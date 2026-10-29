"""
identificar.py — Decide qué producto es cada etiqueta leída.

Resultado de cada etiqueta:
    identificado   se sabe qué producto es
    ambiguo        varios productos tienen ese precio y no se pudo decidir
    no_encontrado  el precio no está en la planilla
    ilegible       la etiqueta está, pero el precio no se pudo leer
"""

import re
import unicodedata
from collections import Counter, defaultdict

ORDEN_CONFIANZA = {"baja": 1, "media": 2, "alta": 3}


def confianza_menor(a, b):
    """La más baja de dos confianzas ("media" y "alta" -> "media")."""
    return a if ORDEN_CONFIANZA[a] <= ORDEN_CONFIANZA[b] else b


def _palabras(texto):
    """Mayúsculas, sin tildes, separado en palabras de 3 o más letras."""
    texto = unicodedata.normalize("NFD", str(texto or "").upper())
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return [p for p in re.split(r"[^A-Z0-9]+", texto) if len(p) >= 3]


def _puntaje(texto_apoyo, producto):
    """Cuántas palabras del texto de la etiqueta aparecen en el nombre/categoría."""
    objetivo = " ".join(_palabras(producto["nombre"] + " " + producto["categoria"]))
    return sum(1 for p in _palabras(texto_apoyo) if p in objetivo)


def identificar_etiqueta(et, planilla):
    """Devuelve dict con: estado, producto, candidatos, confianza, metodo."""
    if not et["legible"] or not et["precio"]:
        return {"estado": "ilegible", "producto": None, "candidatos": [], "confianza": "baja", "metodo": ""}

    # a) Si se leyó el código completo y existe, es lo más seguro.
    por_codigo = et["codigo_parcial"] and planilla.por_codigo.get(et["codigo_parcial"].upper())
    if por_codigo:
        coincide = por_codigo["precio"] == et["precio"]
        # Si el precio no coincide, la etiqueta puede ser vieja: igual lo
        # identificamos, pero con confianza media.
        return {
            "estado": "identificado", "producto": por_codigo, "candidatos": [por_codigo],
            "confianza": et["confianza"] if coincide else confianza_menor(et["confianza"], "media"),
            "metodo": "código" if coincide else "código (precio distinto)",
        }

    # b) Por precio.
    candidatos = planilla.por_precio.get(et["precio"], [])
    if not candidatos:
        return {"estado": "no_encontrado", "producto": None, "candidatos": [],
                "confianza": et["confianza"], "metodo": "precio"}
    if len(candidatos) == 1:
        return {"estado": "identificado", "producto": candidatos[0], "candidatos": candidatos,
                "confianza": et["confianza"], "metodo": "precio único"}

    # c) Varios productos con el mismo precio: desempatamos con el texto de apoyo.
    ranking = sorted(((_puntaje(et["texto_apoyo"], p), p) for p in candidatos),
                     key=lambda x: x[0], reverse=True)
    (mejor_pts, mejor), (segundo_pts, _) = ranking[0], ranking[1]
    # Solo elegimos si el mejor gana claramente (al menos el doble de coincidencias).
    if mejor_pts > 0 and mejor_pts >= 2 * segundo_pts:
        return {"estado": "identificado", "producto": mejor, "candidatos": candidatos,
                "confianza": confianza_menor(et["confianza"], "media"), "metodo": "precio + texto"}
    return {"estado": "ambiguo", "producto": None, "candidatos": candidatos,
            "confianza": et["confianza"], "metodo": "precio repetido"}


# ---------------------------------------------------------------------
# Desempate por categoría
# ---------------------------------------------------------------------
# Los productos suelen estar agrupados por categoría en el depósito.
# Si un precio lo comparten, por ejemplo, un producto de "Cocina" y otro de
# "Baño", y alrededor ya se identificaron varios productos de "Cocina",
# lo más probable es que sea el de Cocina.
#
# Cada candidato suma "votos" según cuántos productos de SU categoría hay:
PESO_MISMA_COLUMNA = 3  # en la misma columna de la misma foto
PESO_OTRA_COLUMNA = 2   # en la otra columna de la misma foto
PESO_VECINAS = 1        # en las fotos de al lado (antes y después)
PESO_ANTERIOR = 1       # cerca de esa foto, según el relevamiento anterior
PESO_TEXTO = 3          # por cada palabra de la etiqueta que coincide con el nombre
VECINDAD = 2            # cuántas fotos antes y después cuentan como "vecinas"

