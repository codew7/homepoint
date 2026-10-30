"""
armar_mosaico.py — Une las "tomas cercanas" de una zona como un rompecabezas.

En LocatorPic, una zona puede sacarse con TOMAS CERCANAS: varias fotos por
estante, de izquierda a derecha, cada una pisando un poco a la anterior.
De arriba hacia abajo, un estante debajo del otro.

Acá se calcula cuánto se corrió cada toma respecto de la anterior (buscando
los mismos detalles en las dos imágenes, con OpenCV). Con eso se sabe en
qué parte del tramo cayó cada etiqueta y, por lo tanto, si está en la
columna izquierda o en la derecha, igual que con una foto única.

Si dos tomas no se pueden encastrar (poco solape, poca textura), el corrimiento
se estima con los sensores del celular o con el promedio de las demás, y la
unión queda marcada como "dudosa" en el informe. Nunca corta el proceso.

Las posiciones se miden en "anchos de toma": la primera toma de cada estante
empieza en 0 y una toma que se corrió un 70% empieza en 0.7.
"""

import base64
import io
import logging

import numpy as np
from PIL import Image, ImageDraw, ImageOps

log = logging.getLogger("locator")

LADO_ENCASTRE = 1000      # px: las tomas se achican a esto para compararlas
MIN_COINCIDENCIAS = 12    # puntos en común mínimos para confiar en el encastre
CORRIMIENTO_TIPICO = 0.7  # la app pide pisar ~30% de la toma anterior
CAMPO_VISUAL = 65.0       # grados horizontales típicos de la cámara principal
TOLERANCIA_DUPLICADO = 0.12   # anchos de toma: misma etiqueta vista en dos tomas


def _cargar_gris(ruta):
    with Image.open(ruta) as im:
        im = ImageOps.exif_transpose(im).convert("L")
        im.thumbnail((LADO_ENCASTRE, LADO_ENCASTRE))
        return np.asarray(im)


