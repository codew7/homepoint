"""
descargar.py — Baja de Firebase Storage el último recorrido terminado en
LocatorPic (la app de fotos de Android) y lo deja listo para relevar.py.

Uso:
    python descargar.py            (también lo llama relevar.py sin carpeta)

Qué hace:
    1. Lee locatorpic/ultima: el último recorrido que se finalizó en la app.
    2. Si ese recorrido ya está en la carpeta local, no baja nada (así, si el
       guardado falló, se reintenta sin volver a consultar a Claude).
    3. Si es nuevo, baja las fotos EN EL ORDEN DE LAS ZONAS a una carpeta
       temporal (Z001_..., Z002_...) y escribe sesion.json con ese orden.
    4. Recién cuando todo bajó bien, borra las fotos anteriores y pone las
       nuevas en su lugar. Si algo falla, la carpeta anterior queda intacta.
    5. Marca el recorrido como "descargada" (la app lo muestra) y limpia de
       Storage los recorridos anteriores: queda solo el último, cuyas
       miniaturas son la foto guía del próximo recorrido.
"""

import json
import logging
import shutil
import sys
import time
from pathlib import Path

from firebase_admin import db, storage

log = logging.getLogger("locator")

RAIZ = "locatorpic"
MANIFIESTO = "sesion.json"
ESTADOS_LIMPIABLES = {"lista", "descargada", "procesada", "archivada", "descartada"}


def _lista_zonas(valor):
    """Firebase devuelve las listas como list o como dict {"0": ..., "1": ...}."""
    if isinstance(valor, list):
        return [z for z in valor if z]
    if isinstance(valor, dict):
        return [valor[k] for k in sorted(valor, key=lambda k: int(k)) if valor[k]]
    return []


