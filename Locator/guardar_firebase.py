"""
guardar_firebase.py — Escribe el resultado del relevamiento en Firebase
(Realtime Database del proyecto pedidos-87064), con el Admin SDK.

Cada foto del recorrido es una ZONA (1, 2, 3... en el orden en que se
sacaron) y tiene dos COLUMNAS: "I" (izquierda) y "D" (derecha).

Estructura dentro de "ubicaciones" (pensada para que la app lea rápido):

    mapa/{codigo}         LO QUE USA LA APP. Liviano, uno por producto:
                          { zona: 12, columna: "I", orden: 24,
                            confianza: "alta" | "media" | "baja",
                            estado: "ubicado" | "posible_movido", fecha }
                          "orden" sirve para ordenar el recorrido:
                          zona 12 izquierda = 24, zona 12 derecha = 25.
                          pedidosv2 lo escucha completo (unos 150 KB con
                          todo el catálogo ubicado).
    detalle/{codigo}      Datos para revisar: nombre, categoría, precio
                          leído, foto, método, relevamiento...
    historial/{codigo}/{id}   Ubicaciones anteriores del producto.
    ultimo                Datos del último relevamiento guardado (cantidad
                          de fotos, fecha) para avisar si cambió el recorrido.
    relevamientos/{id}    Cada recorrido: fotos procesadas y resumen.
    pendientes/{id}/{n}   Lecturas ambiguas o no encontradas, para revisar.

La lectura desde las apps está en ubicaciones-api.js.
"""

import re
import time

import firebase_admin
from firebase_admin import credentials, db

from identificar import ORDEN_CONFIANZA


def orden_de(zona, columna):
    """Posición en el recorrido: zona 1 izq = 2, zona 1 der = 3, zona 2 izq = 4..."""
    return zona * 2 + (1 if columna == "D" else 0)


def clave_segura(texto):
    """Firebase no acepta . # $ [ ] / en las claves: se reemplazan por _."""
    return re.sub(r"[.#$\[\]/]", "_", str(texto).strip())


def conectar(ruta_credenciales, url_base, bucket=None):
    """Inicia el Admin SDK con el archivo de cuenta de servicio (base de datos
    y, si se indica, el bucket de Storage de LocatorPic)."""
    if not firebase_admin._apps:
        opciones = {"databaseURL": url_base}
        if bucket:
            opciones["storageBucket"] = bucket
        firebase_admin.initialize_app(credentials.Certificate(ruta_credenciales), opciones)


def leer_mapa():
    """Ubicaciones actuales: {codigo: {zona, columna, orden, confianza, estado, fecha}}."""
    return db.reference("ubicaciones/mapa").get() or {}


def leer_ultimo():
    """Datos del último relevamiento guardado, o {} si no hay."""
    return db.reference("ubicaciones/ultimo").get() or {}


def _resumir_candidatos(lista):
    return [{"codigo": p["codigo"], "nombre": p["nombre"], "categoria": p["categoria"]} for p in lista]


