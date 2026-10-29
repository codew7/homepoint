"""
Cotizador de encomiendas de Flecha Carga a partir del tarifario en CSV.

Flecha Carga no tiene cotizador instantaneo en su sitio (el formulario de
https://www.flechacarga.com/cotiza-tu-envio/ pide datos de contacto y
responden por mail), asi que los precios salen del cuadro tarifario que
envia la empresa: una fila por destino con NETO / IVA / TOTAL para cada
franja de 5 kg (0-5 ... 35-40 kg) y un "costo por kilo excedente" (con IVA
incluido) para lo que pasa de 40 kg. Al flete se le suma el seguro, que se
carga a mano como monto fijo.

Los Puntos Flecha (sucursales) se leen de la pagina "Donde estamos", que
los trae embebidos en el HTML (var backend = { sucursales: [...] }).

Uso como script:
    python flechacarga.py --importar ["otro tarifario.csv"]   # regenera tarifas.json
    python flechacarga.py --buscar cordoba                     # destinos que coinciden
    python flechacarga.py --destino "ALCORTA (SFE)" --peso 12 [--largo 40 --ancho 30 --alto 30 --factor 4000] [--seguro 1500] [--json]
    python flechacarga.py --sucursales rosario                 # Puntos Flecha que coinciden
    python flechacarga.py --actualizar-sucursales              # regenera sucursales.json (y la copia de pedidosv2)

Uso como libreria:
    from flechacarga import cotizar
    r = cotizar("ALCORTA (SFE)", peso_kg=12, seguro=1500)
"""

import argparse
import csv
import html
import io
import json
import math
import re
import sys
import time
import unicodedata
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
TARIFARIO_CSV = BASE_DIR / "Flecha Carga - TARIFARIO.csv"
TARIFAS_FILE = BASE_DIR / "tarifas.json"
SUCURSALES_FILE = BASE_DIR / "sucursales.json"
URL_SUCURSALES = "https://www.flechacarga.com/donde-estamos/"
# Copia para el boton "Hay sucursal?" de pedidosv2 (se publica con esa carpeta).
PEDIDOS_JSON = BASE_DIR.parent.parent / "pedidosv2" / "flechacarga-sucursales.json"
TIMEOUT_S = 40

# Limite superior de cada franja de peso del tarifario (kg). Mas alla del
# ultimo se cobra la franja 35-40 mas el costo por kilo excedente.
FRANJAS = [5, 10, 15, 20, 25, 30, 35, 40]
FACTOR_VOL_DEFECTO = 4000

# Abreviaturas de provincia que usa el tarifario (los nombres vienen cortados
# a 20 caracteres, asi que muchas quedan truncadas; las ambiguas no se mapean).
PROVINCIAS = {
    "BUE": "Buenos Aires", "BU": "Buenos Aires", "B": "Buenos Aires",
    "GBA": "GBA", "GB": "GBA", "CONURBANO": "GBA",
    "CABA": "CABA", "CAB": "CABA",
    "SFE": "Santa Fe", "SF": "Santa Fe",
    "CBA": "Córdoba", "CB": "Córdoba",
    "SAL": "Salta", "CHA": "Chaco", "TUC": "Tucumán", "TU": "Tucumán",
    "E.R": "Entre Ríos", "ER": "Entre Ríos", "E.R.": "Entre Ríos", "E:R": "Entre Ríos", "E.": "Entre Ríos",
    "MZA": "Mendoza", "MZ": "Mendoza", "MIS": "Misiones", "MI": "Misiones",
    "CTE": "Corrientes", "JUJ": "Jujuy", "JUJUY": "Jujuy", "SGO": "Santiago del Estero",
    "R.N": "Río Negro", "RN": "Río Negro", "RIO NE": "Río Negro", "NQN": "Neuquén",
    "FOR": "Formosa", "FSA": "Formosa", "CAT": "Catamarca", "CHU": "Chubut",
    "S.L": "San Luis", "SL": "San Luis", "L.P": "La Pampa", "L.R": "La Rioja", "LR": "La Rioja",
    "SCZ": "Santa Cruz", "S.J": "San Juan",
}


