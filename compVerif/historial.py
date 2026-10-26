r"""
Historial de comprobantes analizados (SQLite, datos/historial.sqlite).

Permite detectar reenvios (mismo archivo, imagen casi igual, numero de operacion
repetido) y aprender de los comprobantes aprobados (formato de numero de
operacion por banco).
"""

import json
import os
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

# VERIFICADOR_DATOS permite usar otra carpeta (pruebas sin tocar el historial real)
DATOS_DIR = Path(os.environ.get("VERIFICADOR_DATOS") or Path(__file__).resolve().parent / "datos")
ARCHIVOS_DIR = DATOS_DIR / "archivos"
DB = DATOS_DIR / "historial.sqlite"

_lock = threading.Lock()

ESQUEMA = """
CREATE TABLE IF NOT EXISTS analisis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creado TEXT NOT NULL,
    archivo TEXT,
    extension TEXT,
    tipo TEXT,
    sha256 TEXT,
    dhash TEXT,
    texto_hash TEXT,
    banco TEXT,
    titular TEXT,
    operacion TEXT,
    coelsa TEXT,
    fecha_op TEXT,
    monto REAL,
    semaforo TEXT,
    veredicto TEXT,
    veredicto_fecha TEXT,
    detalle TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sha ON analisis(sha256);
CREATE INDEX IF NOT EXISTS ix_op ON analisis(operacion);
"""

COLUMNAS_LISTA = ("id", "creado", "archivo", "extension", "tipo", "banco", "titular", "operacion", "coelsa", "fecha_op",
                  "monto", "semaforo", "veredicto", "sha256", "dhash", "texto_hash")


def _conexion():
    DATOS_DIR.mkdir(exist_ok=True)
    ARCHIVOS_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.executescript(ESQUEMA)
    # Bases creadas por versiones anteriores: se agregan las columnas que falten
    existentes = {f["name"] for f in con.execute("PRAGMA table_info(analisis)")}
    for col in ("titular",):
        if col not in existentes:
            con.execute(f"ALTER TABLE analisis ADD COLUMN {col} TEXT")
    return con


def ahora():
    return datetime.now().isoformat(timespec="seconds")


def _columnas(reg):
    """Campos indexables de un registro completo (lo demas va en 'detalle' como JSON)."""
    datos = reg.get("datos") or {}
    forense = reg.get("forense") or {}
    return {
        "archivo": reg.get("archivo"), "extension": reg.get("extension"), "tipo": forense.get("tipo"),
        "sha256": forense.get("sha256"), "dhash": forense.get("dhash"), "texto_hash": forense.get("texto_hash"),
        "banco": datos.get("banco_origen"), "titular": datos.get("titular_origen"),
        "operacion": (str(datos.get("numero_operacion") or "").strip() or None),
        "coelsa": (str(datos.get("id_coelsa") or "").strip() or None), "fecha_op": reg.get("fecha_op"),
        "monto": reg.get("monto"), "semaforo": reg.get("semaforo"), "veredicto": reg.get("veredicto"),
        "veredicto_fecha": reg.get("veredicto_fecha"),
    }


def guardar(reg):
    """Inserta (sin id) o actualiza (con id) un registro completo; devuelve el id."""
    cols = _columnas(reg)
    with _lock, _conexion() as con:
        if reg.get("id"):
            cols["detalle"] = json.dumps(reg, ensure_ascii=False)
            con.execute(f"UPDATE analisis SET {', '.join(k + '=?' for k in cols)} WHERE id=?",
                        (*cols.values(), reg["id"]))
            return reg["id"]
        reg["creado"] = reg.get("creado") or ahora()
        cols.update(creado=reg["creado"], detalle="{}")
        cur = con.execute(f"INSERT INTO analisis ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                          tuple(cols.values()))
        reg["id"] = cur.lastrowid
        con.execute("UPDATE analisis SET detalle=? WHERE id=?", (json.dumps(reg, ensure_ascii=False), reg["id"]))
        return reg["id"]


def obtener(id_):
    with _lock, _conexion() as con:
        fila = con.execute("SELECT detalle, veredicto, veredicto_fecha FROM analisis WHERE id=?", (id_,)).fetchone()
    if not fila:
        return None
    reg = json.loads(fila["detalle"])
    reg.update(veredicto=fila["veredicto"], veredicto_fecha=fila["veredicto_fecha"])
    return reg


def listar(texto="", limite=300, excluir=None):
    sql = f"SELECT {', '.join(COLUMNAS_LISTA)} FROM analisis"
    params = []
    if texto:
        sql += " WHERE operacion LIKE ? OR coelsa LIKE ? OR archivo LIKE ? OR banco LIKE ? OR titular LIKE ?"
        params = [f"%{texto}%"] * 5
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limite)
    with _lock, _conexion() as con:
        filas = [dict(f) for f in con.execute(sql, params)]
    return [f for f in filas if f["id"] != excluir]


def todos_menos(id_):
    """Todo el historial (liviano) salvo un analisis, para los controles de duplicados."""
    return listar(limite=100000, excluir=id_)


def veredicto(id_, valor):
    with _lock, _conexion() as con:
        con.execute("UPDATE analisis SET veredicto=?, veredicto_fecha=? WHERE id=?",
                    (valor or None, ahora() if valor else None, id_))


def borrar(id_):
    with _lock, _conexion() as con:
        con.execute("DELETE FROM analisis WHERE id=?", (id_,))
    for f in [*ARCHIVOS_DIR.glob(f"{id_}.*"), *ARCHIVOS_DIR.glob(f"{id_}_*")]:
        f.unlink(missing_ok=True)
