"""
planilla.py — Lee la hoja "Lista" de Google Sheets y arma los índices
para buscar productos por precio y por código.

La hoja se descarga como CSV (la planilla está compartida "con enlace",
así que no hace falta ninguna clave). Si algún día se deja de compartir,
habrá que pasar a una cuenta de servicio.

Columnas que se usan de la hoja "Lista":
    A (0) = categoría
    C (2) = código
    D (3) = nombre
    G (6) = precio  (el que sale impreso en la etiqueta)
"""

import csv
import io
import re

import requests

HOJA = "Lista"


def normalizar_precio(valor):
    """Convierte cualquier forma de escribir un precio en un número entero.

        "$ 6.222"   -> 6222   (formato argentino, como sale en la etiqueta)
        "6,221.50"  -> 6222   (formato de la planilla; se redondea)
        "6.221,50"  -> 6222
        6222        -> 6222

    Se redondea porque la etiqueta impresa no muestra decimales.
    Devuelve None si no hay un precio válido.
    """
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return round(valor) if valor > 0 else None

    s = re.sub(r"[$\s]", "", str(valor))
    if not s:
        return None

    ult_punto, ult_coma = s.rfind("."), s.rfind(",")
    if ult_punto > -1 and ult_coma > -1:
        # Tiene los dos: el que aparece último es el separador decimal.
        if ult_coma > ult_punto:
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif ult_coma > -1:
        # Solo comas: si después de la última hay 3 dígitos, es de miles.
        s = s.replace(",", "") if re.search(r",\d{3}$", s) else s.replace(",", ".")
    elif ult_punto > -1:
        # Solo puntos: misma regla.
        s = s.replace(".", "") if re.search(r"\.\d{3}$", s) else s

    try:
        n = float(s)
    except ValueError:
        return None
    # round() de Python redondea 0.5 al par; para precios usamos el redondeo común.
    return int(n + 0.5) if n > 0 else None


class Planilla:
    """Guarda los productos de la planilla y permite buscarlos."""

    def __init__(self):
        self.por_precio = {}   # 6222 -> [producto, producto, ...]
        self.por_codigo = {}   # "123" -> producto

    @property
    def precios_repetidos(self):
        """Precios que comparten 2 o más productos."""
        return {p: lista for p, lista in self.por_precio.items() if len(lista) > 1}

    def cargar(self, spreadsheet_id):
        url = f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/gviz/tq"
        resp = requests.get(url, params={"tqx": "out:csv", "sheet": HOJA}, timeout=60)
        if resp.status_code != 200 or "text/csv" not in resp.headers.get("content-type", ""):
            raise RuntimeError(f"No se pudo leer la planilla (error {resp.status_code}). "
                               "¿Sigue compartida como 'cualquier persona con el enlace'?")
        resp.encoding = "utf-8"
        filas = list(csv.reader(io.StringIO(resp.text)))[1:]   # sin la fila de títulos

        for fila in filas:
            fila = fila + [""] * (8 - len(fila))   # completar columnas vacías del final
            codigo = str(fila[2]).strip()
            if not codigo:
                continue
            producto = {
                "codigo": codigo,
                "nombre": str(fila[3]).strip(),
                "categoria": str(fila[0]).strip(),
                "precio": normalizar_precio(fila[6]),
            }
            self.por_codigo[codigo.upper()] = producto
            if producto["precio"]:
                self.por_precio.setdefault(producto["precio"], []).append(producto)
        return self
