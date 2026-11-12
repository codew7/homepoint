r"""
Historial de comprobantes analizados (SQLite, datos/historial.sqlite).

Tabla "whatsapp": estado de cada comprobante bajado por descargar-comprobantes.js
(pendiente, en cola, listo, error) y el analisis que le corresponde.

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
CREATE TABLE IF NOT EXISTS whatsapp (
    wa_id TEXT PRIMARY KEY,
    archivo TEXT,
    t INTEGER,
    estado TEXT NOT NULL,
    analisis_id INTEGER,
    intentos INTEGER DEFAULT 0,
    error TEXT,
    actualizado TEXT
);
"""

# Estados de la tabla whatsapp
PENDIENTE, EN_COLA, LISTO, ERROR = "pendiente", "en_cola", "listo", "error"

COLUMNAS_LISTA = ("id", "creado", "archivo", "extension", "tipo", "banco", "titular", "operacion", "coelsa", "fecha_op",
                  "monto", "semaforo", "veredicto", "sha256", "dhash", "texto_hash", "origen", "wa_id", "cliente")


def _conexion():
    DATOS_DIR.mkdir(exist_ok=True)
    ARCHIVOS_DIR.mkdir(exist_ok=True)
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    con.executescript(ESQUEMA)
    # Bases creadas por versiones anteriores: se agregan las columnas que falten
    existentes = {f["name"] for f in con.execute("PRAGMA table_info(analisis)")}
    for col in ("titular", "origen", "wa_id", "cliente"):
        if col not in existentes:
            con.execute(f"ALTER TABLE analisis ADD COLUMN {col} TEXT")
    con.execute("CREATE INDEX IF NOT EXISTS ix_wa ON analisis(wa_id)")
    return con


def ahora():
    return datetime.now().isoformat(timespec="seconds")


def _columnas(reg):
    """Campos indexables de un registro completo (lo demas va en 'detalle' como JSON)."""
    datos = reg.get("datos") or {}
    forense = reg.get("forense") or {}
    origen = reg.get("origen") or {}
    return {
        "archivo": reg.get("archivo"), "extension": reg.get("extension"), "tipo": forense.get("tipo"),
        "sha256": forense.get("sha256"), "dhash": forense.get("dhash"), "texto_hash": forense.get("texto_hash"),
        "banco": datos.get("banco_origen"), "titular": datos.get("titular_origen"),
        "operacion": (str(datos.get("numero_operacion") or "").strip() or None),
        "coelsa": (str(datos.get("id_coelsa") or "").strip() or None), "fecha_op": reg.get("fecha_op"),
        "monto": reg.get("monto"), "semaforo": reg.get("semaforo"), "veredicto": reg.get("veredicto"),
        "veredicto_fecha": reg.get("veredicto_fecha"),
        "origen": origen.get("tipo"), "wa_id": origen.get("wa_id"), "cliente": origen.get("cliente"),
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


def listar(texto="", limite=300, excluir=None, origen=None):
    """origen: None (todos), "whatsapp" o "manual"."""
    sql = f"SELECT {', '.join(COLUMNAS_LISTA)} FROM analisis"
    condiciones, params = [], []
    if texto:
        condiciones.append("(operacion LIKE ? OR coelsa LIKE ? OR archivo LIKE ? OR banco LIKE ? OR titular LIKE ? OR cliente LIKE ?)")
        params += [f"%{texto}%"] * 6
    if origen == "whatsapp":
        condiciones.append("origen = 'whatsapp'")
    elif origen == "manual":
        condiciones.append("origen IS NULL")
    if condiciones:
        sql += " WHERE " + " AND ".join(condiciones)
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


def borrar_incompletos():
    """Analisis que quedaron a medias (se cerro la app mientras analizaba): se borran
    al arrancar. Si venian de WhatsApp, vuelven a la cola."""
    with _lock, _conexion() as con:
        filas = con.execute("SELECT id, wa_id FROM analisis WHERE semaforo IS NULL").fetchall()
    for f in filas:
        borrar(f["id"])
        if f["wa_id"]:
            with _lock, _conexion() as con:
                con.execute("UPDATE whatsapp SET estado=? WHERE wa_id=? AND analisis_id IS NULL", (EN_COLA, f["wa_id"]))
    return len(filas)


def borrar(id_):
    with _lock, _conexion() as con:
        con.execute("DELETE FROM analisis WHERE id=?", (id_,))
        # Si venia de WhatsApp, el comprobante vuelve a quedar sin analizar
        con.execute("UPDATE whatsapp SET estado=?, analisis_id=NULL, actualizado=? WHERE analisis_id=?", (PENDIENTE, ahora(), id_))
    for f in [*ARCHIVOS_DIR.glob(f"{id_}.*"), *ARCHIVOS_DIR.glob(f"{id_}_*")]:
        f.unlink(missing_ok=True)


# ------------------------------------------------------------------ whatsapp --

def wa_todos():
    """{wa_id: fila} de la tabla whatsapp."""
    with _lock, _conexion() as con:
        return {f["wa_id"]: dict(f) for f in con.execute("SELECT * FROM whatsapp")}


def wa_poner(wa_id, **campos):
    """Crea o actualiza la fila de un comprobante de WhatsApp."""
    campos["actualizado"] = ahora()
    with _lock, _conexion() as con:
        con.execute("INSERT OR IGNORE INTO whatsapp (wa_id, estado) VALUES (?, ?)", (wa_id, campos.get("estado") or PENDIENTE))
        con.execute(f"UPDATE whatsapp SET {', '.join(k + '=?' for k in campos)} WHERE wa_id=?", (*campos.values(), wa_id))


def wa_de_analisis(id_):
    """wa_id del comprobante de WhatsApp al que corresponde un analisis (o None)."""
    with _lock, _conexion() as con:
        fila = con.execute("SELECT wa_id FROM whatsapp WHERE analisis_id=?", (id_,)).fetchone()
    return fila["wa_id"] if fila else None


def wa_resultados():
    """Ultimo analisis de cada comprobante de WhatsApp: [{wa_id, analisis_id, semaforo, veredicto, detalle}]."""
    with _lock, _conexion() as con:
        filas = con.execute("""SELECT w.wa_id, w.analisis_id, a.semaforo, a.veredicto, a.detalle
                               FROM whatsapp w JOIN analisis a ON a.id = w.analisis_id
                               WHERE w.estado = ?""", (LISTO,)).fetchall()
    return [dict(f) for f in filas]
