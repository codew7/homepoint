r"""
Compila el cotizador (Comparador + Correo + ViaCargo) en una app de Windows y arma el instalador.

    .venv\Scripts\python.exe construir.py            (o "Construir instalador.bat")

Pasos:
  1. Icono (icono.ico aca e icono.png en ../Comparador) si faltan.
  2. Recursos que la app lleva adentro (build/recursos): interfaz y logos, extension de
     MiCorreo, catalogos iniciales, config.js de pedidosv2 y el navegador headless de Playwright.
  3. PyInstaller (carpeta, sin consola) -> dist/Cotizador de envios/
  4. Inno Setup -> salida/Instalador Cotizador de envios <version>.exe

Requisitos (una vez): el venv de compilacion en .venv con playwright (misma version que
../Correo), python-dotenv, pyinstaller y pillow; e Inno Setup 6 instalado.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

VERSION = "1.1.0"
NOMBRE_EXE = "Cotizador de envios"

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent
COMPARADOR, CORREO, VIACARGO = RAIZ / "Comparador", RAIZ / "Correo", RAIZ / "ViaCargo"
PEDIDOSV2_CONFIG = RAIZ.parent / "pedidosv2" / "config.js"
BUILD = AQUI / "build"
RECURSOS = BUILD / "recursos"
DIST = AQUI / "dist"
SALIDA = AQUI / "salida"


def paso(texto):
    print(f"\n=== {texto}", flush=True)


# ---------------------------------------------------------------------------
# 1. Icono: una caja en perspectiva con cinta dorada sobre fondo tinta (paleta de index.html)
# ---------------------------------------------------------------------------

def generar_icono():
    ico, png = AQUI / "icono.ico", COMPARADOR / "icono.png"
    if ico.exists() and png.exists():
        return
    from PIL import Image, ImageDraw

    n = 1024
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((40, 40, n - 40, n - 40), radius=210, fill="#14181f")
    T, L, R, C = (512, 230), (252, 380), (772, 380), (512, 530)
    BL, BR, B = (252, 680), (772, 680), (512, 830)
    d.polygon([T, R, C, L], fill="#f3f2ee")
    d.polygon([L, C, B, BL], fill="#d9d6cc")
    d.polygon([C, R, BR, B], fill="#aaa598")

    def en(a, b, t):
        return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

    t0, t1 = 0.40, 0.60
    d.polygon([en(L, T, t0), en(L, T, t1), en(C, R, t1), en(C, R, t0)], fill="#d69a2c")
    a, b = en(C, R, t0), en(C, R, t1)
    d.polygon([a, b, (b[0], b[1] + 300), (a[0], a[1] + 300)], fill="#b7791f")

    img.resize((256, 256), Image.LANCZOS).save(png)
    img.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"icono -> {ico.name}, {png}")


# ---------------------------------------------------------------------------
# 2. Recursos
# ---------------------------------------------------------------------------

def revision_headless_shell() -> str:
    import playwright
    browsers = Path(playwright.__file__).parent / "driver" / "package" / "browsers.json"
    for b in json.loads(browsers.read_text(encoding="utf-8"))["browsers"]:
        if b["name"] == "chromium-headless-shell":
            return b["revision"]
    raise RuntimeError("No se encontro chromium-headless-shell en browsers.json de Playwright")


def preparar_recursos():
    if RECURSOS.exists():
        shutil.rmtree(RECURSOS)
    web = RECURSOS / "web"
    web.mkdir(parents=True)
    for f in (COMPARADOR / "index.html", COMPARADOR / "icono.png", CORREO / "logo-correo.png", VIACARGO / "logo-viacargo.png"):
        shutil.copy2(f, web / f.name)

    # Extension de Brave para completar MiCorreo en el navegador del usuario (app.py la copia a DATOS).
    shutil.copytree(COMPARADOR / "extension-micorreo", RECURSOS / "extension-micorreo")

    cat = RECURSOS / "catalogos"
    cat.mkdir()
    for f in (CORREO / "sucursales.json", VIACARGO / "localidades.json", VIACARGO / "agencias.json", COMPARADOR / "destinos.json"):
        if f.exists():
            shutil.copy2(f, cat / f.name)
        else:
            print(f"aviso: falta {f} (la app lo descargara al usarse)")

    if not PEDIDOSV2_CONFIG.exists():
        raise RuntimeError(f"Falta {PEDIDOSV2_CONFIG} (configuracion de Firebase de pedidosv2)")
    (RECURSOS / "pedidosv2").mkdir()
    shutil.copy2(PEDIDOSV2_CONFIG, RECURSOS / "pedidosv2" / "config.js")

    # Navegador headless con el que se cotiza el Correo. Se reutiliza el ya descargado si
    # coincide la revision; si no, se baja con el propio Playwright.
    rev = revision_headless_shell()
    carpeta = f"chromium_headless_shell-{rev}"
    destino = RECURSOS / "ms-playwright" / carpeta
    local = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright" / carpeta
    if (local / "INSTALLATION_COMPLETE").exists():
        shutil.copytree(local, destino)
    else:
        env = {**os.environ, "PLAYWRIGHT_BROWSERS_PATH": str(RECURSOS / "ms-playwright")}
        subprocess.run([sys.executable, "-m", "playwright", "install", "--only-shell", "chromium"], env=env, check=True)
    print(f"recursos listos ({carpeta})")


# ---------------------------------------------------------------------------
# 3. PyInstaller
# ---------------------------------------------------------------------------

def archivo_version() -> Path:
    v = tuple(int(x) for x in VERSION.split(".")) + (0,)
    texto = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={v}, prodvers={v}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('0C0A04B0', [
      StringStruct('CompanyName', 'Homepoint'),
      StringStruct('FileDescription', 'Cotizador de envíos (Correo Argentino + Vía Cargo)'),
      StringStruct('FileVersion', '{VERSION}'),
      StringStruct('InternalName', '{NOMBRE_EXE}'),
      StringStruct('OriginalFilename', '{NOMBRE_EXE}.exe'),
      StringStruct('ProductName', 'Cotizador de envíos'),
      StringStruct('ProductVersion', '{VERSION}')])]),
    VarFileInfo([VarStruct('Translation', [0x0C0A, 1200])])
  ]
)
"""
    ruta = BUILD / "version.txt"
    ruta.write_text(texto, encoding="utf-8")
    return ruta


