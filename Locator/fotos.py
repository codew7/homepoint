"""
fotos.py — Busca las fotos de la carpeta, las ordena en el orden en que
se sacaron y prepara las imágenes para Claude.

Cada foto muestra DOS columnas de mercadería. Se corta en dos mitades
(izquierda y derecha) y cada mitad se manda por separado: así Claude ve
las etiquetas con el doble de detalle y además sabemos en qué columna
está cada producto.

Las zonas sacadas con TOMAS CERCANAS (LocatorPic) no se cortan: cada toma
se manda entera y armar_mosaico.py decide la columna de cada etiqueta.
"""

import base64
import io
import json
import re
from datetime import datetime
from pathlib import Path

from PIL import Image, ImageOps

EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp"}
LADO_MAX_PX = 1600      # cada mitad se achica a este tamaño (lado más largo)
CALIDAD_JPEG = 88
SOLAPA = 0.06           # cada mitad toma un 6% de más del centro, para no
                        # perder etiquetas que queden justo en el corte
COLUMNAS = ("I", "D")   # izquierda, derecha


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
    """Devuelve las fotos de la carpeta en el orden del recorrido.
        Si la carpeta viene de LocatorPic (tiene sesion.json), el orden es el
        de las zonas de la app, sin importar fechas ni nombres.
        orden="fecha"  -> por la fecha en que se sacó (y si empatan, por nombre)
        orden="nombre" -> solo por nombre (IMG_2 antes que IMG_10)
    También devuelve la lista de archivos que no se pueden usar."""
    manifiesto = carpeta / "sesion.json"
    if manifiesto.is_file():
        nombres = json.loads(manifiesto.read_text("utf-8")).get("fotos") or []
        faltan = [n for n in nombres if not (carpeta / n).is_file()]
        if faltan:
            raise FileNotFoundError(f"Faltan {len(faltan)} foto(s) del recorrido en {carpeta}: {', '.join(faltan[:5])}")
        return [carpeta / n for n in nombres], []

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
    """El recorrido completo, zona por zona. Devuelve (zonas, ignoradas, sectores):
        zonas: [{"ruta": Path, "tomas": None}                 zona de foto única
                {"ruta": Path (primera toma),
                 "tomas": [[{"ruta", "orientacion"}, ...], ...]}]   por estante
        sectores: [{"nombre", "desde", "hasta"}] (números de zona), o [] si no hay.
    Las carpetas que no son de LocatorPic (o de una versión anterior) son
    todas de foto única."""
    manifiesto = carpeta / "sesion.json"
    datos = json.loads(manifiesto.read_text("utf-8")) if manifiesto.is_file() else {}
    if not datos.get("recorrido"):
        rutas, ignoradas = buscar_fotos(carpeta, orden)
        return [{"ruta": r, "tomas": None} for r in rutas], ignoradas, []

    zonas, faltan = [], []
    for z in datos["recorrido"]:
        if z.get("estantes"):
            estantes = [[{"ruta": carpeta / t["archivo"], "orientacion": t.get("orientacion")}
                         for t in fila] for fila in z["estantes"] if fila]
            todas = [t["ruta"] for fila in estantes for t in fila]
            faltan += [r.name for r in todas if not r.is_file()]
            zonas.append({"ruta": todas[0], "tomas": estantes})
        else:
            ruta = carpeta / z["archivo"]
            if not ruta.is_file():
                faltan.append(ruta.name)
            zonas.append({"ruta": ruta, "tomas": None})
    if faltan:
        raise FileNotFoundError(f"Faltan {len(faltan)} foto(s) del recorrido en {carpeta}: {', '.join(faltan[:5])}")
    return zonas, [], datos.get("sectores") or []


def clave_de_cache(ruta: Path):
    """Identifica una foto por nombre, tamaño y fecha. Si la foto no cambió,
    no hace falta volver a analizarla."""
    st = ruta.stat()
    return f"{ruta.name}|{st.st_size}|{int(st.st_mtime)}"


def partir_en_columnas(ruta: Path, carpeta_destino: Path, base: str):
    """Corta la foto (ya derecha, según la orientación de la cámara) en
    mitad izquierda y mitad derecha, y guarda cada una achicada.
    Devuelve {"I": "base-I.jpg", "D": "base-D.jpg"}."""
    archivos = {}
    with Image.open(ruta) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        ancho, alto = im.size
        mitad, extra = ancho // 2, int(ancho * SOLAPA)
        cortes = {"I": (0, 0, mitad + extra, alto), "D": (mitad - extra, 0, ancho, alto)}
        for col, caja in cortes.items():
            parte = im.crop(caja)
            parte.thumbnail((LADO_MAX_PX, LADO_MAX_PX))
            nombre = f"{base}-{col}.jpg"
            parte.save(carpeta_destino / nombre, "JPEG", quality=CALIDAD_JPEG)
            archivos[col] = nombre
    return archivos


def preparar_toma(ruta: Path, carpeta_destino: Path, nombre: str):
    """Copia achicada de una toma cercana, entera (no se corta en columnas)."""
    with Image.open(ruta) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        im.thumbnail((LADO_MAX_PX, LADO_MAX_PX))
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
