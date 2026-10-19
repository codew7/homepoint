"""
Lectura de pedidos de pedidosv2 (Firebase Realtime Database) para asignarlos a una cotizacion.

Solo lee: nunca escribe en la base. La configuracion (apiKey, databaseURL) se toma de
../../pedidosv2/config.js para no duplicarla.

La apiKey esta restringida por referer a los sitios publicados, asi que el login y la
renovacion del token se hacen desde este proceso enviando el referer del sitio
(REFERER). La base se consulta por REST con el idToken (?auth=).

La sesion (email + refresh token) queda en pedidos_sesion.json (en .gitignore); el
idToken dura 1 h y se renueva solo.

Uso:
    ..\\Correo\\venv\\Scripts\\python.exe pedidos.py            # estado de la sesion y cantidad de pedidos pendientes
    ..\\Correo\\venv\\Scripts\\python.exe pedidos.py perez      # buscar pedidos por nombre, codigo o telefono
"""

import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CONFIG_JS = BASE_DIR.parent.parent / "pedidosv2" / "config.js"
SESION_FILE = BASE_DIR / "pedidos_sesion.json"
REFERER = "https://homepoint-admin.dev.ar/"
ESTADOS_PENDIENTES = ("ABIERTO", "CERRADO")
TIMEOUT = 20

_lock = threading.Lock()
_token = {"id_token": None, "vence": 0.0}


class SinSesion(Exception):
    """No hay sesion de pedidosv2 (o vencio y no se pudo renovar)."""


def _config() -> dict:
    if not CONFIG_JS.exists():
        raise RuntimeError(f"No se encontro {CONFIG_JS}")
    texto = CONFIG_JS.read_text(encoding="utf-8")
    cfg = {}
    for clave in ("apiKey", "databaseURL"):
        m = re.search(clave + r'\s*:\s*"([^"]+)"', texto)
        if not m:
            raise RuntimeError(f"Falta {clave} en {CONFIG_JS.name}")
        cfg[clave] = m.group(1).rstrip("/")
    return cfg