def guardar(relevamiento_id, fotos, lecturas, resumen, modelo, sesion_locatorpic=None):
    """Guarda todo en UNA sola operación: o se guarda todo, o nada.

    sesion_locatorpic: id del recorrido de la app LocatorPic del que salieron
    las fotos (si salieron de ahí). Se marca "procesada" con el resultado,
    para que la app muestre cuántos productos se ubicaron.

    Cada relevamiento es del depósito COMPLETO: los productos que estaban
    ubicados y esta vez no aparecieron se marcan "posible_movido" (se
    conserva su ubicación anterior; no se borra nada).
    Devuelve un pequeño resumen de lo que cambió."""
    ahora = int(time.time() * 1000)
    actuales = leer_mapa()

    # 1) Mejor lectura de cada producto identificado. Si aparece varias
    #    veces (por ejemplo, en el borde entre las dos columnas), gana la de
    #    mayor confianza; si empatan, la primera del recorrido.
    vistos = {}   # clave -> {"lectura": ..., "lugares": set()}
    for l in lecturas:
        if l["estado"] != "identificado":
            continue
        clave = clave_segura(l["producto"]["codigo"])
        lugar = f"{l['zona']}-{l['columna']}"
        if clave not in vistos:
            vistos[clave] = {"lectura": l, "lugares": {lugar}}
        else:
            vistos[clave]["lugares"].add(lugar)
            if ORDEN_CONFIANZA[l["confianza"]] > ORDEN_CONFIANZA[vistos[clave]["lectura"]["confianza"]]:
                vistos[clave]["lectura"] = l

    updates = {}
    cambios = movidos = 0

    # 2) Ubicación nueva de cada producto visto.
    for n, (clave, v) in enumerate(vistos.items()):
        l, anterior = v["lectura"], actuales.get(clave) or {}
        if anterior.get("zona") is not None and (anterior.get("zona"), anterior.get("columna")) != (l["zona"], l["columna"]):
            # Cambió de lugar: el anterior pasa al historial.
            updates[f"ubicaciones/historial/{clave}/{relevamiento_id}_{n}"] = {
                "zona": anterior.get("zona"),
                "columna": anterior.get("columna"),
                "desde": anterior.get("fecha"),
                "hasta": ahora,
            }
            cambios += 1
        updates[f"ubicaciones/mapa/{clave}"] = {
            "zona": l["zona"],
            "columna": l["columna"],
            "orden": orden_de(l["zona"], l["columna"]),
            "confianza": l["confianza"],
            "estado": "ubicado",
            "fecha": ahora,
        }
        lugar = f"{l['zona']}-{l['columna']}"
        updates[f"ubicaciones/detalle/{clave}"] = {
            "codigo": l["producto"]["codigo"],
            "nombre": l["producto"]["nombre"],
            "categoria": l["producto"]["categoria"],
            "metodo": l["metodo"],
            "precioLeido": l["etiqueta"]["precio"],
            "foto": l["foto"],
            "relevamientoId": relevamiento_id,
            # Si se vio en más de un lugar en este mismo relevamiento, se anota.
            "tambienEn": sorted(v["lugares"] - {lugar}) or None,
        }

    # 3) Los que estaban ubicados y no aparecieron: "posible_movido".
    for clave, u in actuales.items():
        if clave not in vistos and isinstance(u, dict) and u.get("estado") != "posible_movido":
            updates[f"ubicaciones/mapa/{clave}/estado"] = "posible_movido"
            updates[f"ubicaciones/detalle/{clave}/marcadoMovidoEn"] = ahora
            movidos += 1

    # 4) Lecturas para revisar a mano.
    for n, l in enumerate(x for x in lecturas if x["estado"] in ("ambiguo", "no_encontrado")):
        updates[f"ubicaciones/pendientes/{relevamiento_id}/{n}"] = {
            "estado": l["estado"],
            "precioLeido": l["etiqueta"]["precio"],
            "precioTexto": l["etiqueta"]["precio_texto"],
            "textoApoyo": l["etiqueta"]["texto_apoyo"],
            "candidatos": _resumir_candidatos(l["candidatos"]),   # los más probables primero
            "zona": l["zona"],
            "columna": l["columna"],
            "foto": l["foto"],
            "confianza": l["confianza"],
            "fecha": ahora,
        }

    # 5) Registro del relevamiento (también sirve de log de fotos procesadas).
    fotos_log = {}
    for f in fotos:
        cols = f.get("columnas") or {}
        fotos_log[clave_segura(f["nombre"])] = {
            "nombre": f["nombre"],
            "zona": f["zona"],
            "ok": len(cols) == 2,
            "error": f.get("error"),
            "etiquetas": sum(len(a["etiquetas"]) for a in cols.values()),
            "problemas": sorted({p for a in cols.values() for p in a["problemas"]}),
        }
    updates[f"ubicaciones/relevamientos/{relevamiento_id}"] = {
        "fecha": ahora,
        "modelo": modelo or "predeterminado",
        "fotos": fotos_log,
        "resumen": {**resumen, "productosUbicados": len(vistos),
                    "cambiosDeLugar": cambios, "marcadosMovidos": movidos},
    }
    updates["ubicaciones/ultimo"] = {
        "relevamientoId": relevamiento_id,
        "fecha": ahora,
        "fotos": len(fotos),
        "primeraFoto": fotos[0]["nombre"] if fotos else None,
        "ultimaFoto": fotos[-1]["nombre"] if fotos else None,
    }

    if sesion_locatorpic:
        updates[f"locatorpic/sesiones/{sesion_locatorpic}/estado"] = "procesada"
        updates[f"locatorpic/sesiones/{sesion_locatorpic}/procesada"] = {
            "fecha": ahora,
            "relevamientoId": relevamiento_id,
            "productosUbicados": len(vistos),
            "ambiguos": resumen.get("ambiguos", 0),
            "noEncontrados": resumen.get("noEncontrados", 0),
        }

    db.reference().update(updates)
    return {"productos_ubicados": len(vistos), "cambios_de_lugar": cambios, "marcados_movidos": movidos}
