"""
Login automatico contra MiCorreo usando credenciales guardadas en .env
(MICORREO_EMAIL / MICORREO_PASSWORD).

El login esta protegido con reCAPTCHA v3 (invisible, basado en un score de
"que tan humano parece" el navegador). Para maximizar ese score:
- se usa un perfil de navegador persistente (browser_profile/), asi las
  cookies de Google se acumulan entre corridas;
- se usa Brave (o Chrome/Edge) real si esta instalado, en vez del Chromium de Playwright;
- se oculta la bandera navigator.webdriver y se tipea con demoras humanas;
- si el recaptcha rechaza, se reintenta varias veces (el rechazo suele ser
  intermitente: el primer intento falla y el segundo pasa).

Si aun asi todos los reintentos fallan y el navegador es visible, se deja la
ventana abierta para que completes el login a mano una vez; el resto del
flujo sigue solo.

Uso:
    from auth import ensure_logged_in
    ensure_logged_in()  # crea/renueva auth_state.json si hace falta
"""

import os
import random
import time
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

LANDING_URL = "https://micorreo.correoargentino.com.ar/landing"
API_BASE = "https://api.correoargentino.com.ar/ed/v2"
STATE_FILE = Path("auth_state.json")
PROFILE_DIR = Path("browser_profile")
SESSION_MAX_AGE_SECONDS = 2 * 60 * 60 - 5 * 60  # ~2 horas observadas, con margen
MAX_INTENTOS_LOGIN = 4
ESPERA_MANUAL_SEGUNDOS = 180


def _session_is_fresh() -> bool:
    if not STATE_FILE.exists():
        return False
    age = time.time() - STATE_FILE.stat().st_mtime
    return age < SESSION_MAX_AGE_SECONDS


BRAVE_RUTAS = [
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "BraveSoftware/Brave-Browser/Application/brave.exe",
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "BraveSoftware/Brave-Browser/Application/brave.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "BraveSoftware/Brave-Browser/Application/brave.exe",
]


def opciones_navegador():
    """Kwargs de lanzamiento en orden de preferencia: Brave, Chrome, Edge y por ultimo el Chromium de Playwright."""
    opciones = []
    brave = next((r for r in BRAVE_RUTAS if r.is_file()), None)
    if brave:
        opciones.append({"executable_path": str(brave)})
    opciones += [{"channel": "chrome"}, {"channel": "msedge"}, {}]
    return opciones


def _launch_context(p, headless: bool):
    args = ["--disable-blink-features=AutomationControlled"]
    # Navegadores reales (Brave/Chrome/Edge) dan mejor score de recaptcha que el Chromium bundled.
    for opcion in opciones_navegador():
        try:
            kwargs = dict(headless=headless, args=args, viewport={"width": 1280, "height": 800}, **opcion)
            return p.chromium.launch_persistent_context(str(PROFILE_DIR), **kwargs)
        except Exception:
            continue
    raise RuntimeError("No se pudo lanzar ningun navegador (brave / chrome / msedge / chromium).")


def _pausa(min_ms: int, max_ms: int, page):
    page.wait_for_timeout(random.randint(min_ms, max_ms))


def _tiene_token(page) -> bool:
    return bool(page.evaluate("() => !!localStorage.getItem('auth_access_token')"))


