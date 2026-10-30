"""
informe.py — Arma el resumen del relevamiento y el informe en HTML.

El informe incluye una "hoja de columnas", agrupada por grupo del depósito
(FL, FR, BL, BR, OT): las fotos de cada columna, una debajo de la otra, con
su número y cuántos productos se ubicaron. Sirve para saber a qué
estantería corresponde cada número.
"""

from collections import Counter, defaultdict
from datetime import datetime
from html import escape

from unir_columna import tira_base64

NOMBRE_GRUPO = {"FL": "Adelante izquierda", "FR": "Adelante derecha",
                "BL": "Atrás izquierda", "BR": "Atrás derecha", "OT": "Otros"}


def texto_lugar(grupo, columna):
    return f"{grupo} · Columna {columna}"


def calcular_resumen(fotos, lecturas, planilla):
    con_precio = [l for l in lecturas if l["estado"] != "ilegible"]
    precios_vistos = {l["etiqueta"]["precio"] for l in con_precio}
    repetidos = planilla.precios_repetidos
    contar = lambda estado: sum(1 for l in lecturas if l["estado"] == estado)
    return {
        "columnas": len(fotos),
        "fotos": sum(len(f["fotos"]) for f in fotos),
        "fotosConError": sum(1 for f in fotos if not f.get("analisis")),
        "etiquetas": len(lecturas),
        "preciosLeidos": len(con_precio),
        "confianzaAlta": sum(1 for l in con_precio if l["etiqueta"]["confianza"] == "alta"),
        "identificados": contar("identificado"),
        "porCategoria": sum(1 for l in lecturas if l["metodo"] == "precio + categoría vecina"),
        "porSegundaMirada": sum(1 for l in lecturas if l["metodo"].startswith("segunda mirada")),
        "porNombre": sum(1 for l in lecturas if "nombre" in l["metodo"] or "código" in l["metodo"]),
        "porMetodo": dict(Counter(l["metodo"] or "—" for l in lecturas if l["estado"] == "identificado")),
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
    "lejos": "Etiquetas muy chicas: acercate un paso, o sacá la columna en dos o más fotos (una debajo de la otra).",
    "tapada": "Etiquetas tapadas: si un producto tapa su etiqueta, correlo un poco antes de la foto.",
    "cortada": "Etiquetas cortadas por el borde: encuadrá la columna entera con un poco de margen a los costados; si la partís en varias fotos, que se pisen un poco.",
}


