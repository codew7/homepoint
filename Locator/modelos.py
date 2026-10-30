"""
modelos.py — Selector del modelo de Claude que lee las fotos.

La lista de modelos sale del catálogo que Claude Code guarda en la PC
(~/.claude/cache/model-catalog). Claude Code lo actualiza solo cada vez que
se usa, así que siempre muestra los modelos vigentes de tu cuenta. Si no
lo encuentra, ofrece los alias de siempre (opus, sonnet, haiku), que
Claude Code traduce al último modelo de cada familia.

El último modelo elegido queda en preferencias.json (al lado de este
archivo) y es el que se propone la próxima vez.
"""

import json
import logging
from pathlib import Path

log = logging.getLogger("locator")

AQUI = Path(__file__).resolve().parent
PREFERENCIAS = AQUI / "preferencias.json"
CATALOGO = Path.home() / ".claude" / "cache" / "model-catalog"

LADO_IMAGEN_POR_DEFECTO = 1568     # px; lo que acepta cualquier modelo
ALIAS = [
    {"id": "sonnet", "nombre": "Sonnet (el último)", "descripcion": "rinde más con el límite", "familia": "sonnet"},
    {"id": "opus", "nombre": "Opus (el último)", "descripcion": "el que más lee", "familia": "opus"},
    {"id": "haiku", "nombre": "Haiku (el último)", "descripcion": "el más rápido", "familia": "haiku"},
]
CONSEJO = {
    "sonnet": "recomendado: lee bien y gasta menos del límite",
    "opus": "el más preciso; gasta más del límite",
    "fable": "el más potente; gasta mucho más del límite",
    "haiku": "rápido y barato; lee peor los números chicos",
}


def leer_catalogo():
    """Modelos principales de la cuenta, del catálogo más nuevo de Claude Code:
    [{"id", "nombre", "descripcion", "familia", "lado"}]. [] si no hay catálogo."""
    mejor = None
    for f in CATALOGO.glob("*.json"):
        try:
            d = json.loads(f.read_text("utf-8"))
            cat = d.get("catalog") or {}
            if cat.get("surface") != "cc" or not (cat.get("config") or {}).get("models"):
                continue
            if mejor is None or d.get("fetchedAt", 0) > mejor.get("fetchedAt", 0):
                mejor = d
        except (OSError, ValueError):
            continue
    if not mejor:
        return []
    modelos = []
    for m in mejor["catalog"]["config"]["models"]:
        if m.get("section") != "main" or not m.get("id"):
            continue
        rt = m.get("runtime") or {}
        lim = rt.get("image_limits") or {}
        modelos.append({
            "id": m["id"],
            "nombre": m.get("name") or m["id"],
            "descripcion": m.get("description") or "",
            "familia": rt.get("family") or "",
            "lado": int(min(lim.get("max_width") or LADO_IMAGEN_POR_DEFECTO,
                            lim.get("max_height") or LADO_IMAGEN_POR_DEFECTO)),
        })
    return modelos


def _leer_preferencias():
    try:
        return json.loads(PREFERENCIAS.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def recordar(modelo):
    """Guarda el modelo usado (dict del catálogo, alias o None = el de Claude Code)."""
    datos = _leer_preferencias()
    datos["modelo"] = modelo
    PREFERENCIAS.write_text(json.dumps(datos, ensure_ascii=False, indent=1), "utf-8")


def _buscar(modelos, texto):
    """Encuentra un modelo por id exacto, por nombre o por familia ("sonnet")."""
    t = str(texto or "").strip().lower()
    if not t:
        return None
    for m in modelos:
        if t in (m["id"].lower(), m["nombre"].lower()):
            return m
    return next((m for m in modelos if m["familia"] == t), None)


def elegir(forzado=None, preguntar=True, env=None):
    """Decide el modelo. Devuelve dict {"id", "nombre", "lado"} o None (= el
    predeterminado de Claude Code).
        forzado:   lo que vino con --modelo (gana siempre)
        preguntar: muestra el selector (si no, usa el último)
        env:       CLAUDE_MODELO del .env, solo como primera propuesta."""
    modelos = leer_catalogo() or ALIAS
    previo = _leer_preferencias().get("modelo")

    if forzado:
        m = _buscar(modelos, forzado) or {"id": forzado, "nombre": forzado, "familia": ""}
        return _completar(m)

    # Lo que se usó la última vez. Si ese modelo ya no está (salió uno
    # nuevo), se propone el actual de la misma familia.
    propuesta = None
    if isinstance(previo, dict):
        propuesta = _buscar(modelos, previo.get("id")) or _buscar(modelos, previo.get("familia"))
    elif previo is None and "modelo" in _leer_preferencias():
        propuesta = "predeterminado"
    if propuesta is None and env:
        propuesta = _buscar(modelos, env)
    if propuesta is None:
        propuesta = _buscar(modelos, "sonnet")

    if not preguntar:
        return None if propuesta == "predeterminado" else _completar(propuesta)

    print()
    print("¿Con qué modelo de Claude se leen las fotos?")
    opciones = list(modelos)
    for n, m in enumerate(opciones, 1):
        marca = ("  <- el último usado" if previo is not None else "  <- recomendado") if m is propuesta else ""
        consejo = CONSEJO.get(m["familia"]) or m["descripcion"]
        print(f"  {n}. {m['nombre']:<20} {consejo}{marca}")
    n_pred = len(opciones) + 1
    print(f"  {n_pred}. El que tengas elegido en Claude Code"
          + ("  <- el último usado" if propuesta == "predeterminado" else ""))
    defecto = n_pred if propuesta == "predeterminado" else (opciones.index(propuesta) + 1 if propuesta in opciones else 1)
    while True:
        r = input(f"Número (Enter = {defecto}): ").strip()
        if not r:
            r = str(defecto)
        if r.isdigit() and 1 <= int(r) <= n_pred:
            break
        print("  Escribí uno de los números de la lista.")
    elegido = None if int(r) == n_pred else opciones[int(r) - 1]
    return _completar(elegido)


def _completar(m):
    if m is None:
        return None
    return {"id": m["id"], "nombre": m["nombre"], "familia": m.get("familia", ""),
            "lado": m.get("lado") or LADO_IMAGEN_POR_DEFECTO}
