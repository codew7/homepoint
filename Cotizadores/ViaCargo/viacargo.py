"""
Cliente de cotizacion de envios de Via Cargo.

El formulario publico https://viacargo.com.ar/cotizar-envio/ embebe la app
https://formularios.viacargo.com.ar/ (Angular), que consulta la API de
Busplus (ws.busplus.com.ar) con una clave publica fija embebida en su JS.
No hace falta login ni captcha: este modulo llama a esos mismos endpoints
con exactamente el payload que arma el formulario y devuelve los precios
que Via Cargo calcula (4 productos con desglose de conceptos).

Endpoints usados (todos con header PUBLIC-KEY):
    POST /alerce/cotizar                       -> precios (Cotizacion[] por producto)
    GET  /alerce/productos                     -> nombre y descripcion de cada producto
    GET  /alerce/limite_importe_declarado      -> minimo / maximo de valor declarado
    GET  /encomiendas/codigopostal/search      -> localidades con CP (1899)
    GET  /agencias/agencias_datos_mapas        -> agencias (direccion, horario, telefono)

Uso como script:
    python viacargo.py --origen 1602 --destino 5000 --peso 2 --largo 20 --ancho 15 --alto 10 --valor 150000
    python viacargo.py --origen "FLORIDA" --destino "CORDOBA (5000)" --peso 2 --largo 20 --ancho 15 --alto 10 --valor 150000 --pago D
    python viacargo.py --buscar munro            # localidades que coinciden
    python viacargo.py --agencias 5000           # agencias en ese CP / localidad
    python viacargo.py --actualizar              # regenera localidades.json y agencias.json

Uso como libreria:
    from viacargo import cotizar
    r = cotizar(cp_origen="1602", cp_destino="5000", peso_kg=2, largo_cm=20,
                ancho_cm=15, alto_cm=10, valor=150000, pago="P")
"""

import argparse
import json
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

API_BASE = "https://ws.busplus.com.ar"
# Clave publica embebida en el bundle de formularios.viacargo.com.ar (environment.keyAccess).
PUBLIC_KEY = "ikh&/54g.Op"
# Remitente generico que usa el cotizador publico (IdClienteRemitenteCotizador / IdCentroRemitenteCotizador).
ID_CLIENTE_COTIZADOR = "99999999"
ID_CENTRO_COTIZADOR = "99"
# Limitante de valor declarado que consulta el cotizador (interfaz 9 = "EntregaAgencia").
ID_LIMITANTE_DECLARADO = 9
TIMEOUT_S = 40

BASE_DIR = Path(__file__).resolve().parent
LOCALIDADES_FILE = BASE_DIR / "localidades.json"
AGENCIAS_FILE = BASE_DIR / "agencias.json"

# Nombres propios para los productos (los de la API son crudos: "VC PUERTA A PUERTA",
# "VIA CARGO PLUS ED"...). El orden es de menor a mayor servicio (y precio).
PRODUCTOS = {
    "2000": {"nombre": "Estándar", "modalidad": "Agencia → Agencia", "retiro": "agencia", "entrega": "agencia",
             "resumen": "Lo despachás en una agencia y el destinatario lo retira en otra."},
    "3000": {"nombre": "Plus RD", "modalidad": "Domicilio → Agencia", "retiro": "domicilio", "entrega": "agencia",
             "resumen": "Lo retiran en tu domicilio y el destinatario lo retira en una agencia."},
    "4000": {"nombre": "Plus ED", "modalidad": "Agencia → Domicilio", "retiro": "agencia", "entrega": "domicilio",
             "resumen": "Lo despachás en una agencia y lo entregan en el domicilio del destinatario."},
    "0001": {"nombre": "Puerta a puerta", "modalidad": "Domicilio → Domicilio", "retiro": "domicilio", "entrega": "domicilio",
             "resumen": "Lo retiran en tu domicilio y lo entregan en el domicilio del destinatario."},
}
ORDEN_PRODUCTOS = ["2000", "3000", "4000", "0001"]
LIMITES_POR_DEFECTO = {"minimo": 100000, "maximo": 1000000}


# ---------- HTTP ----------