def recomendaciones(fotos, r):
    cuenta = Counter(p for f in fotos if f.get("analisis") for p in set(f["analisis"]["problemas"]))
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
.grilla{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;align-items:start}
figure{margin:0;border:1px solid #e2e2e2;border-radius:8px;padding:6px;font-size:12px;position:relative}
figure img{width:100%;border-radius:4px;display:block}
figure .num{position:absolute;top:10px;left:10px;background:#1c1c1c;color:#fff;font-weight:700;
  font-size:16px;border-radius:6px;padding:2px 8px}
figure.error{border-color:#c0392b}
.sector{grid-column:1/-1;margin:10px 0 0;font-size:15px;border-bottom:2px solid #e67e22;padding-bottom:4px}
.sector small{color:#6b6b6b;font-weight:400}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border-bottom:1px solid #e2e2e2;padding:6px;text-align:left;vertical-align:top}th{background:#fafafa}
.identificado{color:#1f8a4c;font-weight:600}.ambiguo{color:#c48a00;font-weight:600}
.no_encontrado,.ilegible{color:#c0392b;font-weight:600}
@media print{section{break-inside:avoid}}
"""


def generar_html(relevamiento_id, columnas, lecturas, resumen, modelo, aviso_recorrido=None):
    r = resumen
    fecha = datetime.now().strftime("%d/%m/%Y %H:%M")

    # Productos identificados por columna (para la hoja de columnas).
    por_lugar = defaultdict(set)
    for l in lecturas:
        if l["estado"] == "identificado":
            por_lugar[(l["grupo"], l["columna"])].add(l["producto"]["codigo"])

    # Hoja de columnas (por grupo) + columnas con problemas.
    hoja, problemas = [], []
    grupo = None
    for c in columnas:
        if c["grupo"] != grupo:
            grupo = c["grupo"]
            n = sum(1 for x in columnas if x["grupo"] == grupo)
            hoja.append(f"<h3 class='sector'>{escape(grupo)} · {escape(NOMBRE_GRUPO.get(grupo, ''))} "
                        f"<small>· {n} columna{'s' if n != 1 else ''}</small></h3>")
        try:
            img = f'<img src="{tira_base64([f["ruta"] for f in c["fotos"]])}" alt="">'
        except Exception:
            img = ""
        a = c.get("analisis")
        clase = "" if a else " class='error'"
        fotos_txt = f" · {len(c['fotos'])} fotos" if len(c["fotos"]) > 1 else ""
        hoja.append(
            f"<figure{clase}>{img}<span class='num'>{escape(c['grupo'])} {c['columna']}</span><figcaption>"
            f"{len(por_lugar[(c['grupo'], c['columna'])])} productos{fotos_txt}</figcaption></figure>")

        motivos = []
        if c.get("error"):
            motivos.append(c["error"])
        if a and (a["problemas"] or a["comentario"]):
            motivos.append(", ".join(a["problemas"]) + (f" — {a['comentario']}" if a["comentario"] else ""))
        if motivos:
            problemas.append(f"<figure>{img}<span class='num'>{escape(c['grupo'])} {c['columna']}</span>"
                             f"<figcaption><b>{escape(c['nombre'])}</b><br>"
                             + "<br>".join(escape(m) for m in motivos) + "</figcaption></figure>")

    # Detalle de lecturas.
    filas = []
    for l in lecturas:
        if l["producto"]:
            producto = escape(f"{l['producto']['codigo']} · {l['producto']['nombre']}")
            if l["metodo"] == "precio + categoría vecina":
                producto += f"<br><small>por categoría: {escape(l['producto']['categoria'])}</small>"
            elif l.get("segunda_mirada"):
                producto += f"<br><small>segunda mirada: {escape(l['segunda_mirada']['motivo'])}</small>"
        elif l["estado"] == "ambiguo":
            producto = "<small>" + "<br>".join(escape(f"{c['codigo']} · {c['nombre']}") for c in l["candidatos"]) + "</small>"
        else:
            producto = ""
        filas.append(
            f"<tr><td>{escape(texto_lugar(l['grupo'], l['columna']))}</td>"
            f"<td>{escape(l['etiqueta']['precio_texto'])}</td><td>{l['etiqueta']['confianza']}</td>"
            f"<td class='{l['estado']}'>{l['estado'].replace('_', ' ')}</td>"
            f"<td>{producto}</td><td><small>{escape(l['etiqueta']['texto_apoyo'])}</small></td></tr>")

    consejos = "".join(f"<li>{escape(c)}</li>" for c in recomendaciones(columnas, r))
    aviso = f'<section class="aviso"><b>Atención:</b> {escape(aviso_recorrido)}</section>' if aviso_recorrido else ""

    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Informe de relevamiento</title><style>{ESTILOS}</style></head><body><main>
<section><h1>Informe del relevamiento</h1>
<p class="sub">{fecha} · {r['columnas']} columnas ({r['fotos']} fotos) · relevamiento {escape(relevamiento_id)} · modelo {escape(modelo or 'predeterminado')}</p></section>
{aviso}
<section><div class="kpis">
<div><b>{r['productosUbicados']}</b><span>productos ubicados</span></div>
<div><b>{r['preciosLeidos']}</b><span>precios leídos</span></div>
<div><b>{_pct(r['confianzaAlta'], r['preciosLeidos'])}</b><span>con confianza alta</span></div>
<div><b>{r['identificados']}</b><span>etiquetas identificadas</span></div>
<div><b>{r['ambiguos']}</b><span>ambiguas</span></div>
<div><b>{r['noEncontrados']}</b><span>no encontradas</span></div>
<div><b>{r['ilegibles']}</b><span>ilegibles</span></div>
<div><b>{r['fotosConError']}</b><span>columnas con error</span></div>
</div></section>

<section><h2>Precios repetidos en la planilla</h2>
<p>{r['preciosRepetidosPlanilla']} precios de la planilla los comparten 2 o más productos
({r['productosConPrecioRepetido']} productos en total). En este relevamiento aparecieron
{r['preciosRepetidosVistos']} de esos precios. {r['porNombre']} etiqueta(s) se identificaron por el nombre o el
código impreso, {r['porSegundaMirada']} por la segunda mirada (Claude viendo el producto),
{r['porCategoria']} por la categoría de los productos vecinos, y {r['ambiguos']} no se pudieron desempatar.</p>
<p class="sub">Cómo se identificó cada etiqueta: {escape(' · '.join(f"{m}: {n}" for m, n in sorted(r['porMetodo'].items(), key=lambda x: -x[1])))}</p></section>

<section><h2>Recomendaciones para las próximas fotos</h2><ul>{consejos}</ul></section>

<section><h2>Hoja de columnas</h2>
<p class="sub">Cada grupo con sus columnas, en el orden del recorrido. Si una columna tiene varias fotos, van una
debajo de la otra (la línea naranja es la unión). Con borde rojo: columnas que no se pudieron analizar.</p>
<div class="grilla">{''.join(hoja)}</div></section>

<section><h2>Columnas con problemas ({len(problemas)})</h2>
{'<div class="grilla">' + ''.join(problemas) + '</div>' if problemas else '<p>Ninguna.</p>'}</section>

<section><h2>Detalle de lecturas</h2><div class="scroll"><table>
<thead><tr><th>Lugar</th><th>Precio</th><th>Confianza</th><th>Estado</th><th>Producto / candidatos</th><th>Texto de apoyo</th></tr></thead>
<tbody>{''.join(filas)}</tbody></table></div></section>
</main></body></html>"""
