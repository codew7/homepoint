"""
informe.py — Arma el resumen del relevamiento y el informe en HTML.

El informe incluye una "hoja de zonas": la miniatura de cada foto con su
número de zona y cuántos productos se ubicaron en cada columna. Sirve para
saber a qué estantería corresponde cada número. Las zonas de tomas
cercanas muestran el rompecabezas armado y, si hay sectores con nombre,
la hoja se agrupa por sector.
"""

from collections import Counter, defaultdict
from datetime import datetime
from html import escape

from fotos import miniatura_base64

NOMBRE_COLUMNA = {"I": "izquierda", "D": "derecha"}


def texto_lugar(zona, columna, estante=None):
    return f"Zona {zona} · {NOMBRE_COLUMNA.get(columna, columna)}" + (f" · estante {estante}" if estante else "")


def calcular_resumen(fotos, lecturas, planilla):
    con_precio = [l for l in lecturas if l["estado"] != "ilegible"]
    precios_vistos = {l["etiqueta"]["precio"] for l in con_precio}
    repetidos = planilla.precios_repetidos
    contar = lambda estado: sum(1 for l in lecturas if l["estado"] == estado)
    return {
        "fotos": len(fotos),
        "fotosConError": sum(1 for f in fotos if len(f.get("columnas") or {}) < 2),
        "etiquetas": len(lecturas),
        "preciosLeidos": len(con_precio),
        "confianzaAlta": sum(1 for l in con_precio if l["etiqueta"]["confianza"] == "alta"),
        "identificados": contar("identificado"),
        "porCategoria": sum(1 for l in lecturas if l["metodo"] == "precio + categoría vecina"),
        "ambiguos": contar("ambiguo"),
        "noEncontrados": contar("no_encontrado"),
        "ilegibles": contar("ilegible"),
        "productosUbicados": len({l["producto"]["codigo"] for l in lecturas if l["estado"] == "identificado"}),
        "preciosRepetidosPlanilla": len(repetidos),
        "productosConPrecioRepetido": sum(len(v) for v in repetidos.values()),
        "preciosRepetidosVistos": len(precios_vistos & set(repetidos)),
    }


CONSEJOS = {
    "borrosa": "Fotos borrosas: tocá la pantalla sobre las etiquetas para enfocar y esperá un segundo antes de disparar. Sostené el equipo con las dos manos.",
    "movida": "Fotos movidas: quedate quieto al disparar. Con poca luz el equipo tarda más y cualquier movimiento se nota.",
    "reflejo": "Reflejos: no saques la foto de frente. Inclinala un poco hacia arriba o hacia un costado y apagá el flash si rebota en las etiquetas.",
    "oscura": "Fotos oscuras: prendé todas las luces del pasillo o usá la linterna desde un costado, no de frente.",
    "lejos": "Etiquetas muy chicas: acercate un paso. Las dos columnas tienen que ocupar toda la foto, sin piso ni techo de más.",
    "tapada": "Etiquetas tapadas: si un producto tapa su etiqueta, correlo un poco antes de la foto.",
    "cortada": "Etiquetas cortadas por el borde: encuadrá dejando un poco de margen a los costados de las dos columnas.",
}


def recomendaciones(fotos, r):
    cuenta = Counter(p for f in fotos for a in (f.get("columnas") or {}).values() for p in set(a["problemas"]))
    lista = [f"{CONSEJOS[p]} ({n} columna{'s' if n > 1 else ''})"
             for p, n in cuenta.most_common() if p in CONSEJOS]
    if r["noEncontrados"]:
        lista.append(f"Hubo {r['noEncontrados']} precio(s) que no están en la planilla. Puede ser una lectura "
                     "equivocada o una etiqueta con precio viejo: conviene reimprimir esas etiquetas.")
    if r["ambiguos"]:
        lista.append(f"Hubo {r['ambiguos']} etiqueta(s) con un precio que comparten varios productos y no se "
                     "pudieron desempatar. Que el nombre de la etiqueta se vea entero ayuda.")
    return lista or ["No se detectaron problemas en las fotos."]


def _pct(a, b):
    return f"{round(a * 100 / b)}%" if b else "—"


