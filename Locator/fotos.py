"""
fotos.py — Lee el recorrido de la carpeta (grupos y columnas) y prepara las
imágenes para Claude.

El depósito se divide en GRUPOS fijos (FL, FR, BL, BR, OT) y cada grupo en
COLUMNAS (1, 2, 3...). Cada columna es una foto, o varias una debajo de la
otra (los estantes de arriba hacia abajo). Cada foto se manda entera.
"""

import base64
import io
import json
import re
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp"}
LADO_MAX_PX = 1568      # tamaño por defecto (lado más largo); relevar.py usa el máximo del modelo
CALIDAD_JPEG = 88
GRUPOS = ("FL", "FR", "BL", "BR", "OT")    # en el orden en que se recorren
GRUPO_SIN_APP = "OT"    # carpetas de fotos sueltas (sin LocatorPic)


def _fecha_de_la_foto(ruta: Path):
    """Fecha en que se sacó la foto: primero la que guarda la cámara (EXIF);
    si no tiene, la fecha de modificación del archivo."""
    try:
        with Image.open(ruta) as im:
            exif = im.getexif()
            texto = exif.get_ifd(0x8769).get(36867) or exif.get(306)   # DateTimeOriginal / DateTime
            if texto:
                return datetime.strptime(str(texto).strip(), "%Y:%m:%d %H:%M:%S")
    except Exception:
        pass
    return datetime.fromtimestamp(ruta.stat().st_mtime)


def _orden_natural(nombre: str):
    """Para que IMG_2 vaya antes que IMG_10."""
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", nombre)]


def buscar_fotos(carpeta: Path, orden="fecha"):
    """Fotos sueltas de una carpeta (que no viene de LocatorPic), en orden:
        orden="fecha"  -> por la fecha en que se sacó (y si empatan, por nombre)
        orden="nombre" -> solo por nombre (IMG_2 antes que IMG_10)
    También devuelve la lista de archivos que no se pueden usar."""
    fotos, ignoradas = [], []
    for ruta in carpeta.iterdir():
        if not ruta.is_file():
            continue
        if ruta.suffix.lower() in EXTENSIONES:
            fotos.append(ruta)
        elif ruta.suffix.lower() in {".heic", ".heif"}:
            ignoradas.append(ruta.name)
    if orden == "nombre":
        fotos.sort(key=lambda r: _orden_natural(r.name))
    else:
        fotos.sort(key=lambda r: (_fecha_de_la_foto(r), _orden_natural(r.name)))
    return fotos, ignoradas


def leer_recorrido(carpeta: Path, orden="fecha"):
    """El recorrido completo, columna por columna. Devuelve (columnas, ignoradas):
        columnas: [{"grupo": "FL", "columna": 3, "fotos": [Path, ...]}, ...]
                  en el orden del recorrido (FL 1, FL 2... FR 1...); las
                  fotos de cada columna, de arriba hacia abajo.
    Una carpeta que no es de LocatorPic (o de una versión anterior): cada
    foto es una columna del grupo OT."""
    manifiesto = carpeta / "sesion.json"
    datos = json.loads(manifiesto.read_text("utf-8")) if manifiesto.is_file() else {}
    if not datos.get("columnas"):
        rutas, ignoradas = buscar_fotos(carpeta, orden)
        return [{"grupo": GRUPO_SIN_APP, "columna": n, "fotos": [r]} for n, r in enumerate(rutas, 1)], ignoradas

    columnas, faltan = [], []
    for c in datos["columnas"]:
        rutas = [carpeta / a for a in c["archivos"]]
        faltan += [r.name for r in rutas if not r.is_file()]
        columnas.append({"grupo": c["grupo"], "columna": int(c["columna"]), "fotos": rutas})
    if faltan:
        raise FileNotFoundError(f"Faltan {len(faltan)} foto(s) del recorrido en {carpeta}: {', '.join(faltan[:5])}")
    return columnas, []


def clave_de_cache(ruta: Path):
    """Identifica una foto por nombre, tamaño y fecha. Si la foto no cambió,
    no hace falta volver a analizarla."""
    st = ruta.stat()
    return f"{ruta.name}|{st.st_size}|{int(st.st_mtime)}"


def preparar_imagen(ruta: Path, carpeta_destino: Path, nombre: str, lado=LADO_MAX_PX):
    """Copia (derecha, según la orientación de la cámara) achicada al lado
    más largo que acepta el modelo: más píxeles = números chicos más claros."""
    with Image.open(ruta) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((lado, lado))
        im.save(carpeta_destino / nombre, "JPEG", quality=CALIDAD_JPEG)
    return nombre


def miniatura_base64(ruta: Path, lado=260):
    """Miniatura chiquita, lista para meter dentro del informe HTML."""
    with Image.open(ruta) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((lado, lado))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=70)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