def _pedir(url, datos=None, form=False):
    cuerpo, cabeceras = None, {"Referer": REFERER}
    if datos is not None:
        if form:
            cuerpo = urllib.parse.urlencode(datos).encode()
            cabeceras["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            cuerpo = json.dumps(datos).encode()
            cabeceras["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=cuerpo, headers=cabeceras)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read() or b"{}")
        except ValueError:
            err = {}
        mensaje = err.get("error")
        if isinstance(mensaje, dict):
            mensaje = mensaje.get("message")
        raise _ErrorHttp(e.code, str(mensaje or e.reason)) from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"Sin conexion con Firebase: {e.reason}") from None


class _ErrorHttp(Exception):
    def __init__(self, codigo, mensaje):
        super().__init__(mensaje)
        self.codigo, self.mensaje = codigo, mensaje


MENSAJES_LOGIN = {
    "INVALID_LOGIN_CREDENTIALS": "Usuario o contraseña incorrectos.",
    "INVALID_PASSWORD": "Usuario o contraseña incorrectos.",
    "EMAIL_NOT_FOUND": "Usuario o contraseña incorrectos.",
    "INVALID_EMAIL": "El email no es válido.",
    "USER_DISABLED": "El usuario está deshabilitado.",
}


def _leer_sesion():
    try:
        return json.loads(SESION_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def estado() -> dict:
    s = _leer_sesion()
    return {"conectado": bool(s and s.get("refresh_token")), "email": (s or {}).get("email")}


def iniciar_sesion(email: str, password: str) -> dict:
    email = (email or "").strip()
    if not email or not password:
        raise ValueError("Falta el email o la contraseña.")
    cfg = _config()
    try:
        r = _pedir(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + cfg["apiKey"],
            {"email": email, "password": password, "returnSecureToken": True},
        )
    except _ErrorHttp as e:
        clave = e.mensaje.split(" ")[0].split(":")[0]
        if clave.startswith("TOO_MANY_ATTEMPTS"):
            raise ValueError("Demasiados intentos fallidos: esperá unos minutos.") from None
        raise ValueError(MENSAJES_LOGIN.get(clave, f"No se pudo iniciar sesión: {e.mensaje}")) from None
    with _lock:
        SESION_FILE.write_text(json.dumps({"email": r.get("email") or email, "uid": r.get("localId"), "refresh_token": r["refreshToken"]}), encoding="utf-8")
        _token.update(id_token=r["idToken"], vence=time.time() + int(r.get("expiresIn", 3600)) - 120)
    return estado()


def cerrar_sesion():
    with _lock:
        _token.update(id_token=None, vence=0.0)
        try:
            SESION_FILE.unlink()
        except FileNotFoundError:
            pass


def _id_token() -> str:
    with _lock:
        if _token["id_token"] and time.time() < _token["vence"]:
            return _token["id_token"]
        s = _leer_sesion()
        if not s or not s.get("refresh_token"):
            raise SinSesion("Iniciá sesión con tu usuario de pedidosv2.")
        cfg = _config()
        try:
            r = _pedir("https://securetoken.googleapis.com/v1/token?key=" + cfg["apiKey"],
                       {"grant_type": "refresh_token", "refresh_token": s["refresh_token"]}, form=True)
        except _ErrorHttp as e:
            if e.codigo in (400, 401, 403):
                raise SinSesion("La sesión de pedidosv2 venció: volvé a iniciar sesión.") from None
            raise RuntimeError(f"No se pudo renovar la sesión: {e.mensaje}") from None
        if r.get("refresh_token") and r["refresh_token"] != s["refresh_token"]:
            s["refresh_token"] = r["refresh_token"]
            SESION_FILE.write_text(json.dumps(s), encoding="utf-8")
        _token.update(id_token=r["id_token"], vence=time.time() + int(r.get("expires_in", 3600)) - 120)
        return _token["id_token"]


def _leer(ruta: str, **query):
    cfg = _config()
    params = {"auth": _id_token(), **{k: json.dumps(v) for k, v in query.items()}}
    url = f"{cfg['databaseURL']}/{ruta}.json?{urllib.parse.urlencode(params)}"
    try:
        return _pedir(url)
    except _ErrorHttp as e:
        if e.codigo == 401:
            with _lock:
                _token.update(id_token=None, vence=0.0)
            raise SinSesion("La sesión de pedidosv2 no tiene permiso: volvé a iniciar sesión.") from None
        raise RuntimeError(f"Firebase respondió {e.codigo}: {e.mensaje}") from None


def _resumen(pid: str, p: dict) -> dict:
    c = p.get("cliente") or {}
    items = p.get("items") or []
    if isinstance(items, dict):
        items = list(items.values())
    return {
        "id": pid,
        "codigo": pid[-8:].upper(),
        "status": p.get("status") or "",
        "timestamp": p.get("timestamp") or 0,
        "tipo_entrega": p.get("tipoEntrega") or "",
        "nota": p.get("nota") or "",
        "items": len([i for i in items if i]),
        "cliente": {k: str(c.get(k) or "").strip() for k in ("nombre", "telefono", "email", "dni", "direccion", "localidad", "provincia")},
    }


def listar_pendientes() -> list:
    """Pedidos ABIERTO y CERRADO (los pendientes de pedidosv2), mas nuevos primero."""
    _id_token()  # falla rapido (SinSesion) antes de lanzar las consultas
    with ThreadPoolExecutor(len(ESTADOS_PENDIENTES)) as ex:
        partes = list(ex.map(lambda st: _leer("pedidos", orderBy="status", equalTo=st) or {}, ESTADOS_PENDIENTES))
    lista = [_resumen(pid, p) for parte in partes for pid, p in parte.items() if isinstance(p, dict)]
    lista.sort(key=lambda x: x["timestamp"], reverse=True)
    return lista


def obtener(pid: str) -> dict:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", pid or ""):
        raise ValueError("Código de pedido inválido.")
    p = _leer("pedidos/" + pid)
    if not isinstance(p, dict):
        raise LookupError("El pedido no existe.")
    return _resumen(pid, p)


def main():
    try:
        e = estado()
        if not e["conectado"]:
            print("Sin sesion de pedidosv2: iniciala desde la UI del comparador.")
            return
        lista = listar_pendientes()
    except (SinSesion, RuntimeError) as err:
        print(f"Error: {err}", file=sys.stderr)
        sys.exit(1)
    print(f"Sesion: {e['email']} · {len(lista)} pedidos pendientes")
    filtro = " ".join(sys.argv[1:]).strip().lower()
    for p in lista:
        c = p["cliente"]
        texto = f"{p['codigo']} {c['nombre']} {c['telefono']} {c['localidad']}".lower()
        if filtro and filtro not in texto:
            continue
        print(f"  {p['codigo']}  {p['status']:<8} {c['nombre'][:30]:<30} {c['localidad'][:22]:<22} {c['provincia']}")


if __name__ == "__main__":
    main()
