r"""
Lanzador de la app instalable "Cotizador de envios" (Correo Argentino + Via Cargo + Flecha Carga).

Es el punto de entrada del ejecutable que arma PyInstaller (ver construir.py). No
duplica codigo: importa servidor.py del comparador, que a su vez importa los modulos
de ../Correo y ../ViaCargo, y solo reubica los archivos que se escriben:

    Programa (solo lectura): _internal/  -> modulos, index.html, logos, catalogos
                                            iniciales, motor de Playwright + navegador
    Datos del usuario:       %LOCALAPPDATA%\Cotizador de envios\
                             .env, auth_state.json, browser_profile/, sucursales*.json,
                             localidades.json, agencias.json, destinos.json,
                             flechacarga-tarifas.json, flechacarga-sucursales.json,
                             pedidos_sesion.json, ventana/ (perfil de la ventana), registro.log,
                             extension-micorreo/ (la extension que el usuario carga en Brave)

La interfaz se abre en una ventana propia (Edge o Chrome en modo aplicacion, con un
perfil aparte para que la configuracion y el historial queden en la app). La app se
cierra sola cuando no queda ninguna ventana abierta (latidos de index.html). Si ya
esta abierta, un segundo lanzamiento solo abre otra ventana.

El mismo ejecutable atiende "Abrir en MiCorreo": servidor.py lanza
`sys.executable .../cotizador.py --abrir ...` y aca se deriva a cotizador.main().

Desarrollo (sin compilar):
    ..\Correo\venv\Scripts\python.exe app.py [--sin-ventana]
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.request
import webbrowser
from pathlib import Path

NOMBRE = "Cotizador de envios"
# Distinto del comparador de desarrollo (8613) para que puedan convivir. Fijo porque el localStorage
# de la ventana es por origen; COTIZADOR_PUERTO solo para pruebas con la app instalada abierta.
PUERTO = int(os.environ.get("COTIZADOR_PUERTO") or 8620)
CONGELADO = getattr(sys, "frozen", False)

if CONGELADO:
    RECURSOS = Path(sys._MEIPASS)
else:
    _RAIZ = Path(__file__).resolve().parent.parent
    RECURSOS = None
    # Correo y ViaCargo tambien tienen un servidor.py: el Comparador tiene que quedar primero
    # (se inserta al reves porque cada insert(0) pasa adelante).
    for _d in ("ViaCargo", "Correo", "Comparador"):
        sys.path.insert(0, str(_RAIZ / _d))
    # Al final: tiene su propio servidor.py, que no debe tapar al del Comparador.
    sys.path.append(str(_RAIZ / "Flecha Carga"))

DATOS = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / NOMBRE
# Catalogos que vienen con el instalador y se copian a DATOS la primera vez (despues se
# actualizan desde la app): nombre en DATOS -> (carpeta hermana, nombre ahi). Sin compilar se
# toman de las carpetas hermanas. Los de Flecha Carga cambian de nombre: "sucursales.json" ya
# es el del Correo.
CATALOGOS_INICIALES = {
    "sucursales.json": ("Correo", "sucursales.json"),
    "localidades.json": ("ViaCargo", "localidades.json"),
    "agencias.json": ("ViaCargo", "agencias.json"),
    "destinos.json": ("Comparador", "destinos.json"),
    "flechacarga-tarifas.json": ("Flecha Carga", "tarifas.json"),
    "flechacarga-sucursales.json": ("Flecha Carga", "sucursales.json"),
}
# El CSV del tarifario se lee desde el programa (solo para regenerar las tarifas si faltan).
TARIFARIO_CSV = "Flecha Carga - TARIFARIO.csv"


def preparar_entorno():
    """Carpeta de datos, variables de entorno y rutas de los modulos. Antes de importar servidor."""
    DATOS.mkdir(parents=True, exist_ok=True)
    os.environ["COTIZADOR_DATOS"] = str(DATOS)
    if CONGELADO:
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(RECURSOS / "ms-playwright")
    for nombre, (carpeta, original) in CATALOGOS_INICIALES.items():
        origen = RECURSOS / "catalogos" / nombre if CONGELADO else _RAIZ / carpeta / original
        if not (DATOS / nombre).exists() and origen.exists():
            shutil.copy2(origen, DATOS / nombre)
    os.chdir(DATOS)
    # auth.py busca el .env junto a su propio archivo; en la app vive en DATOS.
    from dotenv import load_dotenv
    load_dotenv(DATOS / ".env", override=True)


def reubicar_modulos():
    """Los modulos de Via Cargo, destinos y pedidos guardan junto a su archivo: en la app, a DATOS."""
    import destinos
    import flechacarga
    import pedidos
    import servidor
    import viacargo

    viacargo.LOCALIDADES_FILE = DATOS / "localidades.json"
    viacargo.AGENCIAS_FILE = DATOS / "agencias.json"
    destinos.DESTINOS_FILE = DATOS / "destinos.json"
    pedidos.SESION_FILE = DATOS / "pedidos_sesion.json"
    flechacarga.TARIFAS_FILE = DATOS / "flechacarga-tarifas.json"
    flechacarga.SUCURSALES_FILE = DATOS / "flechacarga-sucursales.json"
    # En otra PC no esta la carpeta de pedidosv2: la copia para "Sucursales disponibles" no aplica.
    flechacarga.PEDIDOS_JSON = DATOS / "sin-pedidosv2" / "flechacarga-sucursales.json"
    if CONGELADO:
        flechacarga.TARIFARIO_CSV = RECURSOS / "catalogos" / TARIFARIO_CSV
    else:
        flechacarga.TARIFARIO_CSV = _RAIZ / "Flecha Carga" / TARIFARIO_CSV
    if CONGELADO:
        # La extension se carga en Brave desde una ruta fija: va a DATOS (la carpeta del programa
        # se reemplaza al actualizar) y se refresca en cada inicio por si cambio de version.
        servidor.EXTENSION_DIR = DATOS / "extension-micorreo"
        shutil.copytree(RECURSOS / "extension-micorreo", servidor.EXTENSION_DIR, dirs_exist_ok=True)
        pedidos.CONFIG_JS = RECURSOS / "pedidosv2" / "config.js"
        servidor.ESTATICOS.update({
            "/index.html": RECURSOS / "web" / "index.html",
            "/icono.png": RECURSOS / "web" / "icono.png",
            "/logo-correo.png": RECURSOS / "web" / "logo-correo.png",
            "/logo-viacargo.png": RECURSOS / "web" / "logo-viacargo.png",
            "/logo-flechacarga.png": RECURSOS / "web" / "logo-flechacarga-claro.png",
            "/logo-flechacarga-blanco.png": RECURSOS / "web" / "logo-flechacarga.png",
            "/logo-flechacarga-icono.png": RECURSOS / "web" / "logo-flechacarga-icono.png",
        })
    return servidor


def registro():
    """En la app no hay consola: stdout/stderr van a registro.log (se recorta si crece mucho)."""
    log = DATOS / "registro.log"
    try:
        if log.exists() and log.stat().st_size > 2_000_000:
            log.replace(DATOS / "registro.anterior.log")
    except OSError:
        pass
    f = open(log, "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = f
    print(f"\n===== {time.strftime('%Y-%m-%d %H:%M:%S')} · {' '.join(sys.argv[1:]) or 'inicio'}")


def aviso_error(mensaje: str):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, mensaje, NOMBRE, 0x10)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Ventana
# ---------------------------------------------------------------------------

def _navegadores():
    pf = [os.environ.get(v) for v in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA")]
    rutas = []
    for base in filter(None, pf):
        rutas.append(Path(base) / "Microsoft/Edge/Application/msedge.exe")
    for base in filter(None, pf):
        rutas.append(Path(base) / "Google/Chrome/Application/chrome.exe")
    return [r for r in rutas if r.is_file()]


def abrir_ventana(url: str):
    """Ventana de aplicacion (sin pestanas ni barra de direcciones) con un perfil propio."""
    if "--sin-ventana" in sys.argv:  # pruebas: solo el servidor, se cierra a los ~3,5 min
        return
    perfil = DATOS / "ventana"
    for exe in _navegadores():
        try:
            subprocess.Popen(
                [str(exe), f"--app={url}", f"--user-data-dir={perfil}", "--no-first-run",
                 "--no-default-browser-check", "--disable-sync", "--window-size=1320,900"],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return
        except OSError:
            continue
    webbrowser.open(url)


def ya_abierta(url: str) -> bool:
    # /api/latido responde sin salir a internet (otras rutas consultan Via Cargo y pueden tardar)
    # y ademas le avisa a la instancia abierta que hay una ventana en camino.
    try:
        req = urllib.request.Request(url + "api/latido", data=b"", method="POST")
        with urllib.request.urlopen(req, timeout=3) as r:
            return r.status == 200 and json.loads(r.read()).get("ok") is True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Modos
# ---------------------------------------------------------------------------

def modo_abrir_micorreo(args):
    """`App.exe .../cotizador.py --abrir ...`: lo que servidor.py lanza en un proceso aparte."""
    import cotizador
    sys.argv = ["cotizador.py", *args]
    cotizador.main()


def modo_app():
    from http.server import ThreadingHTTPServer

    url = f"http://127.0.0.1:{PUERTO}/"
    if ya_abierta(url):
        abrir_ventana(url)
        return
    servidor = reubicar_modulos()
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PUERTO), servidor.Handler)
    except OSError:
        # Dos lanzamientos casi simultaneos: el otro gano el puerto y ya esta sirviendo.
        time.sleep(1.5)
        if ya_abierta(url):
            abrir_ventana(url)
        else:
            aviso_error(f"El puerto {PUERTO} está ocupado por otro programa, así que el cotizador no puede iniciar.")
        return
    threading.Thread(target=server.serve_forever, daemon=True).start()
    print(f"Servidor en {url} · datos en {DATOS}")
    servidor.ultimo_latido = time.time() + 60  # margen para que la ventana termine de abrir
    abrir_ventana(url)
    while time.time() - servidor.ultimo_latido < servidor.LATIDO_LIMITE:
        time.sleep(2)
    print("Sin ventanas abiertas: se cierra.")
    server.shutdown()


def main():
    args = sys.argv[1:]
    preparar_entorno()
    if CONGELADO:
        registro()
    try:
        if args and args[0].endswith("cotizador.py"):
            modo_abrir_micorreo(args[1:])
        else:
            modo_app()
    except SystemExit:
        raise
    except BaseException:
        traceback.print_exc()
        aviso_error("El cotizador se cerró por un error inesperado.\n\nEl detalle quedó en:\n" + str(DATOS / "registro.log"))
        sys.exit(1)


if __name__ == "__main__":
    main()
