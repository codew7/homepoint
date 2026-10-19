"""
Inicia sesion en MiCorreo a mano (vos escribis el usuario/contrasena en la
ventana del navegador, nunca en este script) y guarda el estado de sesion
(cookies) en auth_state.json para que cotizador.py lo reutilice sin volver
a loguearse cada vez.

La sesion dura un tiempo limitado (las pruebas mostraron accessToken con
vigencia de 2 horas). Cuando cotizador.py empiece a fallar, volve a correr
este script.

Uso:
    python login.py
"""

from pathlib import Path
from playwright.sync_api import sync_playwright

START_URL = "https://micorreo.correoargentino.com.ar/landing"
TARGET_SUBSTR = "envioCla"
STATE_FILE = Path("auth_state.json")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        print(f"Abriendo {START_URL}")
        print("Inicia sesion manualmente y navega hasta la pantalla de cotizacion (envioCla).")
        print("Una vez que veas el formulario de cotizacion cargado, cerra la ventana del navegador.\n")

        page.goto(START_URL)

        try:
            page.wait_for_event("close", timeout=0)
        except Exception:
            pass

        try:
            context.storage_state(path=str(STATE_FILE))
            print(f"\nSesion guardada en {STATE_FILE.resolve()}")
        except Exception as e:
            print(f"\nNo se pudo guardar la sesion: {e}")

        browser.close()


if __name__ == "__main__":
    main()
