r"""
Analisis tecnico del archivo de un comprobante (imagen o PDF).

    Imagenes  mapa ELA como ayuda visual para ver zonas retocadas, y huellas de
              imagen redibujada por IA: fondo que no es liso como en una captura
              real y tamano/proporcion propios de ChatGPT o Gemini
    PDF       elementos agregados encima (anotaciones), PDF que es solo una imagen,
              y capa de texto para compararla con lo que se ve
    Ambos     SHA-256 y hash perceptual (dHash) para detectar reenvios; sellos de
              IA o de programas de edicion que hayan quedado dentro del archivo

Uso suelto:
    venv\Scripts\python.exe forense.py <archivo>
"""

import hashlib
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageOps
from pypdf import PdfReader

import reglas
from reglas import aviso

ANOTACIONES_SOSPECHOSAS = {"/FreeText", "/Stamp", "/Square", "/Ink", "/Redact", "/Highlight", "/Polygon", "/Caret"}

ORIGEN = "archivo"
LADO_DHASH = 32
MAX_LADO_ELA = 1400

# Lisura: proporcion de pixeles identicos a su vecino de la derecha. Las capturas
# reales dan 76-92 % aun despues de WhatsApp, porque el celular pinta fondos de un
# color exacto; los PNG de ChatGPT dieron 37-44 %. La compresion de WhatsApp aplana
# ese ruido (los mismos PNG pasan a 69-85 %), asi que solo sirve con el archivo
# original o con una captura de la imagen hecha con IA.
LISURA_ROJO = 0.50
LISURA_MIN = 0.65

# Fondo "casi blanco": las apps pintan blanco puro (255) y WhatsApp lo conserva; los
# comprobantes de ChatGPT tienen fondo 250-254, y ese tono suele sobrevivir a WhatsApp.
CASI_BLANCO = (250, 254)

# Proporciones (alto/ancho) de los tamanos que entregan ChatGPT (1024x1024,
# 1024x1536) y Gemini (832x1248, 864x1184, 896x1152, 768x1344 y sus apaisados).
# Una captura de celular tiene la forma de la pantalla (entre 1.6 y 2.4).
FORMATOS_IA = {1.0: "cuadrado (1:1)", 1.5: "2:3", 1184 / 864: "3:4", 1152 / 896: "4:5", 1344 / 768: "9:16"}
TAMANOS_IA = {(1024, 1024), (1024, 1536), (1536, 1024), (832, 1248), (1248, 832), (864, 1184), (1184, 864),
              (896, 1152), (1152, 896), (768, 1344), (1344, 768), (1536, 672)}
TOLERANCIA_FORMATO = 0.006

# Marcas que dejan dentro del archivo las herramientas de IA (C2PA de ChatGPT,
# metadatos IPTC de Gemini) y los programas de edicion. WhatsApp las borra si se
# manda como foto, pero sobreviven si se manda como documento.
SELLOS_IA = {b"trainedAlgorithmicMedia": "metadato «creado con IA» (IPTC)", b"OpenAI": "OpenAI / ChatGPT",
             b"ChatGPT": "OpenAI / ChatGPT", b"DALL-E": "OpenAI / DALL-E", b"Gemini": "Google Gemini",
             b"Google AI": "Google AI", b"Firefly": "Adobe Firefly", b"Midjourney": "Midjourney"}
SELLO_C2PA = b"c2pa"
EDITORES = {b"Photoshop": "Adobe Photoshop", b"GIMP": "GIMP", b"Canva": "Canva", b"Picsart": "Picsart",
            b"Snapseed": "Snapseed", b"Pixelmator": "Pixelmator", b"Photopea": "Photopea"}


def hamming(a, b):
    if not a or not b or len(a) != len(b):
        return None
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def dhash(im, lado=LADO_DHASH):
    g = im.convert("L").resize((lado + 1, lado), Image.Resampling.LANCZOS)
    px = g.tobytes()
    bits = 0
    for y in range(lado):
        fila = px[y * (lado + 1):(y + 1) * (lado + 1)]
        for x in range(lado):
            bits = bits << 1 | (fila[x] > fila[x + 1])
    return f"{bits:0{lado * lado // 4}x}"


def _ela(im, destino):
    """Error Level Analysis: se recomprime al 90 % y se amplifica la diferencia.
    Las zonas pegadas o retocadas suelen brillar distinto que el resto."""
    rgb = im.convert("RGB")
    buf = io.BytesIO()
    rgb.save(buf, "JPEG", quality=90)
    buf.seek(0)
    diff = ImageChops.difference(rgb, Image.open(buf).convert("RGB"))
    # Se escala para que el percentil 99.5 llegue al blanco (el maximo suele ser un borde aislado)
    hist = diff.convert("L").histogram()
    corte, acumulado, total = 1, 0, sum(hist)
    for valor, cuenta in enumerate(hist):
        acumulado += cuenta
        if acumulado >= total * 0.995:
            corte = max(1, valor)
            break
    factor = min(60, 255 / corte)
    ela = diff.point(lambda v: min(255, int(v * factor)))
    ImageOps.contain(ela, (MAX_LADO_ELA, MAX_LADO_ELA)).save(destino, "PNG", optimize=True)


