r"""
Arma el ejecutable portable "Verificador de comprobantes.exe" (un solo archivo).

    1. Icono (icono.ico) dibujado con Pillow, si no existe
    2. Archivo de version de Windows (nombre, descripcion, version del .exe)
    3. PyInstaller --onefile --windowed -> dist\Verificador de comprobantes.exe

Requisitos (en el venv): pywebview, pyinstaller, Pillow, pypdf.
    venv\Scripts\python.exe -m pip install pywebview pyinstaller
    venv\Scripts\python.exe construir.py

En la PC de destino hace falta Edge WebView2 (viene con Windows 10/11) y, para la
revision visual, Claude Code con la sesion iniciada.
"""

import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

AQUI = Path(__file__).resolve().parent
NOMBRE = "Verificador de comprobantes"
VERSION = (1, 0, 0, 0)
ICONO = AQUI / "icono.ico"
BUILD = AQUI / "build"
DIST = AQUI / "dist"


def paso(texto):
    print(f"\n== {texto}", flush=True)


# --------------------------------------------------------------------- icono --

def _bezier(p0, p1, p2, pasos=80):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1])
            for t in (i / pasos for i in range(pasos + 1))]


def _escudo(cx, top, ancho, alto):
    """Contorno de un escudo clasico: hombros redondeados, lados rectos y punta curva abajo."""
    izq, der, base = cx - ancho / 2, cx + ancho / 2, top + alto
    hombro, recto = alto * 0.10, top + alto * 0.46
    puntos = _bezier((cx, top), (cx + ancho * 0.25, top + hombro * 0.9), (der, top + hombro))
    puntos += _bezier((der, top + hombro), (der, (top + recto) / 2), (der, recto))
    puntos += _bezier((der, recto), (der - ancho * 0.04, base - alto * 0.18), (cx, base))
    puntos += _bezier((cx, base), (izq + ancho * 0.04, base - alto * 0.18), (izq, recto))
    puntos += _bezier((izq, recto), (izq, (top + recto) / 2), (izq, top + hombro))
    puntos += _bezier((izq, top + hombro), (cx - ancho * 0.25, top + hombro * 0.9), (cx, top))
    return puntos


def crear_icono():
    n = 2048  # se dibuja al doble y se reduce: bordes suaves
    s = n / 1024
    arriba, abajo = (99, 91, 255), (30, 27, 96)
    grad = Image.new("RGBA", (1, 256))
    for y in range(256):
        t = y / 255
        grad.putpixel((0, y), tuple(int(a + (b - a) * t) for a, b in zip(arriba, abajo)) + (255,))
    grad = grad.resize((n, n), Image.Resampling.BICUBIC)
    mascara = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mascara).rounded_rectangle([56 * s, 56 * s, n - 56 * s, n - 56 * s], radius=220 * s, fill=255)
    fondo = Image.new("RGBA", (n, n))
    fondo.paste(grad, (0, 0), mascara)

    # Sombra suave bajo el escudo y escudo blanco
    sombra = Image.new("RGBA", (n, n))
    ImageDraw.Draw(sombra).polygon([(x, y + 22 * s) for x, y in _escudo(n / 2, 236 * s, 500 * s, 590 * s)], fill=(10, 8, 40, 90))
    fondo.alpha_composite(sombra.filter(ImageFilter.GaussianBlur(24 * s)))
    d = ImageDraw.Draw(fondo)
    d.polygon(_escudo(n / 2, 236 * s, 500 * s, 590 * s), fill=(255, 255, 255, 255))
    # Tilde
    color = (79, 70, 229, 255)
    trazo = [(400 * s, 540 * s), (480 * s, 620 * s), (632 * s, 456 * s)]
    d.line(trazo, fill=color, width=int(64 * s), joint="curve")
    for x, y in (trazo[0], trazo[2]):
        r = 32 * s
        d.ellipse([x - r, y - r, x + r, y + r], fill=color)

    fondo = fondo.resize((1024, 1024), Image.Resampling.LANCZOS)
    fondo.save(AQUI / "icono.png")
    fondo.save(ICONO, sizes=[(s, s) for s in (16, 20, 24, 32, 40, 48, 64, 128, 256)])


# ------------------------------------------------------------------- version --

def archivo_version():
    v = ".".join(map(str, VERSION))
    texto = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={VERSION}, prodvers={VERSION}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('0C0A04B0', [
      StringStruct('CompanyName', 'HomePoint'),
      StringStruct('FileDescription', '{NOMBRE}'),
      StringStruct('FileVersion', '{v}'),
      StringStruct('InternalName', 'Verificador'),
      StringStruct('OriginalFilename', '{NOMBRE}.exe'),
      StringStruct('ProductName', '{NOMBRE}'),
      StringStruct('ProductVersion', '{v}'),
      StringStruct('LegalCopyright', 'HomePoint')])]),
    VarFileInfo([VarStruct('Translation', [3082, 1200])])
  ]
)"""
    BUILD.mkdir(exist_ok=True)
    ruta = BUILD / "version.txt"
    ruta.write_text(texto, encoding="utf-8")
    return ruta


# --------------------------------------------------------------- pyinstaller --

def pyinstaller():
    sep = os.pathsep
    cmd = [
        sys.executable, "-m", "PyInstaller", str(AQUI / "app.py"),
        "--name", NOMBRE, "--onefile", "--windowed", "--noconfirm", "--clean",
        "--icon", str(ICONO), "--version-file", str(archivo_version()),
        "--add-data", f"{AQUI / 'index.html'}{sep}.", "--add-data", f"{ICONO}{sep}.",
        "--exclude-module", "tkinter", "--exclude-module", "unittest",
        "--distpath", str(DIST), "--workpath", str(BUILD / "pyinstaller"), "--specpath", str(BUILD),
    ]
    subprocess.run(cmd, check=True, cwd=AQUI)


if __name__ == "__main__":
    if not ICONO.exists() or "--icono" in sys.argv:
        paso("Icono")
        crear_icono()
    paso("PyInstaller")
    pyinstaller()
    exe = DIST / f"{NOMBRE}.exe"
    print(f"\nListo: {exe} ({exe.stat().st_size / 1e6:.0f} MB)")