# Para elegir, el mejor candidato necesita al menos estos votos y el doble
# que el segundo. Con VOTOS_FUERTE o más, la confianza puede ser "media";
# si no, queda "baja" (la app lo muestra como ubicación incierta).
VOTOS_MINIMOS = 2
VOTOS_FUERTE = 4


def _desempatar_por_categoria(lecturas, planilla, mapa_anterior):
    # Categorías de los productos YA identificados (sin desempate),
    # por zona (= foto) y columna.
    por_columna = defaultdict(Counter)     # (zona, "I") -> Counter
    por_zona = defaultdict(Counter)        # zona -> Counter
    for l in lecturas:
        if l["estado"] == "identificado":
            cat = l["producto"]["categoria"]
            por_columna[(l["zona"], l["columna"])][cat] += 1
            por_zona[l["zona"]][cat] += 1

    # Categorías que había en cada zona según el relevamiento anterior.
    anterior = defaultdict(Counter)
    for clave, u in (mapa_anterior or {}).items():
        producto = planilla.por_codigo.get(str(clave).upper())
        if producto and isinstance(u, dict) and isinstance(u.get("zona"), int) and u.get("estado") != "posible_movido":
            anterior[u["zona"]][producto["categoria"]] += 1

    for l in lecturas:
        if l["estado"] != "ambiguo":
            continue
        z, col = l["zona"], l["columna"]
        otra = "D" if col == "I" else "I"
        vecinas, cerca_antes = Counter(), Counter()
        for d in range(-VECINDAD, VECINDAD + 1):
            cerca_antes.update(anterior[z + d])
            if d:
                vecinas.update(por_zona[z + d])

        def votos(p):
            cat = p["categoria"]
            return (PESO_MISMA_COLUMNA * por_columna[(z, col)][cat] +
                    PESO_OTRA_COLUMNA * por_columna[(z, otra)][cat] +
                    PESO_VECINAS * vecinas[cat] + PESO_ANTERIOR * cerca_antes[cat] +
                    PESO_TEXTO * _puntaje(l["etiqueta"]["texto_apoyo"], p))

        ranking = sorted(((votos(p), p) for p in l["candidatos"]), key=lambda x: x[0], reverse=True)
        l["candidatos"] = [p for _, p in ranking]          # los más probables primero
        (mejor, producto), (segundo, _) = ranking[0], ranking[1]
        if mejor >= VOTOS_MINIMOS and mejor >= 2 * segundo:
            l.update(
                estado="identificado",
                producto=producto,
                confianza=confianza_menor(l["etiqueta"]["confianza"], "media" if mejor >= VOTOS_FUERTE else "baja"),
                metodo="precio + categoría vecina",
            )


def identificar_todo(fotos, planilla, mapa_anterior=None):
    """Una lectura por cada etiqueta de cada columna de cada foto, ya identificada.

    La zona de cada etiqueta es el número de la foto en el recorrido
    (1, 2, 3...) y la columna es "I" (izquierda) o "D" (derecha).

    mapa_anterior: lo guardado en Firebase (ubicaciones/mapa), si se pudo
    leer; ayuda a desempatar con las categorías que había cerca.
    """
    lecturas = []
    for foto in fotos:
        for col, analisis in (foto.get("columnas") or {}).items():
            for et in analisis["etiquetas"]:
                lecturas.append({
                    "foto": foto["nombre"],
                    "indice": foto["indice"],
                    "zona": foto["zona"],
                    "columna": col,
                    "etiqueta": et,
                    **identificar_etiqueta(et, planilla),
                })
    _desempatar_por_categoria(lecturas, planilla, mapa_anterior)
    return lecturas
