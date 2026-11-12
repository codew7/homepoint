r"""
Servidor local del verificador de comprobantes de transferencia.

Se arrastra o pega el comprobante y se analiza solo, sin cargar ningun dato:

    lector.py    revision visual y lectura con Claude (suscripcion, CLI `claude -p`),
                 comparando con comprobantes reales aprobados del mismo banco
    forense.py   mapa ELA, PDF con cosas agregadas encima, texto interno del PDF,
                 huellas de imagen hecha o editada con IA
    reglas.py    digitos verificadores, fecha, numero de operacion repetido
    whatsapp.py  opcional: baja los comprobantes de WhatsAppSync y los analiza solos

API para la interfaz (index.html):

    GET  /api/estado                      -> Claude disponible
    POST /api/analizar?nombre=            -> cuerpo: bytes del archivo; devuelve el analisis completo
    POST /api/releer {id}                 -> vuelve a revisar el comprobante con Claude
    GET  /api/historial?q=                -> lista liviana (busca por operacion, banco, titular)
    GET  /api/analisis?id=                -> analisis completo
    GET  /api/archivo?id=[&ela=1]         -> el comprobante guardado o su mapa ELA
    POST /api/veredicto {id, veredicto: "aprobado"|"rechazado"|""}
    POST /api/borrar {id}

    GET  /api/whatsapp                    -> estado de la descarga y del analisis automatico
    POST /api/whatsapp/activar {activo}
    POST /api/whatsapp/carpeta {ruta}     (o {elegir: true}: abre el selector de carpetas)
    POST /api/whatsapp/analizar {wa_id}   (sin wa_id: todos los sin analizar)

Uso:
    venv\Scripts\python.exe servidor.py [puerto] [--sin-navegador]     (o Verificador.bat)
"""

import json
import mimetypes
import sys
import threading
import webbrowser
from http import HTTPStatus
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import forense
import historial
import lector
import reglas
import whatsapp
from reglas import aviso

BASE_DIR = Path(__file__).resolve().parent
PUERTO = 8614
MAX_BYTES = 25 * 1024 * 1024
EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}

# Distancia maxima (bits de 1024) para considerar dos imagenes "casi iguales"
UMBRAL_DHASH = 25

# Comprobantes aprobados que se le muestran a Claude como referencia (uno por banco,
# los de diseno mas parecido primero)
MAX_REFERENCIAS = 3

# Mismo comprobante recibido otra vez sin que sea sospechoso: en el mismo chat de
# WhatsApp (mismo pedido, o dentro de HORAS_REENVIO si alguno no tiene pedido), o
# pegado a mano despues de que llego por WhatsApp (dentro de DIAS_CRUCE_MANUAL).
HORAS_REENVIO = 48
DIAS_CRUCE_MANUAL = 3

# El selector de carpetas de la ventana (lo pone app.py; en el navegador no hay)
ELEGIR_CARPETA = None

# Analisis manuales en curso: el automatico de WhatsApp les cede el paso
_manuales = 0
_manuales_lock = threading.Lock()


def manual_en_curso():
    return _manuales > 0


# ------------------------------------------------------------------ analisis --

def _quienes(lista):
    partes = [f"#{p['id']} del {p['creado'][:10]}" for p in lista[:5]]
    return ", ".join(partes) + (f" y {len(lista) - 5} más" if len(lista) > 5 else "")


def _ms(iso):
    try:
        return int(datetime.fromisoformat(iso).timestamp() * 1000)
    except (TypeError, ValueError):
        return 0


