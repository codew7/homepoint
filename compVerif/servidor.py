r"""
Servidor local del verificador de comprobantes de transferencia.

Se arrastra o pega el comprobante y se analiza solo, sin cargar ningun dato:

    lector.py    revision visual y lectura con Claude (suscripcion, CLI `claude -p`)
    forense.py   mapa ELA, PDF con cosas agregadas encima, texto interno del PDF
    reglas.py    digitos verificadores, fecha, numero de operacion repetido

API para la interfaz (index.html):

    GET  /api/estado                      -> Claude disponible
    POST /api/analizar?nombre=            -> cuerpo: bytes del archivo; devuelve el analisis completo
    POST /api/releer {id}                 -> vuelve a revisar el comprobante con Claude
    GET  /api/historial?q=                -> lista liviana (busca por operacion, banco, titular)
    GET  /api/analisis?id=                -> analisis completo
    GET  /api/archivo?id=[&ela=1]         -> el comprobante guardado o su mapa ELA
    POST /api/veredicto {id, veredicto: "aprobado"|"rechazado"|""}
    POST /api/borrar {id}

Uso:
    venv\Scripts\python.exe servidor.py [puerto] [--sin-navegador]     (o Verificador.bat)
"""

import json
import mimetypes
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import forense
import historial
import lector
import reglas
from reglas import aviso

BASE_DIR = Path(__file__).resolve().parent
PUERTO = 8614
MAX_BYTES = 25 * 1024 * 1024
EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}

# Distancia maxima (bits de 1024) para considerar dos imagenes "casi iguales"
UMBRAL_DHASH = 25


# ------------------------------------------------------------------ analisis --

def _quienes(lista):
    partes = [f"#{p['id']} del {p['creado'][:10]}" for p in lista[:5]]
    return ", ".join(partes) + (f" y {len(lista) - 5} más" if len(lista) > 5 else "")


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


def evaluar(reg):
    """Recalcula avisos y semaforo de un registro (sin volver a leer el archivo)."""
    datos = reg.get("datos") or {}
    cuando = reglas.a_fecha(datos)
    reg["fecha_op"] = cuando.isoformat() if cuando else None
    reg["monto"] = reglas.a_numero(datos.get("monto"))
    previos = historial.todos_menos(reg.get("id"))
    avisos = list(reg["forense"].get("avisos") or [])
    lectura = reg.get("lectura") or {}
    if lectura.get("estado") == "error":
        avisos.append(aviso("amarillo", "No se pudo revisar el comprobante con Claude", lectura.get("mensaje", ""), "visual"))
    if reg["forense"].get("tipo") == "pdf":
        avisos += forense.cruzar_texto_pdf(reg["forense"].get("texto"), datos)
    avisos += reglas.evaluar(datos, previos) + control_duplicados(reg, previos)
    avisos.sort(key=lambda a: -reglas.ORDEN.get(a["gravedad"], 0))
    reg["avisos"] = avisos
    reg["semaforo"] = reglas.semaforo(avisos)
    return reg


def leer_con_claude(reg, data):
    try:
        datos, info = lector.leer(data, reg["extension"])
        reg["datos"] = datos
        reg["lectura"] = {"estado": "ok", **info}
    except RuntimeError as e:
        reg.setdefault("datos", {})
        reg["lectura"] = {"estado": "error", "mensaje": str(e)}


def ruta_archivo(id_, extension):
    return historial.ARCHIVOS_DIR / f"{id_}{extension}"


def analizar(data, nombre):
    extension = Path(nombre or "").suffix.lower() or (".pdf" if data[:5] == b"%PDF-" else ".jpg")
    if extension not in EXTENSIONES:
        raise ValueError(f"Formato {extension} no soportado. Usá JPG, PNG, WEBP o PDF.")
    reg = {"archivo": nombre, "extension": extension, "datos": {}, "forense": {}}
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
                return self._json({"claude": lector.disponible(), "modelo": lector.MODELO})
            if url.path == "/api/historial":
                return self._json({"items": historial.listar(q.get("q", "").strip())})
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
                return self._json(publico(analizar(data, q.get("nombre", ""))))

            body = json.loads(self._cuerpo() or b"{}")
            reg = historial.obtener(int(body["id"]))
            if not reg:
                return self._error("No existe ese análisis", HTTPStatus.NOT_FOUND)
            if url.path == "/api/releer":
                leer_con_claude(reg, ruta_archivo(reg["id"], reg["extension"]).read_bytes())
                evaluar(reg)
                historial.guardar(reg)
                return self._json(publico(reg))
            if url.path == "/api/veredicto":
                valor = body.get("veredicto") or ""
                if valor not in ("aprobado", "rechazado", ""):
                    return self._error("Veredicto inválido")
                historial.veredicto(reg["id"], valor)
                return self._json(publico(historial.obtener(reg["id"])))
            if url.path == "/api/borrar":
                historial.borrar(reg["id"])
                return self._json({"ok": True})
            return self._error("No encontrado", HTTPStatus.NOT_FOUND)
        except (KeyError, ValueError, json.JSONDecodeError) as e:
            return self._error(str(e))
        except Exception as e:
            return self._error(f"Error inesperado: {e}", HTTPStatus.INTERNAL_SERVER_ERROR)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    puerto = int(args[0]) if args else PUERTO
    servidor = ThreadingHTTPServer(("127.0.0.1", puerto), Handler)
    url = f"http://127.0.0.1:{puerto}"
    print(f"Verificador de comprobantes en {url}  (Ctrl+C para cerrar)")
    if "--sin-navegador" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
