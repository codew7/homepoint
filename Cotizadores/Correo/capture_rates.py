"""
Captura de trafico de red de MiCorreo (Correo Argentino) para descubrir el
endpoint real de cotizacion de tarifas.

Como funciona:
- Abre un navegador Chromium controlado por Playwright.
- Vos navegas e iniciás sesión A MANO con tu cuenta de MiCorreo (tus
  credenciales nunca las ve este script ni se guardan en ningún lado).
- El script solo escucha las requests/responses hacia dominios de
  correoargentino.com.ar y las guarda en capture_log.jsonl.
- Cuando encuentres la pantalla de cotización, completá el formulario y
  simulá un envío como harías normalmente. Después cerrá el navegador.

Uso:
    python capture_rates.py
"""

import json
from pathlib import Path
from playwright.sync_api import sync_playwright

START_URL = "https://micorreo.correoargentino.com.ar/landing"
DOMAIN_FILTER = "correoargentino.com.ar"
OUTPUT_FILE = Path("capture_log.jsonl")
MAX_BODY_CHARS = 5000


def is_relevant(url: str) -> bool:
    return DOMAIN_FILTER in url and any(
        seg in url for seg in ("/api", "/ed/", "/integration", "/rates", "/cotiz", "/shipment", "/envio")
    )


def main():
    entries = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()

        def handle_response(response):
            req = response.request
            if not is_relevant(req.url):
                return
            entry = {
                "method": req.method,
                "url": req.url,
                "status": response.status,
                "request_headers": {
                    k: v for k, v in req.headers.items() if k.lower() != "cookie"
                },
                "request_body": None,
                "response_body": None,
            }
            try:
                post_data = req.post_data
                if post_data:
                    entry["request_body"] = post_data[:MAX_BODY_CHARS]
            except Exception:
                pass
            try:
                ctype = response.headers.get("content-type", "")
                if "json" in ctype or "text" in ctype:
                    body = response.text()
                    entry["response_body"] = body[:MAX_BODY_CHARS]
            except Exception:
                pass

            entries.append(entry)
            print(f"[{entry['status']}] {entry['method']} {entry['url']}")

        page.on("response", handle_response)

        print(f"Abriendo {START_URL}")
        print("Inicia sesion manualmente, navega hasta la cotizacion,")
        print("completa el formulario y simula un envio.")
        print("Cuando termines, cerra la ventana del navegador.\n")

        page.goto(START_URL)

        # Espera hasta que el usuario cierre el navegador manualmente.
        try:
            page.wait_for_event("close", timeout=0)
        except Exception:
            pass

        browser.close()

    with OUTPUT_FILE.open("w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    print(f"\nListo. Se guardaron {len(entries)} requests relevantes en {OUTPUT_FILE.resolve()}")


if __name__ == "__main__":
    main()
