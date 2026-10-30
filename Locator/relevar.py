"""
relevar.py — Programa principal del relevamiento semanal del depósito.

Idea: el depósito se divide en GRUPOS fijos (FL, FR, BL, BR, OT) y cada
grupo en COLUMNAS (1, 2, 3...). En la app LocatorPic se arma una
cuadrícula por grupo: cada foto puesta a la derecha de otra es una columna
nueva, y las que van debajo son otros estantes de la misma columna.
La ubicación de cada producto es "FL · Columna 3".

Uso (desde una consola, en la carpeta Locator):
    python relevar.py                 baja el último recorrido terminado en la
                                      app LocatorPic y lo analiza (lo normal)
    python relevar.py "C:\\Fotos\\x"    analiza una carpeta de fotos cualquiera
                                      (cada foto = una columna del grupo OT)

Opciones:
    --orden nombre    ordena las fotos por nombre de archivo
                      (por defecto: por la fecha en que se sacaron)
    --sin-guardar     analiza y arma el informe, pero no toca Firebase
    --si              guarda en Firebase sin preguntar
    --forzar          guarda aunque haya fotos que no se pudieron analizar
    --modelo NOMBRE   modelo de Claude (ej. sonnet, opus, claude-sonnet-5-5).
                      Si no se indica, al empezar se muestra la lista de
                      modelos vigentes y se propone el último usado.
    --lote N          cuántas imágenes se mandan juntas a Claude (por defecto 6)
    --sin-segunda-mirada   no vuelve a mirar las etiquetas en duda

Qué hace, paso a paso:
    1. Lee la configuración (.env), la planilla de precios y, si puede,
       las ubicaciones anteriores de Firebase.
    2. Lee las columnas del recorrido; cada foto se manda entera.
    3. Le pasa las imágenes a Claude Code, de a lotes, para leer los precios.
       Lo ya analizado se guarda en <carpeta>\\.locator\\analisis.json:
       si el programa se corta, al volver a ejecutarlo sigue donde quedó.
    4. Junta las fotos de cada columna (una etiqueta repetida entre dos
       fotos seguidas cuenta una vez) e identifica los productos por
       código, precio y nombre impreso en la etiqueta.
    5. Segunda mirada: las etiquetas en duda se recortan y Claude elige
       entre los productos posibles viendo el producto.
    6. Lo que siga en duda se desempata por la categoría de los vecinos y
       por dónde estaba cada producto la semana anterior.
    7. Arma el informe y pregunta si guardar en Firebase.
"""

import argparse
import json
import logging
import os
import sys
import threading
import webbrowser
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

import fotos as modulo_fotos
import informe
import modelos
import segunda_mirada
import unir_columna
from identificar import desempatar, identificar_todo
from lector_claude import LimiteDeUso, analizar_lote
from planilla import Planilla

AQUI = Path(__file__).resolve().parent
EN_PARALELO = 2          # lotes que se analizan al mismo tiempo
VERSION_CACHE = "c2"     # si cambia la forma de analizar, se ignora lo guardado antes

log = logging.getLogger("locator")


# ---------------------------------------------------------------------
# Preparación
# ---------------------------------------------------------------------

def configurar_log(relevamiento_id):
    """Muestra mensajes en pantalla y los guarda en logs\\<id>.log."""
    carpeta = AQUI / "logs"
    carpeta.mkdir(exist_ok=True)
    formato = logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S")
    archivo = logging.FileHandler(carpeta / f"{relevamiento_id}.log", encoding="utf-8")
    archivo.setFormatter(formato)
    pantalla = logging.StreamHandler(sys.stdout)
    pantalla.setFormatter(formato)
    log.addHandler(archivo)
    log.addHandler(pantalla)
    log.setLevel(logging.INFO)