def encastrar(ruta_a, ruta_b):
    """Corrimiento de la toma B respecto de la A, en anchos de toma.
    Devuelve (dx, dy) o None si no se pudo encastrar con confianza."""
    try:
        import cv2
    except ImportError:
        log.warning("Falta OpenCV (ejecutá instalar.bat): las tomas se ubican sin encastrar.")
        return None
    a, b = _cargar_gris(ruta_a), _cargar_gris(ruta_b)
    sift = cv2.SIFT_create(nfeatures=3000)
    ka, da = sift.detectAndCompute(a, None)
    kb, db_ = sift.detectAndCompute(b, None)
    if da is None or db_ is None or len(ka) < MIN_COINCIDENCIAS or len(kb) < MIN_COINCIDENCIAS:
        return None
    pares = cv2.BFMatcher().knnMatch(db_, da, k=2)
    buenas = [m for m, n in (p for p in pares if len(p) == 2) if m.distance < 0.75 * n.distance]
    if len(buenas) < MIN_COINCIDENCIAS:
        return None
    pb = np.float32([kb[m.queryIdx].pt for m in buenas])
    pa = np.float32([ka[m.trainIdx].pt for m in buenas])
    # Solo corrimiento, giro chico y escala: lo que pasa al ir moviéndose
    # frente al estante. pa ≈ M · pb
    M, inliers = cv2.estimateAffinePartial2D(pb, pa, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    if M is None or inliers is None or int(inliers.sum()) < MIN_COINCIDENCIAS:
        return None
    escala = float(np.hypot(M[0, 0], M[1, 0]))
    alto, ancho = a.shape
    dx, dy = float(M[0, 2]) / ancho, float(M[1, 2]) / alto
    # Lo esperable: B queda a la derecha de A, más o menos a la misma altura.
    # (Un corrimiento casi nulo es una toma repetida: queda encima de la otra
    # y sus etiquetas se cuentan una vez.)
    if not (0.7 < escala < 1.4) or not (-0.05 < dx < 1.0) or abs(dy) > 0.5:
        return None
    return dx, dy


def _corrimiento_por_sensores(ta, tb):
    """Si entre dos tomas la persona GIRÓ (sin caminar), el cambio de
    orientación dice cuánto se corrió la imagen."""
    oa, ob = ta.get("orientacion") or {}, tb.get("orientacion") or {}
    if oa.get("azimut") is None or ob.get("azimut") is None:
        return None
    giro = (float(ob["azimut"]) - float(oa["azimut"]) + 540) % 360 - 180
    if 5 <= giro <= CAMPO_VISUAL:
        return giro / CAMPO_VISUAL
    return None


def ubicar_tomas(estantes):
    """estantes: [[toma, toma...], ...] (cada toma con "ruta" y, si hay,
    "orientacion"). Agrega a cada toma "x" (posición en anchos de toma) y
    "union" ("ok", "sensores", "estimada" o None para la primera).
    Devuelve {"anchos": [ancho de cada estante], "dudosas": n}."""
    pares = []                      # (toma_anterior, toma, dx o None)
    for fila in estantes:
        for ta, tb in zip(fila, fila[1:]):
            r = encastrar(ta["ruta"], tb["ruta"])
            pares.append((ta, tb, r[0] if r else None))
    buenos = [dx for _, _, dx in pares if dx is not None]
    promedio = sum(buenos) / len(buenos) if buenos else CORRIMIENTO_TIPICO

    corrimiento, union = {}, {}
    for ta, tb, dx in pares:
        if dx is not None:
            corrimiento[id(tb)], union[id(tb)] = dx, "ok"
            continue
        por_sensor = _corrimiento_por_sensores(ta, tb)
        corrimiento[id(tb)] = por_sensor if por_sensor is not None else promedio
        union[id(tb)] = "sensores" if por_sensor is not None else "estimada"

    anchos, dudosas = [], 0
    for fila in estantes:
        x = 0.0
        for i, t in enumerate(fila):
            if i:
                x += corrimiento[id(t)]
                t["union"] = union[id(t)]
                dudosas += t["union"] != "ok"
            else:
                t["union"] = None
            t["x"] = x
        anchos.append(x + 1.0 if fila else 0.0)
    return {"anchos": anchos, "dudosas": dudosas}


def lecturas_de_zona(estantes, anchos):
    """Junta las etiquetas leídas en cada toma y las reparte en columna
    izquierda (I) o derecha (D) según dónde cayeron en el estante.
    Una etiqueta que aparece en dos tomas (por el solape) se cuenta una vez.
    Devuelve {"I": analisis, "D": analisis} con el mismo formato que una
    foto partida en columnas (cada etiqueta suma "estante")."""
    from identificar import ORDEN_CONFIANZA

    columnas = {c: {"etiquetas": [], "problemas": set(), "comentario": []} for c in ("I", "D")}
    for n_estante, (fila, ancho) in enumerate(zip(estantes, anchos), 1):
        vistas = []                 # (x_global, etiqueta)
        for t in fila:
            a = t.get("analisis") or {}
            for et in a.get("etiquetas", []):
                pos = et.get("x")
                xg = t["x"] + (pos / 100.0 if pos is not None else 0.5)
                igual = next((i for i, (xo, eo) in enumerate(vistas)
                              if abs(xo - xg) < TOLERANCIA_DUPLICADO and _misma_etiqueta(eo, et)), None)
                if igual is None:
                    vistas.append((xg, et))
                elif ORDEN_CONFIANZA[et["confianza"]] > ORDEN_CONFIANZA[vistas[igual][1]["confianza"]]:
                    vistas[igual] = (xg, et)
            for col in columnas.values():
                col["problemas"].update(a.get("problemas", []))
            if a.get("comentario"):
                columnas["I"]["comentario"].append(f"E{n_estante}: {a['comentario']}")
        for xg, et in vistas:
            col = "I" if xg < ancho / 2 else "D"
            columnas[col]["etiquetas"].append({**et, "estante": n_estante})
    return {c: {"etiquetas": v["etiquetas"], "problemas": sorted(v["problemas"]),
                "comentario": " · ".join(v["comentario"])} for c, v in columnas.items()}


def _misma_etiqueta(a, b):
    if a.get("codigo_parcial") and b.get("codigo_parcial"):
        return a["codigo_parcial"] == b["codigo_parcial"]
    return bool(a.get("precio")) and a.get("precio") == b.get("precio")


def mosaico_base64(estantes, anchos, lado=1400):
    """Imagen chica del rompecabezas armado, para el informe: cada estante
    es una franja, la línea naranja es el corte entre columnas y las
    uniones dudosas se marcan en rojo."""
    alto_fila, ancho_toma = 220, 293            # tomas 4:3 achicadas
    lienzo_ancho = int(max(anchos or [1]) * ancho_toma) + 2
    lienzo = Image.new("RGB", (lienzo_ancho, alto_fila * max(len(estantes), 1)), "#ffffff")
    dibujo = ImageDraw.Draw(lienzo)
    for n, (fila, ancho) in enumerate(zip(estantes, anchos)):
        y = n * alto_fila
        for t in fila:
            try:
                with Image.open(t["ruta"]) as im:
                    im = ImageOps.exif_transpose(im).convert("RGB").resize((ancho_toma, alto_fila))
                lienzo.paste(im, (int(t["x"] * ancho_toma), y))
            except Exception:
                pass
        for t in fila:
            if t.get("union") and t["union"] != "ok":
                x = int(t["x"] * ancho_toma)
                dibujo.rectangle([x, y, x + 3, y + alto_fila - 1], fill="#c0392b")
        medio = int(ancho / 2 * ancho_toma)
        for yy in range(y, y + alto_fila, 14):
            dibujo.line([medio, yy, medio, yy + 7], fill="#e67e22", width=3)
    lienzo.thumbnail((lado, lado))
    buf = io.BytesIO()
    lienzo.save(buf, "JPEG", quality=72)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
