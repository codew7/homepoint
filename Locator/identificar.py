"""
identificar.py — Decide qué producto es cada etiqueta leída.

Resultado de cada etiqueta:
    identificado   se sabe qué producto es
    ambiguo        varios productos tienen ese precio y no se pudo decidir
    no_encontrado  el precio no está en la planilla
    ilegible       la etiqueta está, pero el precio no se pudo leer

Pistas que se usan, de la más segura a la menos segura:
    1. el código impreso (completo, o con algunos caracteres ilegibles);
    2. el precio;
    3. el NOMBRE impreso en la etiqueta, comparado con el de la planilla
       (sirve también para etiquetas viejas, con un precio que ya cambió);
    4. lo que se ve del producto (descripción y textos del envase);
    5. la "segunda mirada" de Claude sobre el recorte (ver relevar.py);
    6. la categoría de los productos vecinos y dónde estaba cada producto
       en el relevamiento anterior (desempatar).
"""

import re
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher

ORDEN_CONFIANZA = {"baja": 1, "media": 2, "alta": 3}

SIMILITUD_NOMBRE = 0.72      # desde acá, el nombre de la etiqueta "coincide"
SIMILITUD_SIN_PRECIO = 0.85  # para identificar solo por nombre (precio distinto)
MAX_CANDIDATOS_CERCANOS = 12

# Dígitos que se confunden al leer un precio impreso.
CONFUSIONES = {"0": "689", "1": "74", "2": "7", "3": "85", "4": "19", "5": "63",
               "6": "508", "7": "12", "8": "3609", "9": "40"}


def confianza_menor(a, b):
    """La más baja de dos confianzas ("media" y "alta" -> "media")."""
    return a if ORDEN_CONFIANZA[a] <= ORDEN_CONFIANZA[b] else b


# ---------------------------------------------------------------------
# Comparar textos
# ---------------------------------------------------------------------

def _normal(texto):
    """Mayúsculas, sin tildes y con un solo espacio entre palabras."""
    texto = unicodedata.normalize("NFD", str(texto or "").upper())
    texto = "".join(c for c in texto if unicodedata.category(c) != "Mn")
    return " ".join(re.split(r"[^A-Z0-9]+", texto)).strip()


def _palabras(texto):
    return [p for p in _normal(texto).split() if len(p) >= 3]


def _misma_palabra(a, b):
    """GUANTES = GUANTE, CONTENEDORES = CONTENEDOR, PLAST = PLASTICO."""
    if a == b:
        return True
    corta, larga = sorted((a, b), key=len)
    return len(corta) >= 4 and larga.startswith(corta[:max(4, len(corta) - 2)])


def coincidencias(texto, producto):
    """Cuántas palabras del texto aparecen en el nombre o la categoría."""
    objetivo = _palabras(producto["nombre"] + " " + producto["categoria"])
    return sum(1 for p in set(_palabras(texto)) if any(_misma_palabra(p, o) for o in objetivo))


def similitud_nombre(nombre_etiqueta, producto):
    """0 a 1: cuánto se parece el nombre impreso al de la planilla. La
    etiqueta puede traer el nombre cortado, así que se compara con el
    principio del nombre de la planilla."""
    a = _normal(nombre_etiqueta)
    if len(a) < 4:
        return 0.0
    b = _normal(producto["nombre"])
    return SequenceMatcher(None, a, b[:len(a) + 2]).ratio()


def _pistas(et):
    return " ".join(x for x in (et.get("descripcion"), et.get("texto_apoyo")) if x)


def _puntaje(et, producto):
    """Puntaje de un candidato según lo que se leyó de la etiqueta y se vio del producto."""
    sim = similitud_nombre(et.get("nombre_etiqueta"), producto)
    return (10 * sim if sim >= 0.5 else 0) + 3 * coincidencias(_pistas(et), producto)


# ---------------------------------------------------------------------
# Identificar una etiqueta
# ---------------------------------------------------------------------

def _por_codigo_visible(et, candidatos):
    """Código con caracteres ilegibles ("12?45"): los candidatos que encajan."""
    visible = et.get("codigo_visible") or ""
    if "?" not in visible or sum(c != "?" for c in visible) < 3:
        return []
    patron = re.compile("^" + "".join("." if c == "?" else re.escape(c) for c in visible) + "$", re.I)
    return [p for p in candidatos if patron.match(p["codigo"])]


def precios_cercanos(precio, planilla):
    """Productos con un precio que difiere en UN dígito del leído. Primero los
    dígitos que más se confunden (6 por 8, 1 por 7...), después el resto."""
    if not precio:
        return []
    s, probables, resto = str(precio), [], []
    for i, d in enumerate(s):
        for otro in "0123456789":
            if otro == d or (i == 0 and otro == "0"):
                continue
            productos = planilla.por_precio.get(int(s[:i] + otro + s[i + 1:]), [])
            (probables if otro in CONFUSIONES.get(d, "") else resto).extend(productos)
    return probables + resto


