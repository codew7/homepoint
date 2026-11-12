r"""
Comprobantes de WhatsApp: descarga y analisis automatico (opcional).

Con el interruptor prendido, el verificador:

    1. Corre WhatsAppSync\descargar-comprobantes.js --seguir --json en segundo plano
       (oculto, dentro de un Job de Windows: si se cierra la app, se cierra node).
    2. Mira comprobantes\registro.json y analiza de a uno cada comprobante nuevo con
       el mismo analisis que los manuales (servidor.analizar), del mas viejo al mas
       nuevo, para que un comprobante reutilizado se marque en el segundo envio y no
       en el original. Lo manual siempre tiene prioridad.
    3. Deja el resultado en comprobantes\verificacion.json. El script de Node es el
       unico que renombra los archivos ("[ALTERADO]", "[REVISAR]", "[RECHAZADO]") y
       el unico que escribe en Firebase (imgsIdx/{id}/verif, lo muestra pedidosv2).

Al prenderlo por primera vez se analizan solo los comprobantes de los ultimos
DIAS_ATRAS dias; los anteriores quedan "sin analizar" para hacerlo a mano.
Los ajustes quedan en <datos>\ajustes.json.
"""

import ctypes
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path

import historial
import lector

SCRIPT = "descargar-comprobantes.js"
DIAS_ATRAS = 3
SEGUNDOS_VIGIA = 10
MAX_INTENTOS = 3
MINUTOS_REINTENTO = 15
AJUSTES = historial.DATOS_DIR / "ajustes.json"
SIN_VENTANA = 0x08000000 if os.name == "nt" else 0  # CREATE_NO_WINDOW

# Prioridad para el resultado que se manda a verificacion.json: la decision manual manda
CON_MARCA = ("rojo", "amarillo", "rechazado")


def _ms(dt=None):
    return int((dt or datetime.now()).timestamp() * 1000)