def pyinstaller():
    if (DIST / NOMBRE_EXE).exists():
        shutil.rmtree(DIST / NOMBRE_EXE)
    cmd = [
        sys.executable, "-m", "PyInstaller", str(AQUI / "app.py"),
        "--name", NOMBRE_EXE, "--windowed", "--noconfirm", "--clean",
        "--icon", str(AQUI / "icono.ico"), "--version-file", str(archivo_version()),
        "--paths", str(COMPARADOR), "--paths", str(CORREO), "--paths", str(VIACARGO),
        # Modulos que app.py importa dentro de funciones o que solo carga servidor.py.
        *sum((["--hidden-import", m] for m in ("servidor", "destinos", "pedidos", "viacargo", "cotizador", "auth", "sucursales")), []),
        "--exclude-module", "tkinter",
        "--add-data", f"{RECURSOS}{os.pathsep}.",
        "--distpath", str(DIST), "--workpath", str(BUILD / "pyinstaller"), "--specpath", str(BUILD),
    ]
    subprocess.run(cmd, check=True, cwd=AQUI)


# ---------------------------------------------------------------------------
# 4. Inno Setup
# ---------------------------------------------------------------------------

def iscc() -> Path:
    for base in (os.environ.get("LOCALAPPDATA", "") + r"\Programs", os.environ.get("ProgramFiles(x86)", ""), os.environ.get("ProgramFiles", "")):
        p = Path(base) / "Inno Setup 6" / "ISCC.exe"
        if p.exists():
            return p
    raise RuntimeError("No se encontro Inno Setup 6 (ISCC.exe). Instalalo con: winget install JRSoftware.InnoSetup")


def instalador():
    SALIDA.mkdir(exist_ok=True)
    subprocess.run([str(iscc()), f"/DVersion={VERSION}", f"/DExe={NOMBRE_EXE}", str(AQUI / "instalador.iss")], check=True, cwd=AQUI)


def main():
    paso("Icono"); generar_icono()
    paso("Recursos"); preparar_recursos()
    paso("PyInstaller"); pyinstaller()
    paso("Instalador"); instalador()
    print(f"\nListo: {SALIDA}")


if __name__ == "__main__":
    main()
