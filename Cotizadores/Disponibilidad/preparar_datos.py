"""
Genera datos.json para la app de disponibilidad de envio a sucursal.

    ..\\Correo\\venv\\Scripts\\python.exe preparar_datos.py                 # actualiza las listas y genera
    ..\\Correo\\venv\\Scripts\\python.exe preparar_datos.py --sin-descargar  # genera con las listas actuales
    ..\\Correo\\venv\\Scripts\\python.exe preparar_datos.py --forzar         # guarda aunque falle el control

No copia logica: el cruce por CP y el criterio de "hay sucursal" salen del catalogo del
Comparador (destinos.py). Aca se agregan las direcciones del Correo (buscador publico),
las coordenadas de localidades (Georef, datos.gob.ar) y se arma un archivo compacto.

Solo se publican los campos de sucursal() : el sitio no tiene login, asi que nunca deben
entrar emails, tarifas ni datos de cuentas.
"""

import argparse
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
COTIZADORES = BASE_DIR.parent
DATOS_FILE = BASE_DIR / "datos.json"
CACHE_CORREO = BASE_DIR / "cache_correo.json"
CACHE_GEOREF = BASE_DIR / "cache_georef.json"
URL_GEOREF = "https://infra.datos.gob.ar/georef/localidades.json"

DIAS_CACHE_CORREO = 60
DIAS_CACHE_GEOREF = 90
HILOS_CORREO = 4
PAUSA_CORREO_S = 0.2
CAIDA_MAXIMA = 0.20  # si una empresa pierde mas que esto, no se pisa datos.json
KM_GEOREF_LEJOS = 30  # centroide mas lejos que esto de las sucursales: se prefieren las sucursales
KM_MISMA_LOCALIDAD = 25
KM_UNIR_NOMBRE = 10
KM_SUCURSAL_LEJOS = 50  # Punto de Flecha mas lejos que esto de su CP: su ubicacion esta mal

# Los modulos hermanos usan rutas relativas a ../Correo (.env, sucursales.json).
os.chdir(COTIZADORES / "Correo")
sys.path.insert(0, str(COTIZADORES / "Comparador"))

import destinos as catalogo  # noqa: E402  (../Comparador; agrega al path a los demas)
import flechacarga  # noqa: E402
import sucursales as correo  # noqa: E402
import viacargo  # noqa: E402

normalizar = catalogo.normalizar

PROVINCIAS_BONITAS = {
    "BUENOS AIRES": "Buenos Aires", "CAPITAL FEDERAL": "CABA", "CATAMARCA": "Catamarca", "CHACO": "Chaco",
    "CHUBUT": "Chubut", "CORDOBA": "Córdoba", "CORRIENTES": "Corrientes", "ENTRE RIOS": "Entre Ríos",
    "FORMOSA": "Formosa", "JUJUY": "Jujuy", "LA PAMPA": "La Pampa", "LA RIOJA": "La Rioja",
    "MENDOZA": "Mendoza", "MISIONES": "Misiones", "NEUQUEN": "Neuquén", "RIO NEGRO": "Río Negro",
    "SALTA": "Salta", "SAN JUAN": "San Juan", "SAN LUIS": "San Luis", "SANTA CRUZ": "Santa Cruz",
    "SANTA FE": "Santa Fe", "SANTIAGO DEL ESTERO": "Santiago del Estero",
    "TIERRA DEL FUEGO": "Tierra del Fuego", "TUCUMAN": "Tucumán",
}
GEOREF_PROVINCIAS = {"CIUDAD AUTONOMA DE BUENOS AIRES": "CAPITAL FEDERAL",
                     "TIERRA DEL FUEGO, ANTARTIDA E ISLAS DEL ATLANTICO SUR": "TIERRA DEL FUEGO"}
EMAIL = re.compile(r"\S+@\S+")


# ---------- Utilidades ----------

def clave(nombre: str) -> str:
    """Forma comparable de un nombre: sin tildes, sin conectores, abreviaturas expandidas."""
    limpio = re.sub(r"[.,;:'´`\"]", " ", str(nombre or ""))
    return flechacarga._palabras(limpio)


