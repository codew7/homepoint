r"""
Servidor local del comparador de envios: Correo Argentino (Paq.ar) + Via Cargo.

Reutiliza los cotizadores hermanos sin copiarlos (../Correo y ../ViaCargo se
agregan al sys.path) y expone una unica API para la interfaz (index.html):

    GET  /api/estado                    -> sesion del Correo, fechas de catalogos, limites de Via Cargo
    GET  /api/destinos                  -> catalogo unificado por CP (destinos.py)
    POST /api/destinos/actualizar       -> {"catalogo": "localidades" | "sucursales" | "agencias" | "todos"}
    GET  /api/sucursales?provincia=     -> sucursales del Correo de una provincia (eleccion manual)
    GET  /api/sucursal?codigo=          -> direccion / horario de una sucursal del Correo
    GET  /api/agencias?cp=&localidad=   -> agencias de Via Cargo en un CP / localidad
    POST /api/correo/cotizar            -> cotizador.cotizar(...)  (Playwright, serializado con lock)
    POST /api/viacargo/cotizar          -> viacargo.cotizar(...)   (HTTP directo)
    POST /api/correo/abrir              -> abre MiCorreo visible con el formulario cargado (+ destinatario opcional)
    GET  /api/pedidos                   -> pedidos pendientes de pedidosv2 (pedidos.py, solo lectura)
    GET  /api/pedido?id=                -> un pedido (datos frescos del cliente)
    POST /api/pedidos/login             -> {"email", "password"} de pedidosv2
    POST /api/pedidos/salir             -> borra la sesion de pedidosv2

Uso:
    ..\Correo\venv\Scripts\python.exe servidor.py [puerto]     (o Cotizador.bat)

Puerto 8613 para convivir con los cotizadores individuales (8611 y 8612).
"""

import json
import os
import subprocess
import sys
import threading
import time
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
CORREO_DIR = BASE_DIR.parent / "Correo"
VIACARGO_DIR = BASE_DIR.parent / "ViaCargo"
for d in (CORREO_DIR, VIACARGO_DIR):
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))

# cotizador/auth/sucursales del Correo usan rutas relativas (.env, auth_state.json,
# browser_profile/, sucursales.json): el proceso trabaja con cwd = ../Correo.
os.chdir(CORREO_DIR)

import auth as correo_auth  # noqa: E402
from cotizador import cotizar as cotizar_correo  # noqa: E402
from sucursales import cargar_sucursales, detalle_sucursal  # noqa: E402
from viacargo import (  # noqa: E402
    agencias_en,
    cargar_agencias,
    cargar_localidades,
    cotizar as cotizar_viacargo,
    descargar_agencias,
    limites_valor_declarado,
)
from destinos import PROVINCIAS, actualizar_catalogos, cargar_destinos, normalizar  # noqa: E402
import pedidos  # noqa: E402

HOST = "127.0.0.1"
PORT = 8613

# El Correo se cotiza con un navegador que comparte auth_state.json: de a uno.
_lock_correo = threading.Lock()
# Las descargas de catalogos escriben en disco: de a una.
_lock_catalogos = threading.Lock()

ESTATICOS = {
    "/index.html": BASE_DIR / "index.html",
    "/logo-correo.png": CORREO_DIR / "logo-correo.png",
    "/logo-viacargo.png": VIACARGO_DIR / "logo-viacargo.png",
}


