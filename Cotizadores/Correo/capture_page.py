"""
Guarda el HTML completo de la pantalla de cotizacion de MiCorreo (envioCla)
despues de que inicies sesion a mano, para poder leer el formulario completo
(las opciones de peso/destino y como arman el codigo SAP).

Uso:
    python capture_page.py
"""

from pathlib import Path
from playwright.sync_api import sync_playwright

START_URL = "https://micorreo.correoargentino.com.ar/landing"
TARGET_SUBSTR = "envioCla"
OUTPUT_FILE = Path("envioCla_full.html")


def main():
    saved = {"done": False}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        def maybe_save(pg):
            if saved["done"]:
                return
            if TARGET_SUBSTR in pg.url:
                try:
                    html = pg.content()
                    OUTPUT_FILE.write_text(html, encoding="utf-8")
                    saved["done"] = True
                    print(f"Guardado HTML completo de {pg.url} en {OUTPUT_FILE.resolve()}")
                except Exception as e:
                    print("Error guardando:", e)

        page.on("load", lambda: maybe_save(page))

        print(f"Abriendo {START_URL}")
        print("Inicia sesion manualmente y navega hasta la pantalla de cotizacion (envioCla).")
        print("Una vez que la pagina cargue completamente, el HTML se guarda solo.")
        print("Despues podes cerrar el navegador.\n")

        page.goto(START_URL)

        try:
            page.wait_for_event("close", timeout=0)
        except Exception:
            pass

        # Por si el evento 'load' no llego a dispararse mientras el navegador seguia abierto
        maybe_save(page)

        browser.close()

    if not saved["done"]:
        print("No se detecto la pagina envioCla. Volve a intentar navegando manualmente hasta ahi.")


if __name__ == "__main__":
    main()
