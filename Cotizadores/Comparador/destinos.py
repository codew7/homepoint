"""
Catalogo unificado de destinos para el comparador Correo Argentino + Via Cargo + Flecha Carga.

Cada empresa tiene su propio listado (sucursales de MiCorreo por provincia;
localidades con CP de Via Cargo). Este modulo los cruza por codigo postal y
arma un unico listado de destinos con, para cada CP:

    - nombre principal y alias (localidad de Via Cargo, sucursales del Correo)
    - provincia con la etiqueta que usa MiCorreo (misma que Via Cargo)
    - sucursales del Correo en ese CP (para entrega en sucursal)
    - si Via Cargo tiene cobertura en ese CP: solo cuenta si hay una agencia que
      recibe encomiendas en ese mismo CP (el comparador cotiza de sucursal a
      sucursal; los CP que Via Cargo solo atiende a domicilio quedan sin cobertura)
    - si Flecha Carga tiene un Punto donde retirar en ese CP, con la tarifa que le
      corresponde (flechacarga.cobertura_por_cp, mismo criterio de sucursal a sucursal)

Tambien resuelve la provincia de un CP que no figura en ningun listado con una
tabla aproximada de rangos (solo como ultimo recurso; el usuario puede corregirla).
"""

import json
import re
import sys
import time
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CORREO_DIR = BASE_DIR.parent / "Correo"
VIACARGO_DIR = BASE_DIR.parent / "ViaCargo"
FLECHA_DIR = BASE_DIR.parent / "Flecha Carga"
DESTINOS_FILE = BASE_DIR / "destinos.json"

for d in (CORREO_DIR, VIACARGO_DIR):
    if str(d) not in sys.path:
        sys.path.insert(0, str(d))
# Al final: "Flecha Carga" tiene su propio servidor.py, que no debe tapar al del Comparador.
if str(FLECHA_DIR) not in sys.path:
    sys.path.append(str(FLECHA_DIR))

from sucursales import cargar_sucursales, descargar_sucursales  # noqa: E402  (../Correo)
from viacargo import cargar_agencias, cargar_localidades, descargar_localidades  # noqa: E402  (../ViaCargo)
import flechacarga  # noqa: E402  (../Flecha Carga)

PROVINCIAS = [
    "BUENOS AIRES", "CAPITAL FEDERAL", "CATAMARCA", "CHACO", "CHUBUT", "CORDOBA", "CORRIENTES",
    "ENTRE RIOS", "FORMOSA", "JUJUY", "LA PAMPA", "LA RIOJA", "MENDOZA", "MISIONES", "NEUQUEN",
    "RIO NEGRO", "SALTA", "SAN JUAN", "SAN LUIS", "SANTA CRUZ", "SANTA FE", "SANTIAGO DEL ESTERO",
    "TIERRA DEL FUEGO", "TUCUMAN",
]

# Rangos aproximados de CP -> provincia. Solo se usan cuando el CP no aparece en
# ningun listado; la UI deja corregir la provincia a mano.
RANGOS_CP = [
    (1000, 1499, "CAPITAL FEDERAL"), (1500, 1999, "BUENOS AIRES"),
    (2000, 2699, "SANTA FE"), (2700, 2999, "BUENOS AIRES"),
    (3000, 3099, "SANTA FE"), (3100, 3299, "ENTRE RIOS"), (3300, 3399, "MISIONES"),
    (3400, 3499, "CORRIENTES"), (3500, 3599, "CHACO"), (3600, 3699, "FORMOSA"),
    (3700, 3799, "CHACO"), (3800, 3899, "SANTIAGO DEL ESTERO"),
    (4000, 4199, "TUCUMAN"), (4200, 4399, "SANTIAGO DEL ESTERO"), (4400, 4599, "SALTA"),
    (4600, 4699, "JUJUY"), (4700, 4799, "CATAMARCA"),
    (5000, 5299, "CORDOBA"), (5300, 5399, "LA RIOJA"), (5400, 5499, "SAN JUAN"),
    (5500, 5699, "MENDOZA"), (5700, 5899, "SAN LUIS"), (5900, 5999, "CORDOBA"),
    (6000, 6299, "BUENOS AIRES"), (6300, 6399, "LA PAMPA"), (6400, 6499, "BUENOS AIRES"),
    (6500, 6999, "BUENOS AIRES"), (7000, 7999, "BUENOS AIRES"),
    (8000, 8299, "BUENOS AIRES"), (8300, 8399, "NEUQUEN"), (8400, 8599, "RIO NEGRO"),
    (9000, 9299, "CHUBUT"), (9300, 9399, "SANTA CRUZ"), (9400, 9409, "SANTA CRUZ"),
    (9410, 9499, "TIERRA DEL FUEGO"),
]