def leer_manifiesto(carpeta: Path):
    ruta = carpeta / MANIFIESTO
    if not ruta.is_file():
        return None
    try:
        return json.loads(ruta.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def _es_carpeta_nuestra(carpeta: Path):
    """Solo se borra una carpeta que creó este programa (tiene sesion.json) o vacía."""
    if not carpeta.exists():
        return True
    return (carpeta / MANIFIESTO).is_file() or not any(carpeta.iterdir())


def _bajar(blob, destino: Path, intentos=3):
    for intento in range(1, intentos + 1):
        try:
            blob.download_to_filename(str(destino))
            blob.reload()
            if blob.size is not None and destino.stat().st_size != blob.size:
                raise IOError(f"tamaño distinto ({destino.stat().st_size} de {blob.size} bytes)")
            return
        except Exception as e:
            if intento == intentos:
                raise
            log.warning("  Reintento %d de %s: %s", intento, destino.name, e)
            time.sleep(3 * intento)


def obtener_ultimo(carpeta: Path, bucket_nombre: str):
    """Deja en `carpeta` el último recorrido terminado. Devuelve la carpeta,
    o None si no hay nada para descargar."""
    ultima = db.reference(f"{RAIZ}/ultima").get() or {}
    sesion_id = ultima.get("sesionId")
    if not sesion_id:
        log.error("Todavía no hay recorridos terminados en LocatorPic.")
        return None

    sesion = db.reference(f"{RAIZ}/sesiones/{sesion_id}").get() or {}
    zonas = _lista_zonas(sesion.get("zonas")) or _lista_zonas(ultima.get("zonas"))
    if not zonas:
        log.error("El recorrido %s no tiene fotos.", sesion_id)
        return None

    local = leer_manifiesto(carpeta)
    if local and local.get("sesionId") == sesion_id:
        log.info("El recorrido %s (%d zonas) ya está descargado en %s.", sesion_id, len(zonas), carpeta)
        return carpeta

    if not _es_carpeta_nuestra(carpeta):
        sys.exit(f"La carpeta {carpeta} tiene archivos que no son de un relevamiento.\n"
                 "Por seguridad no se borra. Revisá RELEVAMIENTO_CARPETA en el archivo .env.")

    log.info("Descargando el recorrido %s: %d zonas...", sesion_id, len(zonas))
    bucket = storage.bucket(bucket_nombre)
    temporal = carpeta.with_name(carpeta.name + ".descargando")
    if temporal.exists():
        shutil.rmtree(temporal)
    temporal.mkdir(parents=True)

    nombres = []
    total_bytes = 0
    try:
        for i, foto_id in enumerate(zonas, 1):
            blob = bucket.blob(f"{RAIZ}/{sesion_id}/{foto_id}.jpg")
            if not blob.exists():
                raise FileNotFoundError(f"La foto de la zona {i} no está en Storage (¿no terminó de subirse?)")
            nombre = f"Z{i:03d}_{foto_id}.jpg"
            _bajar(blob, temporal / nombre)
            nombres.append(nombre)
            total_bytes += (temporal / nombre).stat().st_size
            print(f"\r  {i}/{len(zonas)} fotos  ({total_bytes / 1048576:.0f} MB)", end="", flush=True)
        print()
    except Exception as e:
        print()
        shutil.rmtree(temporal, ignore_errors=True)
        log.error("No se pudo descargar el recorrido: %s", e)
        log.error("Las fotos anteriores de la PC quedaron como estaban.")
        return None

    (temporal / MANIFIESTO).write_text(json.dumps({
        "sesionId": sesion_id,
        "zonas": zonas,
        "fotos": nombres,
        "finalizada": ultima.get("finalizada"),
        "usuario": sesion.get("usuario"),
        "dispositivo": sesion.get("dispositivo"),
        "descargada": int(time.time() * 1000),
    }, ensure_ascii=False, indent=1), "utf-8")

    # Recién ahora se borran las fotos anteriores y se ponen las nuevas.
    if carpeta.exists():
        shutil.rmtree(carpeta)
    temporal.rename(carpeta)
    log.info("Listo: %d fotos (%.0f MB) en %s", len(nombres), total_bytes / 1048576, carpeta)

    db.reference(f"{RAIZ}/sesiones/{sesion_id}").update({
        "estado": "descargada",
        "descargada": {".sv": "timestamp"},
    })
    limpiar_storage(bucket, sesion_id)
    return carpeta


def limpiar_storage(bucket, actual_id):
    """Borra de Storage los recorridos anteriores al actual (fotos y
    miniaturas) y los marca "archivada". Nunca toca un recorrido en curso."""
    sesiones = db.reference(f"{RAIZ}/sesiones").get(shallow=False) or {}
    viejas = [sid for sid, s in sesiones.items()
              if sid != actual_id and isinstance(s, dict) and s.get("estado") in ESTADOS_LIMPIABLES]
    if not viejas:
        return
    borrados = 0
    for sid in viejas:
        for blob in bucket.list_blobs(prefix=f"{RAIZ}/{sid}/"):
            try:
                blob.delete()
                borrados += 1
            except Exception as e:
                log.warning("  No se pudo borrar %s: %s", blob.name, e)
        # Del registro queda lo mínimo; se descartan los datos de cada foto.
        db.reference(f"{RAIZ}/sesiones/{sid}").update({"estado": "archivada", "fotos": None})
    log.info("Storage: se borraron %d archivo(s) de %d recorrido(s) anterior(es).", borrados, len(viejas))


if __name__ == "__main__":
    # Uso independiente: solo descarga.
    import os
    from dotenv import load_dotenv
    import guardar_firebase

    logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
    aqui = Path(__file__).resolve().parent
    load_dotenv(aqui / ".env")
    guardar_firebase.conectar(os.environ["FIREBASE_CREDENCIALES"], os.environ["FIREBASE_DB_URL"],
                              os.getenv("FIREBASE_BUCKET", "pedidos-87064.firebasestorage.app"))
    destino = Path(os.getenv("RELEVAMIENTO_CARPETA", r"C:\HomePoint\Relevamiento\actual"))
    sys.exit(0 if obtener_ultimo(destino, os.getenv("FIREBASE_BUCKET", "pedidos-87064.firebasestorage.app")) else 1)
