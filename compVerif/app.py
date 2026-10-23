r"""
Lanzador de la app de escritorio "Verificador de comprobantes" (ejecutable portable).

Levanta servidor.py en un puerto libre de 127.0.0.1 y lo muestra en una ventana
propia (pywebview sobre Edge WebView2, que ya viene con Windows 10/11). Al cerrar
la ventana se cierra todo.

Portable: los datos (historial y copias de los comprobantes) quedan en la carpeta
"Verificador - datos" junto al .exe. Si esa carpeta no se puede escribir (por
ejemplo, el .exe esta en Archivos de programa), se usa %LOCALAPPDATA%.

Desarrollo (sin compilar):
    venv\Scripts\python.exe app.py
Compilar el .exe:
    venv\Scripts\python.exe construir.py
"""

import ctypes
import os
import sys
import threading
from pathlib import Path

NOMBRE = "Verificador de comprobantes"
CONGELADO = getattr(sys, "frozen", False)
RECURSOS = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
JUNTO_AL_EXE = Path(sys.executable).resolve().parent if CONGELADO else Path(__file__).resolve().parent

ANCHO, ALTO = 420, 700


def carpeta_datos():
    preferida = JUNTO_AL_EXE / "Verificador - datos" if CONGELADO else JUNTO_AL_EXE / "datos"
    try:
        preferida.mkdir(exist_ok=True)
        prueba = preferida / ".escritura"
        prueba.write_text("ok")
        prueba.unlink()
        return preferida
    except OSError:
        alternativa = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / NOMBRE
        alternativa.mkdir(parents=True, exist_ok=True)
        return alternativa


def una_sola_instancia():
    """Mutex con nombre: si la app ya esta abierta, no se abre otra."""
    if os.name != "nt":
        return True
    ctypes.windll.kernel32.CreateMutexW(None, False, "Local\\VerificadorComprobantes")
    if ctypes.windll.kernel32.GetLastError() == 183:  # ERROR_ALREADY_EXISTS
        ctypes.windll.user32.MessageBoxW(None, "El verificador ya está abierto.", NOMBRE, 0x40)
        return False
    return True


def main():
    if not una_sola_instancia():
        return
    os.environ["VERIFICADOR_DATOS"] = str(carpeta_datos())
    if os.name == "nt":
        # Icono propio en la barra de tareas (si no, Windows agrupa la ventana bajo python/pywebview)
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("HomePoint.VerificadorComprobantes")

    import webview
    from http.server import ThreadingHTTPServer
    import servidor

    servidor.BASE_DIR = RECURSOS
    http = ThreadingHTTPServer(("127.0.0.1", 0), servidor.Handler)
    threading.Thread(target=http.serve_forever, daemon=True).start()

    webview.create_window(NOMBRE, f"http://127.0.0.1:{http.server_address[1]}/", width=ANCHO, height=ALTO,
                          min_size=(380, 560), background_color="#F4F4F6", text_select=True)
    webview.start(private_mode=False, storage_path=str(Path(os.environ["VERIFICADOR_DATOS"]) / "ventana"),
                  icon=str(RECURSOS / "icono.ico"))
    http.shutdown()


if __name__ == "__main__":
    main()
