"""
lector_claude.py — Le pide a Claude Code (con tu suscripción) que lea los
precios de las etiquetas en cada imagen y los devuelva en JSON.

Cada imagen es UNA columna de mercadería (la mitad izquierda o derecha de
una foto de estantería).

Cómo funciona: por cada lote de imágenes se ejecuta, sin ventana,
    claude -p "<instrucciones>" --json-schema <forma del JSON> ...
Claude abre cada imagen con su herramienta "Read" (solo puede LEER archivos
de la carpeta de trabajo; no puede ejecutar nada ni tocar otra cosa) y
responde con un JSON que Claude Code ya valida contra el esquema.
Acá se vuelve a validar antes de usarlo.
"""

import json
import logging
import re
import shutil
import subprocess
import time

from planilla import normalizar_precio

log = logging.getLogger("locator")

TIEMPO_MAX_POR_LOTE = 600      # segundos
REINTENTOS = 3                 # reintentos por lote si algo falla
ESPERAS = [15, 45, 120]        # segundos de espera antes de cada reintento

CONFIANZAS = ("alta", "media", "baja")
PROBLEMAS = ("borrosa", "reflejo", "tapada", "oscura", "lejos", "movida", "cortada", "otra")


class LimiteDeUso(Exception):
    """Se alcanzó el límite de uso de la suscripción. Hay que esperar."""


class ErrorDeLectura(Exception):
    """Claude no pudo devolver un resultado válido (se puede reintentar)."""


# ---------------------------------------------------------------------
# Instrucciones y forma de la respuesta
# ---------------------------------------------------------------------

INSTRUCCIONES = """Leés etiquetas de precio en fotos de las estanterías del depósito de una tienda de artículos del hogar en Argentina.

Cada imagen es UNA columna de mercadería: la mitad izquierda o la mitad derecha de una foto de estantería. En el borde del corte puede asomar un poco de la otra columna: leé solo las etiquetas que estén mayormente dentro de la imagen.

Las etiquetas son impresas, con este formato:
   - arriba, el nombre del artículo (a veces cortado);
   - en el centro, el precio grande en pesos, sin decimales, con punto de miles: "$ 6.222";
   - abajo, en letra muy chica, el código del artículo y la fecha de impresión.

Para CADA etiqueta visible devolvé:
   - precio_texto: el precio tal cual lo ves (ej. "$ 6.222").
   - precio: el mismo precio como número entero, sin símbolo ni puntos (ej. 6222). Si no se puede leer, 0.
   - codigo_parcial: el código de la franja de abajo SOLO si se lee completo y sin dudas; si no, "".
   - texto_apoyo: cualquier otro texto legible de la etiqueta o del envase (nombre, marca, medida, color). "" si no hay.
   - confianza: "alta" si leíste el precio sin ninguna duda, "media" si hay algún dígito dudoso, "baja" si es casi ilegible.
   - legible: false si la etiqueta está pero el precio no se puede leer.

Reglas:
- No inventes precios. Si dudás de un dígito, bajá la confianza.
- No repitas la misma etiqueta dos veces dentro de una imagen.
- Ignorá precios que no estén en estas etiquetas (cajas de proveedor, códigos de barras, carteles de oferta).
- En problemas_foto marcá lo que dificulte leer: borrosa, reflejo, tapada (etiquetas tapadas por productos), oscura, lejos (etiquetas muy chicas), movida, cortada (etiquetas cortadas por el borde), otra.
- En comentario explicá en una frase corta cualquier dificultad. Si no hubo, "".
- Devolvé un elemento en "imagenes" por CADA archivo de la lista, con su nombre exacto en "archivo"."""

_ETIQUETA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["precio_texto", "precio", "codigo_parcial", "texto_apoyo", "confianza", "legible"],
    "properties": {
        "precio_texto": {"type": "string"},
        "precio": {"type": "number"},
        "codigo_parcial": {"type": "string"},
        "texto_apoyo": {"type": "string"},
        "confianza": {"type": "string", "enum": list(CONFIANZAS)},
        "legible": {"type": "boolean"},
    },
}

ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["imagenes"],
    "properties": {
        "imagenes": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["archivo", "etiquetas", "problemas_foto", "comentario"],
                "properties": {
                    "archivo": {"type": "string"},
                    "etiquetas": {"type": "array", "items": _ETIQUETA},
                    "problemas_foto": {"type": "array", "items": {"type": "string", "enum": list(PROBLEMAS)}},
                    "comentario": {"type": "string"},
                },
            },
        }
    },
}


# ---------------------------------------------------------------------
# Validación
# ---------------------------------------------------------------------