def _mismo_comprobante(reg, p):
    """True si p es el mismo comprobante (mismo archivo, texto, imagen casi igual o mismo
    numero de operacion) Y con el mismo monto. Con otro monto nunca: seria una edicion."""
    f, monto = reg["forense"], reg.get("monto")
    if not (monto and p.get("monto") and abs(monto - p["monto"]) < 0.01):
        return False
    if (f.get("sha256") and f["sha256"] == p.get("sha256")) or (f.get("texto_hash") and f["texto_hash"] == p.get("texto_hash")):
        return True
    d = forense.hamming(f.get("dhash"), p.get("dhash"))
    if d is not None and d <= UMBRAL_DHASH:
        return True
    datos = reg.get("datos") or {}
    codigos = {str(datos.get(k) or "").strip() for k in ("numero_operacion", "id_coelsa")} - {""}
    return bool(codigos & {p.get("operacion"), p.get("coelsa")})


def reenvio(reg, p):
    """Motivo si p es el mismo comprobante recibido otra vez de forma esperable; None si no.
    El mismo comprobante desde otro telefono o para otro pedido NO es un reenvio: es la
    senal mas fuerte de un comprobante reutilizado y sigue saliendo en rojo."""
    if not _mismo_comprobante(reg, p):
        return None
    o = reg.get("origen") or {}
    po = ((historial.obtener(p["id"]) or {}).get("origen") or {}) if p.get("origen") == "whatsapp" else {}
    if o.get("tipo") == "whatsapp" and po:
        if not o.get("tel") or o["tel"] != po.get("tel"):
            return None
        if o.get("pedido") and po.get("pedido"):
            return "reenviado en el mismo chat, para el mismo pedido" if o["pedido"] == po["pedido"] else None
        cerca = abs((o.get("recibido") or 0) - (po.get("recibido") or 0)) <= HORAS_REENVIO * 3600000
        return "reenviado en el mismo chat" if cerca else None
    if (o.get("tipo") == "whatsapp") != bool(po):  # uno pegado a mano y el otro bajado de WhatsApp
        t_reg = o.get("recibido") or _ms(reg.get("creado"))
        t_p = po.get("recibido") or _ms(p.get("creado"))
        if abs(t_reg - t_p) <= DIAS_CRUCE_MANUAL * 86400000:
            return "ya se analizó automáticamente desde WhatsApp" if po else "ya se había analizado a mano"
    return None


def control_duplicados(reg, previos):
    f = reg["forense"]
    monto = reg.get("monto")
    iguales, mismo_texto, parecidos, parecidos_monto = [], [], [], []
    for p in previos:
        if f.get("sha256") and f["sha256"] == p.get("sha256"):
            iguales.append(p)
        elif f.get("texto_hash") and f["texto_hash"] == p.get("texto_hash"):
            mismo_texto.append(p)
        else:
            d = forense.hamming(f.get("dhash"), p.get("dhash"))
            if d is not None and d <= UMBRAL_DHASH:
                mismo_monto = monto and p.get("monto") and abs(monto - p["monto"]) < 0.01
                (parecidos_monto if mismo_monto else parecidos).append(p)
    avisos = []
    if iguales:
        avisos.append(aviso("rojo", "Este mismo archivo ya se analizó", f"Es idéntico a: {_quienes(iguales)}.", "historial"))
    if mismo_texto:
        avisos.append(aviso("rojo", "PDF con exactamente el mismo texto que otro", f"Coincide con: {_quienes(mismo_texto)}.", "historial"))
    if parecidos_monto:
        avisos.append(aviso("rojo", "Imagen casi idéntica a otro comprobante del mismo monto",
                            f"Se parece a: {_quienes(parecidos_monto)}. Puede ser el mismo comprobante reenviado o recortado.", "historial"))
    if parecidos:
        avisos.append(aviso("amarillo", "Imagen casi idéntica a otro comprobante",
                            f"Se parece a: {_quienes(parecidos)}. Compará los dos: puede ser el mismo comprobante con datos cambiados.", "historial"))
    return avisos


def fondos_reales(datos, previos, maximo=20):
    """Colores de fondo de los ultimos comprobantes aprobados del mismo banco."""
    banco = reglas.normalizar(datos.get("banco_origen"))
    if not banco:
        return []
    colores = []
    for p in [p for p in previos if p.get("veredicto") == "aprobado" and reglas.normalizar(p.get("banco")) == banco][:maximo]:
        color = ((historial.obtener(p["id"]) or {}).get("forense", {}).get("meta") or {}).get("fondo")
        if color:
            colores.append(color)
    return colores