def leer_configuracion():
    """Lee los datos del archivo .env (las claves nunca están escritas en el código)."""
    load_dotenv(AQUI / ".env")
    faltan = [v for v in ("SPREADSHEET_ID", "FIREBASE_DB_URL", "FIREBASE_CREDENCIALES") if not os.getenv(v)]
    if faltan:
        sys.exit("Faltan datos en el archivo .env: " + ", ".join(faltan) +
                 "\nCopiá 'config.ejemplo.env' como '.env' y completalo (ver LEEME.md).")
    cfg = {v: os.getenv(v) for v in ("SPREADSHEET_ID", "FIREBASE_DB_URL", "FIREBASE_CREDENCIALES", "CLAUDE_MODELO")}
    cfg["FIREBASE_BUCKET"] = os.getenv("FIREBASE_BUCKET") or "pedidos-87064.firebasestorage.app"
    cfg["RELEVAMIENTO_CARPETA"] = os.getenv("RELEVAMIENTO_CARPETA") or r"C:\HomePoint\Relevamiento\actual"
    return cfg


def conectar_firebase(cfg):
    import guardar_firebase
    guardar_firebase.conectar(cfg["FIREBASE_CREDENCIALES"], cfg["FIREBASE_DB_URL"], cfg["FIREBASE_BUCKET"])
    return guardar_firebase


def leer_firebase(cfg):
    """Ubicaciones y último relevamiento guardados. Si no se puede, sigue sin eso."""
    if not Path(cfg["FIREBASE_CREDENCIALES"]).is_file():
        log.warning("No encuentro la credencial de Firebase (%s): se sigue sin los datos anteriores.",
                    cfg["FIREBASE_CREDENCIALES"])
        return {}, {}
    try:
        guardar_firebase = conectar_firebase(cfg)
        return guardar_firebase.leer_mapa(), guardar_firebase.leer_ultimo()
    except Exception as e:
        log.warning("No se pudieron leer los datos anteriores de Firebase: %s", e)
        return {}, {}


# ---------------------------------------------------------------------
# Análisis con Claude (con memoria para poder retomar)
# ---------------------------------------------------------------------

def analizar_fotos(lista_columnas, carpeta_trabajo, modelo, tam_lote, lado):
    """Lee las etiquetas de cada foto de cada columna y las junta: llena
    columna["analisis"] (o columna["error"] si alguna foto no se pudo leer).
    Devuelve True si terminó, False si se cortó por el límite de uso de la
    suscripción."""
    ruta_cache = carpeta_trabajo / "analisis.json"
    cache = json.loads(ruta_cache.read_text("utf-8")) if ruta_cache.exists() else {}
    candado = threading.Lock()

    imagenes = carpeta_trabajo / "imagenes"
    imagenes.mkdir(exist_ok=True)
    pendientes = []
    total = 0
    for c in lista_columnas:
        for f in c["fotos"]:
            total += 1
            clave = f"{VERSION_CACHE}|{modulo_fotos.clave_de_cache(f['ruta'])}"
            if clave in cache:
                f["analisis"] = cache[clave]
                continue
            nombre = modulo_fotos.preparar_imagen(
                f["ruta"], imagenes, f"{c['grupo']}-C{c['columna']:02d}-{f['parte']}.jpg", lado)
            pendientes.append({"columna": c, "foto": f, "archivo": nombre, "clave": clave})

    hechas = total - len(pendientes)
    if hechas:
        log.info("%d foto(s) ya estaban analizadas de antes.", hechas)

    lotes = [pendientes[i:i + tam_lote] for i in range(0, len(pendientes), tam_lote)]
    limite = threading.Event()

    def procesar(lote, reintentar_solas=True):
        if limite.is_set():
            return
        nombres = [p["archivo"] for p in lote]
        try:
            resultado = analizar_lote(imagenes, nombres, modelo)
        except LimiteDeUso as e:
            limite.set()
            log.error("Se alcanzó el límite de uso de la suscripción: %s", e)
            return
        except Exception as e:   # cualquier otra falla queda registrada y se sigue con el resto
            resultado = {}
            log.error("  Lote %s falló: %s", ", ".join(nombres), e)

        faltantes = []
        with candado:
            for p in lote:
                if p["archivo"] in resultado:
                    p["foto"]["analisis"] = resultado[p["archivo"]]
                    cache[p["clave"]] = resultado[p["archivo"]]
                else:
                    faltantes.append(p)
            ruta_cache.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")

        # Las que no vinieron en el lote se prueban de a una. (Las que sigan
        # sin venir las marca juntar_columnas.)
        if faltantes and reintentar_solas and len(lote) > 1:
            for p in faltantes:
                procesar([p], reintentar_solas=False)

    def etiquetas_de(p):
        a = p["foto"].get("analisis")
        return len(a["etiquetas"]) if a else None

    if pendientes:
        with ThreadPoolExecutor(max_workers=EN_PARALELO) as ejecutor:
            trabajos = {ejecutor.submit(procesar, lote): lote for lote in lotes}
            for t in as_completed(trabajos):
                t.result()
                hechas += len(trabajos[t])
                detalle = "  ".join(f"{p['columna']['nombre']} {p['foto']['parte']}: {etiquetas_de(p)}"
                                    for p in trabajos[t] if etiquetas_de(p) is not None)
                log.info("[%d/%d] etiquetas -> %s", hechas, total, detalle or "sin resultado")

    if limite.is_set():
        return False
    juntar_columnas(lista_columnas)
    return True