def _numero(x, nombre: str) -> float:
    try:
        return float(str(x).strip().replace(",", "."))
    except (TypeError, ValueError):
        raise ValueError(f"{nombre} invalido: {x!r}")


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    # ---------- GET ----------

    def do_GET(self):
        url = urlparse(self.path)
        ruta, query = url.path, parse_qs(url.query)
        if ruta in ("/", ""):
            ruta = "/index.html"
        if ruta in ESTATICOS:
            self._archivo(ESTATICOS[ruta])
            return
        if ruta == "/api/estado":
            self._json(HTTPStatus.OK, self._estado())
            return
        if ruta == "/api/destinos":
            with _lock_catalogos:
                self._json(HTTPStatus.OK, cargar_destinos())
            return
        if ruta == "/api/sucursales":
            prov = normalizar((query.get("provincia") or [""])[0])
            datos = cargar_sucursales() or {}
            lista = [{"codigo": s["codigo"], "nombre": s["nombre"], "cp": s["cp"]}
                     for s in (datos.get("provincias") or {}).get(prov, []) if s.get("HABILITADA") != "N"]
            self._json(HTTPStatus.OK, {"provincia": prov, "sucursales": lista})
            return
        if ruta == "/api/sucursal":
            codigo = (query.get("codigo") or [""])[0].strip()
            if not codigo:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "falta el parametro codigo"})
                return
            try:
                self._json(HTTPStatus.OK, detalle_sucursal(codigo))
            except ValueError as e:
                self._json(HTTPStatus.NOT_FOUND, {"error": str(e)})
            except Exception as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo consultar la sucursal: {e}"})
            return
        if ruta == "/api/agencias":
            cp = (query.get("cp") or [""])[0].strip()
            localidad = (query.get("localidad") or [""])[0].strip()
            try:
                lista = agencias_en(cp, localidad) if (cp or localidad) else cargar_agencias()["agencias"]
            except Exception as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo cargar el listado de agencias: {e}"})
                return
            lista = sorted(lista, key=lambda a: (not a.get("recibe_encomiendas"), a.get("nombre", "")))
            self._json(HTTPStatus.OK, {"agencias": lista})
            return
        if ruta == "/api/limites":
            self._json(HTTPStatus.OK, limites_valor_declarado())
            return
        if ruta == "/api/pedidos":
            self._pedidos(lambda: {"pedidos": pedidos.listar_pendientes(), **pedidos.estado()})
            return
        if ruta == "/api/pedido":
            pid = (query.get("id") or [""])[0].strip()
            self._pedidos(lambda: pedidos.obtener(pid))
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})

    def _pedidos(self, fn):
        try:
            self._json(HTTPStatus.OK, fn())
        except pedidos.SinSesion as e:
            self._json(HTTPStatus.UNAUTHORIZED, {"error": str(e), "sin_sesion": True})
        except ValueError as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
        except LookupError as e:
            self._json(HTTPStatus.NOT_FOUND, {"error": str(e)})
        except Exception as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudieron leer los pedidos: {e}"})

    def _estado(self):
        sesion = correo_auth.STATE_FILE
        edad = time.time() - sesion.stat().st_mtime if sesion.exists() else None
        sucursales = cargar_sucursales() or {}
        try:
            localidades = cargar_localidades()
        except Exception:
            localidades = {}
        try:
            agencias = cargar_agencias()
        except Exception:
            agencias = {}
        return {
            "correo": {
                "credenciales": bool(os.environ.get("MICORREO_EMAIL") and os.environ.get("MICORREO_PASSWORD")),
                "sesion_guardada": sesion.exists(),
                "sesion_fresca": correo_auth._session_is_fresh(),
                "sesion_minutos": round(edad / 60) if edad is not None else None,
                "sucursales": sucursales.get("total"),
                "sucursales_actualizado": sucursales.get("actualizado"),
            },
            "viacargo": {
                "localidades": localidades.get("cantidad"),
                "localidades_actualizado": localidades.get("actualizado"),
                "agencias": agencias.get("cantidad"),
                "agencias_actualizado": agencias.get("actualizado"),
                "limites": limites_valor_declarado(),
            },
            "provincias": PROVINCIAS,
            "ocupado_correo": _lock_correo.locked(),
            "pedidos": pedidos.estado(),
        }

    # ---------- POST ----------

    def do_POST(self):
        ruta = urlparse(self.path).path
        datos = self._leer_json()
        if datos is None:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "JSON invalido"})
            return
        if ruta == "/api/correo/cotizar":
            self._correo_cotizar(datos)
        elif ruta == "/api/viacargo/cotizar":
            self._viacargo_cotizar(datos)
        elif ruta == "/api/correo/abrir":
            self._correo_abrir(datos)
        elif ruta == "/api/destinos/actualizar":
            self._actualizar(datos)
        elif ruta == "/api/pedidos/login":
            self._pedidos(lambda: pedidos.iniciar_sesion(datos.get("email"), datos.get("password")))
        elif ruta == "/api/pedidos/salir":
            pedidos.cerrar_sesion()
            self._json(HTTPStatus.OK, pedidos.estado())
        else:
            self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})

    def _params_paquete(self, datos):
        return dict(
            peso_kg=_numero(datos["peso"], "peso"),
            largo_cm=_numero(datos["largo"], "largo"),
            ancho_cm=_numero(datos["ancho"], "ancho"),
            alto_cm=_numero(datos["alto"], "alto"),
            valor=_numero(datos["valor"], "valor"),
        )

    def _correo_cotizar(self, datos):
        try:
            params = dict(
                provincia=normalizar(datos["provincia"]),
                tipo_entrega=datos.get("entrega", "domicilio"),
                cp=(str(datos.get("cp") or "").strip() or None),
                sucursal_destino=(str(datos.get("sucursal_destino") or "").strip() or None),
                sucursal_origen=(str(datos.get("sucursal_origen") or "").strip() or None),
                **self._params_paquete(datos),
            )
            if params["provincia"] not in PROVINCIAS:
                raise ValueError(f"provincia desconocida: {params['provincia']}")
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        inicio = time.time()
        with _lock_correo:
            espera = time.time() - inicio
            try:
                resultado = cotizar_correo(**params)
            except (RuntimeError, ValueError) as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": str(e)})
                return
            except Exception as e:  # Playwright / red
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(e).__name__}: {e}"})
                return
        resultado["_segundos"] = round(time.time() - inicio, 1)
        resultado["_espera"] = round(espera, 1)
        self._json(HTTPStatus.OK, resultado)

    def _viacargo_cotizar(self, datos):
        try:
            params = dict(
                cp_origen=str(datos["origen"]).strip(),
                cp_destino=str(datos["destino"]).strip(),
                pago=str(datos.get("pago") or "P"),
                bultos=int(datos.get("bultos") or 1),
                **self._params_paquete(datos),
            )
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        inicio = time.time()
        try:
            resultado = cotizar_viacargo(**params)
        except ValueError as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            return
        except RuntimeError as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": str(e)})
            return
        except Exception as e:
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(e).__name__}: {e}"})
            return
        resultado["_segundos"] = round(time.time() - inicio, 1)
        self._json(HTTPStatus.OK, resultado)

    def _correo_abrir(self, datos):
        # Igual que el cotizador del Correo: proceso aparte para que la ventana visible
        # no bloquee al servidor (queda abierta hasta que el usuario la cierra).
        try:
            p = self._params_paquete(datos)
            args = [
                sys.executable, str(CORREO_DIR / "cotizador.py"), "--abrir",
                "--provincia", normalizar(datos["provincia"]),
                "--entrega", str(datos.get("entrega", "domicilio")),
                "--peso", str(p["peso_kg"]), "--largo", str(p["largo_cm"]), "--ancho", str(p["ancho_cm"]),
                "--alto", str(p["alto_cm"]), "--valor", str(p["valor"]),
            ]
            if datos.get("cp"):
                args += ["--cp", str(datos["cp"]).strip()]
            if datos.get("sucursal_destino"):
                args += ["--sucursal-destino", str(datos["sucursal_destino"]).strip()]
            if datos.get("sucursal_origen"):
                args += ["--sucursal-origen", str(datos["sucursal_origen"]).strip()]
            # Destinatario del pedido asignado (opcional): MiCorreo lo deja completo.
            dest = datos.get("destinatario") or {}
            for clave, flag in (("nombre", "--dest-nombre"), ("email", "--dest-email"), ("cod_area", "--dest-cod-area"),
                                ("celular", "--dest-celular"), ("nro_orden", "--nro-orden")):
                valor = str(dest.get(clave) or "").strip()
                if valor:
                    args += [flag, valor]
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        subprocess.Popen(args, cwd=str(CORREO_DIR), creationflags=flags, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        self._json(HTTPStatus.OK, {"ok": True})

    def _actualizar(self, datos):
        cual = str(datos.get("catalogo") or "todos")
        if cual not in ("todos", "localidades", "sucursales", "agencias"):
            self._json(HTTPStatus.BAD_REQUEST, {"error": "catalogo desconocido"})
            return
        try:
            with _lock_catalogos:
                hecho = {}
                if cual in ("todos", "agencias"):
                    hecho["agencias"] = descargar_agencias()["cantidad"]
                if cual != "agencias":
                    # Las sucursales del Correo se bajan con el navegador (requiere sesion).
                    if cual in ("todos", "sucursales"):
                        with _lock_correo:
                            hecho.update(actualizar_catalogos(cual))
                    else:
                        hecho.update(actualizar_catalogos(cual))
        except Exception as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo actualizar ({cual}): {e}"})
            return
        self._json(HTTPStatus.OK, {"ok": True, "actualizado": hecho})

    # ---------- utilidades ----------

    def _archivo(self, path: Path):
        if not path.exists():
            self._json(HTTPStatus.NOT_FOUND, {"error": f"falta {path.name}"})
            return
        tipo = "text/html; charset=utf-8" if path.suffix == ".html" else "image/png"
        cuerpo = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(cuerpo)

    def _leer_json(self):
        try:
            largo = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(largo) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None

    def _json(self, status, payload):
        cuerpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)


def main():
    numeros = [a for a in sys.argv[1:] if a.isdigit()]
    puerto = int(numeros[0]) if numeros else PORT
    server = ThreadingHTTPServer((HOST, puerto), Handler)
    url = f"http://{HOST}:{puerto}/"
    print(f"Comparador de envios disponible en {url}  (Ctrl+C para detener)")
    if "--sin-navegador" not in sys.argv:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