def evaluar(reg):
    """Recalcula avisos y semaforo de un registro (sin volver a leer el archivo)."""
    datos = reg.get("datos") or {}
    cuando = reglas.a_fecha(datos)
    reg["fecha_op"] = cuando.isoformat() if cuando else None
    reg["monto"] = reglas.a_numero(datos.get("monto"))
    origen = reg.get("origen") or {}
    copia = origen.get("tipo") == "whatsapp"
    previos = historial.todos_menos(reg.get("id"))

    # Reenvios esperables: no cuentan como comprobante repetido ni como numero de operacion ya usado
    reenvios = {}
    for p in previos:
        motivo = reenvio(reg, p)
        if motivo:
            reenvios.setdefault(motivo, []).append(p)
    vistos = {p["id"] for lista in reenvios.values() for p in lista}
    otros = [p for p in previos if p["id"] not in vistos]

    avisos = list(reg["forense"].get("avisos") or [])
    lectura = reg.get("lectura") or {}
    if lectura.get("estado") == "error":
        avisos.append(aviso("amarillo", "No se pudo revisar el comprobante con Claude", lectura.get("mensaje", ""), "visual"))
    if reg["forense"].get("tipo") == "pdf":
        avisos += forense.cruzar_texto_pdf(reg["forense"].get("texto"), datos)
    avisos += forense.controles_ia(reg["forense"], datos, fondos_reales(datos, previos), copia=copia)
    if copia:
        avisos += controles_copia(origen)
    # En los de WhatsApp, "comprobante de hace N dias" se mide contra cuando lo mando el cliente
    recibido = datetime.fromtimestamp(origen["recibido"] / 1000) if copia and origen.get("recibido") else None
    avisos += reglas.evaluar(datos, otros, ahora=recibido) + control_duplicados(reg, otros)
    for motivo, lista in reenvios.items():
        avisos.append(aviso("info", "Mismo comprobante que otro análisis", f"Coincide con {_quienes(lista)}: {motivo}.", "historial"))
    # Un reenvio no limpia nada: si ese mismo comprobante ya salio alterado (o se rechazo), este tambien
    marcados = [p for lista in reenvios.values() for p in lista
                if p.get("veredicto") == "rechazado" or (p.get("semaforo") == "rojo" and p.get("veredicto") != "aprobado")]
    if marcados:
        avisos.append(aviso("rojo", "Este mismo comprobante ya salió alterado", f"Se marcó así en {_quienes(marcados)}.", "historial"))
    avisos.sort(key=lambda a: -reglas.ORDEN.get(a["gravedad"], 0))
    reg["avisos"] = avisos
    reg["semaforo"] = reglas.semaforo(avisos)
    return reg


def controles_copia(origen):
    """Lo que no se puede controlar en la copia que guarda WhatsAppSync (achicada,
    recomprimida y sin metadatos), para que el verde no parezca mas de lo que es."""
    avisos = [aviso("info", "Analizado desde la copia de WhatsApp",
                    "WhatsAppSync guarda una copia achicada y sin los datos internos del archivo: no se pueden buscar "
                    "sellos de IA o de programas de edición. Si dudás, pedí el archivo original y soltalo acá.", forense.ORIGEN)]
    if origen.get("doc"):
        avisos.append(aviso("amarillo", "Llegó como documento y se analizó una foto de la primera página",
                            "Si era un PDF, no se pudo comparar su texto interno con lo que se ve. Para el control completo, "
                            "descargá el PDF desde WhatsApp y soltalo acá.", forense.ORIGEN))
    return avisos