def normalizar(s: str) -> str:
    """Mayusculas, sin tildes y solo letras/numeros separados por un espacio."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", s.upper()).split())


def _numero(txt: str) -> float:
    # El CSV usa coma de miles y espacios: " 6,092 " -> 6092
    t = str(txt or "").strip().replace(",", "")
    return float(t) if t else 0.0


def _limpiar_nombre(nombre: str) -> str:
    n = " ".join(nombre.replace("( ", "(").replace(" )", ")").split())
    n = re.sub(r"\(\s*$", "", n).strip()          # "PARQUE AVELLANEDA (" -> sin parentesis suelto
    if n.count("(") > n.count(")"):
        n += ")"                                   # "VILLA SOLDATI (CABA" -> cerrar
    return n


# ---------- Tarifario ----------

def importar_tarifario(origen=None, texto: str = None, nombre_fuente: str = None) -> dict:
    """Lee el CSV del tarifario (ruta o texto) y escribe tarifas.json."""
    if texto is None:
        ruta = Path(origen) if origen else TARIFARIO_CSV
        texto = ruta.read_text(encoding="utf-8-sig", errors="replace")
        nombre_fuente = nombre_fuente or ruta.name
    destinos = []
    for fila in csv.reader(io.StringIO(texto)):
        if len(fila) < 29 or not fila[0].strip():
            continue
        m = re.match(r"^(.*)\(([^()]*)\)\s*$", fila[0].strip())
        valores = fila[4:28]
        if not m or not any(v.strip() for v in valores):
            continue  # encabezados y filas vacias
        try:
            nums = [_numero(v) for v in valores]
            excedente = _numero(fila[28])
        except ValueError:
            continue
        nombre = _limpiar_nombre(m.group(1))
        codigo = m.group(2).strip()
        p = re.search(r"\(([^()]*)\)$", nombre)
        abrev = p.group(1).strip().upper() if p else ""
        base = nombre[:p.start()].strip() if p else nombre
        franjas = [{"desde": FRANJAS[i] - 5, "hasta": FRANJAS[i], "neto": nums[3 * i], "iva": nums[3 * i + 1], "total": nums[3 * i + 2]}
                   for i in range(len(FRANJAS))]
        destinos.append({
            "nombre": nombre, "base": base, "abrev": abrev, "provincia": PROVINCIAS.get(abrev, ""),
            "codigo": codigo, "etiqueta": f"{nombre} · {codigo}",
            "franjas": franjas, "kg_excedente": excedente,
        })
    if not destinos:
        raise ValueError("El archivo no tiene filas de tarifas reconocibles (se espera el formato del cuadro tarifario de Flecha Carga).")
    destinos.sort(key=lambda d: normalizar(d["nombre"]))
    datos = {"actualizado": time.strftime("%Y-%m-%dT%H:%M:%S"), "fuente": nombre_fuente or "", "franjas_kg": FRANJAS, "destinos": destinos}
    TARIFAS_FILE.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    return datos


def cargar_tarifas() -> dict:
    """tarifas.json; se regenera si falta o si el CSV es mas nuevo."""
    if TARIFAS_FILE.exists():
        csv_mas_nuevo = TARIFARIO_CSV.exists() and TARIFARIO_CSV.stat().st_mtime > TARIFAS_FILE.stat().st_mtime
        if not csv_mas_nuevo:
            return json.loads(TARIFAS_FILE.read_text(encoding="utf-8"))
    return importar_tarifario()


def buscar_destinos(texto: str, tarifas: dict = None) -> list:
    tarifas = tarifas or cargar_tarifas()
    t = normalizar(texto)
    return [d for d in tarifas["destinos"] if t in normalizar(d["etiqueta"])]


def resolver_destino(texto: str, tarifas: dict = None) -> dict:
    """Acepta la etiqueta "NOMBRE · CODIGO", el codigo o el nombre."""
    tarifas = tarifas or cargar_tarifas()
    t = str(texto or "").strip()
    n = normalizar(t)
    for campo in ("etiqueta", "codigo", "nombre", "base"):
        exactos = [d for d in tarifas["destinos"] if normalizar(d[campo]) == n]
        if len(exactos) == 1:
            return exactos[0]
    parciales = buscar_destinos(t, tarifas)
    if len(parciales) == 1:
        return parciales[0]
    if not parciales:
        raise ValueError(f"Destino no encontrado en el tarifario: {t!r}")
    raise ValueError(f"{len(parciales)} destinos coinciden con {t!r}: " + ", ".join(d["etiqueta"] for d in parciales[:8]))


def cotizar(destino, peso_kg: float, largo_cm: float = 0, ancho_cm: float = 0, alto_cm: float = 0,
            seguro: float = 0, factor_vol: float = None) -> dict:
    """Precio de una encomienda. factor_vol (ej. 4000) activa el peso volumetrico."""
    d = destino if isinstance(destino, dict) else resolver_destino(destino)
    if not peso_kg or peso_kg <= 0:
        raise ValueError("El peso tiene que ser mayor a cero.")
    volumen = largo_cm * ancho_cm * alto_cm
    peso_vol = volumen / factor_vol if factor_vol and volumen > 0 else 0.0
    facturable = max(peso_kg, peso_vol)
    idx = next((i for i, h in enumerate(FRANJAS) if facturable <= h + 1e-9), len(FRANJAS) - 1)
    franja = d["franjas"][idx]
    kg_extra = math.ceil(facturable - FRANJAS[-1] - 1e-9) if facturable > FRANJAS[-1] else 0
    excedente = kg_extra * d["kg_excedente"]
    flete = franja["total"] + excedente
    seguro = max(0.0, float(seguro or 0))
    return {
        "destino": {k: d[k] for k in ("nombre", "provincia", "codigo", "etiqueta")},
        "peso_real": peso_kg, "volumen_cm3": volumen, "factor_vol": factor_vol or None,
        "peso_vol": round(peso_vol, 2), "peso_facturable": round(facturable, 2),
        "manda": "volumen" if peso_vol > peso_kg else "peso",
        "franja": {"indice": idx, "desde": franja["desde"], "hasta": franja["hasta"]},
        "conceptos": {
            "flete_neto": franja["neto"], "flete_iva": franja["iva"], "flete_total": franja["total"],
            "kg_extra": kg_extra, "kg_excedente_precio": d["kg_excedente"], "excedente": excedente,
            "seguro": seguro,
        },
        "flete": flete,
        "total": flete + seguro,
    }


# ---------- Puntos Flecha (sucursales) ----------

def descargar_sucursales() -> dict:
    req = urllib.request.Request(URL_SUCURSALES, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        pagina = resp.read().decode("utf-8", errors="replace")
    m = re.search(r"sucursales\s*:\s*\[", pagina)
    if not m:
        raise RuntimeError("No se encontro el listado de sucursales en la pagina de Flecha Carga (pudo cambiar el sitio).")
    # raw_decode lee solo el array y deja de lado el resto del script.
    crudas, _ = json.JSONDecoder().raw_decode(pagina, m.end() - 1)
    sucursales = []
    for s in crudas:
        nombre = html.unescape(str(s.get("name") or "")).strip()
        direccion = html.unescape(str(s.get("address") or "")).strip()
        texto = normalizar(nombre + " " + direccion)
        sucursales.append({
            "nombre": nombre, "direccion": direccion,
            "cp": str(s.get("postalCode") or "").strip(),
            "horario": html.unescape(str(s.get("hours") or "")).strip(),
            "contacto": html.unescape(str(s.get("contact") or "")).strip(),
            "lat": s.get("lat"), "lng": s.get("lng"),
            "solo_domicilio": "SOLO CON" in texto and "DOMI" in texto,
            "solo_despacho": "SOLO DESPACHO" in texto,
        })
    datos = {"actualizado": time.strftime("%Y-%m-%dT%H:%M:%S"), "sucursales": sucursales}
    SUCURSALES_FILE.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
    exportar_para_pedidos(datos)
    return datos


def exportar_para_pedidos(datos: dict = None):
    """Copia compacta del listado para pedidosv2 ("Hay sucursal?").

    El sitio de Flecha Carga no habilita CORS, asi que pedidosv2 no puede leerlo
    desde el navegador: usa este archivo, que se publica junto a pedidosv2.html.
    Si la carpeta no existe (app instalada en otra PC) no hace nada.
    """
    if not PEDIDOS_JSON.parent.is_dir():
        return None
    datos = datos or cargar_sucursales()
    campos = ("nombre", "direccion", "cp", "horario", "contacto", "lat", "lng", "solo_domicilio", "solo_despacho")
    compacto = {"actualizado": datos.get("actualizado"),
                "sucursales": [{k: s[k] for k in campos if s.get(k)} for s in datos["sucursales"]]}
    PEDIDOS_JSON.write_text(json.dumps(compacto, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return PEDIDOS_JSON


def cargar_sucursales() -> dict:
    if SUCURSALES_FILE.exists():
        return json.loads(SUCURSALES_FILE.read_text(encoding="utf-8"))
    return descargar_sucursales()


def sucursales_de(destino: dict, sucursales: list) -> list:
    """Puntos Flecha cuyo nombre contiene el nombre del destino (como palabras completas)."""
    base = normalizar(destino.get("base") or destino.get("nombre"))
    if len(base) < 3:
        return []
    patron = re.compile(r"(^| )" + re.escape(base) + r"( |$)")
    lista = [s for s in sucursales if patron.search(normalizar(s["nombre"]))]
    # Si alguna coincide exacto (o por CP = codigo del tarifario), se descartan las
    # que solo contienen el nombre ("ROSARIO" no debe traer "ROSARIO DEL TALA").
    abrev = normalizar(destino.get("abrev"))
    fuertes = [s for s in lista if normalizar(s["nombre"]) in (base, f"{base} {abrev}".strip())
               or (s["cp"] and s["cp"] == destino.get("codigo"))]
    lista = fuertes or lista
    # Primero las que reciben encomiendas para retirar.
    return sorted(lista, key=lambda s: (s["solo_domicilio"] or s["solo_despacho"]))


# ---------- Cobertura por CP (para el Comparador) ----------

# Abreviaturas de los nombres de Puntos y del tarifario ("GRAL. PACHECO", "STA. ROSA", "CONCEP. DEL URUGUAY").
ABREVIATURAS = {"GRAL": "GENERAL", "GRL": "GENERAL", "STA": "SANTA", "STO": "SANTO", "PTE": "PRESIDENTE",
                "CNEL": "CORONEL", "TTE": "TENIENTE", "ING": "INGENIERO", "DR": "DOCTOR", "PTO": "PUERTO",
                "CMTE": "COMANDANTE", "SALV": "SALVADOR", "CONCEP": "CONCEPCION", "LIB": "LIBERTADOR",
                "ROS": "ROSARIO", "3": "III"}
# Conectores que un listado pone y el otro no ("BANDA DE RIO SALI" / "BANDA DEL RIO SALI").
CONECTORES = {"DE", "DEL", "LA", "LAS", "LOS", "EL"}
# Provincia del tarifario -> etiqueta de MiCorreo (la que usa el catalogo del Comparador).
PROVINCIA_MICORREO = {"GBA": "BUENOS AIRES", "CABA": "CAPITAL FEDERAL"}


def _palabras(s: str) -> str:
    return " ".join(ABREVIATURAS.get(p, p) for p in normalizar(s).split() if p not in CONECTORES)


def _provincia_micorreo(destino: dict) -> str:
    p = destino.get("provincia") or ""
    return PROVINCIA_MICORREO.get(p, normalizar(p))


def _puntaje(punto: dict, destino: dict, prov_confirmada: bool = False) -> float:
    """Que tan seguro es que la tarifa `destino` corresponde al Punto (0 = no corresponde)."""
    nom, base = _palabras(punto["nombre"]), _palabras(destino["base"])
    if len(base) < 3:
        return 0
    if nom == base:
        return 3
    if nom.startswith(base + " ") or base.startswith(nom + " "):
        return 2
    # Los nombres del tarifario vienen cortados a 20 caracteres ("SAN MARTIN DE LOS AN").
    if len(normalizar(destino["base"])) >= 15 and nom.startswith(base):
        return 2
    # Abreviado palabra por palabra ("CONCEP DEL URU" = "CONCEPCION DEL URUGUAY").
    pb, pn = base.split(), nom.split()
    if len(pb) >= 2 and len(pb) <= len(pn) and all(n.startswith(b) for b, n in zip(pb, pn)):
        return 1.8
    # El codigo del tarifario es de agencia, pero en algunas ciudades coincide con el CP
    # (COLON "3280"). Solo vale si ademas coincide la primera palabra: CONCORDIA "3300"
    # es el CP de Posadas y no debe cruzarse.
    if punto.get("cp") and punto["cp"] == destino["codigo"] and nom.split()[0] == base.split()[0]:
        return 1.5
    if re.search(r"(^| )" + re.escape(base) + r"( |$)", nom):
        return 1
    # "SAN SALVADOR DE JUJUY" (Punto) / "JUJUY TERMINAL" (tarifa): la ciudad es la ultima
    # palabra del Punto y la primera de la tarifa. Solo cuenta con la provincia confirmada.
    ultima, primera = nom.split()[-1], base.split()[0]
    if prov_confirmada and len(ultima) >= 5 and ultima == primera:
        return 0.8
    return 0


def cobertura_por_cp(provincia_de_cp=None, nombres_de_cp=None) -> dict:
    """{cp: {codigo, etiqueta, nombre, puntos: [indices], general}} de los CP con sucursal para retirar.

    El cruce va del Punto (que trae CP) a la tarifa: la de mejor coincidencia de nombre y,
    si se conoce la provincia del CP (`provincia_de_cp(cp)`), de la misma provincia. En CABA
    las tarifas son casi todas iguales: un Punto sin tarifa propia usa la mas comun de CABA.
    Ademas, el CP que trae la tarifa al final del nombre cuenta como sucursal (`nombres_de_cp(cp)`
    da los nombres del CP, para validar las tarifas sin provincia).
    """
    tarifas = cargar_tarifas()["destinos"]
    puntos = cargar_sucursales()["sucursales"]
    caba = [d for d in tarifas if d["provincia"] == "CABA"]
    precio_caba = max(set(d["franjas"][0]["total"] for d in caba), key=[d["franjas"][0]["total"] for d in caba].count) if caba else None
    general_caba = next((d for d in caba if d["franjas"][0]["total"] == precio_caba), None)
    cobertura = {}
    for i, s in enumerate(puntos):
        if not s.get("cp") or s["solo_domicilio"] or s["solo_despacho"]:
            continue
        prov = provincia_de_cp(s["cp"]) if provincia_de_cp else None
        mejor, mejor_p = None, 0
        for d in tarifas:
            if prov and d["provincia"] and _provincia_micorreo(d) != prov:
                continue
            p = _puntaje(s, d, prov_confirmada=bool(prov and d["provincia"]))
            # Empate: la tarifa de nombre mas largo es la mas especifica.
            if p > mejor_p or (p == mejor_p and p and len(d["base"]) > len(mejor["base"])):
                mejor, mejor_p = d, p
        general = False
        if mejor is None and prov == "CAPITAL FEDERAL" and general_caba:
            mejor, mejor_p, general = general_caba, 0.5, True
        if mejor is None:
            continue
        # La tarifa del CP es la del Punto con mejor coincidencia; los Puntos se listan todos.
        actual = cobertura.setdefault(s["cp"], {"puntos": [], "_p": -1})
        actual["puntos"].append(i)
        if mejor_p > actual["_p"]:
            actual.update(codigo=mejor["codigo"], etiqueta=mejor["etiqueta"], nombre=mejor["nombre"], general=general, _p=mejor_p)
    # El numero de 4 cifras al final de la tarifa ("AGRONOMIA (CABA) (1417)", "1428A") es el CP
    # de esa sucursal: manda sobre el cruce por nombre, aunque el sitio no liste un Punto ahi.
    # Se valida contra la provincia del CP (o, si la tarifa no la trae, contra el nombre del
    # CP): hay codigos de agencia que parecen CP y no lo son ("EL GALPON (SAL) (1316)").
    retirables = {}
    for i, s in enumerate(puntos):
        if s.get("cp") and not s["solo_domicilio"] and not s["solo_despacho"]:
            retirables.setdefault(s["cp"], []).append(i)
    for d in tarifas:
        cp = cp_de_codigo(d["codigo"])
        if not cp:
            continue
        prov = provincia_de_cp(cp) if provincia_de_cp else None
        palabras = set(_palabras(d["base"]).split())
        nombres = set(" ".join(_palabras(n) for n in (nombres_de_cp(cp) if nombres_de_cp else [])).split())
        nombres |= set(" ".join(_palabras(puntos[i]["nombre"]) for i in retirables.get(cp, [])).split())
        por_nombre = any(len(p) >= 4 and p in nombres for p in palabras)
        if d["provincia"]:
            if prov and _provincia_micorreo(d) != prov:
                continue
        elif not por_nombre:
            continue
        p = 4 + (0.5 if por_nombre else 0)
        actual = cobertura.setdefault(cp, {"puntos": [], "_p": -1})
        actual["puntos"] += [i for i in retirables.get(cp, []) if i not in actual["puntos"]]
        if p > actual["_p"]:
            actual.update(codigo=d["codigo"], etiqueta=d["etiqueta"], nombre=d["nombre"], general=False, _p=p)
    for c in cobertura.values():
        del c["_p"]
    return cobertura


def cp_de_codigo(codigo: str):
    """"1417" o "1417A" -> "1417"; los codigos de agencia ("522", "CBUE") -> None."""
    m = re.fullmatch(r"(\d{4})[A-Z]?", (codigo or "").strip().upper())
    return m.group(1) if m else None


def puntos_por_indice(indices) -> list:
    puntos = cargar_sucursales()["sucursales"]
    return [puntos[i] for i in indices if 0 <= i < len(puntos)]


# ---------- CLI ----------

def _fmt(x: float) -> str:
    return "$ " + f"{x:,.0f}".replace(",", ".")


def main():
    ap = argparse.ArgumentParser(description="Cotizador de encomiendas de Flecha Carga (tarifario en CSV)")
    ap.add_argument("--importar", nargs="?", const="", metavar="CSV", help="regenera tarifas.json desde el CSV")
    ap.add_argument("--buscar", metavar="TEXTO")
    ap.add_argument("--destino")
    ap.add_argument("--peso", type=float)
    ap.add_argument("--largo", type=float, default=0)
    ap.add_argument("--ancho", type=float, default=0)
    ap.add_argument("--alto", type=float, default=0)
    ap.add_argument("--factor", type=float, help="activa el peso volumetrico con este divisor (ej. 4000)")
    ap.add_argument("--seguro", type=float, default=0)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--sucursales", metavar="TEXTO")
    ap.add_argument("--actualizar-sucursales", action="store_true")
    a = ap.parse_args()

    if a.importar is not None:
        datos = importar_tarifario(a.importar or None)
        print(f"{len(datos['destinos'])} destinos importados -> {TARIFAS_FILE.name}")
    elif a.buscar:
        for d in buscar_destinos(a.buscar):
            print(f"{d['etiqueta']:<40} {d['provincia']:<20} 0-5 kg {_fmt(d['franjas'][0]['total'])}")
    elif a.actualizar_sucursales:
        datos = descargar_sucursales()
        print(f"{len(datos['sucursales'])} sucursales -> {SUCURSALES_FILE.name}"
              + (f" y {PEDIDOS_JSON}" if PEDIDOS_JSON.exists() else ""))
    elif a.sucursales:
        t = normalizar(a.sucursales)
        for s in cargar_sucursales()["sucursales"]:
            if t in normalizar(s["nombre"] + " " + s["direccion"] + " " + s["cp"]):
                print(f"{s['nombre']} | {s['direccion']} | CP {s['cp'] or '-'}")
    elif a.destino and a.peso:
        r = cotizar(a.destino, a.peso, a.largo, a.ancho, a.alto, a.seguro, a.factor)
        if a.json:
            print(json.dumps(r, ensure_ascii=False, indent=2))
        else:
            c = r["conceptos"]
            print(f"Destino: {r['destino']['etiqueta']}  {r['destino']['provincia']}")
            print(f"Peso facturable: {r['peso_facturable']} kg (franja {r['franja']['desde']}-{r['franja']['hasta']} kg)")
            print(f"Flete: {_fmt(c['flete_total'])}" + (f" + {c['kg_extra']} kg extra {_fmt(c['excedente'])}" if c["kg_extra"] else ""))
            print(f"Seguro: {_fmt(c['seguro'])}")
            print(f"TOTAL: {_fmt(r['total'])}")
    else:
        ap.print_help()
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
