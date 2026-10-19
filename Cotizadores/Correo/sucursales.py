"""
Descarga el listado completo de sucursales de destino de MiCorreo (todas las
provincias) y lo guarda en sucursales.json para que la interfaz pueda mostrar
un desplegable dependiente de la provincia, igual que el sitio.

Usa el mismo endpoint interno que el formulario (POST /consultarSO con
action "E" = entrega), invocado desde la propia pagina autenticada para que
el token CSRF y la sesion sean los del sitio.

Uso:
    python sucursales.py            # genera/actualiza sucursales.json
    from sucursales import cargar_sucursales, descargar_sucursales
"""

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

from auth import ensure_logged_in
from cotizador import ENVIO_CLA_URL, STATE_FILE

SUCURSALES_FILE = Path("sucursales.json")

# Mismos codigos y etiquetas que el select #provincia2 del sitio.
PROVINCIAS = {
    "B": "BUENOS AIRES", "C": "CAPITAL FEDERAL", "K": "CATAMARCA", "H": "CHACO",
    "U": "CHUBUT", "X": "CORDOBA", "W": "CORRIENTES", "E": "ENTRE RIOS",
    "P": "FORMOSA", "Y": "JUJUY", "L": "LA PAMPA", "F": "LA RIOJA",
    "M": "MENDOZA", "N": "MISIONES", "Q": "NEUQUEN", "R": "RIO NEGRO",
    "A": "SALTA", "J": "SAN JUAN", "D": "SAN LUIS", "Z": "SANTA CRUZ",
    "S": "SANTA FE", "G": "SANTIAGO DEL ESTERO", "V": "TIERRA DEL FUEGO", "T": "TUCUMAN",
}