def referencias(reg):
    """Comprobantes reales (aprobados) para comparar el diseno: el ultimo de cada banco,
    ordenados por parecido visual con el que se analiza. [(bytes, extension, banco)]"""
    f = reg.get("forense") or {}
    por_banco = {}
    for p in historial.todos_menos(reg.get("id")):  # del mas nuevo al mas viejo
        if p.get("veredicto") != "aprobado" or p.get("tipo") != "imagen" or p.get("sha256") == f.get("sha256"):
            continue
        por_banco.setdefault(reglas.normalizar(p.get("banco")) or f"#{p['id']}", p)

    def distancia(p):
        d = forense.hamming(f.get("dhash"), p.get("dhash"))
        return d if d is not None else forense.LADO_DHASH ** 2

    elegidos = []
    for p in sorted(por_banco.values(), key=distancia)[:MAX_REFERENCIAS]:
        ruta = ruta_archivo(p["id"], p.get("extension") or "")
        if ruta.exists():
            elegidos.append((ruta.read_bytes(), ruta.suffix, p.get("banco")))
    return elegidos


def leer_con_claude(reg, data):
    try:
        datos, info = lector.leer(data, reg["extension"], referencias(reg))
        reg["datos"] = datos
        reg["lectura"] = {"estado": "ok", **info}
    except RuntimeError as e:
        reg.setdefault("datos", {})
        reg["lectura"] = {"estado": "error", "mensaje": str(e)}


def ruta_archivo(id_, extension):
    return historial.ARCHIVOS_DIR / f"{id_}{extension}"


def analizar(data, nombre, origen=None):
    """origen: None si se cargo a mano; {"tipo": "whatsapp", wa_id, tel, pedido, cliente,
    recibido (ms), doc} si lo bajo descargar-comprobantes.js."""
    extension = Path(nombre or "").suffix.lower() or (".pdf" if data[:5] == b"%PDF-" else ".jpg")
    if extension not in EXTENSIONES:
        raise ValueError(f"Formato {extension} no soportado. Usá JPG, PNG, WEBP o PDF.")
    reg = {"archivo": nombre, "extension": extension, "datos": {}, "forense": {}}
    if origen:
        reg["origen"] = origen
    reg["id"] = historial.guardar(reg)
    try:
        ruta_archivo(reg["id"], extension).write_bytes(data)
        reg["forense"] = forense.analizar(data, historial.ARCHIVOS_DIR / f"{reg['id']}_ela.png")
    except Exception:
        historial.borrar(reg["id"])
        raise
    leer_con_claude(reg, data)
    evaluar(reg)
    historial.guardar(reg)
    return reg


def analizar_manual(data, nombre):
    global _manuales
    with _manuales_lock:
        _manuales += 1
    try:
        return analizar(data, nombre)
    finally:
        with _manuales_lock:
            _manuales -= 1


WA = whatsapp.Integracion(analizar, manual_en_curso)


def publico(reg):
    """Registro para la interfaz: sin el texto interno del PDF."""
    r = json.loads(json.dumps(reg))
    r.get("forense", {}).pop("texto", None)
    r["ela"] = (historial.ARCHIVOS_DIR / f"{reg['id']}_ela.png").exists()
    return r


