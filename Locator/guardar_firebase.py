"""
guardar_firebase.py — Escribe el resultado del relevamiento en Firebase
(Realtime Database del proyecto pedidos-87064), con el Admin SDK.

El lugar de cada producto es un GRUPO del depósito (FL, FR, BL, BR, OT) y
una COLUMNA dentro del grupo (1, 2, 3...).

Estructura dentro de "ubicaciones" (pensada para que la app lea rápido):

    mapa/{codigo}         LO QUE USA LA APP. Liviano, uno por producto:
                          { grupo: "FL", columna: 3, orden: 3,
                            confianza: "alta" | "media" | "baja",
                            estado: "ubicado" | "posible_movido", fecha }
                          "orden" sirve para ordenar el recorrido:
                          FL columna 3 = 3, FR columna 1 = 1001...
                          pedidosv2 lo escucha completo (unos 150 KB con
                          todo el catálogo ubicado).
    detalle/{codigo}      Datos para revisar: nombre, categoría, precio
                          leído, foto, método, relevamiento...
    historial/{codigo}/{id}   Ubicaciones anteriores del producto.
    ultimo                Datos del último relevamiento guardado (columnas
                          por grupo, fecha) para avisar si cambió el recorrido.
    relevamientos/{id}    Cada recorrido: fotos procesadas y resumen.
    pendientes/{id}/{n}   Lecturas ambiguas o no encontradas, para revisar.

La lectura desde las apps está en ubicaciones-api.js.
"""

import re
import time

import firebase_admin
from firebase_admin import credentials, db

from identificar import ORDEN_CONFIANZA


GRUPOS = ("FL", "FR", "BL", "BR", "OT")    # en el orden en que se recorren


def orden_de(grupo, columna):
    """Posición en el recorrido: FL 1 = 1, FL 2 = 2... FR 1 = 1001, BL 1 = 2001..."""
    g = GRUPOS.index(grupo) if grupo in GRUPOS else len(GRUPOS)
    return g * 1000 + int(columna)


def lugar_de(l):
    return f"{l['grupo']}-{l['columna']}"


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
    """Ubicaciones actuales: {codigo: {grupo, columna, orden, confianza, estado, fecha}}."""
    return db.reference("ubicaciones/mapa").get() or {}


def leer_ultimo():
    """Datos del último relevamiento guardado, o {} si no hay."""
    return db.reference("ubicaciones/ultimo").get() or {}


def _resumir_candidatos(lista):
    return [{"codigo": p["codigo"], "nombre": p["nombre"], "categoria": p["categoria"]} for p in lista]


def guardar(relevamiento_id, columnas, lecturas, resumen, modelo, sesion_locatorpic=None):
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
    #    veces (por ejemplo, en el borde entre dos columnas), gana la de
    #    mayor confianza; si empatan, la primera del recorrido.
    vistos = {}   # clave -> {"lectura": ..., "lugares": set()}
    for l in lecturas:
        if l["estado"] != "identificado":
            continue
        clave = clave_segura(l["producto"]["codigo"])
        lugar = lugar_de(l)
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
        estaba = anterior.get("grupo") is not None or anterior.get("zona") is not None
        if estaba and (anterior.get("grupo"), anterior.get("columna")) != (l["grupo"], l["columna"]):
            # Cambió de lugar: el anterior pasa al historial.
            updates[f"ubicaciones/historial/{clave}/{relevamiento_id}_{n}"] = {
                "grupo": anterior.get("grupo"),
                "zona": anterior.get("zona"),          # relevamientos viejos
                "columna": anterior.get("columna"),
                "desde": anterior.get("fecha"),
                "hasta": ahora,
            }
            cambios += 1
        updates[f"ubicaciones/mapa/{clave}"] = {
            "grupo": l["grupo"],
            "columna": l["columna"],
            "orden": orden_de(l["grupo"], l["columna"]),
            "confianza": l["confianza"],
            "estado": "ubicado",
            "fecha": ahora,
        }
        lugar = lugar_de(l)
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
            "grupo": l["grupo"],
            "columna": l["columna"],
            "foto": l["foto"],
            "confianza": l["confianza"],
            "fecha": ahora,
        }

    # 5) Registro del relevamiento (también sirve de log de columnas procesadas).
    columnas_log, por_grupo = {}, {}
    for c in columnas:
        a = c.get("analisis")
        columnas_log[f"{c['grupo']}-{c['columna']:02d}"] = {
            "nombre": c["nombre"],
            "fotos": len(c["fotos"]),
            "ok": a is not None,
            "error": c.get("error"),
            "etiquetas": len(a["etiquetas"]) if a else 0,
            "problemas": a["problemas"] if a else [],
        }
        por_grupo[c["grupo"]] = por_grupo.get(c["grupo"], 0) + 1
    updates[f"ubicaciones/relevamientos/{relevamiento_id}"] = {
        "fecha": ahora,
        "modelo": modelo or "predeterminado",
        "columnas": columnas_log,
        "resumen": {**resumen, "productosUbicados": len(vistos),
                    "cambiosDeLugar": cambios, "marcadosMovidos": movidos},
    }
    updates["ubicaciones/ultimo"] = {
        "relevamientoId": relevamiento_id,
        "fecha": ahora,
        "columnas": len(columnas),
        "columnasPorGrupo": por_grupo,
    }
    updates["ubicaciones/sectores"] = None     # de la versión anterior (zonas con sectores)

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