ESTILOS = """
body{font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#f5f5f3;color:#1c1c1c;margin:0}
main{max-width:1100px;margin:0 auto;padding:16px}
section{background:#fff;border:1px solid #e2e2e2;border-radius:10px;padding:16px;margin-bottom:14px}
h1{font-size:20px;margin:0}.sub{color:#6b6b6b;font-size:13px;margin:4px 0 0}
h2{font-size:16px;margin:0 0 8px}
.aviso{background:#fff4d6;border-color:#e8c766}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.kpis div{border:1px solid #e2e2e2;border-radius:8px;padding:10px;text-align:center}
.kpis b{display:block;font-size:24px}.kpis span{font-size:12px;color:#6b6b6b}
li{margin-bottom:6px}
.grilla{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
figure{margin:0;border:1px solid #e2e2e2;border-radius:8px;padding:6px;font-size:12px;position:relative}
figure img{width:100%;border-radius:4px;display:block}
figure .num{position:absolute;top:10px;left:10px;background:#1c1c1c;color:#fff;font-weight:700;
  font-size:16px;border-radius:6px;padding:2px 8px}
figure.error{border-color:#c0392b}
figure.ancho{grid-column:span 2}
.sector{grid-column:1/-1;margin:10px 0 0;font-size:15px;border-bottom:2px solid #e67e22;padding-bottom:4px}
.sector small{color:#6b6b6b;font-weight:400}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid #e2e2e2;padding:6px;text-align:left;vertical-align:top}th{background:#fafafa}
.identificado{color:#1f8a4c;font-weight:600}.ambiguo{color:#c48a00;font-weight:600}
.no_encontrado,.ilegible{color:#c0392b;font-weight:600}
@media print{section{break-inside:avoid}}
"""


def generar_html(relevamiento_id, fotos, lecturas, resumen, modelo, aviso_recorrido=None, sectores=None):
    r = resumen
    fecha = datetime.now().strftime("%d/%m/%Y %H:%M")

    # Productos identificados por zona y columna (para la hoja de zonas).
    por_lugar = defaultdict(set)
    for l in lecturas:
        if l["estado"] == "identificado":
            por_lugar[(l["zona"], l["columna"])].add(l["producto"]["codigo"])

    # Hoja de zonas + fotos con problemas.
    inicio_sector = {s["desde"]: s for s in (sectores or [])}
    hoja, problemas = [], []
    for f in fotos:
        if f["zona"] in inicio_sector:
            s = inicio_sector[f["zona"]]
            hoja.append(f"<h3 class='sector'>{escape(s['nombre'])} <small>· zonas {s['desde']}–{s['hasta']}</small></h3>")
        try:
            img = f'<img src="{f.get("mosaico") or miniatura_base64(f["ruta"])}" alt="">'
        except Exception:
            img = ""
        cols = f.get("columnas") or {}
        clases = (["error"] if len(cols) < 2 else []) + (["ancho"] if f.get("tomas") else [])
        clase = f" class='{' '.join(clases)}'" if clases else ""
        extra = ""
        if f.get("tomas"):
            extra = f"<br>{sum(len(x) for x in f['tomas'])} tomas en {len(f['tomas'])} estante(s)"
            if f.get("uniones_dudosas"):
                extra += f" · <b style='color:#c0392b'>{f['uniones_dudosas']} unión(es) dudosa(s)</b> (en rojo)"
        hoja.append(
            f"<figure{clase}>{img}<span class='num'>{f['zona']}</span><figcaption>"
            f"{escape(f['nombre'])}<br>izq: {len(por_lugar[(f['zona'], 'I')])} · "
            f"der: {len(por_lugar[(f['zona'], 'D')])} productos{extra}</figcaption></figure>")

        motivos = [f"{NOMBRE_COLUMNA[c]}: " + ", ".join(a["problemas"]) + (f" — {a['comentario']}" if a["comentario"] else "")
                   for c, a in cols.items() if a["problemas"] or a["comentario"]]
        if f.get("error"):
            motivos.insert(0, f["error"])
        if motivos:
            problemas.append(f"<figure>{img}<span class='num'>{f['zona']}</span><figcaption><b>{escape(f['nombre'])}</b><br>"
                             + "<br>".join(escape(m) for m in motivos) + "</figcaption></figure>")

    # Detalle de lecturas.
    filas = []
    for l in lecturas:
        if l["producto"]:
            producto = escape(f"{l['producto']['codigo']} · {l['producto']['nombre']}")
            if l["metodo"] == "precio + categoría vecina":
                producto += f"<br><small>por categoría: {escape(l['producto']['categoria'])}</small>"
        elif l["estado"] == "ambiguo":
            producto = "<small>" + "<br>".join(escape(f"{c['codigo']} · {c['nombre']}") for c in l["candidatos"]) + "</small>"
        else:
            producto = ""
        filas.append(
            f"<tr><td>{escape(texto_lugar(l['zona'], l['columna'], l.get('estante')))}</td><td>{escape(l['foto'])}</td>"
            f"<td>{escape(l['etiqueta']['precio_texto'])}</td><td>{l['etiqueta']['confianza']}</td>"
            f"<td class='{l['estado']}'>{l['estado'].replace('_', ' ')}</td>"
            f"<td>{producto}</td><td><small>{escape(l['etiqueta']['texto_apoyo'])}</small></td></tr>")

    consejos = "".join(f"<li>{escape(c)}</li>" for c in recomendaciones(fotos, r))
    aviso = f'<section class="aviso"><b>Atención:</b> {escape(aviso_recorrido)}</section>' if aviso_recorrido else ""

    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe de relevamiento</title><style>{ESTILOS}</style></head><body><main>