def limpiar_nombre(nombre: str) -> str:
    """"BARILOCHE - TERMINAL H/ 5KG" -> "BARILOCHE"; "JUNIN UP 3" -> "JUNIN"."""
    n = normalizar(nombre)
    n = re.split(r"\s+-\s+|\s*\(|\s+H/|\s+HASTA\s+\d", n)[0]
    n = re.split(r"\s+UP\d*(?:\s|$)|\s+NRO\b|\s+MUNICIPALIDAD\b|\s+DELEG", n)[0]
    return n.strip(" .-")


def km(lat1, lon1, lat2, lon2) -> float:
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 6371 * 2 * math.asin(math.sqrt(a))


def coordenadas(lat, lng):
    """Coordenadas redondeadas, o (None, None) si no caen dentro de Argentina."""
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError):
        return None, None
    if not (-56 <= lat <= -21 and -74 <= lng <= -53):
        return None, None
    return round(lat, 4), round(lng, 4)


def texto(valor) -> str:
    """Texto listo para publicar: sin HTML, sin emails, sin espacios de mas."""
    limpio = re.sub(r"<[^>]+>", " ", str(valor or ""))
    return " ".join(EMAIL.sub("", limpio).split()).strip(" -·/,")


def sucursal(nombre, direccion, cp, horario, telefono, lat, lng) -> list:
    lat, lng = coordenadas(lat, lng)
    return [texto(nombre), texto(direccion), str(cp or ""), texto(horario), texto(telefono), lat, lng]