def juntar_columnas(lista_columnas):
    """Junta las etiquetas de las fotos de cada columna en un solo análisis."""
    for c in lista_columnas:
        sin_leer = [f["parte"] for f in c["fotos"] if not f.get("analisis")]
        if sin_leer:
            c["error"] = "Claude no devolvió " + ("la foto " if len(sin_leer) == 1 else "las fotos ") + ", ".join(sin_leer)
            continue
        c.pop("error", None)
        c["analisis"] = unir_columna.lecturas_de_columna(c["fotos"])


def aviso_de_cambios(lista_columnas, ultimo):
    """Si un grupo tiene otra cantidad de columnas que en el relevamiento
    anterior, los números de columna pueden haberse corrido."""
    antes = ultimo.get("columnasPorGrupo") or {}
    if not antes:
        return None
    ahora = {}
    for c in lista_columnas:
        ahora[c["grupo"]] = ahora.get(c["grupo"], 0) + 1
    distintos = [f"{g}: {antes.get(g, 0)} → {ahora.get(g, 0)}"
                 for g in modulo_fotos.GRUPOS if antes.get(g, 0) != ahora.get(g, 0)]
    if not distintos:
        return None
    return ("Cambió la cantidad de columnas respecto del relevamiento anterior (" + ", ".join(distintos) +
            "). Los números de columna de esos grupos pueden haberse corrido: revisá la hoja de columnas del informe.")