def normalizar(texto) -> str:
    texto = unicodedata.normalize("NFKD", str(texto or ""))
    return " ".join("".join(c for c in texto if not unicodedata.combining(c)).upper().split())


def provincia_por_rango(cp: str) -> str | None:
    try:
        n = int(str(cp).strip())
    except ValueError:
        return None
    for desde, hasta, prov in RANGOS_CP:
        if desde <= n <= hasta:
            return prov
    return None


def _titulo(nombre: str) -> str:
    # "VILLA CARLOS PAZ" -> "Villa Carlos Paz" (las preposiciones en minuscula).
    chicas = {"DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "AL", "EN"}
    palabras = []
    for i, w in enumerate(str(nombre).split()):
        if i and w.upper() in chicas:
            palabras.append(w.lower())
        else:
            palabras.append(w.capitalize())
    return " ".join(palabras)


def construir_destinos(sucursales: dict | None, localidades: dict | None, agencias: dict | None) -> dict:
    """Cruza ambos catalogos por CP. Devuelve {"actualizado", "cantidad", "destinos": [...]}."""
    por_cp: dict[str, dict] = {}
    # Agencias de Via Cargo que reciben encomiendas, por CP. Sin agencia en el CP no hay
    # retiro en agencia (solo domicilio), asi que ese CP no cuenta como cobertura.
    agencias_por_cp = Counter(str(a.get("cp") or "").strip() for a in (agencias or {}).get("agencias", [])
                              if a.get("recibe_encomiendas"))

    def entrada(cp: str) -> dict:
        if cp not in por_cp:
            por_cp[cp] = {"cp": cp, "alias": [], "provincias_correo": Counter(), "provincia_viacargo": None,
                          "sucursales": [], "viacargo": None}
        return por_cp[cp]

    if localidades:
        for l in localidades.get("localidades", []):
            cp = str(l.get("cp") or "").strip()
            if not cp:
                continue
            e = entrada(cp)
            nombre = normalizar(l.get("nombre"))
            if nombre and not nombre.startswith("CP ") and nombre not in e["alias"]:
                e["alias"].append(nombre)
            if l.get("provincia") and not e["provincia_viacargo"]:
                e["provincia_viacargo"] = normalizar(l["provincia"])
            if e["viacargo"] is None and agencias_por_cp[cp]:
                e["viacargo"] = {"etiqueta": l.get("etiqueta"), "nombre": l.get("nombre"), "provincia": l.get("provincia") or "",
                                 "agencias": agencias_por_cp[cp]}

    if sucursales:
        for prov, lista in (sucursales.get("provincias") or {}).items():
            for s in lista:
                if s.get("HABILITADA") == "N":
                    continue
                cp = str(s.get("cp") or "").strip()
                if not cp:
                    continue
                e = entrada(cp)
                e["provincias_correo"][normalizar(prov)] += 1
                e["sucursales"].append({"codigo": s.get("codigo"), "nombre": s.get("nombre")})
                nombre = normalizar(s.get("nombre"))
                if nombre and nombre not in e["alias"]:
                    e["alias"].append(nombre)

    destinos = []
    for cp, e in por_cp.items():
        # Provincia: la que usa MiCorreo para sus sucursales (es la que valida el sitio);
        # si no hay sucursal en el CP, la de Via Cargo; si no, el rango aproximado.
        if e["provincias_correo"]:
            provincia, fuente = e["provincias_correo"].most_common(1)[0][0], "correo"
        elif e["provincia_viacargo"]:
            provincia, fuente = e["provincia_viacargo"], "viacargo"
        else:
            provincia, fuente = provincia_por_rango(cp), "rango"
        # Nombre principal: la localidad de Via Cargo si existe (es "la localidad"), si no
        # la primera sucursal del Correo.
        principal = (e["viacargo"]["nombre"] if e["viacargo"] and not str(e["viacargo"]["nombre"]).startswith("CP ") else None) \
            or (e["alias"][0] if e["alias"] else f"CP {cp}")
        principal = normalizar(principal)
        alias = [a for a in e["alias"] if a != principal]
        destinos.append({
            "cp": cp,
            "nombre": principal,
            "nombre_bonito": _titulo(principal),
            "alias": alias,
            "provincia": provincia,
            "provincia_fuente": fuente,
            "correo": {"sucursales": sorted(e["sucursales"], key=lambda s: s["nombre"])},
            "viacargo": e["viacargo"],
            "flechacarga": None,
        })
    # Flecha Carga: sus Puntos traen CP, pero no provincia; se usa la de este catalogo para no
    # cruzar una tarifa de otra provincia con el mismo nombre de ciudad.
    provincia_de = {d["cp"]: d["provincia"] for d in destinos}
    try:
        nombres_de = {d["cp"]: [d["nombre"], *d["alias"]] for d in destinos}
        cobertura = flechacarga.cobertura_por_cp(lambda cp: provincia_de.get(cp) or provincia_por_rango(cp),
                                                 lambda cp: nombres_de.get(cp, []))
    except Exception as e:  # sin tarifario o sin Puntos: el resto del catalogo sirve igual
        print(f"aviso: sin cobertura de Flecha Carga ({e})")
        cobertura = {}
    for d in destinos:
        c = cobertura.get(d["cp"])
        if c:
            d["flechacarga"] = {"etiqueta": c["etiqueta"], "nombre": c["nombre"], "puntos": c["puntos"], "general": c["general"]}
    destinos.sort(key=lambda d: (d["provincia"] or "ZZZ", d["nombre"], d["cp"]))
    return {"actualizado": time.strftime("%Y-%m-%dT%H:%M:%S"), "cantidad": len(destinos), "destinos": destinos,
            "fuentes": _firmas(sucursales, localidades, agencias)}


def _firmas(sucursales: dict | None, localidades: dict | None, agencias: dict | None) -> dict:
    return {"sucursales": (sucursales or {}).get("actualizado"), "localidades": (localidades or {}).get("actualizado"),
            "agencias": (agencias or {}).get("actualizado"), **_firmas_flecha()}


def _firmas_flecha() -> dict:
    # Fecha del tarifario y de los Puntos: si cambia alguno (CSV nuevo o Puntos descargados), se reconstruye.
    try:
        tarifas = flechacarga.cargar_tarifas().get("actualizado")
    except Exception:
        tarifas = None
    try:
        puntos = flechacarga.cargar_sucursales().get("actualizado")
    except Exception:
        puntos = None
    # flecha_criterio: subirlo al cambiar el cruce de cobertura, asi se reconstruye el catalogo guardado.
    return {"flecha_tarifas": tarifas, "flecha_puntos": puntos, "flecha_criterio": 2}


_cache: dict | None = None


def cargar_destinos(forzar: bool = False) -> dict:
    """Catalogo unificado; se reconstruye si cambio alguno de los catalogos de origen."""
    global _cache
    sucursales = cargar_sucursales()
    localidades = cargar_localidades()
    try:
        agencias = cargar_agencias()
    except Exception:  # sin listado de agencias no se puede saber donde hay retiro en agencia
        agencias = None
    firmas = _firmas(sucursales, localidades, agencias)
    if not forzar and _cache and _cache.get("fuentes") == firmas:
        return _cache
    if not forzar and DESTINOS_FILE.exists():
        try:
            datos = json.loads(DESTINOS_FILE.read_text(encoding="utf-8"))
            if datos.get("fuentes") == firmas and datos.get("destinos"):
                _cache = datos
                return datos
        except (OSError, ValueError):
            pass
    datos = construir_destinos(sucursales, localidades, agencias)
    try:
        DESTINOS_FILE.write_text(json.dumps(datos, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    _cache = datos
    return datos


def actualizar_catalogos(cual: str = "todos") -> dict:
    """Vuelve a descargar los catalogos de origen (sucursales del Correo requiere sesion) y reconstruye."""
    hecho = {}
    if cual in ("todos", "localidades"):
        hecho["localidades"] = descargar_localidades()["cantidad"]
    if cual in ("todos", "sucursales"):
        hecho["sucursales"] = descargar_sucursales()["total"]
    datos = cargar_destinos(forzar=True)
    hecho["destinos"] = datos["cantidad"]
    return hecho


def buscar(texto: str, destinos: list | None = None, limite: int = 12) -> list:
    """Busqueda por CP (prefijo) o por nombre / alias (sin tildes). Para uso desde CLI."""
    destinos = destinos if destinos is not None else cargar_destinos()["destinos"]
    t = normalizar(texto)
    if not t:
        return []
    if t.isdigit():
        exactos = [d for d in destinos if d["cp"] == t]
        return (exactos + [d for d in destinos if d["cp"].startswith(t) and d["cp"] != t])[:limite]
    res = [d for d in destinos if t in d["nombre"] or any(t in a for a in d["alias"])]
    res.sort(key=lambda d: (0 if d["nombre"].startswith(t) else 1, d["nombre"]))
    return res[:limite]


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--reconstruir":
        datos = cargar_destinos(forzar=True)
        print(f"{datos['cantidad']} destinos -> {DESTINOS_FILE}")
    elif len(sys.argv) > 1:
        for d in buscar(" ".join(sys.argv[1:])):
            vc = "VC" if d["viacargo"] else "--"
            fc = "FC" if d.get("flechacarga") else "--"
            print(f"{d['cp']}  {d['nombre_bonito']:<32} {d['provincia'] or '?':<22} correo:{len(d['correo']['sucursales']):>2} suc  {vc} {fc}")
    else:
        datos = cargar_destinos()
        print(f"{datos['cantidad']} destinos (fuentes: {datos['fuentes']})")