def precios_con_comodin(precio_texto, planilla):
    """Precio con dígitos ilegibles ("$ 10.12?"): los productos cuyo precio encaja."""
    digitos = re.sub(r"[^0-9?]", "", str(precio_texto or ""))
    if "?" not in digitos or digitos.count("?") > 1 or len(digitos) < 4:
        return []
    patron = re.compile("^" + digitos.replace("?", "[0-9]") + "$")
    return [prod for precio, lista in planilla.por_precio.items() if patron.match(str(precio)) for prod in lista]


def identificar_etiqueta(et, planilla):
    """Devuelve dict con: estado, producto, candidatos, confianza, metodo."""
    if not et["legible"] or not et["precio"]:
        # Sin precio, igual puede salvarse por el código o el nombre.
        r = _sin_precio(et, planilla)
        return r or {"estado": "ilegible", "producto": None, "confianza": "baja", "metodo": "",
                     "candidatos": precios_con_comodin(et.get("precio_texto"), planilla)[:MAX_CANDIDATOS_CERCANOS]}

    # a) Código completo: lo más seguro.
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

    candidatos = planilla.por_precio.get(et["precio"], [])
    if not candidatos:
        r = _sin_precio(et, planilla)
        if r:
            return r
        return {"estado": "no_encontrado", "producto": None, "confianza": et["confianza"], "metodo": "precio",
                "candidatos": precios_cercanos(et["precio"], planilla)[:MAX_CANDIDATOS_CERCANOS]}

    # b) Código con algún carácter ilegible: si deja un solo candidato.
    encajan = _por_codigo_visible(et, candidatos)
    if len(encajan) == 1:
        return {"estado": "identificado", "producto": encajan[0], "candidatos": candidatos,
                "confianza": et["confianza"], "metodo": "precio + código parcial"}

    if len(candidatos) == 1:
        r = {"estado": "identificado", "producto": candidatos[0], "candidatos": candidatos,
             "confianza": et["confianza"], "metodo": "precio único"}
        # Si lo que se ve no tiene nada que ver con el producto, el precio
        # pudo leerse mal: la segunda mirada lo verifica (con los de precio
        # cercano como alternativa).
        pistas = _pistas(et)
        if len(_palabras(pistas)) >= 2 and coincidencias(pistas, candidatos[0]) == 0 \
                and similitud_nombre(et.get("nombre_etiqueta"), candidatos[0]) < SIMILITUD_NOMBRE:
            r["verificar"] = True
            r["candidatos"] = (candidatos + precios_cercanos(et["precio"], planilla))[:MAX_CANDIDATOS_CERCANOS]
        return r

    # c) Varios productos con el mismo precio: nombre impreso y lo que se ve.
    ranking = sorted(((_puntaje(et, p), p) for p in candidatos), key=lambda x: x[0], reverse=True)
    (mejor_pts, mejor), (segundo_pts, _) = ranking[0], ranking[1]
    sim = similitud_nombre(et.get("nombre_etiqueta"), mejor)
    if sim >= SIMILITUD_NOMBRE and mejor_pts >= segundo_pts + 2:
        return {"estado": "identificado", "producto": mejor, "candidatos": candidatos,
                "confianza": et["confianza"], "metodo": "precio + nombre"}
    # Por lo que se ve del producto: hacen falta al menos dos palabras en
    # común ("vaso térmico") y que el segundo quede lejos. Con una sola
    # palabra, decide la segunda mirada.
    if mejor_pts >= 6 and mejor_pts >= 2 * segundo_pts:
        return {"estado": "identificado", "producto": mejor, "candidatos": candidatos,
                "confianza": confianza_menor(et["confianza"], "media"), "metodo": "precio + texto"}
    return {"estado": "ambiguo", "producto": None, "candidatos": [p for _, p in ranking],
            "confianza": et["confianza"], "metodo": "precio repetido"}


def _sin_precio(et, planilla):
    """Sin un precio que sirva: por código parcial o por nombre en toda la
    planilla (etiqueta vieja, con un precio que ya cambió)."""
    todos = list(planilla.por_codigo.values())
    encajan = _por_codigo_visible(et, todos)
    if len(encajan) == 1:
        return {"estado": "identificado", "producto": encajan[0], "candidatos": encajan,
                "confianza": confianza_menor(et["confianza"], "media"), "metodo": "código parcial (precio distinto)"}
    if len(_normal(et.get("nombre_etiqueta"))) < 8:
        return None
    ranking = sorted(((similitud_nombre(et["nombre_etiqueta"], p), p) for p in todos),
                     key=lambda x: x[0], reverse=True)
    (mejor, producto), (segundo, _) = ranking[0], ranking[1]
    if mejor >= SIMILITUD_SIN_PRECIO and mejor - segundo >= 0.08:
        return {"estado": "identificado", "producto": producto, "candidatos": [producto],
                "confianza": "media", "metodo": "nombre (precio distinto)"}
    return None