# ---------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Relevamiento semanal del depósito (grupos y columnas) a partir de fotos.")
    p.add_argument("carpeta", nargs="?",
                   help="carpeta con las fotos del recorrido (sin carpeta: baja el último de LocatorPic)")
    p.add_argument("--orden", choices=["fecha", "nombre"], default="fecha", help="cómo ordenar las fotos")
    p.add_argument("--sin-guardar", action="store_true", help="no guardar en Firebase")
    p.add_argument("--si", action="store_true", help="guardar sin preguntar")
    p.add_argument("--forzar", action="store_true", help="guardar aunque haya fotos sin analizar")
    p.add_argument("--modelo", help="modelo de Claude (sonnet, opus...)")
    p.add_argument("--lote", type=int, default=6, help="imágenes por consulta a Claude (1 a 10)")
    p.add_argument("--sin-segunda-mirada", action="store_true", help="no revisar de nuevo las etiquetas en duda")
    args = p.parse_args()

    relevamiento_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    configurar_log(relevamiento_id)
    cfg = leer_configuracion()
    # Modelo: el de --modelo, o el que se elija en la lista (propone el último usado).
    elegido = modelos.elegir(forzado=args.modelo, preguntar=not args.si and sys.stdin.isatty(),
                             env=cfg.get("CLAUDE_MODELO"))
    modelos.recordar(elegido)
    modelo = elegido["id"] if elegido else None
    nombre_modelo = elegido["nombre"] if elegido else "el elegido en Claude Code"
    lado = elegido["lado"] if elegido else max([m["lado"] for m in modelos.leer_catalogo()]
                                                 or [modelos.LADO_IMAGEN_POR_DEFECTO])
    # Se revisa antes de leer las fotos, para no enterarse recién al final.
    hay_credencial = Path(cfg["FIREBASE_CREDENCIALES"]).is_file()
    if (not args.sin_guardar or not args.carpeta) and not hay_credencial:
        sys.exit(f"No encuentro la credencial de Firebase:\n  {cfg['FIREBASE_CREDENCIALES']}\n"
                 "Revisá en el archivo .env que FIREBASE_CREDENCIALES tenga la ruta y el nombre exactos "
                 "del archivo .json (o usá --sin-guardar con una carpeta para probar sin Firebase).")

    # 0) Sin carpeta: se baja el último recorrido terminado en LocatorPic.
    if args.carpeta:
        carpeta = Path(args.carpeta).expanduser().resolve()
    else:
        import descargar
        conectar_firebase(cfg)
        log.info("Buscando el último recorrido de LocatorPic...")
        carpeta = descargar.obtener_ultimo(Path(cfg["RELEVAMIENTO_CARPETA"]), cfg["FIREBASE_BUCKET"])
        if carpeta is None:
            sys.exit(1)
    if not carpeta.is_dir():
        sys.exit(f"No existe la carpeta: {carpeta}")
    manifiesto = (json.loads((carpeta / "sesion.json").read_text("utf-8"))
                  if (carpeta / "sesion.json").is_file() else {})
    sesion_locatorpic = manifiesto.get("sesionId")

    # 1) Planilla y datos anteriores
    log.info("Leyendo la planilla de precios...")
    planilla = Planilla().cargar(cfg["SPREADSHEET_ID"])
    log.info("  %d productos, %d precios repetidos.", len(planilla.por_codigo), len(planilla.precios_repetidos))
    mapa_anterior, ultimo = leer_firebase(cfg)
    if mapa_anterior:
        log.info("  %d productos ubicados en el relevamiento anterior.", len(mapa_anterior))

    # 2) Columnas del recorrido (grupo FL, FR, BL, BR, OT y número de columna)
    columnas, ignoradas = modulo_fotos.leer_recorrido(carpeta, args.orden)
    if ignoradas:
        log.warning("Se ignoran %d foto(s) HEIC (configurá la cámara en JPG): %s", len(ignoradas), ", ".join(ignoradas))
    if not columnas:
        sys.exit("No hay fotos JPG/PNG en la carpeta.")
    lista_fotos = []
    for i, c in enumerate(columnas):
        lista_fotos.append({
            "indice": i,
            "zona": i + 1,     # posición en todo el recorrido (para buscar columnas vecinas)
            "grupo": c["grupo"],
            "columna": c["columna"],
            "nombre": f"{c['grupo']} · Columna {c['columna']}",
            "ruta": c["fotos"][0],
            "fotos": [{"ruta": r, "parte": f"E{e}"} for e, r in enumerate(c["fotos"], 1)],
        })
    por_grupo = {}
    for c in lista_fotos:
        por_grupo[c["grupo"]] = por_grupo.get(c["grupo"], 0) + 1
    log.info("%d columnas, %d fotos (%s)%s.", len(lista_fotos), sum(len(c["fotos"]) for c in lista_fotos),
             " · ".join(f"{g}: {n}" for g, n in por_grupo.items()),
             "" if sesion_locatorpic else f" (fotos sueltas, orden: {args.orden})")
    aviso_recorrido = aviso_de_cambios(lista_fotos, ultimo)
    if aviso_recorrido:
        log.warning(aviso_recorrido)

    # 3) Claude
    trabajo = carpeta / ".locator"
    trabajo.mkdir(exist_ok=True)
    log.info("Leyendo precios con Claude Code (modelo: %s, fotos de hasta %d px)...", nombre_modelo, lado)
    if not analizar_fotos(lista_fotos, trabajo, modelo, max(1, min(args.lote, 10)), lado):
        log.error("El análisis quedó a medias por el límite de uso. Lo ya analizado está guardado: "
                  "volvé a ejecutar el mismo comando más tarde y sigue desde ahí.")
        sys.exit(2)

    # 4) Identificación: lo que dice cada etiqueta...
    lecturas = identificar_todo(lista_fotos, planilla)
    # ...segunda mirada a las que quedaron en duda...
    if not args.sin_segunda_mirada:
        resueltas = segunda_mirada.revisar(lecturas, planilla, trabajo, modelo)
        if resueltas:
            log.info("Segunda mirada: %d etiqueta(s) resueltas.", resueltas)
    # ...y lo que siga en duda, por los vecinos y la semana anterior.
    desempatar(lecturas, planilla, mapa_anterior)
    resumen = informe.calcular_resumen(lista_fotos, lecturas, planilla)

    # 5) Informe y resultados
    for nombre in ("informes", "resultados"):
        (AQUI / nombre).mkdir(exist_ok=True)
    ruta_informe = AQUI / "informes" / f"informe-{relevamiento_id}.html"
    ruta_informe.write_text(informe.generar_html(relevamiento_id, lista_fotos, lecturas, resumen,
                                                 nombre_modelo, aviso_recorrido), "utf-8")
    (AQUI / "resultados" / f"resultado-{relevamiento_id}.json").write_text(json.dumps({
        "relevamientoId": relevamiento_id, "carpeta": str(carpeta), "resumen": resumen,
        "columnas": [{k: v for k, v in f.items() if k not in ("ruta", "tira")} for f in lista_fotos],
        "lecturas": lecturas,
    }, ensure_ascii=False, indent=1, default=str), "utf-8")
    webbrowser.open(ruta_informe.as_uri())

    r = resumen
    log.info("-" * 60)
    log.info("Precios leídos: %d (%s con confianza alta)", r["preciosLeidos"],
             f"{round(r['confianzaAlta'] * 100 / r['preciosLeidos'])}%" if r["preciosLeidos"] else "—")
    log.info("Identificados: %d (%d gracias a la categoría vecina) · Ambiguos: %d · No encontrados: %d · Ilegibles: %d",
             r["identificados"], r["porCategoria"], r["ambiguos"], r["noEncontrados"], r["ilegibles"])
    log.info("Productos distintos ubicados: %d · Columnas con error: %d", r["productosUbicados"], r["fotosConError"])
    log.info("Informe: %s", ruta_informe)

    # 6) Firebase
    if args.sin_guardar:
        log.info("No se guardó en Firebase (--sin-guardar).")
        return
    if r["fotosConError"] and not args.forzar:
        # Si se guardara igual, los productos de esas columnas quedarían como
        # "posiblemente movidos" sin serlo.
        log.error("Hay %d columna(s) sin analizar: no se guarda. Volvé a ejecutar el mismo comando "
                  "(reintenta solo esas) o usá --forzar.", r["fotosConError"])
        sys.exit(3)
    if not args.si:
        respuesta = input("\n¿Guardar estas ubicaciones en Firebase? (s/n): ").strip().lower()
        if respuesta not in ("s", "si", "sí"):
            log.info("No se guardó en Firebase.")
            return

    try:
        guardar_firebase = conectar_firebase(cfg)
        cambios = guardar_firebase.guardar(relevamiento_id, lista_fotos, lecturas, resumen, modelo=nombre_modelo,
                                           sesion_locatorpic=sesion_locatorpic)
    except Exception as e:
        log.error("No se pudo guardar en Firebase: %s", e)
        log.error("Lo analizado no se pierde: corregí el problema y volvé a ejecutar relevar.bat "
                  "(no vuelve a consultar a Claude).")
        sys.exit(4)
    log.info("Guardado en Firebase: %d productos ubicados, %d cambiaron de lugar, %d marcados como posiblemente movidos.",
             cambios["productos_ubicados"], cambios["cambios_de_lugar"], cambios["marcados_movidos"])
    if sesion_locatorpic:
        log.info("La app LocatorPic ya muestra este recorrido como analizado.")


if __name__ == "__main__":
    main()