def validar_imagen(d):
    """Revisa el resultado de UNA imagen y lo devuelve limpio.
    Si algo no cierra, lanza ErrorDeLectura."""
    if not isinstance(d, dict) or not isinstance(d.get("etiquetas"), list):
        raise ErrorDeLectura("Falta la lista de etiquetas")

    etiquetas = []
    for e in d["etiquetas"]:
        if not isinstance(e, dict) or e.get("confianza") not in CONFIANZAS:
            raise ErrorDeLectura("Etiqueta inválida")
        etiquetas.append({
            "precio_texto": str(e.get("precio_texto") or ""),
            # Preferimos el texto tal cual se ve ("$ 6.222"): el número podría
            # venir como 6.222 (seis coma algo) por error.
            "precio": normalizar_precio(e.get("precio_texto")) or normalizar_precio(e.get("precio")),
            "codigo_parcial": str(e.get("codigo_parcial") or "").strip(),
            "texto_apoyo": str(e.get("texto_apoyo") or "").strip(),
            "confianza": e["confianza"],
            "legible": e.get("legible") is not False,
        })

    return {
        "etiquetas": etiquetas,
        "problemas": [p for p in d.get("problemas_foto") or [] if p in PROBLEMAS],
        "comentario": str(d.get("comentario") or ""),
    }


# ---------------------------------------------------------------------
# Llamada a Claude Code
# ---------------------------------------------------------------------

_TEXTO_LIMITE = re.compile(r"(usage|rate).{0,20}limit|limit.{0,30}(reach|reset)|límite", re.I)


def _ejecutable_claude():
    exe = shutil.which("claude")
    if not exe:
        raise RuntimeError("No encuentro Claude Code. Instalalo y ejecutá 'claude' una vez para iniciar sesión.")
    return exe


def _llamar_claude(carpeta, archivos, modelo):
    """Una sola ejecución de Claude Code para un lote de imágenes."""
    lista = "\n".join(f"- {a}" for a in archivos)
    prompt = (INSTRUCCIONES +
              "\n\nImágenes de este lote (abrí cada una con la herramienta Read, en este orden):\n" + lista)

    comando = [
        _ejecutable_claude(), "-p", prompt,
        "--output-format", "json",
        "--json-schema", json.dumps(ESQUEMA),
        "--tools", "Read",               # la única herramienta disponible: leer archivos
        "--allowedTools", "Read",
        "--restricted",                  # solo puede leer dentro de la carpeta de trabajo
        "--strict-mcp-config",           # sin conectores externos
        "--no-session-persistence",      # no guarda estas sesiones en el historial
    ]
    if modelo:
        comando += ["--model", modelo]

    try:
        r = subprocess.run(comando, cwd=carpeta, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=TIEMPO_MAX_POR_LOTE)
    except subprocess.TimeoutExpired:
        raise ErrorDeLectura("Claude tardó demasiado")

    try:
        salida = json.loads(r.stdout)
    except json.JSONDecodeError:
        texto = (r.stdout + r.stderr)[:400]
        if _TEXTO_LIMITE.search(texto):
            raise LimiteDeUso(texto)
        raise ErrorDeLectura(f"Claude Code no devolvió JSON (código {r.returncode}): {texto}")

    if salida.get("is_error") or r.returncode != 0:
        texto = str(salida.get("result", "")) + " " + r.stderr
        if salida.get("api_error_status") == 429 or _TEXTO_LIMITE.search(texto):
            raise LimiteDeUso(texto.strip()[:400])
        raise ErrorDeLectura(texto.strip()[:400] or f"Claude Code terminó con código {r.returncode}")

    datos = salida.get("structured_output")
    if not isinstance(datos, dict) or not isinstance(datos.get("imagenes"), list):
        raise ErrorDeLectura("La respuesta no trae la lista de imágenes")
    return datos["imagenes"]


def analizar_lote(carpeta, archivos, modelo=None):
    """Analiza un lote de imágenes con reintentos.

    Devuelve {archivo: resultado_validado}. Las imágenes que Claude no
    devolvió (o devolvió mal) quedan afuera; quien llama decide si
    reintentarlas solas.
    """
    ultimo_error = None
    for intento in range(REINTENTOS + 1):
        if intento:
            espera = ESPERAS[min(intento - 1, len(ESPERAS) - 1)]
            log.warning("  Reintento %d en %d s (%s)", intento, espera, ultimo_error)
            time.sleep(espera)
        try:
            crudos = _llamar_claude(carpeta, archivos, modelo)
        except ErrorDeLectura as e:
            ultimo_error = e
            continue

        resultado = {}
        for d in crudos:
            nombre = str(d.get("archivo", "")).strip() if isinstance(d, dict) else ""
            if nombre in archivos:
                try:
                    resultado[nombre] = validar_imagen(d)
                except ErrorDeLectura as e:
                    log.warning("  %s: %s", nombre, e)
        if resultado:
            return resultado
        ultimo_error = ErrorDeLectura("Ninguna imagen del lote vino bien")
    raise ultimo_error