def leer_json(ruta: Path, defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return defecto


def escribir_json(ruta: Path, datos, compacto=True):
    tmp = ruta.with_suffix(".tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, separators=(",", ":") if compacto else None), encoding="utf-8")
    tmp.replace(ruta)


# ---------- Paso 1: listas de cada empresa ----------

def actualizar_listas() -> list:
    """Actualiza cada lista por separado: si una falla, queda la anterior y se avisa."""
    avisos = []
    pasos = [
        ("Vía Cargo: localidades", viacargo.descargar_localidades),
        ("Vía Cargo: agencias", viacargo.descargar_agencias),
        ("Flecha Carga: sucursales", flechacarga.descargar_sucursales),
        ("Correo Argentino: sucursales (usa tu sesión de MiCorreo)", correo.descargar_sucursales),
    ]
    for nombre, funcion in pasos:
        print(f"  {nombre}...", flush=True)
        try:
            funcion()
        except Exception as e:  # cualquier falla de red o de sesion: se sigue con la lista anterior
            avisos.append(f"{nombre}: no se pudo actualizar, queda la lista anterior ({e})")
            print(f"    AVISO: {avisos[-1]}", flush=True)
    return avisos


# ---------- Paso 2: direcciones del Correo ----------

def _puntos_de(cod_prov: str, localidad: dict) -> list:
    time.sleep(PAUSA_CORREO_S)
    return correo._parsear_puntos(correo._ws("sucursales", provincia=cod_prov, localidad=localidad["id"]))


def descargar_detalle_correo(cods_prov: list) -> tuple[dict, list]:
    """{cod_prov: [{id, nombre, cp, puntos, fecha}]} con cache; devuelve tambien los avisos."""
    cache = leer_json(CACHE_CORREO, {})
    ahora = time.time()
    avisos, pendientes = [], []
    resultado = {}
    for cod in cods_prov:
        try:
            localidades = correo._localidades(cod)
        except Exception as e:
            avisos.append(f"Correo Argentino: sin localidades de la provincia {cod} ({e})")
            localidades = []
        for loc in localidades:
            k = f"{cod}|{loc['id']}"
            guardada = cache.get(k)
            if guardada and ahora - guardada.get("fecha", 0) < DIAS_CACHE_CORREO * 86400:
                continue
            pendientes.append((k, cod, loc))
    if pendientes:
        print(f"  Direcciones del Correo: faltan {len(pendientes)} localidades...", flush=True)
    fallas = 0
    with ThreadPoolExecutor(HILOS_CORREO) as pool:
        futuros = {pool.submit(_puntos_de, cod, loc): (k, cod, loc) for k, cod, loc in pendientes}
        for hechas, futuro in enumerate(as_completed(futuros), 1):
            k, cod, loc = futuros[futuro]
            try:
                cache[k] = {"prov": cod, "nombre": loc["nombre"], "cp": str(loc.get("cp") or ""),
                            "puntos": futuro.result(), "fecha": ahora}
            except Exception:
                fallas += 1
            if hechas % 100 == 0:
                print(f"    {hechas}/{len(pendientes)}", flush=True)
                escribir_json(CACHE_CORREO, cache)
    if pendientes:
        escribir_json(CACHE_CORREO, cache)
    if fallas:
        avisos.append(f"Correo Argentino: {fallas} localidades sin descargar; se reintentan en la próxima corrida")
    for entrada in cache.values():
        resultado.setdefault(entrada["prov"], []).append(entrada)
    return resultado, avisos


def sucursales_correo(lista: dict, detalle: dict) -> tuple[dict, dict]:
    """{codigo: sucursal publicable} y {cp: {nombres del buscador publico}}."""
    salida, nombres_cp = {}, defaultdict(set)
    for cod, locs in detalle.items():
        for loc in locs:
            if cod != "C" and loc["cp"]:
                nombres_cp[loc["cp"]].add(loc["nombre"])
    # Indices por provincia: nombre exacto y, por CP, los puntos para coincidencias parciales.
    exactos, por_cp = defaultdict(dict), defaultdict(list)
    for cod, locs in detalle.items():
        for loc in locs:
            for p in loc["puntos"]:
                n = normalizar(p.get("nombre"))
                exactos[cod].setdefault(n, p)
                por_cp[(cod, loc["cp"])].append((n, p))
    for prov_lista in (lista.get("provincias") or {}).values():
        for s in prov_lista:
            if s.get("HABILITADA") == "N":
                continue
            cod, nombre = s.get("codProvincia") or s["codigo"][0], normalizar(s.get("nombre"))
            p = exactos[cod].get(nombre)
            if not p:
                p = next((q for n, q in por_cp[(cod, str(s.get("cp")))] if n.startswith(nombre) or nombre.startswith(n)), None)
            p = p or {}
            salida[s["codigo"]] = sucursal(s.get("nombre"), p.get("direccion"), s.get("cp"), p.get("horario"), "",
                                           p.get("lat"), p.get("lon"))
    return salida, nombres_cp


# ---------- Paso 3: Georef ----------

def cargar_georef() -> tuple[list, list]:
    guardado = leer_json(CACHE_GEOREF, {})
    avisos = []
    if time.time() - guardado.get("fecha", 0) > DIAS_CACHE_GEOREF * 86400:
        try:
            req = urllib.request.Request(URL_GEOREF, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                crudo = json.loads(r.read().decode("utf-8"))["localidades"]
            guardado = {"fecha": time.time(), "localidades": [
                {"nombre": l["nombre"], "provincia": l["provincia"]["nombre"],
                 "departamento": (l.get("departamento") or {}).get("nombre") or "",
                 "lat": l["centroide"]["lat"], "lon": l["centroide"]["lon"]} for l in crudo]}
            escribir_json(CACHE_GEOREF, guardado)
        except Exception as e:
            avisos.append(f"Georef: no se pudo descargar ({e}); se usa la copia guardada si existe")
    salida = []
    for l in guardado.get("localidades", []):
        prov = normalizar(l["provincia"])
        lat, lon = coordenadas(l["lat"], l["lon"])
        if lat is not None:
            salida.append({**l, "provincia": GEOREF_PROVINCIAS.get(prov, prov), "lat": lat, "lon": lon})
    return salida, avisos


# ---------- Paso 4: armar localidades ----------

def mediana(puntos: list):
    """Centro de un grupo de ubicaciones; a diferencia del promedio, resiste una mal cargada."""
    puntos = [p for p in puntos if p[0] is not None]
    if not puntos:
        return None, None
    return round(statistics.median(p[0] for p in puntos), 4), round(statistics.median(p[1] for p in puntos), 4)


def armar(destinos_cat: list, nombres_correo: dict, suc_correo: dict, georef: list) -> dict:
    # Empresas: solo entran las sucursales que el catalogo cuenta como cobertura.
    agencias = [a for a in viacargo.cargar_agencias()["agencias"] if a.get("recibe_encomiendas")]
    agencias_cp = defaultdict(list)
    for a in agencias:
        agencias_cp[str(a.get("cp") or "").strip()].append(a)
    puntos_flecha = flechacarga.cargar_sucursales()["sucursales"]

    listas = {"c": [], "v": [], "f": []}
    indice = {"c": {}, "v": {}, "f": {}}

    def agregar(emp, llave, fila):
        if llave not in indice[emp]:
            indice[emp][llave] = len(listas[emp])
            listas[emp].append(fila)
        return indice[emp][llave]

    por_cp, provincia_cp = {}, {}
    for d in destinos_cat:
        cp = d["cp"]
        provincia_cp[cp] = d["provincia"]
        c, v, f = [], [], []
        for s in d["correo"]["sucursales"]:
            if s["codigo"] in suc_correo:
                c.append(agregar("c", s["codigo"], suc_correo[s["codigo"]]))
        if d.get("viacargo"):
            for a in agencias_cp[cp]:
                v.append(agregar("v", a["id"], sucursal(a["nombre"], a["direccion"], cp, a["horarios"], a["telefono"], a["lat"], a["lng"])))
        if d.get("flechacarga"):
            for i in d["flechacarga"]["puntos"]:
                p = puntos_flecha[i]
                f.append(agregar("f", i, sucursal(p["nombre"], p["direccion"], cp, p["horario"], p["contacto"], p["lat"], p["lng"])))
            # El tarifario trae el CP de sucursales que el sitio no lista: el catalogo las
            # cuenta como cobertura, asi que figuran, sin direccion.
            if not f:
                f.append(agregar("f", f"tarifa-{cp}", sucursal(d["flechacarga"]["nombre"], "", cp, "", "", None, None)))
        if c or v or f:
            por_cp[cp] = [c, v, f]

    # Localidades: nombres confiables por CP (Via Cargo + buscador del Correo). Los nombres de
    # sucursal del Correo traen el comercio ("JOSE C PAZ KIOSCO JAVIMAR"): solo se usan si el
    # CP no tiene ningun otro nombre.
    nombres_cp = defaultdict(set)
    for l in viacargo.cargar_localidades()["localidades"]:
        cp = str(l.get("cp") or "").strip()
        n = limpiar_nombre(l.get("nombre"))
        if cp and n and not n.startswith("CP "):
            nombres_cp[cp].add(n)
    for cp, nombres in nombres_correo.items():
        nombres_cp[cp].update(limpiar_nombre(n) for n in nombres)
    # Un nombre de sucursal que coincide con una localidad oficial tambien es confiable
    # (en CABA es la unica fuente de barrios como Saavedra).
    oficiales = {(clave(g["nombre"]), g["provincia"]) for g in georef}
    for d in destinos_cat:
        for s in d["correo"]["sucursales"]:
            n = limpiar_nombre(s["nombre"])
            if (clave(n), d["provincia"]) in oficiales:
                nombres_cp[d["cp"]].add(n)
    for d in destinos_cat:
        cp = d["cp"]
        if not nombres_cp[cp]:
            candidato = limpiar_nombre(d["nombre"])
            if candidato and not candidato.startswith("CP "):
                nombres_cp[cp].add(candidato)
        if not nombres_cp[cp] and cp in por_cp:
            nombres_cp[cp].add(f"CP {cp}")

    locs: dict[tuple, dict] = {}
    for cp, nombres in nombres_cp.items():
        prov = provincia_cp.get(cp) or catalogo.provincia_por_rango(cp)
        for n in nombres:
            k = (clave(n), prov)
            if not k[0]:
                continue
            loc = locs.setdefault(k, {"nombre": catalogo._titulo(n), "prov": prov, "cps": set(), "lat": None, "lon": None, "otros": {}, "dep": "", "oficial": False})
            loc["cps"].add(cp)

    def ubicaciones(cps, empresas="cv"):
        return [(listas[e][i][5], listas[e][i][6]) for cp in cps
                for e, grupo in zip("cvf", por_cp.get(cp, [[], [], []])) if e in empresas for i in grupo]

    def centro_sucursales(loc):
        # Flecha solo si no hay otra: tiene Puntos geolocalizados en otra ciudad.
        centro = mediana(ubicaciones(loc["cps"]))
        return centro if centro[0] is not None else mediana(ubicaciones(loc["cps"], "f"))

    # Coordenadas y nombre con tildes desde Georef; lo que no cruza se agrega como localidad propia.
    medias = {k: centro_sucursales(l) for k, l in locs.items()}
    grupos_georef = defaultdict(list)
    for g in georef:
        grupos_georef[(clave(g["nombre"]), g["provincia"])].append(g)
    sueltas = []
    for k, grupo in grupos_georef.items():
        if k in locs:
            lat, lon = medias[k]
            elegida = grupo[0] if lat is None else min(grupo, key=lambda g: km(lat, lon, g["lat"], g["lon"]))
            loc = locs[k]
            loc["nombre"] = elegida["nombre"]
            loc["oficial"] = True
            lejos = lat is not None and km(lat, lon, elegida["lat"], elegida["lon"]) > KM_GEOREF_LEJOS
            loc["lat"], loc["lon"] = (lat, lon) if lejos else (elegida["lat"], elegida["lon"])
            ref = elegida
            resto = [g for g in grupo if g is not elegida and km(ref["lat"], ref["lon"], g["lat"], g["lon"]) > KM_MISMA_LOCALIDAD]
        else:
            resto = grupo
        sueltas.extend(resto)
    for k, loc in locs.items():
        if loc["lat"] is None:
            loc["lat"], loc["lon"] = medias[k]

    # Una suelta puede ser otra forma de nombrar la misma ciudad ("San Carlos de Bariloche" /
    # "Bariloche"): se une si un nombre contiene al otro y estan cerca.
    por_prov = defaultdict(list)
    for loc in locs.values():
        if loc["lat"] is not None:
            por_prov[loc["prov"]].append((set(clave(loc["nombre"]).split()), loc))
    repetidas = Counter((clave(g["nombre"]), g["provincia"]) for g in sueltas)
    unidas = 0
    agregadas = []
    for g in sueltas:
        if clave(g["nombre"]) == clave("Ciudad de Buenos Aires"):
            continue  # ya esta como la opcion que reune a toda CABA
        palabras = set(clave(g["nombre"]).split())
        destino = None
        for otras, loc in por_prov[g["provincia"]]:
            if not loc["cps"]:
                continue
            chico = palabras if len(palabras) <= len(otras) else otras
            if (palabras <= otras or otras <= palabras) and len(" ".join(chico)) >= 5 \
                    and km(g["lat"], g["lon"], loc["lat"], loc["lon"]) <= KM_UNIR_NOMBRE:
                destino = loc
                break
        if destino is not None:
            destino["otros"][clave(g["nombre"])] = g["nombre"]
            unidas += 1
            continue
        dep = g["departamento"] if repetidas[(clave(g["nombre"]), g["provincia"])] > 1 else ""
        agregadas.append({"nombre": g["nombre"], "prov": g["provincia"], "cps": set(), "lat": g["lat"], "lon": g["lon"], "otros": {}, "dep": dep, "oficial": True})

    # Toda CABA como una sola opcion, ademas de sus barrios.
    cps_caba = {cp for cp, p in provincia_cp.items() if p == "CAPITAL FEDERAL" and cp in por_cp}
    caba = {"nombre": "Ciudad de Buenos Aires", "prov": "CAPITAL FEDERAL", "cps": cps_caba, "lat": -34.6037, "lon": -58.3816,
            "otros": {clave(n): n for n in ("CABA", "Capital Federal", "Buenos Aires Capital")}, "dep": "", "oficial": True}

    todas = [caba, *[l for k, l in locs.items() if clave(l["nombre"]) != clave(caba["nombre"])], *agregadas]
    todas.sort(key=lambda l: (clave(l["nombre"]), l["prov"] or ""))

    # Ubicacion de cada sucursal. Las del Correo y Via Cargo se respetan. Los Puntos de Flecha
    # incoherentes con su CP (Resistencia figura en Saenz Peña) y las sucursales sin ubicacion
    # usan el centro del CP, marcadas como aproximadas: el mapa las busca por direccion y la
    # posicion sirve solo para calcular distancias. Un CP puede abarcar pueblos lejanos entre
    # si, asi que tambien vale estar cerca de la localidad que lleva el nombre del Punto.
    centro_cp, centros_oficiales = {}, defaultdict(list)
    for loc in todas:
        if loc["lat"] is not None and loc is not caba:
            for cp in loc["cps"]:
                centro_cp.setdefault(cp, (loc["lat"], loc["lon"]))
                if loc["oficial"]:
                    centros_oficiales[cp].append((loc["lat"], loc["lon"]))
    corregidas = 0
    for emp in listas:
        for s in listas[emp]:
            aproximada = 0
            if s[5] is None:
                if s[2] in centro_cp:
                    s[5], s[6] = centro_cp[s[2]]
                    aproximada = 1
            elif emp == "f":
                ref = mediana(ubicaciones([s[2]]))
                referencias = [ref] if ref[0] is not None else centros_oficiales.get(s[2], [])
                por_nombre = [(g["lat"], g["lon"]) for g in grupos_georef.get((clave(limpiar_nombre(s[0])), provincia_cp.get(s[2])), [])]
                if referencias and all(km(s[5], s[6], *c) > KM_SUCURSAL_LEJOS for c in referencias + por_nombre):
                    s[5], s[6] = referencias[0]
                    aproximada = 1
                    corregidas += 1
            s.append(aproximada)

    provincias = sorted({l["prov"] for l in todas if l["prov"]})
    pos_prov = {p: i for i, p in enumerate(provincias)}
    return {
        "prov": [PROVINCIAS_BONITAS.get(p, p.title()) for p in provincias],
        "abrev": flechacarga.ABREVIATURAS,
        "conect": sorted(flechacarga.CONECTORES),
        "suc": listas,
        "cp": por_cp,
        "l": [[l["nombre"], pos_prov.get(l["prov"], -1), sorted(l["cps"]), l["lat"], l["lon"], list(l["otros"].values()), l["dep"]]
              for l in todas],
        "_stats": {"unidas": unidas, "sueltas": len(agregadas), "sin_coord": sum(1 for l in todas if l["lat"] is None), "corregidas": corregidas},
    }


# ---------- Paso 5: control ----------

def controlar(datos: dict, destinos_cat: list) -> list:
    problemas = []
    # Los totales por CP tienen que coincidir con el catalogo del Comparador.
    cuentas = {"Correo Argentino": (sum(1 for d in destinos_cat if d["correo"]["sucursales"]), 0),
               "Vía Cargo": (sum(1 for d in destinos_cat if d.get("viacargo")), 1),
               "Flecha Carga": (sum(1 for d in destinos_cat if d.get("flechacarga")), 2)}
    for nombre, (esperado, pos) in cuentas.items():
        real = sum(1 for g in datos["cp"].values() if g[pos])
        if real != esperado:
            problemas.append(f"{nombre}: {real} códigos postales con sucursal, el catálogo tiene {esperado}")
    # Todo CP con sucursal tiene que poder encontrarse.
    alcanzables = {cp for l in datos["l"] for cp in l[2]}
    faltan = [cp for cp in datos["cp"] if cp not in alcanzables]
    if faltan:
        problemas.append(f"{len(faltan)} códigos postales con sucursal no quedaron en ninguna localidad: {faltan[:10]}")
    # Caida fuerte respecto de la version anterior.
    anterior = leer_json(DATOS_FILE, {}).get("tot") or {}
    nombres = {"c": "Correo Argentino", "v": "Vía Cargo", "f": "Flecha Carga"}
    for emp, nombre in nombres.items():
        antes, ahora = anterior.get(emp) or 0, len(datos["suc"][emp])
        if antes and ahora < antes * (1 - CAIDA_MAXIMA):
            problemas.append(f"{nombre}: bajó de {antes} a {ahora} sucursales (más de {int(CAIDA_MAXIMA * 100)} %)")
        if not ahora:
            problemas.append(f"{nombre}: sin sucursales")
    if EMAIL.search(json.dumps(datos["suc"], ensure_ascii=False)):
        problemas.append("quedó un email en los datos de sucursales")
    return problemas


# ---------- Principal ----------

def main() -> int:
    ap = argparse.ArgumentParser(description="Genera datos.json de la app de disponibilidad")
    ap.add_argument("--sin-descargar", action="store_true", help="no actualiza las listas de las empresas")
    ap.add_argument("--forzar", action="store_true", help="guarda aunque falle el control")
    args = ap.parse_args()
    avisos = []
    inicio = time.time()

    if not args.sin_descargar:
        print("1. Actualizando listas de las empresas...", flush=True)
        avisos += actualizar_listas()
    print("2. Armando catálogo...", flush=True)
    lista_correo = correo.cargar_sucursales() or {}
    cat = catalogo.cargar_destinos(forzar=not args.sin_descargar)
    cods = sorted({s.get("codProvincia") or s["codigo"][0] for v in lista_correo.get("provincias", {}).values() for s in v})
    detalle, a = descargar_detalle_correo(cods)
    avisos += a
    suc_correo, nombres_correo = sucursales_correo(lista_correo, detalle)
    print("3. Coordenadas de localidades...", flush=True)
    georef, a = cargar_georef()
    avisos += a
    print("4. Armando localidades...", flush=True)
    datos = armar(cat["destinos"], nombres_correo, suc_correo, georef)
    stats = datos.pop("_stats")
    fechas = {"c": lista_correo.get("actualizado"), "v": viacargo.cargar_agencias().get("actualizado"),
              "f": flechacarga.cargar_sucursales().get("actualizado")}
    datos = {"generado": time.strftime("%Y-%m-%dT%H:%M:%S"), "fechas": fechas,
             "tot": {e: len(datos["suc"][e]) for e in "cvf"}, **datos}

    sin_cp = [s["nombre"] for s in flechacarga.cargar_sucursales()["sucursales"]
              if not s.get("cp") and not s["solo_domicilio"] and not s["solo_despacho"]]
    if sin_cp:
        avisos.append(f"Flecha Carga: Puntos sin código postal, no figuran hasta cargarlos en CP_FALTANTES: {', '.join(sin_cp)}")
    problemas = controlar(datos, cat["destinos"])
    tamano = len(json.dumps(datos, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    guardar = not problemas or args.forzar
    if guardar:
        escribir_json(DATOS_FILE, datos)

    con_dir = sum(1 for s in datos["suc"]["c"] if s[1])
    print("\nResumen")
    print(f"  Correo Argentino: {datos['tot']['c']} sucursales ({con_dir} con dirección), lista del {fechas['c']}")
    print(f"  Vía Cargo:        {datos['tot']['v']} sucursales, lista del {fechas['v']}")
    print(f"  Flecha Carga:     {datos['tot']['f']} sucursales, lista del {fechas['f']}")
    print(f"  Localidades:      {len(datos['l'])} (sin coordenadas: {stats['sin_coord']}; nombres unidos: {stats['unidas']}; solo Georef: {stats['sueltas']})")
    print(f"  Puntos de Flecha con ubicación corregida: {stats['corregidas']}")
    print(f"  Tamaño:           {tamano / 1024:.0f} KB · {time.time() - inicio:.0f} s")
    for aviso in avisos:
        print(f"  AVISO: {aviso}")
    if problemas:
        print("\nCONTROL NO SUPERADO:")
        for p in problemas:
            print(f"  - {p}")
    if guardar:
        print(f"\nListo: datos.json actualizado{' (forzado)' if problemas else ''}. Falta publicarlo subiendo los cambios al repositorio.")
        return 0
    print("\nNo se modificó datos.json: la app sigue con los datos anteriores. Revisá los problemas o corré con --forzar.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