def _intentar_login(page, email: str, password: str, timeout_ms: int) -> None:
    page.goto(LANDING_URL, wait_until="networkidle")
    _pausa(1500, 3000, page)

    page.mouse.move(random.randint(200, 600), random.randint(200, 500))
    page.click("text=Iniciar sesión")
    page.wait_for_selector("input[name='email']", timeout=timeout_ms)
    _pausa(500, 1200, page)

    ultimo_error = ""
    for intento in range(1, MAX_INTENTOS_LOGIN + 1):
        page.fill("input[name='email']", "")
        page.type("input[name='email']", email, delay=random.randint(40, 110))
        _pausa(300, 800, page)
        page.fill("input[name='password']", "")
        page.type("input[name='password']", password, delay=random.randint(40, 110))
        # reCAPTCHA v3 junta senales de comportamiento: le damos un par de segundos.
        _pausa(1500, 3000, page)

        with page.expect_response(lambda r: "/auth/login" in r.url, timeout=timeout_ms) as resp_info:
            page.click("button:has-text('Ingresar')")
        response = resp_info.value

        if response.status == 200:
            page.wait_for_timeout(1000)
            if _tiene_token(page):
                return
            ultimo_error = "login 200 pero sin token en localStorage"
        else:
            try:
                ultimo_error = response.text()
            except Exception:
                ultimo_error = f"status {response.status}"

        es_recaptcha = "Recaptcha" in ultimo_error
        print(f"[auth] intento {intento}/{MAX_INTENTOS_LOGIN} fallo: {ultimo_error[:120]}")
        if not es_recaptcha or intento == MAX_INTENTOS_LOGIN:
            break
        _pausa(2500, 5000, page)

    raise RuntimeError(f"Login automatico fallo tras {MAX_INTENTOS_LOGIN} intentos: {ultimo_error}")


def _esperar_login_manual(page, segundos: int) -> None:
    print(
        f"\n[auth] El recaptcha rechazo el login automatico. Completa el login a mano en la ventana "
        f"abierta (tenes {segundos} segundos). El resto sigue solo.\n"
    )
    limite = time.time() + segundos
    while time.time() < limite:
        try:
            if _tiene_token(page):
                return
        except Exception:
            pass
        page.wait_for_timeout(1000)
    raise RuntimeError("Se agoto el tiempo de espera para el login manual.")


def _puente_a_envio_cla(page, timeout_ms: int) -> None:
    redirect_to = page.evaluate(
        """async (apiBase) => {
            const token = localStorage.getItem('auth_access_token');
            if (!token) return null;
            const resp = await fetch(apiBase + '/auth/redirect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + token,
                },
                body: JSON.stringify({ token: token, path: '/envioCla' }),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            return data?.data?.redirectTo || null;
        }""",
        API_BASE,
    )
    if not redirect_to:
        raise RuntimeError(
            "Login OK pero no se pudo obtener el puente de sesion hacia MiCorreo clasico (/auth/redirect)."
        )
    page.goto(redirect_to, wait_until="networkidle", timeout=timeout_ms)
    if "envioCla" not in page.url:
        raise RuntimeError(f"El puente de sesion no llego a envioCla (termino en {page.url}).")


def login_and_save_state(headless: bool = False, timeout_ms: int = 30000, manual_fallback: bool = True) -> None:
    email = os.environ.get("MICORREO_EMAIL")
    password = os.environ.get("MICORREO_PASSWORD")
    if not email or not password:
        raise RuntimeError(
            "Falta MICORREO_EMAIL / MICORREO_PASSWORD. Copia .env.example a .env "
            "y completa tus credenciales ahi."
        )

    with sync_playwright() as p:
        context = _launch_context(p, headless)
        page = context.pages[0] if context.pages else context.new_page()
        try:
            try:
                _intentar_login(page, email, password, timeout_ms)
            except Exception as e:
                if manual_fallback and not headless:
                    print(f"[auth] {e}")
                    _esperar_login_manual(page, ESPERA_MANUAL_SEGUNDOS)
                else:
                    raise

            _puente_a_envio_cla(page, timeout_ms)
            context.storage_state(path=str(STATE_FILE))
        finally:
            context.close()


def ensure_logged_in(headless: bool = False, force: bool = False) -> None:
    if not force and _session_is_fresh():
        return
    login_and_save_state(headless=headless)


if __name__ == "__main__":
    ensure_logged_in(force=True)
    print(f"Sesion guardada en {STATE_FILE.resolve()}")
