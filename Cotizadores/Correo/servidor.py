r"""
Servidor local minimo para usar el cotizador desde el navegador (index.html).

No requiere dependencias extra: usa http.server de la biblioteca estandar.
Sirve index.html en http://127.0.0.1:8611 y expone POST /api/cotizar, que
llama a cotizador.cotizar(...) y devuelve el JSON resultante.

Uso:
    .\venv\Scripts\python.exe servidor.py
    (abre el navegador automaticamente; Ctrl+C para detener)

Las cotizaciones se serializan con un lock: cada una abre un navegador
Playwright y comparte auth_state.json, asi que se atienden de a una.
"""

import json
import os
import subprocess
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from cotizador import cotizar
from sucursales import cargar_sucursales, descargar_sucursales, detalle_sucursal
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = 8611
BASE_DIR = Path(__file__).resolve().parent

_lock = threading.Lock()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def log_message(self, fmt, *args):
        # Silenciar el ruido de archivos estaticos; solo mostrar la API.
        if "/api/" in (args[0] if args else ""):
            super().log_message(fmt, *args)

    def do_GET(self):
        if self.path in ("/", ""):
            self.path = "/index.html"
        if self.path == "/api/sucursales":
            self._sucursales(forzar=False)
            return
        if self.path.startswith("/api/sucursal?"):
            # Direccion / horario de una sucursal, desde el buscador publico del Correo.
            codigo = (parse_qs(urlparse(self.path).query).get("codigo") or [""])[0]
            if not codigo:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "falta el parametro codigo"})
                return
            try:
                self._json(HTTPStatus.OK, detalle_sucursal(codigo))
            except ValueError as e:
                self._json(HTTPStatus.NOT_FOUND, {"error": str(e)})
            except Exception as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo consultar el detalle de la sucursal: {e}"})
            return
        if not self.path.startswith(("/index.html", "/logo-correo.png")):
            self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})
            return
        super().do_GET()

    def _sucursales(self, forzar: bool):
        # Listado completo de sucursales por provincia. Se descarga del sitio la
        # primera vez (o cuando se pide actualizar) y despues se sirve desde disco.
        datos = None if forzar else cargar_sucursales()
        if datos is None:
            with _lock:
                try:
                    datos = descargar_sucursales()
                except Exception as e:
                    self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo descargar el listado de sucursales: {e}"})
                    return
        self._json(HTTPStatus.OK, datos)

    def _leer_json(self):
        try:
            largo = int(self.headers.get("Content-Length", 0))
            return json.loads(self.rfile.read(largo) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return None

    def do_POST(self):
        if self.path == "/api/sucursales/actualizar":
            self._sucursales(forzar=True)
            return
        if self.path == "/api/abrir":
            self._abrir()
            return
        if self.path != "/api/cotizar":
            self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})
            return

        datos = self._leer_json()
        if datos is None:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "JSON invalido"})
            return

        try:
            params = dict(
                provincia=str(datos["provincia"]),
                tipo_entrega=datos.get("entrega", "domicilio"),
                cp=(str(datos.get("cp") or "").strip() or None),
                sucursal_destino=(str(datos.get("sucursal_destino") or "").strip() or None),
                sucursal_origen=(str(datos.get("sucursal_origen") or "").strip() or None),
                peso_kg=float(str(datos["peso"]).replace(",", ".")),
                largo_cm=float(datos["largo"]),
                ancho_cm=float(datos["ancho"]),
                alto_cm=float(datos["alto"]),
                valor=float(datos["valor"]),
            )
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return

        with _lock:
            try:
                resultado = cotizar(**params)
            except (RuntimeError, ValueError) as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": str(e)})
                return
            except Exception as e:  # cualquier falla de Playwright / red
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(e).__name__}: {e}"})
                return

        self._json(HTTPStatus.OK, resultado)

    def _abrir(self):
        # Abre MiCorreo en un navegador visible con el formulario completo, en un
        # proceso aparte: la ventana queda abierta el tiempo que el usuario necesite
        # para cargar el destinatario y pagar, sin bloquear al servidor.
        datos = self._leer_json()
        if datos is None:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "JSON invalido"})
            return
        try:
            args = [
                sys.executable, str(BASE_DIR / "cotizador.py"), "--abrir",
                "--provincia", str(datos["provincia"]),
                "--entrega", str(datos.get("entrega", "domicilio")),
                "--peso", str(float(str(datos["peso"]).replace(",", "."))),
                "--largo", str(float(datos["largo"])), "--ancho", str(float(datos["ancho"])),
                "--alto", str(float(datos["alto"])), "--valor", str(float(datos["valor"])),
            ]
            if datos.get("cp"):
                args += ["--cp", str(datos["cp"]).strip()]
            if datos.get("sucursal_destino"):
                args += ["--sucursal-destino", str(datos["sucursal_destino"]).strip()]
            if datos.get("sucursal_origen"):
                args += ["--sucursal-origen", str(datos["sucursal_origen"]).strip()]
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return

        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        subprocess.Popen(args, cwd=str(BASE_DIR), creationflags=flags, stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        self._json(HTTPStatus.OK, {"ok": True})

    def _json(self, status, payload):
        cuerpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)


def main():
    # cotizador/auth usan rutas relativas (.env, auth_state.json, browser_profile/).
    os.chdir(BASE_DIR)
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    server = ThreadingHTTPServer((HOST, puerto), Handler)
    url = f"http://{HOST}:{puerto}/"
    print(f"Cotizador disponible en {url}  (Ctrl+C para detener)")
    threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