def cargar_sucursales() -> dict | None:
    if not SUCURSALES_FILE.exists():
        return None
    try:
        return json.loads(SUCURSALES_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def descargar_sucursales(headless: bool = True) -> dict:
    ensure_logged_in()
    for intento in range(2):
        datos = _descargar_con_sesion(headless)
        if datos is not None:
            SUCURSALES_FILE.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
            return datos
        if intento == 0:
            ensure_logged_in(force=True)
    raise RuntimeError("No se pudo llegar a la pantalla de cotizacion ni siquiera tras relogin.")


def _descargar_con_sesion(headless: bool):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        context = browser.new_context(storage_state=str(STATE_FILE))
        page = context.new_page()
        page.goto(ENVIO_CLA_URL)
        if "envioCla" not in page.url:
            browser.close()
            return None

        try:
            provincias = {}
            for cod, nombre in PROVINCIAS.items():
                res = page.evaluate(
                    """async (codProv) => {
                        const data = await $.post(la_url + "/consultarSO", {
                            token: $("input[name='_token']").val(),
                            codProv: codProv,
                            action: "E",
                        });
                        const res = typeof data === "string" ? JSON.parse(data) : data;
                        return res.sucursales || [];
                    }""",
                    cod,
                )
                sucursales = sorted(
                    (
                        {
                            "codigo": s.get("codigoSucursal"),
                            "nombre": (s.get("descripcion") or "").strip(),
                            "cp": str(s.get("cp") or ""),
                            **{k: v for k, v in s.items() if k not in ("codigoSucursal", "descripcion", "cp")},
                        }
                        for s in res
                    ),
                    key=lambda s: s["nombre"],
                )
                provincias[nombre] = sucursales
                print(f"[sucursales] {nombre}: {len(sucursales)}", file=sys.stderr)

            return {
                "actualizado": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "total": sum(len(v) for v in provincias.values()),
                "provincias": provincias,
            }
        finally:
            browser.close()


# ---------------------------------------------------------------------------
# Detalle (direccion, horario, ubicacion) desde el buscador publico de
# sucursales de correoargentino.com.ar. Es el mismo endpoint que usa el
# formulario "Sucursales" del sitio; no requiere login. Devuelve HTML con un
# bloque <address> por punto (SUCURSAL o UNIDAD POSTAL), horarios y marcadores
# de mapa en el mismo orden. No publica telefono por sucursal.
# ---------------------------------------------------------------------------

import html as _html
import re
import threading
import urllib.parse
import urllib.request

WSFACADE_URL = "https://www.correoargentino.com.ar/sites/all/modules/custom/ca_forms/api/wsFacade.php"
DETALLE_FILE = Path("sucursales_detalle.json")
TELEFONO_ATENCION = "0810-777-7787"  # atencion al cliente Correo Argentino (unico publicado)
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
_lock = threading.Lock()
_localidades_cache: dict[str, list] = {}


def _ws(action: str, **campos) -> str:
    datos = {"action": action, "provincia": "", "departamento": "", "localidad": "", "nis": "", "servicios": ""}
    datos.update(campos)
    req = urllib.request.Request(
        WSFACADE_URL,
        data=urllib.parse.urlencode(datos).encode(),
        headers={"User-Agent": _UA, "Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8-sig", errors="replace")


def _localidades(cod_prov: str) -> list:
    if cod_prov == "C":
        return [{"id": "5001", "nombre": "CIUDAD AUTONOMA BUENOS AIRES", "cp": ""}]
    if cod_prov not in _localidades_cache:
        datos = json.loads(_ws("localidadesconsucursales", provincia=cod_prov))
        _localidades_cache[cod_prov] = datos.get("Localidades", {}).get("lista", []) or []
    return _localidades_cache[cod_prov]


def _parsear_puntos(html_txt: str) -> list[dict]:
    limpiar = lambda s: " ".join(_html.unescape(re.sub(r"<[^>]+>", " ", s)).split())
    bloques = re.findall(r"<address>(.*?)</address>", html_txt, re.S)
    horarios = re.findall(r"HORARIOS:\s*</strong>\s*(.*?)</p>", html_txt, re.S)
    coords = re.findall(r"L\.marker\(\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]", html_txt)
    puntos = []
    for i, b in enumerate(bloques):
        m = re.search(r"<strong>\s*([^:<]+):\s*(.*?)</strong>", b, re.S)
        if not m:
            continue
        lineas = [limpiar(x) for x in re.split(r"<br\s*/?>|</br>", b.split("</strong>", 1)[1])]
        lineas = [x for x in lineas if x]
        punto = {
            "tipo": limpiar(m.group(1)).title(),
            "nombre": " ".join(limpiar(m.group(2)).upper().split()),
            "direccion": lineas[0] if lineas else None,
            "localidad": lineas[1] if len(lineas) > 1 else None,
            "horario": limpiar(horarios[i]) if i < len(horarios) else None,
        }
        if len(coords) == len(bloques):
            punto["lat"], punto["lon"] = float(coords[i][0]), float(coords[i][1])
            punto["mapa"] = f"https://www.google.com/maps?q={coords[i][0]},{coords[i][1]}"
        puntos.append(punto)
    return puntos


def _buscar_sucursal(codigo: str) -> dict | None:
    datos = cargar_sucursales() or {}
    for lista in datos.get("provincias", {}).values():
        for s in lista:
            if s.get("codigo") == codigo:
                return s
    return None


def detalle_sucursal(codigo: str) -> dict:
    """Direccion, horario y ubicacion de una sucursal de MiCorreo (por codigo, ej. B0721)."""
    codigo = codigo.strip().upper()
    with _lock:
        cache = {}
        if DETALLE_FILE.exists():
            try:
                cache = json.loads(DETALLE_FILE.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                cache = {}
        if codigo in cache:
            return cache[codigo]

    suc = _buscar_sucursal(codigo)
    if not suc:
        raise ValueError(f"La sucursal {codigo} no esta en el listado de MiCorreo.")

    cod_prov = suc.get("codProvincia") or codigo[0]
    nombre = " ".join(suc["nombre"].upper().split())
    localidades = _localidades(cod_prov)
    # Candidatas: mismo CP; si no hay, localidades cuyo nombre es prefijo del de
    # la sucursal. CABA es una unica localidad en el buscador publico.
    if cod_prov == "C":
        candidatas = localidades
    else:
        candidatas = [l for l in localidades if str(l.get("cp")) == str(suc.get("cp"))]
        if not candidatas:
            candidatas = [l for l in localidades if nombre.startswith(l["nombre"].upper())]
        candidatas.sort(key=lambda l: -len(l["nombre"]))

    encontrado = None
    for loc in candidatas[:6]:
        puntos = _parsear_puntos(_ws("sucursales", provincia=cod_prov, localidad=loc["id"]))
        encontrado = next((p for p in puntos if p["nombre"] == nombre), None)
        if not encontrado:
            encontrado = next((p for p in puntos if p["nombre"].startswith(nombre) or nombre.startswith(p["nombre"])), None)
        if encontrado:
            break

    detalle = {
        "codigo": codigo, "nombre": suc["nombre"], "cp": suc.get("cp"),
        "provincia": suc.get("nombreProvincia"), "telefono_atencion": TELEFONO_ATENCION,
        "encontrado": bool(encontrado),
    }
    if encontrado:
        detalle.update(encontrado)
        detalle["nombre"] = suc["nombre"]

    with _lock:
        cache[codigo] = detalle
        DETALLE_FILE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
    return detalle


if __name__ == "__main__":
    if len(sys.argv) > 1:
        print(json.dumps(detalle_sucursal(sys.argv[1]), ensure_ascii=False, indent=2))
    else:
        datos = descargar_sucursales()
        print(f"{datos['total']} sucursales en {len(datos['provincias'])} provincias -> {SUCURSALES_FILE.resolve()}")
