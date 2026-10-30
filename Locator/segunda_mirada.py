"""
segunda_mirada.py — Para las etiquetas que quedaron en duda, Claude mira
de nuevo, de cerca, y elige entre los productos posibles.

Casos que se revisan:
    ambiguo        el precio lo comparten varios productos y la etiqueta
                   no alcanzó para decidir;
    no_encontrado  el precio no está en la planilla, pero hay productos con
                   un precio que difiere en un dígito (6 por 8, 1 por 7...);
    ilegible       falta un dígito del precio ("$ 10.12?") y hay productos
                   que encajan;
    a verificar    precio único, pero lo que se ve no tiene nada que ver
                   con ese producto (el precio pudo leerse mal).

De la foto original (a resolución completa) se recorta la etiqueta con el
producto que tiene arriba, se marca la etiqueta con un recuadro naranja y
se le pasa a Claude junto con la lista de productos posibles. Claude ve el
producto en sí, así que distingue "guante deportivo" de "caja mostacilla"
aunque cuesten lo mismo.

Las respuestas quedan guardadas en .locator\\segunda_mirada.json: si se
vuelve a ejecutar, no se pregunta de nuevo.
"""

import hashlib
import json
import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

from identificar import confianza_menor
from lector_claude import LimiteDeUso, elegir_candidatos

log = logging.getLogger("locator")

VERSION = "m1"
POR_LOTE = 8               # recortes por consulta a Claude
MAX_CANDIDATOS = 15        # con más productos posibles no se pregunta
LADO_RECORTE = 1400        # px
ANCHO = 0.24               # mitad del ancho del recorte, en fracción de la foto
ARRIBA, ABAJO = 0.30, 0.07  # cuánto se toma arriba (el producto) y abajo de la etiqueta


def casos_a_revisar(lecturas):
    casos = []
    for l in lecturas:
        et, n = l["etiqueta"], len(l["candidatos"])
        if et.get("x") is None or et.get("y") is None:
            continue
        if (l["estado"] == "ambiguo" and 2 <= n <= MAX_CANDIDATOS) or \
                (l["estado"] in ("no_encontrado", "ilegible") and 1 <= n <= MAX_CANDIDATOS) or \
                (l.get("verificar") and n <= MAX_CANDIDATOS):
            casos.append(l)
    return casos


def _clave(l):
    codigos = ",".join(sorted(p["codigo"] for p in l["candidatos"]))
    ruta = Path(l["ruta"])
    st = ruta.stat()
    base = f"{VERSION}|{ruta.name}|{st.st_size}|{l['etiqueta']['x']:.0f}|{l['etiqueta']['y']:.0f}|{codigos}"
    return hashlib.sha1(base.encode()).hexdigest()[:16]


def recortar(l, destino: Path, nombre):
    """Recorte de la etiqueta y su producto, con la etiqueta marcada."""
    et = l["etiqueta"]
    with Image.open(l["ruta"]) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        w, h = im.size
        cx, cy = et["x"] / 100 * w, et["y"] / 100 * h
        caja = (max(0, int(cx - ANCHO * w)), max(0, int(cy - ARRIBA * h)),
                min(w, int(cx + ANCHO * w)), min(h, int(cy + ABAJO * h)))
        r = im.crop(caja)
        # Recuadro naranja alrededor de donde Claude dijo que está la etiqueta.
        mx, my = cx - caja[0], cy - caja[1]
        rw, rh = 0.09 * w, 0.035 * h
        ImageDraw.Draw(r).rectangle([mx - rw, my - rh, mx + rw, my + rh], outline="#ff7a00",
                                    width=max(3, int(w / 400)))
        r.thumbnail((LADO_RECORTE, LADO_RECORTE))
        r.save(destino / nombre, "JPEG", quality=90)
    return nombre


def revisar(lecturas, planilla, trabajo: Path, modelo):
    """Hace la segunda mirada sobre las lecturas en duda y las actualiza.
    Devuelve cuántas se resolvieron. Si se alcanza el límite de uso, corta
    sin error: lo que no se revisó queda como estaba."""
    casos = casos_a_revisar(lecturas)
    if not casos:
        return 0
    ruta_cache = trabajo / "segunda_mirada.json"
    cache = json.loads(ruta_cache.read_text("utf-8")) if ruta_cache.exists() else {}
    carpeta = trabajo / "recortes"
    carpeta.mkdir(exist_ok=True)

    pendientes = []
    for i, l in enumerate(casos):
        try:
            l["_clave"] = _clave(l)
        except OSError:
            continue
        if l["_clave"] in cache:
            continue
        try:
            nombre = recortar(l, carpeta, f"r{i:04d}.jpg")
        except Exception as e:
            log.warning("  No se pudo recortar una etiqueta de %s: %s", l["foto"], e)
            continue
        pendientes.append((nombre, l))

    log.info("Segunda mirada: %d etiqueta(s) en duda (%d ya revisadas antes).",
             len(casos), len(casos) - len(pendientes))
    for i in range(0, len(pendientes), POR_LOTE):
        lote = pendientes[i:i + POR_LOTE]
        pedido = [{"archivo": n, "precio_texto": l["etiqueta"]["precio_texto"],
                   "candidatos": [{"codigo": p["codigo"], "nombre": p["nombre"]} for p in l["candidatos"]]}
                  for n, l in lote]
        try:
            respuestas = elegir_candidatos(carpeta, pedido, modelo)
        except LimiteDeUso as e:
            log.error("Se alcanzó el límite de uso en la segunda mirada (%s). Lo que falta queda en duda.", e)
            break
        except Exception as e:
            log.warning("  Segunda mirada: un lote falló (%s); esas etiquetas quedan en duda.", e)
            continue
        for n, l in lote:
            if n in respuestas:
                cache[l["_clave"]] = respuestas[n]
        ruta_cache.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")
        log.info("  [%d/%d] revisadas", min(i + POR_LOTE, len(pendientes)), len(pendientes))

    resueltas = 0
    for l in casos:
        r = cache.get(l.pop("_clave", None))
        if not r:
            continue
        l["segunda_mirada"] = r
        producto = planilla.por_codigo.get(r["codigo"].upper()) if r["codigo"] else None
        if l.get("verificar"):
            if producto and producto["codigo"] == l["producto"]["codigo"]:
                l["metodo"] = "precio único (verificado)"
                continue
            if not producto:      # no se parece a nada: queda, pero como dudoso
                l.update(confianza="baja", metodo="precio único (dudoso)")
                continue
        if not producto:
            continue
        precio_distinto = l["estado"] in ("no_encontrado", "ilegible") or l.get("verificar")
        l.update(
            estado="identificado",
            producto=producto,
            # Si el precio leído no era el de la planilla, nunca queda "alta".
            confianza=confianza_menor(confianza_menor(l["etiqueta"]["confianza"], r["seguridad"]),
                                      "media" if precio_distinto else "alta"),
            metodo="segunda mirada" + (" (precio cercano)" if precio_distinto else ""),
        )
        resueltas += 1
    return resueltas
