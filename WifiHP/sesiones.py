"""
Logica de la red para clientes: une el hotspot, los filtros y el tiempo de cada telefono.

  * Activar: clave nueva, se enciende la red y se cargan los filtros.
  * Cada telefono (por MAC) tiene su contador desde que aparece por primera vez. Si se
    desconecta y vuelve, el contador sigue corriendo (no se reinicia reconectando).
  * Al vencer o al cortarlo a mano, se bloquea todo su trafico.
  * Apagar (a mano, o solo si nadie la usa un rato): se apaga la red, se borran filtros y
    contadores. La proxima vez la clave es otra, asi una foto vieja del QR no sirve.

Un hilo revisa el estado una vez por segundo; la interfaz solo lee `estado()`.
"""

import secrets
import threading
import time
import winreg

import segno

import config
from hotspot import ErrorHotspot, Hotspot
from trafico import ErrorFiltro, Filtro

CONSONANTES = "bcdfgjklmnprstvz"
VOCALES = "aeiou"


def clave_nueva():
    """Clave facil de dictar: dos silabas, guion y cuatro numeros (ej. 'lupa-4821')."""
    silabas = "".join(secrets.choice(CONSONANTES) + secrets.choice(VOCALES) for _ in range(2))
    return f"{silabas}-{secrets.randbelow(10000):04d}"


def qr_svg(ssid, clave):
    texto = ssid.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace(":", "\\:").replace('"', '\\"')
    pw = clave.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace(":", "\\:").replace('"', '\\"')
    qr = segno.make(f"WIFI:T:WPA;S:{texto};P:{pw};;", error="m")
    return qr.svg_inline(scale=1, border=0, dark="#0B0F0E", light=None, omitsize=True)


def _sin_ahorro_de_energia():
    """Windows apaga el hotspot solo si no hay nadie conectado ~5 min; lo controla la app."""
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Services\icssvc\Settings",
                            0, winreg.KEY_SET_VALUE) as k:
            winreg.SetValueEx(k, "PeerlessTimeoutEnabled", 0, winreg.REG_DWORD, 0)
    except OSError:
        pass  # sin administrador: queda el comportamiento de Windows


