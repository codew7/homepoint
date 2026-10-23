r"""
Configuracion y registro de "WiFi Clientes".

Todo vive en %LOCALAPPDATA%\WiFi Clientes\:
    config.json    nombre de la red, minutos por cliente, apagado automatico
    registro.log   una linea por evento (encendido, cliente nuevo, vencido, cortado, apagado)
"""

import json
import os
import threading
import time
from pathlib import Path

NOMBRE = "WiFi Clientes"
DATOS = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / NOMBRE
ARCHIVO = DATOS / "config.json"
REGISTRO = DATOS / "registro.log"

PREDETERMINADA = {
    "ssid": "HomePoint Clientes",
    "minutos": 5,
    # Si la red queda sin ningun dispositivo conectado este tiempo, se apaga sola (0 = nunca).
    "apagado_auto_min": 5,
}

_candado = threading.Lock()


def cargar():
    DATOS.mkdir(parents=True, exist_ok=True)
    datos = dict(PREDETERMINADA)
    try:
        datos.update(json.loads(ARCHIVO.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass
    return validar(datos)


def validar(datos):
    """Normaliza valores que vienen de la interfaz o de un config.json editado a mano."""
    ssid = str(datos.get("ssid") or PREDETERMINADA["ssid"]).strip()[:32]
    minutos = _entero(datos.get("minutos"), PREDETERMINADA["minutos"], 1, 120)
    auto = _entero(datos.get("apagado_auto_min"), PREDETERMINADA["apagado_auto_min"], 0, 240)
    return {"ssid": ssid or PREDETERMINADA["ssid"], "minutos": minutos, "apagado_auto_min": auto}


def guardar(datos):
    datos = validar(datos)
    DATOS.mkdir(parents=True, exist_ok=True)
    ARCHIVO.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    return datos


def registrar(texto):
    linea = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {texto}\n"
    with _candado:
        try:
            DATOS.mkdir(parents=True, exist_ok=True)
            with REGISTRO.open("a", encoding="utf-8") as f:
                f.write(linea)
        except OSError:
            pass


def _entero(valor, defecto, minimo, maximo):
    try:
        return max(minimo, min(maximo, int(valor)))
    except (TypeError, ValueError):
        return defecto
