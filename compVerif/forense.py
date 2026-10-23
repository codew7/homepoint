r"""
Analisis tecnico del archivo de un comprobante (imagen o PDF), sin metadatos.

    Imagenes  mapa ELA como ayuda visual para ver zonas retocadas
    PDF       elementos agregados encima (anotaciones), PDF que es solo una imagen,
              y capa de texto para compararla con lo que se ve
    Ambos     SHA-256 y hash perceptual (dHash) para detectar reenvios

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


def _imagen(data, destino_ela):
    original = Image.open(io.BytesIO(data))
    original.load()
    im = ImageOps.exif_transpose(original)
    _ela(im, destino_ela)
    return {"tipo": "imagen", "dhash": dhash(im), "meta": {"ancho": im.width, "alto": im.height}, "avisos": []}


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
    r["sha256"] = hashlib.sha256(data).hexdigest()
    return r


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
