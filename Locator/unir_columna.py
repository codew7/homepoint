"""
unir_columna.py — Junta las fotos de una misma COLUMNA.

En LocatorPic cada columna de mercadería se saca con una foto o con varias,
una debajo de la otra (los estantes de arriba hacia abajo). Acá se juntan
las etiquetas leídas en esas fotos como si fueran una sola imagen.

Si dos fotos seguidas se pisan un poco, la misma etiqueta aparece abajo en
la de arriba y arriba en la de abajo: se cuenta una sola vez (gana la
lectura de mayor confianza).
"""

import base64
import io

from PIL import Image, ImageDraw, ImageOps

BORDE = 35   # % de la foto: una etiqueta a menos de esto del borde puede repetirse en la vecina


def lecturas_de_columna(fotos):
    """fotos: [{"analisis": {...}}, ...] de arriba hacia abajo.
    Devuelve un solo análisis {"etiquetas", "problemas", "comentario"}."""
    from identificar import ORDEN_CONFIANZA

    elegidas = []                 # (n_foto, etiqueta)
    problemas, comentarios = set(), []
    for n, f in enumerate(fotos):
        a = f.get("analisis") or {}
        for et in a.get("etiquetas", []):
            igual = next((i for i, (m, eo) in enumerate(elegidas)
                          if m == n - 1 and _abajo(eo) and _arriba(et) and _misma_etiqueta(eo, et)), None)
            if igual is None:
                elegidas.append((n, et))
            elif ORDEN_CONFIANZA[et["confianza"]] > ORDEN_CONFIANZA[elegidas[igual][1]["confianza"]]:
                elegidas[igual] = (n, et)
        problemas.update(a.get("problemas", []))
        if a.get("comentario"):
            comentarios.append(f"foto {n + 1}: {a['comentario']}" if len(fotos) > 1 else a["comentario"])
    # n_foto: de qué foto de la columna salió (para recortarla en la segunda mirada).
    return {"etiquetas": [{**et, "n_foto": n} for n, et in elegidas], "problemas": sorted(problemas),
            "comentario": " · ".join(comentarios)}


def _abajo(et):
    return et.get("y") is None or et["y"] >= 100 - BORDE


def _arriba(et):
    return et.get("y") is None or et["y"] <= BORDE


def _misma_etiqueta(a, b):
    if a.get("codigo_parcial") and b.get("codigo_parcial"):
        return a["codigo_parcial"] == b["codigo_parcial"]
    return bool(a.get("precio")) and a.get("precio") == b.get("precio")


def tira_base64(rutas, ancho=240):
    """Las fotos de la columna una debajo de la otra, chicas, para el informe."""
    partes = []
    for r in rutas:
        try:
            with Image.open(r) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((ancho, ancho * 4))
                partes.append(im.copy())
        except Exception:
            pass
    if not partes:
        raise ValueError("ninguna foto se pudo abrir")
    alto = sum(p.height for p in partes) + 3 * (len(partes) - 1)
    lienzo = Image.new("RGB", (max(p.width for p in partes), alto), "#ffffff")
    dibujo = ImageDraw.Draw(lienzo)
    y = 0
    for i, p in enumerate(partes):
        lienzo.paste(p, (0, y))
        y += p.height
        if i < len(partes) - 1:
            dibujo.rectangle([0, y, lienzo.width, y + 2], fill="#e67e22")   # unión entre fotos
            y += 3
    buf = io.BytesIO()
    lienzo.save(buf, "JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