def lisura(im):
    """Proporcion de pixeles exactamente iguales a su vecino de la derecha (0 a 1)."""
    rgb = im.convert("RGB")
    if rgb.width < 2:
        return None
    diff = ImageChops.difference(rgb.crop((0, 0, rgb.width - 1, rgb.height)), rgb.crop((1, 0, rgb.width, rgb.height)))
    r, g, b = diff.split()
    mayor = ImageChops.lighter(ImageChops.lighter(r, g), b)
    return round(mayor.histogram()[0] / (mayor.width * mayor.height), 3)


def fondo(im):
    """Color mas repetido de la imagen [r, g, b] y la proporcion que ocupa."""
    rgb = im.convert("RGB")
    cuenta, color = max(rgb.getcolors(rgb.width * rgb.height))
    return list(color), round(cuenta / (rgb.width * rgb.height), 3)


def formato_ia(ancho, alto):
    """Nombre del formato de ChatGPT/Gemini si la imagen lo tiene; None si no."""
    if (ancho, alto) in TAMANOS_IA:
        return f"{ancho}×{alto}, tamaño exacto de imagen generada por IA"
    largo, corto = max(ancho, alto), min(ancho, alto)
    for proporcion, nombre in FORMATOS_IA.items():
        if abs(largo / corto - proporcion) <= TOLERANCIA_FORMATO:
            return f"proporción {nombre}, habitual en imágenes de ChatGPT o Gemini"
    return None


def _sellos(data):
    """Avisos por marcas de IA o de programas de edicion dentro del archivo."""
    ia = sorted({nombre for marca, nombre in SELLOS_IA.items() if marca in data})
    editores = sorted({nombre for marca, nombre in EDITORES.items() if marca in data})
    avisos = []
    if ia:
        avisos.append(aviso("rojo", "El archivo tiene un sello de inteligencia artificial",
                            f"Dentro del archivo figura: {', '.join(ia)}. Un comprobante real del banco nunca lo trae.", ORIGEN))
    elif SELLO_C2PA in data:
        avisos.append(aviso("amarillo", "El archivo tiene credenciales de contenido (C2PA)",
                            "Es la marca que dejan ChatGPT y otros programas al crear o editar una imagen. Las capturas de una app de banco no la traen.", ORIGEN))
    if editores:
        avisos.append(aviso("rojo", "El archivo pasó por un programa de edición",
                            f"Dentro del archivo figura: {', '.join(editores)}.", ORIGEN))
    return avisos


def _imagen(data, destino_ela):
    original = Image.open(io.BytesIO(data))
    original.load()
    im = ImageOps.exif_transpose(original)
    _ela(im, destino_ela)
    color, proporcion = fondo(im)
    meta = {"ancho": im.width, "alto": im.height, "lisura": lisura(im), "formato_ia": formato_ia(im.width, im.height),
            "fondo": color, "fondo_proporcion": proporcion}
    return {"tipo": "imagen", "dhash": dhash(im), "meta": meta, "avisos": []}


def _pdf(data):
    avisos = []
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            return {"tipo": "pdf", "meta": {}, "texto": "",
                    "avisos": [aviso("amarillo", "PDF protegido con contraseña", "No se pudo analizar por dentro.", ORIGEN)]}

    texto, anotaciones, imagenes = [], [], []
    for pagina in reader.pages:
        try:
            texto.append(pagina.extract_text() or "")
        except Exception:
            pass
        for a in pagina.get("/Annots") or []:
            try:
                tipo = str(a.get_object().get("/Subtype"))
                if tipo in ANOTACIONES_SOSPECHOSAS:
                    anotaciones.append(tipo.lstrip("/"))
            except Exception:
                pass
        try:
            imagenes.extend(pagina.images)
        except Exception:
            pass
    texto = "\n".join(texto)
    meta = {"paginas": len(reader.pages), "caracteres": len(texto.strip())}

    if anotaciones:
        avisos.append(aviso("rojo", "El PDF tiene elementos agregados encima",
                            f"Anotaciones: {', '.join(sorted(set(anotaciones)))} (texto, sellos o recuadros puestos sobre el comprobante).", ORIGEN))
    if meta["caracteres"] < 20 and imagenes:
        avisos.append(aviso("amarillo", "El PDF no tiene texto: es una imagen dentro de un PDF",
                            "Los comprobantes que generan los bancos traen el texto seleccionable. Así se esconde una captura retocada.", ORIGEN))

    salida = {"tipo": "pdf", "meta": meta, "texto": texto, "avisos": avisos}
    if meta["caracteres"] >= 20:
        normal = re.sub(r"\s+", " ", texto).strip().lower()
        salida["texto_hash"] = hashlib.sha256(normal.encode()).hexdigest()
    elif imagenes:
        try:
            mayor = max(imagenes, key=lambda i: len(i.data))
            salida["dhash"] = dhash(Image.open(io.BytesIO(mayor.data)))
        except Exception:
            pass
    return salida