class Control:
    def __init__(self):
        self.cfg = config.cargar()
        self.hotspot = Hotspot()
        self.filtro = Filtro()
        self._candado = threading.RLock()
        self._ocupado = None  # "encendiendo" / "apagando" mientras Windows trabaja
        self._error = ""
        self._reset()
        # Si quedo encendida de una sesion anterior (clave desconocida), arrancar limpio.
        if self.hotspot.encendido():
            try:
                self.hotspot.apagar()
            except Exception:
                pass
        threading.Thread(target=self._vigilar, name="vigilar", daemon=True).start()

    def _reset(self):
        self.activa = False
        self.limitado = False  # encendida pero sin filtros (sin permisos de administrador)
        self.ssid = self.clave = self.qr = ""
        self.desde = 0.0
        self.ultimo_uso = 0.0
        self.sesiones = {}  # mac -> {inicio, nombre, ips, estado: activo|vencido|cortado, conectado}

    # --- acciones de la interfaz ---------------------------------------------------------------

    def activar(self):
        with self._candado:
            if self.activa or self._ocupado:
                return self.estado()
            self._ocupado, self._error = "encendiendo", ""
        try:
            ssid, clave = self.cfg["ssid"], clave_nueva()
            _sin_ahorro_de_energia()
            self.hotspot.encender(ssid, clave)
            limitado = False
            try:
                self.filtro.activar()
            except ErrorFiltro as e:
                limitado = True
                config.registrar(f"filtros no disponibles: {e}")
            with self._candado:
                self._reset()
                self.activa, self.ssid, self.clave = True, ssid, clave
                self.qr = qr_svg(ssid, clave)
                self.desde = self.ultimo_uso = time.time()
                self.limitado = limitado
            config.registrar(f"encendida '{ssid}'" + (" (sin filtros)" if limitado else ""))
        except ErrorHotspot as e:
            self._error = str(e)
        except Exception as e:  # cualquier otra cosa de Windows: mensaje generico + detalle al log
            config.registrar(f"error al encender: {e!r}")
            self._error = "No se pudo encender la red para clientes. Probá de nuevo en unos segundos."
        finally:
            self._ocupado = None
        return self.estado()

    def apagar(self, motivo="a mano"):
        with self._candado:
            if self._ocupado == "apagando":
                return self.estado()
            self._ocupado = "apagando"
        try:
            self.filtro.desactivar()
            try:
                self.hotspot.apagar()
            except Exception as e:
                config.registrar(f"error al apagar: {e!r}")
            if self.activa:
                usados = len(self.sesiones)
                config.registrar(f"apagada ({motivo}), {usados} cliente(s)")
            with self._candado:
                self._reset()
        finally:
            self._ocupado = None
        return self.estado()

    def cortar(self, mac):
        with self._candado:
            s = self.sesiones.get(mac)
            if s and s["estado"] == "activo":
                s["estado"] = "cortado"
                config.registrar(f"cortado {s['nombre'] or mac}")
                self._bloquear(s)
        return self.estado()

    def guardar_config(self, datos):
        self.cfg = config.guardar({**self.cfg, **(datos or {})})
        return self.estado()

    # --- estado para la interfaz ----------------------------------------------------------------

    def estado(self):
        ahora = time.time()
        with self._candado:
            limite = self.cfg["minutos"] * 60
            clientes = []
            for mac, s in self.sesiones.items():
                if not s["conectado"]:
                    continue
                clientes.append({
                    "mac": mac,
                    "nombre": s["nombre"] or "Teléfono",
                    "estado": s["estado"],
                    "restante": max(0, limite - (ahora - s["inicio"])) if s["estado"] == "activo" else 0,
                    "total": limite,
                })
            clientes.sort(key=lambda c: (c["estado"] != "activo", -c["restante"]))
            return {
                "activa": self.activa,
                "ocupado": self._ocupado,
                "error": self._error,
                "ssid": self.ssid,
                "clave": self.clave,
                "qr": self.qr,
                "clientes": clientes,
                "limitado": self.limitado,
                "conexion": self.hotspot.conexion(),
                "cfg": self.cfg,
            }

    # --- vigilancia -----------------------------------------------------------------------------

    def _bloquear(self, s):
        for ip in s["ips"]:
            try:
                self.filtro.bloquear(ip)
            except ErrorFiltro as e:
                config.registrar(f"no se pudo bloquear {ip}: {e}")

    def _vigilar(self):
        while True:
            time.sleep(1)
            try:
                self._revisar()
            except Exception as e:
                config.registrar(f"vigilancia: {e!r}")

    def _revisar(self):
        if not self.activa or self._ocupado:
            return
        if not self.hotspot.encendido():
            # La apagaron desde Configuracion de Windows (o se cayo): sincronizar.
            self.apagar("desde Windows")
            return
        ahora = time.time()
        conectados = {c["mac"]: c for c in self.hotspot.clientes()}
        with self._candado:
            limite = self.cfg["minutos"] * 60
            for s in self.sesiones.values():
                s["conectado"] = False
            for mac, c in conectados.items():
                s = self.sesiones.get(mac)
                if s is None:
                    s = self.sesiones[mac] = {"inicio": ahora, "nombre": c["nombre"], "ips": [], "estado": "activo"}
                    config.registrar(f"conectado {c['nombre'] or mac}")
                s["conectado"] = True
                s["nombre"] = c["nombre"] or s["nombre"]
                nuevas = [ip for ip in c["ips"] if ip not in s["ips"]]
                s["ips"] += nuevas
                if s["estado"] == "activo" and ahora - s["inicio"] >= limite:
                    s["estado"] = "vencido"
                    config.registrar(f"vencido {s['nombre'] or mac}")
                if s["estado"] != "activo" and (nuevas or not set(s["ips"]) <= self.filtro.bloqueadas()):
                    self._bloquear(s)
            # Apagado automatico: se mide desde que no queda ningun telefono conectado.
            if conectados:
                self.ultimo_uso = ahora
        auto = self.cfg["apagado_auto_min"]
        if auto and ahora - self.ultimo_uso >= auto * 60:
            self.apagar("sin dispositivos")
