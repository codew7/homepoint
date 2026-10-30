"""
lector_claude.py — Le pide a Claude Code (con tu suscripción) que lea los
precios de las etiquetas en cada imagen y los devuelva en JSON.

Cada imagen es UNA columna de mercadería, sacada de cerca con LocatorPic:
la columna entera o algunos de sus estantes (si la columna se fotografió
en varias fotos, una debajo de la otra). De cada etiqueta se pide además
su posición en la foto (x, y): sirve para no contar dos veces una etiqueta
que aparece en dos fotos seguidas de la misma columna y para recortarla en
la "segunda mirada".

Segunda mirada (elegir_candidatos): cuando un precio lo comparten varios
productos, o no está en la planilla, se le muestra a Claude el recorte de
esa etiqueta con el producto que tiene arriba, junto con la lista de
productos posibles, y se le pide que elija cuál es (o ninguno).

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

Cada imagen es UNA columna de mercadería, sacada de cerca: la columna entera o algunos de sus estantes. A los costados puede asomar un poco de las columnas vecinas, y arriba o abajo puede haber etiquetas cortadas.
Leé solo las etiquetas que estén mayormente dentro de la imagen.

Las etiquetas son impresas, con este formato:
   - arriba, el nombre del artículo (a veces cortado);
   - en el centro, el precio grande en pesos, sin decimales, con punto de miles: "$ 6.222";
   - abajo, en letra muy chica, el código del artículo y la fecha de impresión.

Para CADA etiqueta visible devolvé:
   - precio_texto: el precio tal cual lo ves (ej. "$ 6.222").
   - precio: el mismo precio como número entero, sin símbolo ni puntos (ej. 6222). Si no se puede leer, 0.
   - nombre_etiqueta: el nombre impreso arriba en la etiqueta, copiado tal cual (en mayúsculas, aunque esté cortado). Es el dato más útil después del precio: hacé el esfuerzo de leerlo. "" solo si de verdad no se ve.
   - codigo: el código impreso abajo en letra chica, con un "?" por cada carácter que no se pueda leer (ej. "12?45"). "" si no se ve nada.
   - descripcion: qué producto hay sobre la etiqueta o al lado, en 2 a 5 palabras en castellano (ej. "guantes deportivos negros", "canasto plástico"). "" si no se distingue.
   - texto_apoyo: otros textos legibles del envase (marca, modelo, medida, color). "" si no hay.
   - confianza: "alta" si leíste el precio sin ninguna duda, "media" si hay algún dígito dudoso, "baja" si es casi ilegible.
   - legible: false si la etiqueta está pero el precio no se puede leer.
   - x: dónde está el centro de la etiqueta, de izquierda a derecha, de 0 (borde izquierdo de la imagen) a 100 (borde derecho). Aproximado.
   - y: dónde está el centro de la etiqueta, de arriba hacia abajo, de 0 (borde de arriba de la imagen) a 100 (borde de abajo). Aproximado.

Reglas:
- No inventes precios, nombres ni códigos. Si dudás de un dígito, bajá la confianza.
- No repitas la misma etiqueta dos veces dentro de una imagen.
- Ignorá precios que no estén en estas etiquetas (cajas de proveedor, códigos de barras, carteles de oferta).
- En problemas_foto marcá lo que dificulte leer: borrosa, reflejo, tapada (etiquetas tapadas por productos), oscura, lejos (etiquetas muy chicas), movida, cortada (etiquetas cortadas por el borde), otra.
- En comentario explicá en una frase corta cualquier dificultad. Si no hubo, "".
- Devolvé un elemento en "imagenes" por CADA archivo de la lista, con su nombre exacto en "archivo"."""

