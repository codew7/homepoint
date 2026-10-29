"""
relevar.py — Programa principal del relevamiento semanal del depósito.

Idea: se recorre el depósito SIEMPRE en el mismo orden sacando una foto
por tramo de estantería (dos columnas de mercadería por foto). El orden de
las fotos es la ubicación:
    foto 1 = zona 1, foto 2 = zona 2, ...
y cada zona tiene columna izquierda (I) y derecha (D).

Uso (desde una consola, en la carpeta Locator):
    python relevar.py                 baja el último recorrido terminado en la
                                      app LocatorPic y lo analiza (lo normal)
    python relevar.py "C:\\Fotos\\x"    analiza una carpeta de fotos cualquiera

Opciones:
    --orden nombre    ordena las fotos por nombre de archivo
                      (por defecto: por la fecha en que se sacaron)
    --sin-guardar     analiza y arma el informe, pero no toca Firebase
    --si              guarda en Firebase sin preguntar
    --forzar          guarda aunque haya fotos que no se pudieron analizar
    --modelo NOMBRE   modelo de Claude (ej. sonnet, opus). Si no se indica,
                      usa el que tengas elegido en Claude Code.
    --lote N          cuántas imágenes se mandan juntas a Claude (por defecto 6)

Qué hace, paso a paso:
    1. Lee la configuración (.env), la planilla de precios y, si puede,
       las ubicaciones anteriores de Firebase.
    2. Ordena las fotos y corta cada una en columna izquierda y derecha.
    3. Le pasa las columnas a Claude Code, de a lotes, para leer los precios.
       Lo ya analizado se guarda en <carpeta>\\.locator\\analisis.json:
       si el programa se corta, al volver a ejecutarlo sigue donde quedó.
    4. Identifica los productos por precio (y por categoría si hay empate).
    5. Arma el informe y pregunta si guardar en Firebase.
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
from identificar import identificar_todo
from lector_claude import LimiteDeUso, analizar_lote
from planilla import Planilla

AQUI = Path(__file__).resolve().parent
EN_PARALELO = 2          # lotes que se analizan al mismo tiempo
VERSION_CACHE = "v2"     # si cambia la forma de analizar, se ignora lo guardado antes

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

def analizar_fotos(lista_fotos, carpeta_trabajo, modelo, tam_lote):
    """Llena foto["columnas"] = {"I": analisis, "D": analisis} en cada foto
    (o foto["error"] si no se pudo). Devuelve True si terminó, False si se
    cortó por el límite de uso de la suscripción."""
    ruta_cache = carpeta_trabajo / "analisis.json"
    cache = json.loads(ruta_cache.read_text("utf-8")) if ruta_cache.exists() else {}
    candado = threading.Lock()

    # Cada foto se parte en dos imágenes: una "parte" por columna.
    imagenes = carpeta_trabajo / "columnas"
    imagenes.mkdir(exist_ok=True)
    pendientes = []
    for f in lista_fotos:
        f["columnas"] = {}
        claves = {col: f"{VERSION_CACHE}|{f['clave']}|{col}" for col in modulo_fotos.COLUMNAS}
        if all(c in cache for c in claves.values()):
            f["columnas"] = {col: cache[c] for col, c in claves.items()}
            continue
        archivos = modulo_fotos.partir_en_columnas(f["ruta"], imagenes, f"{f['zona']:03d}")
        for col, nombre in archivos.items():
            if claves[col] in cache:
                f["columnas"][col] = cache[claves[col]]
            else:
                pendientes.append({"foto": f, "columna": col, "archivo": nombre, "clave": claves[col]})

    total = len(lista_fotos) * 2
    hechas = total - len(pendientes)
    if hechas:
        log.info("%d columna(s) ya estaban analizadas de antes.", hechas)
    if not pendientes:
        return True

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
                    p["foto"]["columnas"][p["columna"]] = resultado[p["archivo"]]
                    cache[p["clave"]] = resultado[p["archivo"]]
                else:
                    faltantes.append(p)
            ruta_cache.write_text(json.dumps(cache, ensure_ascii=False), "utf-8")

        # Las que no vinieron en el lote se prueban de a una.
        if faltantes and reintentar_solas and len(lote) > 1:
            for p in faltantes:
                procesar([p], reintentar_solas=False)
        else:
            for p in faltantes:
                p["foto"]["error"] = f"Claude no devolvió la columna {p['columna']}"

    with ThreadPoolExecutor(max_workers=EN_PARALELO) as ejecutor:
        trabajos = {ejecutor.submit(procesar, lote): lote for lote in lotes}
        for t in as_completed(trabajos):
            t.result()
            hechas += len(trabajos[t])
            detalle = "  ".join(
                f"zona {p['foto']['zona']}{p['columna']}: {len(p['foto']['columnas'][p['columna']]['etiquetas'])}"
                for p in trabajos[t] if p["columna"] in p["foto"]["columnas"])
            log.info("[%d/%d] etiquetas -> %s", hechas, total, detalle or "sin resultado")

    return not limite.is_set()


# ---------------------------------------------------------------------
# Programa principal
# ---------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="Relevamiento semanal de zonas del depósito a partir de fotos.")
    p.add_argument("carpeta", nargs="?",
                   help="carpeta con las fotos del recorrido (sin carpeta: baja el último de LocatorPic)")
    p.add_argument("--orden", choices=["fecha", "nombre"], default="fecha", help="cómo ordenar las fotos")
    p.add_argument("--sin-guardar", action="store_true", help="no guardar en Firebase")
    p.add_argument("--si", action="store_true", help="guardar sin preguntar")
    p.add_argument("--forzar", action="store_true", help="guardar aunque haya fotos sin analizar")
    p.add_argument("--modelo", help="modelo de Claude (sonnet, opus...)")
    p.add_argument("--lote", type=int, default=6, help="imágenes por consulta a Claude (1 a 10)")
    args = p.parse_args()

    relevamiento_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    configurar_log(relevamiento_id)
    cfg = leer_configuracion()
    modelo = args.modelo or cfg.get("CLAUDE_MODELO") or None
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

    # 2) Fotos: cada una es una zona, en el orden del recorrido
    rutas, ignoradas = modulo_fotos.buscar_fotos(carpeta, args.orden)
    if ignoradas:
        log.warning("Se ignoran %d foto(s) HEIC (configurá la cámara en JPG): %s", len(ignoradas), ", ".join(ignoradas))
    if not rutas:
        sys.exit("No hay fotos JPG/PNG en la carpeta.")
    lista_fotos = [{"indice": i, "zona": i + 1, "ruta": r, "nombre": r.name,
                    "clave": modulo_fotos.clave_de_cache(r)} for i, r in enumerate(rutas)]
    log.info("%d fotos = %d zonas (orden: %s): de %s a %s.", len(rutas), len(rutas),
             "el de la app LocatorPic" if sesion_locatorpic else args.orden, rutas[0].name, rutas[-1].name)
    aviso_recorrido = None
    if ultimo.get("fotos") and ultimo["fotos"] != len(rutas):
        aviso_recorrido = (f"El relevamiento anterior tuvo {ultimo['fotos']} fotos y este tiene {len(rutas)}: "
                           "los números de zona pueden haberse corrido. Revisá la hoja de zonas del informe.")
        log.warning(aviso_recorrido)

    # 3) Claude
    trabajo = carpeta / ".locator"
    trabajo.mkdir(exist_ok=True)
    log.info("Leyendo precios con Claude Code (modelo: %s)...", modelo or "el elegido en Claude Code")
    if not analizar_fotos(lista_fotos, trabajo, modelo, max(1, min(args.lote, 10))):
        log.error("El análisis quedó a medias por el límite de uso. Lo ya analizado está guardado: "
                  "volvé a ejecutar el mismo comando más tarde y sigue desde ahí.")
        sys.exit(2)

    # 4) Identificación
    lecturas = identificar_todo(lista_fotos, planilla, mapa_anterior)
    resumen = informe.calcular_resumen(lista_fotos, lecturas, planilla)

    # 5) Informe y resultados
    for nombre in ("informes", "resultados"):
        (AQUI / nombre).mkdir(exist_ok=True)
    ruta_informe = AQUI / "informes" / f"informe-{relevamiento_id}.html"
    ruta_informe.write_text(informe.generar_html(relevamiento_id, lista_fotos, lecturas, resumen,
                                                 modelo, aviso_recorrido), "utf-8")
    (AQUI / "resultados" / f"resultado-{relevamiento_id}.json").write_text(json.dumps({
        "relevamientoId": relevamiento_id, "carpeta": str(carpeta), "resumen": resumen,
        "fotos": [{k: v for k, v in f.items() if k != "ruta"} for f in lista_fotos],
        "lecturas": lecturas,
    }, ensure_ascii=False, indent=1, default=str), "utf-8")
    webbrowser.open(ruta_informe.as_uri())

    r = resumen
    log.info("-" * 60)
    log.info("Precios leídos: %d (%s con confianza alta)", r["preciosLeidos"],
             f"{round(r['confianzaAlta'] * 100 / r['preciosLeidos'])}%" if r["preciosLeidos"] else "—")
    log.info("Identificados: %d (%d gracias a la categoría vecina) · Ambiguos: %d · No encontrados: %d · Ilegibles: %d",
             r["identificados"], r["porCategoria"], r["ambiguos"], r["noEncontrados"], r["ilegibles"])
    log.info("Productos distintos ubicados: %d · Fotos con error: %d", r["productosUbicados"], r["fotosConError"])
    log.info("Informe: %s", ruta_informe)

    # 6) Firebase
    if args.sin_guardar:
        log.info("No se guardó en Firebase (--sin-guardar).")
        return
    if r["fotosConError"] and not args.forzar:
        # Si se guardara igual, los productos de esas fotos quedarían como
        # "posiblemente movidos" sin serlo.
        log.error("Hay %d foto(s) sin analizar: no se guarda. Volvé a ejecutar el mismo comando "
                  "(reintenta solo esas) o usá --forzar.", r["fotosConError"])
        sys.exit(3)
    if not args.si:
        respuesta = input("\n¿Guardar estas ubicaciones en Firebase? (s/n): ").strip().lower()
        if respuesta not in ("s", "si", "sí"):
            log.info("No se guardó en Firebase.")
            return

    try:
        guardar_firebase = conectar_firebase(cfg)
        cambios = guardar_firebase.guardar(relevamiento_id, lista_fotos, lecturas, resumen, modelo=modelo,
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