# ---------------------------------------------------------------------
# Desempate por categoría y por el relevamiento anterior
# ---------------------------------------------------------------------
# Los productos suelen estar agrupados por categoría en el depósito, y de
# una semana a otra la mayoría no se mueve. Si un precio lo comparten, por
# ejemplo, un producto de "Cocina" y otro de "Baño", y alrededor ya se
# identificaron varios de "Cocina", lo más probable es que sea el de Cocina.
#
# Cada candidato suma "votos":
PESO_MISMA_COLUMNA = 3  # por cada producto de su categoría en la misma columna
PESO_PEGADA = 2         # ... en la columna de al lado (mismo grupo)
PESO_VECINAS = 1        # ... a dos columnas (mismo grupo)
PESO_ANTERIOR = 1       # ... cerca de esa columna, según el relevamiento anterior
PESO_MISMO_LUGAR = 5    # el mismo producto estaba en esta columna el relevamiento anterior
PESO_LUGAR_PEGADO = 2   # ... o en la columna de al lado
PESO_TEXTO = 1          # por cada punto de nombre/texto de la etiqueta
VECINDAD = 2            # cuántas columnas antes y después cuentan como "vecinas"

# Para elegir, el mejor candidato necesita al menos estos votos y el doble
# que el segundo. Con VOTOS_FUERTE o más, la confianza puede ser "media";
# si no, queda "baja" (la app lo muestra como ubicación incierta).
VOTOS_MINIMOS = 2
VOTOS_FUERTE = 5


def desempatar(lecturas, planilla, mapa_anterior):
    # Categorías de los productos YA identificados, por grupo y columna.
    por_columna = defaultdict(Counter)     # ("FL", 3) -> Counter
    for l in lecturas:
        if l["estado"] == "identificado":
            por_columna[(l["grupo"], l["columna"])][l["producto"]["categoria"]] += 1

    # Relevamiento anterior: categorías por columna y lugar de cada producto.
    anterior = defaultdict(Counter)
    lugar_anterior = {}
    for clave, u in (mapa_anterior or {}).items():
        producto = planilla.por_codigo.get(str(clave).upper())
        if (producto and isinstance(u, dict) and u.get("grupo") and isinstance(u.get("columna"), int)
                and u.get("estado") != "posible_movido"):
            anterior[(u["grupo"], u["columna"])][producto["categoria"]] += 1
            lugar_anterior[producto["codigo"]] = (u["grupo"], u["columna"])

    for l in lecturas:
        if l["estado"] != "ambiguo":
            continue
        g, col = l["grupo"], l["columna"]
        pegadas, vecinas, cerca_antes = Counter(), Counter(), Counter()
        for d in range(-VECINDAD, VECINDAD + 1):
            cerca_antes.update(anterior[(g, col + d)])
            if abs(d) == 1:
                pegadas.update(por_columna[(g, col + d)])
            elif d:
                vecinas.update(por_columna[(g, col + d)])

        def votos(p):
            cat = p["categoria"]
            antes = lugar_anterior.get(p["codigo"])
            lugar = 0
            if antes and antes[0] == g:
                lugar = PESO_MISMO_LUGAR if antes[1] == col else PESO_LUGAR_PEGADO if abs(antes[1] - col) == 1 else 0
            return (PESO_MISMA_COLUMNA * por_columna[(g, col)][cat] +
                    PESO_PEGADA * pegadas[cat] + PESO_VECINAS * vecinas[cat] +
                    PESO_ANTERIOR * cerca_antes[cat] + lugar +
                    PESO_TEXTO * _puntaje(l["etiqueta"], p))

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


def identificar_todo(columnas, planilla):
    """Una lectura por cada etiqueta de cada columna, identificada con lo que
    dice la etiqueta (sin desempatar todavía por los vecinos).

    El lugar de cada etiqueta es su grupo ("FL") y su número de columna
    dentro del grupo (1, 2, 3...). "ruta" es la foto de donde salió, para
    la segunda mirada.
    """
    lecturas = []
    for c in columnas:
        for et in (c.get("analisis") or {}).get("etiquetas", []):
            n = et.get("n_foto") or 0
            ruta = c["fotos"][n]["ruta"] if n < len(c["fotos"]) else c["fotos"][0]["ruta"]
            lecturas.append({
                "foto": c["nombre"],
                "ruta": str(ruta),
                "indice": c["indice"],
                "grupo": c["grupo"],
                "columna": c["columna"],
                "etiqueta": et,
                **identificar_etiqueta(et, planilla),
            })
    return lecturas