<section><h1>Informe del relevamiento</h1>
<p class="sub">{fecha} · {r['fotos']} fotos = {r['fotos']} zonas · relevamiento {escape(relevamiento_id)} · modelo {escape(modelo or 'predeterminado')}</p></section>
{aviso}
<section><div class="kpis">
<div><b>{r['productosUbicados']}</b><span>productos ubicados</span></div>
<div><b>{r['preciosLeidos']}</b><span>precios leídos</span></div>
<div><b>{_pct(r['confianzaAlta'], r['preciosLeidos'])}</b><span>con confianza alta</span></div>
<div><b>{r['identificados']}</b><span>etiquetas identificadas</span></div>
<div><b>{r['ambiguos']}</b><span>ambiguas</span></div>
<div><b>{r['noEncontrados']}</b><span>no encontradas</span></div>
<div><b>{r['ilegibles']}</b><span>ilegibles</span></div>
<div><b>{r['fotosConError']}</b><span>fotos con error</span></div>
</div></section>

<section><h2>Precios repetidos en la planilla</h2>
<p>{r['preciosRepetidosPlanilla']} precios de la planilla los comparten 2 o más productos
({r['productosConPrecioRepetido']} productos en total). En este relevamiento aparecieron
{r['preciosRepetidosVistos']} de esos precios: {r['porCategoria']} etiqueta(s) se desempataron por la
categoría de los productos vecinos y {r['ambiguos']} no se pudieron desempatar.</p></section>

<section><h2>Recomendaciones para las próximas fotos</h2><ul>{consejos}</ul></section>

<section><h2>Hoja de zonas</h2>
<p class="sub">Cada foto es una zona, en el orden del recorrido. Con borde rojo: fotos que no se pudieron analizar.
En las zonas de tomas cercanas, la línea naranja es el corte entre la columna izquierda y la derecha.</p>
<div class="grilla">{''.join(hoja)}</div></section>

<section><h2>Fotos con problemas ({len(problemas)})</h2>
{'<div class="grilla">' + ''.join(problemas) + '</div>' if problemas else '<p>Ninguna.</p>'}</section>

<section><h2>Detalle de lecturas</h2><div class="scroll"><table>
<thead><tr><th>Lugar</th><th>Foto</th><th>Precio</th><th>Confianza</th><th>Estado</th><th>Producto / candidatos</th><th>Texto de apoyo</th></tr></thead>
<tbody>{''.join(filas)}</tbody></table></div></section>
</main></body></html>"""
