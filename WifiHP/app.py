r"""
WiFi Clientes: comparte el internet de la PC por una red Wi-Fi temporal para clientes.

    .venv\Scripts\python.exe app.py              (pide administrador para los filtros)
    .venv\Scripts\python.exe app.py --sin-admin  (prueba de interfaz, sin filtros)

Una sola instancia: si ya esta abierta (aunque este en la bandeja), se trae al frente.
Cerrar con la red encendida la deja en la bandeja; "Salir" desde la bandeja apaga todo.
"""

import ctypes
import os
import subprocess
import sys
import threading
import winreg
from pathlib import Path

import pystray
import webview
from PIL import Image, ImageDraw

import config
from sesiones import Control
from trafico import es_admin

TITULO = config.NOMBRE
CONGELADO = getattr(sys, "frozen", False)
RAIZ = Path(sys._MEIPASS) if CONGELADO else Path(__file__).resolve().parent
ANCHO, ALTO = 380, 660

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32


# --- arranque ------------------------------------------------------------------------------------

TAREA = "WiFi Clientes"  # tarea programada que crea el instalador (privilegios altos, sin aviso UAC)


def elevar_si_hace_falta():
    """Sin administrador no hay filtros. Instalada: se relanza por la tarea programada, sin
    aviso de Windows. Si no hay tarea, pide permiso; si lo niegan, sigue en modo basico."""
    if es_admin() or "--sin-admin" in sys.argv:
        return
    if CONGELADO:
        r = subprocess.run(["schtasks", "/run", "/tn", TAREA], capture_output=True,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        if r.returncode == 0:
            sys.exit(0)
    if CONGELADO:
        exe, params = sys.executable, " ".join(sys.argv[1:])
    else:
        exe = sys.executable.replace("python.exe", "pythonw.exe")
        params = f'"{Path(__file__).resolve()}" ' + " ".join(sys.argv[1:])
    if ctypes.windll.shell32.ShellExecuteW(None, "runas", exe, params, str(RAIZ), 1) > 32:
        sys.exit(0)


def instancia_unica():
    """True si somos la primera. Si no, trae al frente la ventana que ya esta abierta."""
    kernel32.CreateMutexW(None, False, "Local\\WiFiClientes.instancia")
    if kernel32.GetLastError() != 183:  # ERROR_ALREADY_EXISTS
        return True
    hwnd = user32.FindWindowW(None, TITULO)
    if hwnd:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
    return False


def tema_oscuro():
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as k:
            return winreg.QueryValueEx(k, "AppsUseLightTheme")[0] == 0
    except OSError:
        return False


# --- icono de bandeja ----------------------------------------------------------------------------

def icono(encendido):
    """Ondas de Wi-Fi: verde si la red esta activa, gris si no."""
    n = 64
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    color = (52, 211, 153, 255) if encendido else (150, 158, 154, 255)
    cx, cy = n / 2, n * 0.78
    for r in (27, 18, 9):
        d.arc((cx - r, cy - r, cx + r, cy + r), 225, 315, fill=color, width=6)
    d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=color)
    return img


class Bandeja:
    def __init__(self, ventana, control):
        self._ventana, self._control = ventana, control
        self._encendido = None
        menu = pystray.Menu(
            pystray.MenuItem("Abrir", self._abrir, default=True),
            pystray.MenuItem("Apagar red", self._apagar, enabled=lambda _: self._control.activa),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Salir", self._salir),
        )
        self.icono = pystray.Icon("wificlientes", icono(False), TITULO, menu)
        threading.Thread(target=self.icono.run, name="bandeja", daemon=True).start()

    def actualizar(self, encendido, clientes):
        texto = f"{TITULO}: {'activa' if encendido else 'apagada'}"
        if encendido:
            texto += f" · {clientes} conectado(s)"
        self.icono.title = texto
        if encendido != self._encendido:
            self._encendido = encendido
            self.icono.icon = icono(encendido)

    def _abrir(self, *_):
        self._ventana.show()
        self._ventana.restore()

    def _apagar(self, *_):
        self._control.apagar()

    def _salir(self, *_):
        salir(self._ventana, self._control, self)


def salir(ventana, control, bandeja):
    control.apagar("al salir")
    bandeja.icono.stop()
    ventana.destroy()


# --- puente con la interfaz ----------------------------------------------------------------------

class Api:
    """Metodos que llama ui/app.js. Los atributos privados no se exponen a JS."""

    def __init__(self, control):
        self._control = control
        self._ventana = None
        self._bandeja = None

    def estado(self):
        e = self._control.estado()
        if self._bandeja:
            self._bandeja.actualizar(e["activa"], sum(c["estado"] == "activo" for c in e["clientes"]))
        return e

    def activar(self):
        return self._control.activar()

    def apagar(self):
        return self._control.apagar()

    def cortar(self, mac):
        return self._control.cortar(mac)

    def guardar_config(self, datos):
        return self._control.guardar_config(datos)

    def minimizar(self):
        self._ventana.minimize()

    def cerrar(self):
        # Con la red encendida queda en la bandeja para que los contadores sigan corriendo.
        if self._control.activa:
            self._ventana.hide()
            self._bandeja.icono.notify("Sigue funcionando acá. Abrí desde este ícono para apagarla.", TITULO)
        else:
            salir(self._ventana, self._control, self._bandeja)


def main():
    elevar_si_hace_falta()
    if not instancia_unica():
        return
    config.registrar(f"inicio (administrador: {'sí' if es_admin() else 'no'})")
    control = Control()
    api = Api(control)
    fondo = "#0B0E0D" if tema_oscuro() else "#F3F4F1"
    ventana = webview.create_window(
        TITULO, str(RAIZ / "ui" / "index.html"), js_api=api,
        width=ANCHO, height=ALTO, resizable=False, frameless=True, easy_drag=False,
        background_color=fondo,
    )
    api._ventana = ventana
    api._bandeja = Bandeja(ventana, control)
    webview.start(private_mode=False, storage_path=str(config.DATOS / "ventana"))
    # Ventana cerrada por cualquier via: nunca dejar la red encendida sin control.
    if control.activa:
        control.apagar("al cerrar")
    api._bandeja.icono.stop()
    os._exit(0)


if __name__ == "__main__":
    main()
