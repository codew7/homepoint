r"""
Servidor local minimo para usar el cotizador de Via Cargo desde el navegador (index.html).

No requiere dependencias: usa http.server de la biblioteca estandar y el
cliente viacargo.py (urllib). Sirve index.html en http://127.0.0.1:8612 y
expone la API:

    POST /api/cotizar                 -> viacargo.cotizar(...) en JSON
    GET  /api/localidades             -> listado de localidades con CP (cache localidades.json)
    POST /api/localidades/actualizar  -> vuelve a descargarlo de Via Cargo
    GET  /api/agencias                -> listado de agencias (cache agencias.json)
    POST /api/agencias/actualizar     -> vuelve a descargarlo de Via Cargo
    GET  /api/limites                 -> minimo / maximo de valor declarado

Uso:
    .\venv\Scripts\python.exe servidor.py [puerto]
    (abre el navegador automaticamente; Ctrl+C para detener)

Corre en el puerto 8612 para convivir con el cotizador del Correo (8611).
"""

import json
import os
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from viacargo import (
    cargar_agencias,
    cargar_localidades,
    cotizar,
    descargar_agencias,
    descargar_localidades,
    limites_valor_declarado,
)

HOST = "127.0.0.1"
PORT = 8612
BASE_DIR = Path(__file__).resolve().parent

# Las descargas de catalogos escriben archivos en disco: de a una por vez.
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
        if self.path == "/api/localidades":
            self._catalogo(cargar_localidades, descargar_localidades, forzar=False)
            return
        if self.path == "/api/agencias":
            self._catalogo(cargar_agencias, descargar_agencias, forzar=False)
            return
        if self.path == "/api/limites":
            self._json(HTTPStatus.OK, limites_valor_declarado())
            return
        if not self.path.startswith(("/index.html", "/logo-viacargo.png")):
            self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/localidades/actualizar":
            self._catalogo(cargar_localidades, descargar_localidades, forzar=True)
            return
        if self.path == "/api/agencias/actualizar":
            self._catalogo(cargar_agencias, descargar_agencias, forzar=True)
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
                cp_origen=str(datos["origen"]).strip(),
                cp_destino=str(datos["destino"]).strip(),
                peso_kg=float(str(datos["peso"]).replace(",", ".")),
                largo_cm=float(datos["largo"]),
                ancho_cm=float(datos["ancho"]),
                alto_cm=float(datos["alto"]),
                valor=float(datos["valor"]),
                pago=str(datos.get("pago") or "P"),
                bultos=int(datos.get("bultos") or 1),
            )
        except (KeyError, TypeError, ValueError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return

        try:
            resultado = cotizar(**params)
        except ValueError as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            return
        except RuntimeError as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": str(e)})
            return
        except Exception as e:  # cualquier otra falla de red
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"{type(e).__name__}: {e}"})
            return
        self._json(HTTPStatus.OK, resultado)

    def _catalogo(self, cargar, descargar, forzar: bool):
        # Listados grandes (localidades / agencias): se descargan la primera vez o
        # cuando se pide actualizar; despues se sirven desde disco.
        try:
            with _lock:
                datos = descargar() if forzar else cargar()
        except Exception as e:
            self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo descargar el listado de Via Cargo: {e}"})
            return
        self._json(HTTPStatus.OK, datos)

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
    os.chdir(BASE_DIR)
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    server = ThreadingHTTPServer((HOST, puerto), Handler)
    url = f"http://{HOST}:{puerto}/"
    print(f"Cotizador Via Cargo disponible en {url}  (Ctrl+C para detener)")
    threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