def _request(path: str, body: dict | None = None, con_clave: bool = True):
    url = API_BASE + path
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (cotizador local)"}
    if con_clave:
        headers["PUBLIC-KEY"] = PUBLIC_KEY
    datos = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        datos = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=datos, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        # La API devuelve {"status": false, "message": "..."} con 404/405 cuando no puede cotizar
        # (CP sin cobertura, valor declarado fuera de rango, etc.).
        try:
            cuerpo = json.loads(e.read().decode("utf-8", "replace"))
            mensaje = cuerpo.get("message") or cuerpo.get("error") or str(cuerpo)
        except Exception:
            mensaje = e.reason
        raise RuntimeError(f"Via Cargo respondio HTTP {e.code}: {mensaje}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"No se pudo conectar con la API de Via Cargo ({e.reason}).") from None


def _fmt_entero(x) -> str:
    # El formulario limpia todo lo que no sea digito y admite 1..999 en medidas.
    return str(int(round(float(x))))


def _fmt_decimal(x, decimales: int = 1) -> str:
    # Peso y valor declarado viajan como texto con punto decimal ("2.5"), igual que el
    # formulario. La API acepta a lo sumo un decimal en el peso: con "2.55" devuelve 400.
    x = round(float(x) + 1e-9, decimales)
    if x.is_integer():
        return str(int(x))
    return f"{x:.{decimales}f}".rstrip("0").rstrip(".")


# ---------- Catalogos (localidades / agencias / productos / limites) ----------

def _normalizar(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", str(texto or ""))
    return "".join(c for c in texto if not unicodedata.combining(c)).upper().strip()


def _leer_cache(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _guardar_cache(path: Path, datos: dict):
    path.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")


def descargar_localidades() -> dict:
    # Listado de localidades con CP que ofrece el autocompletar del formulario.
    crudo = _request("/encomiendas/codigopostal/search", con_clave=False)
    lista = []
    for x in crudo:
        cp = str(x.get("CodigoPostal") or "").strip()
        nombre = str(x.get("Descripcion") or "").split("(")[0].strip()
        if not cp:
            continue
        lista.append({
            "cp": cp,
            "nombre": nombre or f"CP {cp}",
            "provincia": x.get("Provincia") or "",
            "id_provincia": x.get("IdProvincia"),
            "etiqueta": f"{nombre or 'CP ' + cp} ({cp}) - {x.get('Provincia') or 'sin provincia'}",
        })
    lista.sort(key=lambda l: (l["provincia"], l["nombre"], l["cp"]))
    datos = {"actualizado": time.strftime("%Y-%m-%dT%H:%M:%S"), "cantidad": len(lista), "localidades": lista}
    _guardar_cache(LOCALIDADES_FILE, datos)
    return datos


def cargar_localidades(forzar: bool = False) -> dict:
    datos = None if forzar else _leer_cache(LOCALIDADES_FILE)
    if not datos or not datos.get("localidades"):
        datos = descargar_localidades()
    return datos


def buscar_localidades(texto: str, localidades: list | None = None) -> list:
    # Coincidencia por CP exacto o por nombre (sin tildes, sin distinguir mayusculas).
    localidades = localidades if localidades is not None else cargar_localidades()["localidades"]
    t = _normalizar(texto)
    if not t:
        return []
    if t.isdigit():
        return [l for l in localidades if l["cp"] == t] or [l for l in localidades if l["cp"].startswith(t)]
    return [l for l in localidades if t in _normalizar(l["nombre"]) or t in _normalizar(l["etiqueta"])]


def resolver_localidad(valor: str, localidades: list | None = None) -> dict:
    """Acepta un CP ("5000"), una etiqueta del listado ("CORDOBA (5000) - CORDOBA") o un nombre."""
    localidades = localidades if localidades is not None else cargar_localidades()["localidades"]
    v = str(valor or "").strip()
    if not v:
        raise ValueError("Falta la localidad o el CP.")
    # "NOMBRE (CP) - PROVINCIA": el CP entre parentesis es lo que manda (igual que el formulario).
    m = re.search(r"\((\d+)\)", v)
    if m:
        v = m.group(1)
    if v.isdigit():
        exactas = [l for l in localidades if l["cp"] == v]
        if exactas:
            return exactas[0]
        raise ValueError(f"El CP {v} no figura en el listado de Via Cargo.")
    candidatas = buscar_localidades(v, localidades)
    if not candidatas:
        raise ValueError(f'No se encontro ninguna localidad para "{valor}".')
    exacta = [l for l in candidatas if _normalizar(l["nombre"]) == _normalizar(v)]
    return (exacta or candidatas)[0]


def descargar_agencias() -> dict:
    # TipoAgencias=2 es el listado que usa el mapa de agencias del sitio.
    crudo = _request("/agencias/agencias_datos_mapas?TipoAgencias=2")
    lista = []
    for x in crudo:
        # La API trae la clave "RecepcionEncomiendas " con un espacio al final.
        recibe = next((v for k, v in x.items() if k.strip() == "RecepcionEncomiendas"), "")
        lista.append({
            "id": x.get("IdAgencia"),
            "codigo": x.get("IdAlerceAgencia") or "",
            "nombre": (x.get("RazonSocial") or "").strip(),
            "direccion": (x.get("Direccion") or "").strip(),
            "cp": str(x.get("IdCodigoPostal") or "").strip(),
            "localidad": (x.get("Localidad") or "").strip(),
            "provincia": (x.get("Provincia") or "").strip(),
            "telefono": (x.get("Telefono") or "").strip(),
            "email": (x.get("Email") or "").strip(),
            "horarios": (x.get("Horarios") or "").strip(),
            "servicios": (x.get("TipoServicio") or "").strip(),
            "recibe_encomiendas": str(recibe).strip().upper() != "NO",
            "lat": x.get("Latitud"),
            "lng": x.get("Longitud"),
        })
    lista.sort(key=lambda a: (a["provincia"], a["localidad"], a["nombre"]))
    datos = {"actualizado": time.strftime("%Y-%m-%dT%H:%M:%S"), "cantidad": len(lista), "agencias": lista}
    _guardar_cache(AGENCIAS_FILE, datos)
    return datos


def cargar_agencias(forzar: bool = False) -> dict:
    datos = None if forzar else _leer_cache(AGENCIAS_FILE)
    if not datos or not datos.get("agencias"):
        datos = descargar_agencias()
    return datos


def agencias_en(cp: str | None = None, localidad: str | None = None, agencias: list | None = None) -> list:
    # Primero las del mismo CP; si no hay, las de la localidad con el mismo nombre.
    agencias = agencias if agencias is not None else cargar_agencias()["agencias"]
    cp = str(cp or "").strip()
    por_cp = [a for a in agencias if cp and a["cp"] == cp]
    if por_cp:
        return por_cp
    loc = _normalizar(localidad)
    return [a for a in agencias if loc and _normalizar(a["localidad"]) == loc]


_productos_api: dict | None = None


def productos_api() -> dict:
    # Nombre y descripcion larga que muestra el sitio para cada producto (se consulta una sola vez).
    global _productos_api
    if _productos_api is None:
        try:
            _productos_api = {str(p.get("code")): {"nombre": p.get("name") or "", "detalle": (p.get("detail") or "").strip()}
                              for p in _request("/alerce/productos")}
        except RuntimeError:
            _productos_api = {}
    return _productos_api


def limites_valor_declarado() -> dict:
    try:
        datos = _request(f"/alerce/limite_importe_declarado?IdlimitanteDeclarado={ID_LIMITANTE_DECLARADO}")
        d = datos[0] if isinstance(datos, list) and datos else datos
        return {"minimo": float(d["Minimo"]), "maximo": float(d["Maximo"]), "descripcion": d.get("Descripcion", "")}
    except Exception:
        return dict(LIMITES_POR_DEFECTO)


# ---------- Cotizacion ----------

def _numero(x) -> float:
    try:
        return float(str(x).replace(",", "."))
    except (TypeError, ValueError):
        return 0.0


def cotizar(
    cp_origen: str,
    cp_destino: str,
    peso_kg: float,
    largo_cm: float,
    ancho_cm: float,
    alto_cm: float,
    valor: float,
    pago: str = "P",
    bultos: int = 1,
) -> dict:
    """Cotiza un envio y devuelve los 4 productos con total, entrega estimada y desglose.

    pago: "P" = pago en origen (contado), "D" = pago en destino (recargo sobre el flete).
    Los CP se validan contra el listado de localidades; se aceptan tambien nombres o etiquetas.
    """
    pago = str(pago or "P").strip().upper()
    if pago not in ("P", "D"):
        raise ValueError('pago debe ser "P" (pago en origen) o "D" (pago en destino).')
    for nombre, v in (("largo", largo_cm), ("ancho", ancho_cm), ("alto", alto_cm)):
        if not 1 <= float(v) <= 999:
            raise ValueError(f"{nombre} invalido: valores aceptados 1 a 999 cm (enteros).")
    if float(peso_kg) < 0.1:
        raise ValueError("El peso minimo es 0,1 kg.")
    if int(bultos) < 1 or int(bultos) > 999:
        raise ValueError("Bultos: valores aceptados 1 a 999.")
    if float(valor) <= 0:
        raise ValueError("El valor declarado tiene que ser mayor a cero.")

    localidades = cargar_localidades()["localidades"]
    origen = resolver_localidad(cp_origen, localidades)
    destino = resolver_localidad(cp_destino, localidades)

    payload = {
        "IdClienteRemitente": ID_CLIENTE_COTIZADOR,
        "IdCentroRemitente": ID_CENTRO_COTIZADOR,
        "CodigoPostalRemitente": origen["cp"],
        "CodigoPostalDestinatario": destino["cp"],
        "ImporteValorDeclarado": _fmt_decimal(valor, 2),
        "NumeroBultos": _fmt_entero(bultos),
        "Kilos": _fmt_decimal(peso_kg),
        "Largo": _fmt_entero(largo_cm),
        "Alto": _fmt_entero(alto_cm),
        "Ancho": _fmt_entero(ancho_cm),
        "TipoPortes": pago,
    }
    crudo = _request("/alerce/cotizar", payload)
    if not isinstance(crudo, dict) or not crudo.get("Cotizacion"):
        raise RuntimeError(f"Via Cargo no devolvio precios para estos parametros: {crudo}")

    info_api = productos_api()
    productos = []
    for c in crudo["Cotizacion"]:
        codigo = str(c.get("PRODUCTO_CODIGO") or "")
        base = PRODUCTOS.get(codigo, {"nombre": c.get("PRODUCTO_DESCRIPCION") or codigo, "modalidad": "", "retiro": "", "entrega": "", "resumen": ""})
        conceptos = [{"codigo": x.get("CONCEPTO_CODIGO"), "descripcion": (x.get("CONCEPTO_DESC") or "").strip(),
                      "valor": _numero(x.get("CONCEPTO_VALOR"))} for x in c.get("CONCEPTOS") or []]
        total = _numero(c.get("TOTAL"))
        neto = sum(x["valor"] for x in conceptos)
        productos.append({
            "codigo": codigo,
            "nombre": base["nombre"],
            "modalidad": base["modalidad"],
            "retiro": base["retiro"],
            "entrega": base["entrega"],
            "resumen": base["resumen"],
            "nombre_api": (c.get("PRODUCTO_DESCRIPCION") or "").strip(),
            "detalle_api": info_api.get(codigo, {}).get("detalle", ""),
            "permitido": str(c.get("PRODUCTO_PERMITIDO") or "S").upper() != "N",
            "entrega_estimada": (c.get("TIEMPO_ENTREGA") or "").strip(),
            "total": total,
            "total_txt": _fmt_pesos(total),
            "neto": round(neto, 2),
            # Los conceptos vienen sin IVA; el total lo incluye (21 %) y se redondea a miles
            # mediante el concepto REDP/REDD ("ajustes de redondeo").
            "iva": round(total - neto, 2),
            "conceptos": conceptos,
        })
    productos.sort(key=lambda p: ORDEN_PRODUCTOS.index(p["codigo"]) if p["codigo"] in ORDEN_PRODUCTOS else 99)

    return {
        "id_cotizacion": crudo.get("IdCotizacion"),
        "costo_fijo": _numero(crudo.get("CostoFijo")),
        "pago": pago,
        "pago_txt": "Pago en origen" if pago == "P" else "Pago en destino",
        "origen": origen,
        "destino": destino,
        "paquete": {"largo": _fmt_entero(largo_cm), "ancho": _fmt_entero(ancho_cm), "alto": _fmt_entero(alto_cm),
                    "peso": _fmt_decimal(peso_kg), "valor": _fmt_decimal(valor, 2), "bultos": _fmt_entero(bultos)},
        "productos": productos,
        "raw": crudo,
    }


def _fmt_pesos(x: float) -> str:
    # "$ 16.000,00" al estilo argentino.
    s = f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"$ {s}"


# ---------- CLI ----------

def main():
    parser = argparse.ArgumentParser(description="Cotizar un envio en Via Cargo")
    parser.add_argument("--origen", help='CP o localidad de origen. Ej: 1602 o "FLORIDA"')
    parser.add_argument("--destino", help='CP o localidad de destino. Ej: 5000 o "CORDOBA (5000)"')
    parser.add_argument("--peso", type=float, help="Peso en kg (minimo 0,1)")
    parser.add_argument("--largo", type=float, help="Largo en cm (1 a 999)")
    parser.add_argument("--ancho", type=float, help="Ancho en cm (1 a 999)")
    parser.add_argument("--alto", type=float, help="Alto en cm (1 a 999)")
    parser.add_argument("--valor", type=float, help="Valor declarado en $")
    parser.add_argument("--pago", default="P", choices=["P", "D"], help="P = pago en origen (defecto), D = pago en destino")
    parser.add_argument("--bultos", type=int, default=1, help="Cantidad de bultos (defecto 1)")
    parser.add_argument("--json", action="store_true", help="Imprimir la respuesta completa en JSON")
    parser.add_argument("--buscar", metavar="TEXTO", help="Buscar localidades por nombre o CP y salir")
    parser.add_argument("--agencias", metavar="CP_O_LOCALIDAD", help="Listar agencias de un CP o localidad y salir")
    parser.add_argument("--actualizar", action="store_true", help="Regenerar localidades.json y agencias.json desde la API y salir")
    args = parser.parse_args()

    if args.actualizar:
        loc = descargar_localidades()
        ag = descargar_agencias()
        print(f"localidades.json: {loc['cantidad']} localidades · agencias.json: {ag['cantidad']} agencias")
        return
    if args.buscar:
        for l in buscar_localidades(args.buscar)[:50]:
            print(l["etiqueta"])
        return
    if args.agencias:
        loc = None
        try:
            loc = resolver_localidad(args.agencias)
        except ValueError:
            pass
        lista = agencias_en(loc["cp"] if loc else args.agencias, loc["nombre"] if loc else args.agencias)
        if not lista:
            print("Sin agencias para ese CP / localidad.")
        for a in lista:
            print(f"{a['nombre']} ({a['codigo']}) · {a['direccion']}, {a['localidad']} (CP {a['cp']}) · Tel {a['telefono'] or '-'} · {a['horarios'] or '-'}"
                  + ("" if a["recibe_encomiendas"] else " · NO recibe encomiendas"))
        return

    faltan = [n for n in ("origen", "destino", "peso", "largo", "ancho", "alto", "valor") if getattr(args, n) is None]
    if faltan:
        parser.error("faltan argumentos: " + ", ".join("--" + f for f in faltan))

    try:
        r = cotizar(args.origen, args.destino, args.peso, args.largo, args.ancho, args.alto, args.valor, pago=args.pago, bultos=args.bultos)
    except (RuntimeError, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return
    print(f"{r['origen']['etiqueta']}  ->  {r['destino']['etiqueta']}  ({r['pago_txt']})")
    p = r["paquete"]
    print(f"{p['largo']}x{p['ancho']}x{p['alto']} cm · {p['peso']} kg · {p['bultos']} bulto(s) · valor $ {p['valor']}")
    for prod in r["productos"]:
        print(f"  {prod['nombre']:<16} {prod['modalidad']:<24} {prod['total_txt']:>16}   entrega estimada {prod['entrega_estimada'][:10]}")


if __name__ == "__main__":
    main()