_ETIQUETA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["precio_texto", "precio", "nombre_etiqueta", "codigo", "descripcion", "texto_apoyo",
                 "confianza", "legible", "x", "y"],
    "properties": {
        "precio_texto": {"type": "string"},
        "precio": {"type": "number"},
        "nombre_etiqueta": {"type": "string"},
        "codigo": {"type": "string"},
        "descripcion": {"type": "string"},
        "texto_apoyo": {"type": "string"},
        "confianza": {"type": "string", "enum": list(CONFIANZAS)},
        "legible": {"type": "boolean"},
        "x": {"type": "number"},
        "y": {"type": "number"},
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

def _posicion(valor):
    """Posición 0-100, o None si no vino o no es un número."""
    try:
        return min(max(float(valor), 0.0), 100.0)
    except (TypeError, ValueError):
        return None


def validar_imagen(d):
    """Revisa el resultado de UNA imagen y lo devuelve limpio.
    Si algo no cierra, lanza ErrorDeLectura."""
    if not isinstance(d, dict) or not isinstance(d.get("etiquetas"), list):
        raise ErrorDeLectura("Falta la lista de etiquetas")

    etiquetas = []
    for e in d["etiquetas"]:
        if not isinstance(e, dict) or e.get("confianza") not in CONFIANZAS:
            raise ErrorDeLectura("Etiqueta inválida")
        codigo = re.sub(r"\s+", "", str(e.get("codigo") or e.get("codigo_parcial") or "")).upper()
        etiquetas.append({
            "precio_texto": str(e.get("precio_texto") or ""),
            # Preferimos el texto tal cual se ve ("$ 6.222"): el número podría
            # venir como 6.222 (seis coma algo) por error.
            "precio": normalizar_precio(e.get("precio_texto")) or normalizar_precio(e.get("precio")),
            "nombre_etiqueta": str(e.get("nombre_etiqueta") or "").strip(),
            # Código completo (sin "?") o "" ; codigo_visible conserva los "?".
            "codigo_parcial": codigo if codigo and "?" not in codigo else "",
            "codigo_visible": codigo,
            "descripcion": str(e.get("descripcion") or "").strip(),
            "texto_apoyo": str(e.get("texto_apoyo") or "").strip(),
            "confianza": e["confianza"],
            "legible": e.get("legible") is not False,
            "x": _posicion(e.get("x")),
            "y": _posicion(e.get("y")),
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


def _llamar_claude(carpeta, archivos, modelo, instrucciones=INSTRUCCIONES, esquema=None, clave="imagenes"):
    """Una sola ejecución de Claude Code para un lote de imágenes."""
    esquema = esquema or ESQUEMA
    lista = "\n".join(f"- {a}" for a in archivos)
    prompt = (instrucciones +
              "\n\nImágenes de este lote (abrí cada una con la herramienta Read, en este orden):\n" + lista)

    comando = [
        _ejecutable_claude(), "-p", prompt,
        "--output-format", "json",
        "--json-schema", json.dumps(esquema),
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
    if not isinstance(datos, dict) or not isinstance(datos.get(clave), list):
        raise ErrorDeLectura("La respuesta no trae la lista de imágenes")
    return datos[clave]


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


# ---------------------------------------------------------------------
# Segunda mirada: elegir entre los productos posibles
# ---------------------------------------------------------------------

INSTRUCCIONES_ELEGIR = """Ayudás a identificar productos en el depósito de una tienda de artículos del hogar en Argentina.

Cada imagen es un recorte de una estantería. La etiqueta de precio que interesa está marcada con un recuadro naranja; el producto al que corresponde suele estar justo arriba de la etiqueta (a veces al costado).

Para cada imagen te paso la lista de productos posibles (código y nombre, como figuran en la planilla de la tienda). Mirá la etiqueta (sobre todo el nombre impreso arriba y el código chico de abajo) y el producto, y elegí cuál de la lista es.

Devolvé, por CADA archivo:
   - archivo: el nombre exacto del archivo.
   - codigo: el código del producto elegido, copiado de la lista. "" si ninguno corresponde o no se puede saber.
   - seguridad: "alta" si el nombre o el código de la etiqueta coinciden claramente, "media" si lo deducís por cómo es el producto, "baja" si es una suposición.
   - motivo: en pocas palabras, qué te hizo decidir (ej. "la etiqueta dice GUANTE DEPORTIVO").

No elijas por descarte: si nada de la lista se parece a lo que ves, devolvé "".
"""

ESQUEMA_ELEGIR = {
    "type": "object",
    "additionalProperties": False,
    "required": ["respuestas"],
    "properties": {
        "respuestas": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["archivo", "codigo", "seguridad", "motivo"],
                "properties": {
                    "archivo": {"type": "string"},
                    "codigo": {"type": "string"},
                    "seguridad": {"type": "string", "enum": list(CONFIANZAS)},
                    "motivo": {"type": "string"},
                },
            },
        }
    },
}


def elegir_candidatos(carpeta, casos, modelo=None):
    """casos: [{"archivo", "precio_texto", "candidatos": [{"codigo", "nombre"}]}].
    Devuelve {archivo: {"codigo", "seguridad", "motivo"}} (solo los que vinieron
    bien y con un código de su lista o ""). Reintenta si Claude falla."""
    texto = INSTRUCCIONES_ELEGIR + "\nProductos posibles de cada imagen:\n"
    for c in casos:
        texto += f"\n{c['archivo']} (la etiqueta dice {c['precio_texto'] or 'un precio ilegible'}):\n"
        texto += "\n".join(f"   {p['codigo']} · {p['nombre']}" for p in c["candidatos"]) + "\n"
    archivos = [c["archivo"] for c in casos]
    validos = {c["archivo"]: {p["codigo"] for p in c["candidatos"]} for c in casos}

    ultimo_error = None
    for intento in range(REINTENTOS + 1):
        if intento:
            espera = ESPERAS[min(intento - 1, len(ESPERAS) - 1)]
            log.warning("  Reintento %d en %d s (%s)", intento, espera, ultimo_error)
            time.sleep(espera)
        try:
            crudos = _llamar_claude(carpeta, archivos, modelo, texto, ESQUEMA_ELEGIR, "respuestas")
        except ErrorDeLectura as e:
            ultimo_error = e
            continue
        resultado = {}
        for d in crudos:
            if not isinstance(d, dict) or d.get("archivo") not in validos:
                continue
            codigo = str(d.get("codigo") or "").strip()
            if codigo and codigo not in validos[d["archivo"]]:
                continue        # inventó un código que no estaba en la lista
            if d.get("seguridad") not in CONFIANZAS:
                continue
            resultado[d["archivo"]] = {"codigo": codigo, "seguridad": d["seguridad"],
                                       "motivo": str(d.get("motivo") or "")}
        if resultado:
            return resultado
        ultimo_error = ErrorDeLectura("Ninguna respuesta del lote vino bien")
    raise ultimo_error
