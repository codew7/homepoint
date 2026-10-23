r"""
Compila "WiFi Clientes" en una app de Windows y arma el instalador.

    .venv\Scripts\python.exe construir.py            (o "Construir instalador.bat")

Pasos:
  1. Icono (icono.ico) si falta.
  2. PyInstaller (carpeta, sin consola) -> dist/WiFi Clientes/
  3. Inno Setup -> salida/Instalador WiFi Clientes <version>.exe

Requisitos (una vez): el venv .venv con requisitos-build.txt e Inno Setup 6 instalado.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

VERSION = "1.0.0"
NOMBRE_EXE = "WiFi Clientes"

AQUI = Path(__file__).resolve().parent
BUILD = AQUI / "build"
DIST = AQUI / "dist"
SALIDA = AQUI / "salida"


def paso(texto):
    print(f"\n=== {texto}", flush=True)


# ---------------------------------------------------------------------------
# 1. Icono: ondas de Wi-Fi en verde senal sobre fondo tinta (paleta de ui/app.css)
# ---------------------------------------------------------------------------

def generar_icono():
    ico = AQUI / "icono.ico"
    if ico.exists():
        return
    from PIL import Image, ImageDraw

    n = 1024
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((40, 40, n - 40, n - 40), radius=230, fill="#101614")
    cx, cy = n / 2, 700
    for r in (380, 255, 130):
        d.arc((cx - r, cy - r, cx + r, cy + r), 225, 315, fill="#34D399", width=78)
    d.ellipse((cx - 56, cy - 56, cx + 56, cy + 56), fill="#34D399")
    img.save(ico, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"icono -> {ico.name}")


# ---------------------------------------------------------------------------
# 2. PyInstaller
# ---------------------------------------------------------------------------

def archivo_version() -> Path:
    v = tuple(int(x) for x in VERSION.split(".")) + (0,)
    texto = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={v}, prodvers={v}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('0C0A04B0', [
      StringStruct('CompanyName', 'Homepoint'),
      StringStruct('FileDescription', 'WiFi Clientes: internet temporal para clientes'),
      StringStruct('FileVersion', '{VERSION}'),
      StringStruct('InternalName', '{NOMBRE_EXE}'),
      StringStruct('OriginalFilename', '{NOMBRE_EXE}.exe'),
      StringStruct('ProductName', 'WiFi Clientes'),
      StringStruct('ProductVersion', '{VERSION}')])]),
    VarFileInfo([VarStruct('Translation', [0x0C0A, 1200])])
  ]
)
"""
    BUILD.mkdir(exist_ok=True)
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
        # Sin --uac-admin: app.py se eleva sola por la tarea programada (sin aviso de Windows).
        "--collect-submodules", "winrt",
        "--exclude-module", "tkinter",
        "--add-data", f"{AQUI / 'ui'}{os.pathsep}ui",
        "--distpath", str(DIST), "--workpath", str(BUILD / "pyinstaller"), "--specpath", str(BUILD),
    ]
    subprocess.run(cmd, check=True, cwd=AQUI)


# ---------------------------------------------------------------------------
# 3. Inno Setup
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
    paso("PyInstaller"); pyinstaller()
    paso("Instalador"); instalador()
    print(f"\nListo: {SALIDA}")


if __name__ == "__main__":
    main()