def analizar(data, destino_ela):
    """Analiza los bytes de un comprobante. destino_ela: Path del PNG del mapa ELA (solo imagenes)."""
    if data[:5] == b"%PDF-":
        r = _pdf(data)
    else:
        try:
            r = _imagen(data, destino_ela)
        except Exception as e:
            raise ValueError(f"No es una imagen ni un PDF que se pueda abrir ({e})") from e
    r["avisos"] += _sellos(data)
    r["sha256"] = hashlib.sha256(data).hexdigest()
    return r


CONSEJO_GEMINI = (" Para salir de dudas: subí la imagen a la app de Gemini y preguntale «¿Esta imagen fue creada o "
                  "editada con IA de Google?». Detecta su marca invisible (SynthID), que resiste WhatsApp.")


def controles_ia(forense, datos, fondos_reales=()):
    """Huellas de imagen redibujada por IA. Solo pesan si Claude la vio como captura
    de pantalla: una foto de un ticket o de otra pantalla nunca tiene fondo liso.
    fondos_reales: colores de fondo de comprobantes aprobados del mismo banco."""
    meta = forense.get("meta") or {}
    if forense.get("tipo") != "imagen" or "lisura" not in meta:
        return []
    captura = str(datos.get("tipo_imagen") or "").lower().startswith("captura")
    avisos = []
    valor = meta.get("lisura")
    if valor is not None and captura:
        if valor < LISURA_MIN:
            avisos.append(aviso("rojo" if valor < LISURA_ROJO else "amarillo", "El fondo no es liso como en una captura real",
                                f"Sólo el {valor:.0%} de los píxeles son idénticos a su vecino (en capturas reales suele ser más del 75 %). "
                                "Es lo que pasa cuando una IA vuelve a dibujar la imagen." + CONSEJO_GEMINI, ORIGEN))
        else:
            avisos.append(aviso("ok", f"Fondo liso como en una captura real ({valor:.0%})", origen=ORIGEN))
    color = meta.get("fondo")
    if captura and color and (meta.get("fondo_proporcion") or 0) >= 0.2 and color not in [list(c) for c in fondos_reales] \
            and all(CASI_BLANCO[0] <= c <= CASI_BLANCO[1] for c in color):
        avisos.append(aviso("amarillo", "El fondo es casi blanco, no blanco puro",
                            f"El color de fondo es {tuple(color)}; las apps de los bancos usan blanco puro (255, 255, 255) y "
                            "WhatsApp lo conserva. Es típico de una imagen hecha con IA." + CONSEJO_GEMINI, ORIGEN))
    formato = meta.get("formato_ia")
    if formato:
        if captura:
            avisos.append(aviso("amarillo", "La imagen tiene el formato de una IA, no la forma de una pantalla",
                                f"Tiene {formato}. Una captura de celular es alargada, con la forma de la pantalla." + CONSEJO_GEMINI, ORIGEN))
        else:
            avisos.append(aviso("info", "Formato habitual de imágenes generadas por IA", f"Tiene {formato}.", ORIGEN))
    return avisos


def _numeros(texto):
    return {n for n in (reglas.a_numero(t) for t in re.findall(r"\d[\d.,]*\d|\d", texto)) if n is not None}


def cruzar_texto_pdf(texto, datos):
    """Compara lo que Claude vio en el PDF con su capa de texto: si alguien tapo el
    monto con un recuadro y escribio otro, el texto original sigue ahi abajo."""
    if len((texto or "").strip()) < 20:
        return []
    avisos = []
    digitos = reglas.solo_digitos(texto)
    op = reglas.solo_digitos(datos.get("numero_operacion"))
    op_ok = len(op) >= 5 and op in digitos
    if len(op) >= 5:
        if op_ok:
            avisos.append(aviso("ok", "El número de operación visible coincide con el texto interno del PDF", origen=ORIGEN))
        else:
            avisos.append(aviso("amarillo", "El número de operación que se ve no está en el texto interno del PDF",
                                "Puede ser un error de lectura o una edición encima del PDF.", ORIGEN))
    monto = reglas.a_numero(datos.get("monto"))
    if monto:
        if any(abs(n - monto) < 0.01 for n in _numeros(texto)):
            avisos.append(aviso("ok", "El monto visible coincide con el texto interno del PDF", origen=ORIGEN))
        else:
            avisos.append(aviso("rojo" if op_ok else "amarillo", "El monto que se ve no coincide con el texto interno del PDF",
                                f"Se ve {reglas.pesos(monto)} pero ese número no figura dentro del archivo: puede estar tapado y reescrito.", ORIGEN))
    return avisos


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    ruta = Path(sys.argv[1])
    r = analizar(ruta.read_bytes(), ruta.with_name(ruta.stem + "_ela.png"))
    r.pop("texto", None)
    print(json.dumps(r, ensure_ascii=False, indent=2))
