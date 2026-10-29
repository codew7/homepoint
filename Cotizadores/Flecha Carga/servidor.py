r"""
Servidor local minimo para usar el cotizador de Flecha Carga desde el navegador (index.html).

No requiere dependencias: usa http.server de la biblioteca estandar y
flechacarga.py. Sirve index.html en http://127.0.0.1:8614 y expone la API:

    GET  /api/tarifas                 -> tarifario (tarifas.json) + Puntos Flecha de cada destino
    POST /api/tarifas/importar        -> importa un CSV nuevo (cuerpo = texto del CSV; header X-Archivo = nombre)
    POST /api/sucursales/actualizar   -> vuelve a descargar los Puntos Flecha del sitio
    POST /api/cotizar                 -> flechacarga.cotizar(...) en JSON

Uso:
    py -3 servidor.py [puerto]
    (abre el navegador automaticamente; Ctrl+C para detener)

Corre en el puerto 8614 para convivir con los otros cotizadores (8611 Correo,
8612 Via Cargo, 8613 Comparador).
"""

import json
import os
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from flechacarga import (
    cargar_sucursales,
    cargar_tarifas,
    cotizar,
    descargar_sucursales,
    importar_tarifario,
    resolver_destino,
    sucursales_de,
)

HOST = "127.0.0.1"
PORT = 8614
BASE_DIR = Path(__file__).resolve().parent

# Importar tarifario y descargar sucursales escriben archivos en disco: de a uno por vez.
_lock = threading.Lock()


def _catalogo(tarifas: dict) -> dict:
    # Se agregan a cada destino los indices de sus Puntos Flecha, asi la UI no
    # repite la logica de cruce por nombre.
    try:
        suc = cargar_sucursales()
    except Exception as e:  # sin internet la primera vez: se cotiza igual
        suc = {"actualizado": None, "sucursales": [], "error": str(e)}
    pos = {id(s): i for i, s in enumerate(suc["sucursales"])}
    destinos = [dict(d, puntos=[pos[id(s)] for s in sucursales_de(d, suc["sucursales"])]) for d in tarifas["destinos"]]
    return dict(tarifas, destinos=destinos, sucursales=suc["sucursales"],
                sucursales_actualizado=suc.get("actualizado"), sucursales_error=suc.get("error"))


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
        if self.path == "/api/tarifas":
            try:
                with _lock:
                    self._json(HTTPStatus.OK, _catalogo(cargar_tarifas()))
            except Exception as e:
                self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"No se pudo leer el tarifario: {e}"})
            return
        if not self.path.startswith(("/index.html", "/logo-flechacarga.png")):
            self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/tarifas/importar":
            texto = self._leer_cuerpo().decode("utf-8-sig", errors="replace")
            nombre = unquote(self.headers.get("X-Archivo") or "") or "tarifario.csv"
            try:
                with _lock:
                    datos = importar_tarifario(texto=texto, nombre_fuente=nombre)
                    self._json(HTTPStatus.OK, _catalogo(datos))
            except ValueError as e:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
            return
        if self.path == "/api/sucursales/actualizar":
            try:
                with _lock:
                    descargar_sucursales()
                    self._json(HTTPStatus.OK, _catalogo(cargar_tarifas()))
            except Exception as e:
                self._json(HTTPStatus.BAD_GATEWAY, {"error": f"No se pudo descargar el listado de Flecha Carga: {e}"})
            return
        if self.path != "/api/cotizar":
            self._json(HTTPStatus.NOT_FOUND, {"error": "no encontrado"})
            return

        try:
            datos = json.loads(self._leer_cuerpo() or b"{}")
            factor = float(datos.get("factor_vol") or 0) or None
            resultado = cotizar(
                resolver_destino(str(datos["destino"])),
                peso_kg=float(str(datos["peso"]).replace(",", ".")),
                largo_cm=float(datos.get("largo") or 0),
                ancho_cm=float(datos.get("ancho") or 0),
                alto_cm=float(datos.get("alto") or 0),
                seguro=float(datos.get("seguro") or 0),
                factor_vol=factor,
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as e:
            self._json(HTTPStatus.BAD_REQUEST, {"error": f"Parametros invalidos: {e}"})
            return
        self._json(HTTPStatus.OK, resultado)

    def _leer_cuerpo(self) -> bytes:
        try:
            return self.rfile.read(int(self.headers.get("Content-Length", 0)))
        except ValueError:
            return b""

    def _json(self, status, payload):
        cuerpo = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)


def main():
    os.chdir(BASE_DIR)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    puerto = int(args[0]) if args else PORT
    server = ThreadingHTTPServer((HOST, puerto), Handler)
    url = f"http://{HOST}:{puerto}/"
    print(f"Cotizador Flecha Carga disponible en {url}  (Ctrl+C para detener)")
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