# ------------------------------------------------------------------ servidor --

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s - %s\n" % (self.log_date_time_string(), fmt % args))

    def _json(self, obj, status=HTTPStatus.OK):
        cuerpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def _error(self, mensaje, status=HTTPStatus.BAD_REQUEST):
        self._json({"error": mensaje}, status)

    def _cuerpo(self):
        largo = int(self.headers.get("Content-Length") or 0)
        if largo > MAX_BYTES:
            raise ValueError("El archivo supera los 25 MB.")
        return self.rfile.read(largo) if largo else b""

    def _archivo(self, ruta, tipo=None):
        if not ruta.exists():
            return self._error("No encontrado", HTTPStatus.NOT_FOUND)
        cuerpo = ruta.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", tipo or mimetypes.guess_type(ruta.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path in ("/", "/index.html"):
                return self._archivo(BASE_DIR / "index.html", "text/html; charset=utf-8")
            if url.path == "/api/estado":
                return self._json({"claude": lector.disponible(), "modelo": lector.MODELO, "ventana": ELEGIR_CARPETA is not None})
            if url.path == "/api/historial":
                origen = q.get("origen") if q.get("origen") in ("whatsapp", "manual") else None
                return self._json({"items": historial.listar(q.get("q", "").strip(), origen=origen)})
            if url.path == "/api/whatsapp":
                return self._json(WA.estado(limite=min(int(q.get("limite") or 40), 500)))
            if url.path == "/api/analisis":
                reg = historial.obtener(int(q["id"]))
                return self._json(publico(reg)) if reg else self._error("No existe ese análisis", HTTPStatus.NOT_FOUND)
            if url.path == "/api/archivo":
                id_ = int(q["id"])
                if q.get("ela"):
                    return self._archivo(historial.ARCHIVOS_DIR / f"{id_}_ela.png")
                reg = historial.obtener(id_)
                return self._archivo(ruta_archivo(id_, reg["extension"])) if reg else self._error("No existe", HTTPStatus.NOT_FOUND)
            return self._error("No encontrado", HTTPStatus.NOT_FOUND)
        except (KeyError, ValueError) as e:
            return self._error(f"Parámetro inválido: {e}")
        except Exception as e:
            return self._error(f"Error inesperado: {e}", HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self):
        url = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/api/analizar":
                data = self._cuerpo()
                if not data:
                    return self._error("No llegó ningún archivo.")
                return self._json(publico(analizar_manual(data, q.get("nombre", ""))))

            body = json.loads(self._cuerpo() or b"{}")
            if url.path.startswith("/api/whatsapp/"):
                return self._whatsapp(url.path.rsplit("/", 1)[1], body)
            reg = historial.obtener(int(body["id"]))
            if not reg:
                return self._error("No existe ese análisis", HTTPStatus.NOT_FOUND)
            if url.path == "/api/releer":
                leer_con_claude(reg, ruta_archivo(reg["id"], reg["extension"]).read_bytes())
                evaluar(reg)
                historial.guardar(reg)
                WA.exportar()
                return self._json(publico(reg))
            if url.path == "/api/veredicto":
                valor = body.get("veredicto") or ""
                if valor not in ("aprobado", "rechazado", ""):
                    return self._error("Veredicto inválido")
                historial.veredicto(reg["id"], valor)
                WA.exportar()   # la decision manual cambia la marca del archivo y la de pedidosv2
                return self._json(publico(historial.obtener(reg["id"])))
            if url.path == "/api/borrar":
                historial.borrar(reg["id"])
                WA.exportar()
                return self._json({"ok": True})
            return self._error("No encontrado", HTTPStatus.NOT_FOUND)
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            return self._error(str(e))
        except Exception as e:
            return self._error(f"Error inesperado: {e}", HTTPStatus.INTERNAL_SERVER_ERROR)

    def _whatsapp(self, accion, body):
        if accion == "activar":
            WA.activar(bool(body.get("activo")))
        elif accion == "carpeta":
            ruta = body.get("ruta")
            if body.get("elegir"):
                if not ELEGIR_CARPETA:
                    return self._error("Escribí la ruta de la carpeta WhatsAppSync.")
                ruta = ELEGIR_CARPETA()
                if not ruta:
                    return self._json(WA.estado())  # cancelado
            WA.poner_carpeta(ruta)
        elif accion == "analizar":
            WA.encolar(body.get("wa_id") or None)
        else:
            return self._error("No encontrado", HTTPStatus.NOT_FOUND)
        return self._json(WA.estado())


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    puerto = int(args[0]) if args else PUERTO
    servidor = ThreadingHTTPServer(("127.0.0.1", puerto), Handler)
    url = f"http://127.0.0.1:{puerto}"
    print(f"Verificador de comprobantes en {url}  (Ctrl+C para cerrar)")
    WA.iniciar()
    if "--sin-navegador" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