def _leer_json(ruta):
    try:
        return json.loads(Path(ruta).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _escribir_json(ruta, obj):
    """Escritura atomica: nadie llega a leer un archivo a medio escribir."""
    tmp = Path(str(ruta) + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, ruta)


def partes_nombre(archivo):
    """'Cliente - CODIGO - 2026-11-12 (dudoso) [ALTERADO].jpg' -> (cliente, codigo o '')."""
    partes = Path(archivo or "").stem.split(" - ")
    cliente = partes[0].strip() if partes else ""
    codigo = partes[1].strip() if len(partes) > 1 and partes[1].strip() != "SIN PEDIDO" else ""
    return cliente, codigo


# -------------------------------------------------------------- job de windows --

class _Job:
    """Job Object con KILL_ON_JOB_CLOSE: los procesos asignados mueren con esta app,
    aunque se cierre de golpe (no quedan node.exe huerfanos)."""

    def __init__(self):
        self.handle = None
        if os.name != "nt":
            return
        from ctypes import wintypes

        class Basica(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]

        class Io(ctypes.Structure):
            _fields_ = [(n, ctypes.c_uint64) for n in ("Read", "Write", "Other", "ReadT", "WriteT", "OtherT")]

        class Extendida(ctypes.Structure):
            _fields_ = [("Basic", Basica), ("Io", Io), ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        self._k32 = k32
        handle = k32.CreateJobObjectW(None, None)
        if not handle:
            return
        info = Extendida()
        info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if k32.SetInformationJobObject(handle, 9, ctypes.byref(info), ctypes.sizeof(info)):  # ExtendedLimitInformation
            self.handle = handle

    def asignar(self, proceso):
        if self.handle:
            self._k32.AssignProcessToJobObject(self.handle, int(proceso._handle))


# ---------------------------------------------------------------- integracion --

class Integracion:
    def __init__(self, analizar, manual_en_curso):
        """analizar(data, nombre, origen) -> registro; manual_en_curso() -> bool."""
        self._analizar = analizar
        self._manual_en_curso = manual_en_curso
        self._lock = threading.Lock()
        self._despertar = threading.Event()   # cambio de ajustes o trabajo nuevo
        self._job = _Job()
        self._proceso = None
        self._proceso_detenido = False
        self._registro = {}
        self._registro_mtime = None
        self._estado = {"proceso": "apagado", "mensaje": "", "ultima_pasada": None, "analizando": None}
        self.ajustes = _leer_json(AJUSTES)
        self.ajustes.setdefault("activo", False)
        if not self.ajustes.get("carpeta"):
            detectada = next((c for c in self._candidatas() if (c / SCRIPT).exists()), None)
            self.ajustes["carpeta"] = str(detectada) if detectada else ""
        self._iniciado = False

    # ---- ajustes --
    @staticmethod
    def _candidatas():
        aqui = Path(__file__).resolve().parent
        exe = Path(sys.executable).resolve().parent
        return [aqui.parent / "WhatsAppSync", exe.parent / "WhatsAppSync", exe / "WhatsAppSync"]

    def carpeta(self):
        c = self.ajustes.get("carpeta")
        return Path(c) if c else None

    def carpeta_ok(self):
        c = self.carpeta()
        return bool(c and (c / SCRIPT).exists())

    def comprobantes(self):
        return self.carpeta() / "comprobantes"

    def _guardar_ajustes(self):
        _escribir_json(AJUSTES, self.ajustes)
        self._despertar.set()

    def activar(self, activo):
        with self._lock:
            self.ajustes["activo"] = bool(activo)
            if activo and not self.ajustes.get("activado_en"):
                self.ajustes["activado_en"] = _ms()
            self._guardar_ajustes()
        if not activo:
            self._detener_proceso()
        else:
            self._registro_mtime = None   # releer enseguida

    def poner_carpeta(self, ruta):
        ruta = Path(str(ruta or "").strip().strip('"'))
        if ruta.name.lower() == "comprobantes":
            ruta = ruta.parent
        if not (ruta / SCRIPT).exists():
            raise ValueError(f"En esa carpeta no está {SCRIPT}. Elegí la carpeta WhatsAppSync.")
        with self._lock:
            self.ajustes["carpeta"] = str(ruta)
            self._guardar_ajustes()
        self._detener_proceso()
        self._registro_mtime = None

    # ---- arranque --
    def iniciar(self):
        if self._iniciado:
            return
        self._iniciado = True
        historial.borrar_incompletos()
        for destino in (self._supervisar, self._vigilar, self._trabajar):
            threading.Thread(target=destino, daemon=True).start()

    def _activa(self):
        return self.ajustes.get("activo") and self.carpeta_ok()

    def _estado_proceso(self, proceso, mensaje=""):
        self._estado.update(proceso=proceso, mensaje=mensaje)

    # ---- 1. proceso de descarga --
    def _supervisar(self):
        espera = 15
        while True:
            if not self._activa():
                self._estado_proceso("apagado")
                self._despertar.wait(5)
                self._despertar.clear()
                continue
            carpeta = self.carpeta()
            node = shutil.which("node")
            if not node:
                self._estado_proceso("error", "Node.js no está instalado en esta PC (hace falta para descargar los comprobantes).")
                self._despertar.wait(60)
                continue
            if not (carpeta / "node_modules").exists():
                self._estado_proceso("instalando", "Instalando por primera vez…")
                npm = shutil.which("npm.cmd") or shutil.which("npm") or "npm"
                try:
                    r = subprocess.run([npm, "install"], cwd=carpeta, creationflags=SIN_VENTANA, capture_output=True, timeout=900)
                    if r.returncode != 0:
                        raise RuntimeError((r.stderr or r.stdout or b"").decode("utf-8", "replace").strip()[-300:])
                except Exception as e:
                    self._estado_proceso("error", f"No se pudo instalar lo necesario (npm install): {e}")
                    self._despertar.wait(300)
                    continue

            codigo = self._correr(node, carpeta)
            if not self._activa() or self._proceso_detenido:
                espera = 15
                continue
            if codigo == 2:
                self._estado_proceso("error", "Falta la clave de Firebase (clave-firebase.json) en la carpeta WhatsAppSync.")
                self._despertar.wait(120)
            elif codigo == 3:
                self._estado_proceso("error", "Ya hay otra descarga abierta. Cerrá la ventana de descargar-comprobantes.bat.")
                self._despertar.wait(30)
            else:
                self._estado_proceso("error", f"La descarga se cerró (código {codigo}). Se reintenta en {espera} s.")
                self._despertar.wait(espera)
                espera = min(espera * 2, 600)
            self._despertar.clear()

    def _correr(self, node, carpeta):
        self._proceso_detenido = False
        try:
            proceso = subprocess.Popen([node, SCRIPT, "--seguir", "--json"], cwd=carpeta, stdout=subprocess.PIPE,
                                       stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=SIN_VENTANA,
                                       encoding="utf-8", errors="replace")
        except OSError as e:
            self._estado_proceso("error", f"No se pudo abrir la descarga: {e}")
            return -1
        self._job.asignar(proceso)
        self._proceso = proceso
        self._estado_proceso("corriendo", "Conectando…")
        for linea in proceso.stdout:
            linea = linea.strip()
            if not linea.startswith("@@"):
                continue
            try:
                ev = json.loads(linea[2:])
            except ValueError:
                continue
            if ev.get("ev") == "pasada":
                self._estado["ultima_pasada"] = ev
                self._estado_proceso("corriendo", "")
                self._registro_mtime = None   # hay novedades: releer ya
                self._despertar.set()
            elif ev.get("ev") == "error" and ev.get("codigo") == "pasada":
                self._estado_proceso("corriendo", "Error en la última descarga: " + str(ev.get("msg") or ""))
        codigo = proceso.wait()
        self._proceso = None
        return codigo

    def _detener_proceso(self):
        proceso = self._proceso
        if not proceso:
            return
        self._proceso_detenido = True
        try:
            proceso.terminate()
            proceso.wait(10)
        except Exception:
            pass
        # node se corta sin llegar a borrar su candado: se borra aca si es el suyo
        try:
            candado = self.comprobantes() / ".descargando.lock"
            if candado.read_text().strip() == str(proceso.pid):
                candado.unlink()
        except OSError:
            pass
        self._despertar.set()

    # ---- 2. vigia de registro.json --
    def _vigilar(self):
        while True:
            try:
                if self._activa():
                    self._sincronizar()
            except Exception as e:
                self._estado["mensaje"] = f"No se pudo leer el registro de comprobantes: {e}"
            time.sleep(SEGUNDOS_VIGIA)

    def _sincronizar(self):
        ruta = self.comprobantes() / "registro.json"
        try:
            mtime = ruta.stat().st_mtime
        except OSError:
            return
        if mtime == self._registro_mtime:
            return
        registro = _leer_json(ruta)
        self._registro, self._registro_mtime = registro, mtime
        filas = historial.wa_todos()
        limite = (self.ajustes.get("activado_en") or _ms()) - DIAS_ATRAS * 86400000
        nuevos = False
        for wa_id, e in registro.items():
            archivo = e.get("archivo")
            if not archivo:
                continue
            fila = filas.get(wa_id)
            if not fila:
                t = e.get("t")
                if not t:
                    try:
                        t = int((self.comprobantes() / archivo).stat().st_mtime * 1000)  # la descarga le pone la fecha de envio
                    except OSError:
                        continue
                estado = historial.EN_COLA if t >= limite else historial.PENDIENTE
                historial.wa_poner(wa_id, archivo=archivo, t=t, estado=estado)
                nuevos = nuevos or estado == historial.EN_COLA
            elif fila["archivo"] != archivo:
                historial.wa_poner(wa_id, archivo=archivo)
        if nuevos:
            self._despertar.set()

    # ---- 3. analisis de a uno --
    def _siguiente(self):
        ahora = _ms()
        candidatos = []
        for f in historial.wa_todos().values():
            if f["estado"] == historial.EN_COLA:
                candidatos.append(f)
            elif f["estado"] == historial.ERROR and (f["intentos"] or 0) < MAX_INTENTOS:
                cuando = datetime.fromisoformat(f["actualizado"]) if f["actualizado"] else datetime.min
                if _ms(cuando) + MINUTOS_REINTENTO * 60000 <= ahora:
                    candidatos.append(f)
        return min(candidatos, key=lambda f: f["t"] or 0) if candidatos else None

    def _trabajar(self):
        while True:
            try:
                if not self._activa() or self._manual_en_curso():
                    time.sleep(2)
                    continue
                if not lector.disponible():
                    self._estado["mensaje"] = "Claude Code no está disponible: los comprobantes esperan en la cola."
                    time.sleep(30)
                    continue
                fila = self._siguiente()
                if not fila:
                    time.sleep(3)
                    continue
                self._procesar(fila)
            except Exception as e:  # nunca debe morir el hilo
                self._estado["mensaje"] = f"Error en el análisis automático: {e}"
                time.sleep(10)

    def _procesar(self, fila):
        wa_id = fila["wa_id"]
        e = self._registro.get(wa_id) or {}
        archivo = e.get("archivo") or fila["archivo"]
        ruta = self.comprobantes() / archivo
        if not ruta.exists():
            historial.wa_poner(wa_id, estado=historial.ERROR, intentos=MAX_INTENTOS, error="El archivo ya no está en la carpeta.")
            return
        cliente, _ = partes_nombre(archivo)
        origen = {"tipo": "whatsapp", "wa_id": wa_id, "tel": e.get("tel"), "pedido": e.get("pedido"),
                  "cliente": cliente, "recibido": e.get("t") or fila["t"], "doc": bool(e.get("doc"))}
        self._estado["analizando"] = {"wa_id": wa_id, "archivo": archivo, "desde": _ms()}
        try:
            reg = self._analizar(ruta.read_bytes(), archivo, origen)
            if (reg.get("lectura") or {}).get("estado") == "error":
                # Sin la revision de Claude no se marca nada: se borra y se reintenta
                mensaje = (reg["lectura"].get("mensaje") or "No se pudo revisar con Claude")[:300]
                historial.borrar(reg["id"])
                historial.wa_poner(wa_id, estado=historial.ERROR, intentos=(fila["intentos"] or 0) + 1, error=mensaje)
            else:
                historial.wa_poner(wa_id, estado=historial.LISTO, analisis_id=reg["id"], error=None)
        except Exception as ex:
            historial.wa_poner(wa_id, estado=historial.ERROR, intentos=(fila["intentos"] or 0) + 1, error=str(ex)[:300])
        finally:
            self._estado["analizando"] = None
        self.exportar()

    def encolar(self, wa_id=None):
        """Pone en la cola un comprobante (o todos los sin analizar y con error si wa_id es None)."""
        n = 0
        for f in historial.wa_todos().values():
            if (wa_id is None or f["wa_id"] == wa_id) and f["estado"] in (historial.PENDIENTE, historial.ERROR):
                historial.wa_poner(f["wa_id"], estado=historial.EN_COLA, intentos=0, error=None)
                n += 1
        self._despertar.set()
        return n

    # ---- salida para descargar-comprobantes.js --
    def exportar(self):
        """Reescribe comprobantes\\verificacion.json con el resultado de cada comprobante."""
        if not self.carpeta_ok() or not self.comprobantes().exists():
            return
        salida = {}
        for r in historial.wa_resultados():
            try:
                detalle = json.loads(r["detalle"] or "{}")
            except ValueError:
                detalle = {}
            veredicto = r["veredicto"] or ""
            s = veredicto if veredicto in ("aprobado", "rechazado") else (r["semaforo"] or "")
            if not s:
                continue
            avisos = [a for a in detalle.get("avisos") or [] if a.get("gravedad") in ("rojo", "amarillo")]
            if veredicto == "rechazado":
                motivo = "Rechazado en el verificador"
            elif veredicto == "aprobado":
                motivo = "Aprobado en el verificador"
            elif s in ("rojo", "amarillo") and avisos:
                motivo = avisos[0].get("titulo") or ""
            else:
                motivo = "Sin signos de alteración"
            creado = detalle.get("creado")
            t = _ms(datetime.fromisoformat(creado)) if creado else 0
            salida[r["wa_id"]] = {"s": s, "n": r["analisis_id"], "m": motivo[:160], "t": t}
        ruta = self.comprobantes() / "verificacion.json"
        if _leer_json(ruta) != salida:   # sin cambios no se toca (la descarga mira la fecha del archivo)
            _escribir_json(ruta, salida)

    # ---- estado para la interfaz --
    def estado(self, limite=40):
        filas = historial.wa_todos()
        analisis = {a["id"]: a for a in historial.listar(limite=100000, origen="whatsapp")}
        items = []
        for f in sorted(filas.values(), key=lambda f: -(f["t"] or 0)):
            a = analisis.get(f["analisis_id"]) or {}
            cliente, codigo = partes_nombre(f["archivo"])
            items.append({"wa_id": f["wa_id"], "estado": f["estado"], "t": f["t"], "cliente": cliente, "pedido": codigo,
                          "analisis_id": f["analisis_id"], "semaforo": a.get("semaforo"), "veredicto": a.get("veredicto"),
                          "monto": a.get("monto"), "banco": a.get("banco"), "error": f["error"]})
        cuenta = lambda estado: sum(1 for f in filas.values() if f["estado"] == estado)
        alertas = sum(1 for i in items if i["estado"] == historial.LISTO and i["semaforo"] == "rojo" and not i["veredicto"])
        revisar = sum(1 for i in items if i["estado"] == historial.LISTO and i["semaforo"] == "amarillo" and not i["veredicto"])
        analizando = self._estado.get("analizando")
        return {
            "activo": bool(self.ajustes.get("activo")), "carpeta": self.ajustes.get("carpeta") or "",
            "carpeta_ok": self.carpeta_ok(), "proceso": self._estado["proceso"], "mensaje": self._estado["mensaje"],
            "ultima_pasada": self._estado["ultima_pasada"], "analizando": analizando,
            "cola": cuenta(historial.EN_COLA),
            "pendientes": cuenta(historial.PENDIENTE), "errores": sum(1 for f in filas.values() if f["estado"] == historial.ERROR),
            "alertas": alertas, "revisar": revisar, "items": items[:limite],
        }
