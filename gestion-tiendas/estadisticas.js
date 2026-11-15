/* ==========================================================================
   ESTADISTICAS.JS · gestión de tiendas → Estadísticas (sólo admin global)
   --------------------------------------------------------------------------
   Qué se cuenta: los pedidos ENTREGADOS de todas las tiendas, por el día en
   que se marcaron (igual que "Facturación" en el panel de cada tienda). Los
   pedidos se conservan 90 días, así que no hay datos más viejos.

   Las tres capas de cada artículo vendido:
     · precio  → lo que pagó el cliente final a la tienda (facturación de la tienda)
     · costo   → lo que la tienda te paga a vos (guardado en el pedido al comprar,
                 según su variable de costos). Es tu venta.
     · real    → lo que te cuesta a vos la mercadería (columna H). Tu ganancia
                 es costo − real.

   Cómo se obtiene el costo real según la variable de costos de la tienda:
     · Valor Costo (H):        real = costo → no te deja ganancia.
     · Costo % (H + %):        real = costo / (1 + %). Exacto.
     · Descuento Interior (E): real = costo × H / E de la fila actual de la hoja.
                               Se usa la proporción y no H directo, así un
                               aumento de precios en la hoja no distorsiona
                               pedidos viejos. Si el artículo ya no está en la
                               hoja, se estima con la proporción promedio.
   Se usa la variable de costos ACTUAL de cada tienda: si se la cambiaste a
   mitad de período, los pedidos anteriores se calculan con la nueva.
   ========================================================================== */
(function () {
    'use strict';

    const T = window.TiendaCore;
    const $ = (id) => document.getElementById(id);
    const esc = T.escaparHtml;
    const DIA = 864e5;
    const ENTREGADO = T.ESTADOS_PEDIDO.ENTREGADO;
    const fm = (n) => T.formatearMonto(Math.round(Number(n) || 0));
    const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : 0);
    const fmPct = (n) => (Math.round(n * 10) / 10).toLocaleString('es-AR') + '%';
    const reducirMovimiento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const NOMBRE_MODO = { interior: 'Descuento Interior', costo: 'Valor Costo', costoPct: 'Costo %' };

    const est = {
        ctx: null,
        cargado: false,
        cargando: null,
        error: '',
        pedidos: {},          // id de tienda → [pedido]
        hoja: null,           // Map código → { e, h } · null si no se pudo leer
        ratioPromedio: null,  // H/E promedio de la hoja (respaldo)
        periodo: '30',
        orden: { col: 'ganancia', desc: true },
        ultimo: null          // último cálculo (para el CSV)
    };

    // ======================================================================
    // 1 · CÁLCULO (sin DOM)
    // ======================================================================
    function inicioDia(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
    function fechaFacturacion(p) { return Number(p.entregado) || Number(p.fecha) || 0; }

    function rangoPeriodo(periodo, ahora) {
        ahora = ahora || Date.now();
        const limite = T.limitePedidos(ahora);
        const hoy = inicioDia(ahora);
        const d = new Date(hoy);
        let desde, hasta = ahora, texto;
        switch (periodo) {
            case 'hoy': desde = hoy; texto = 'Hoy'; break;
            case '7': desde = hoy - 6 * DIA; texto = 'Últimos 7 días'; break;
            case 'mes': desde = new Date(d.getFullYear(), d.getMonth(), 1).getTime(); texto = 'Este mes'; break;
            case 'mesAnterior':
                desde = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
                hasta = new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1;
                texto = new Date(desde).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
                texto = texto.charAt(0).toUpperCase() + texto.slice(1);
                break;
            case '90': desde = limite; texto = 'Últimos 90 días'; break;
            default: desde = hoy - 29 * DIA; texto = 'Últimos 30 días';
        }
        const recortado = desde < limite;
        return { desde: Math.max(desde, limite), hasta: Math.min(hasta, ahora), texto, recortado };
    }

    // Costo real de una unidad que la tienda pagó "costo"
    function costoReal(costo, codigo, regla, hoja, ratioPromedio) {
        const r = T.normalizarReglaCosto(regla);
        if (r.modo === 'costo') return { real: costo, estimado: false };
        if (r.modo === 'costoPct') return { real: costo / (1 + r.pct / 100), estimado: false };
        const fila = hoja && codigo ? hoja.get(String(codigo).trim()) : null;
        if (fila && fila.e > 0 && fila.h > 0) return { real: costo * fila.h / fila.e, estimado: false };
        if (ratioPromedio) return { real: costo * ratioPromedio, estimado: true };
        return { real: null, estimado: true };
    }

    function nuevoAcum() {
        return { pedidos: 0, unidades: 0, facturado: 0, compro: 0, real: 0, sinCosto: 0, estimados: 0, ultimo: 0 };
    }

    // Suma un pedido a uno o más acumuladores. Devuelve las cifras del pedido.
    function cifrasPedido(p, regla, hoja, ratio) {
        const c = { facturado: Number(p.total) || 0, compro: 0, real: 0, unidades: 0, sinCosto: 0, estimados: 0, items: [] };
        // El total puede traer descuento: la parte "tienda" se calcula sobre
        // el total cobrado, no sobre la suma de precios de lista.
        T.aArray(p.items).forEach(it => {
            const cant = Number(it.cantidad) || 0;
            const costo = Number(it.costo);
            c.unidades += cant;
            if (!(costo > 0)) { c.sinCosto += cant; return; }
            const r = costoReal(costo, it.codigo, regla, hoja, ratio);
            if (r.real === null) { c.sinCosto += cant; return; }
            if (r.estimado) c.estimados += cant;
            c.compro += costo * cant;
            c.real += r.real * cant;
            c.items.push({ clave: it.codigo || it.nombre, nombre: it.nombre, cant, compro: costo * cant, real: r.real * cant });
        });
        return c;
    }

    function sumar(a, c) {
        a.pedidos++;
        a.unidades += c.unidades;
        a.facturado += c.facturado;
        a.compro += c.compro;
        a.real += c.real;
        a.sinCosto += c.sinCosto;
        a.estimados += c.estimados;
    }

    function calcular(pedidosPorTienda, tiendas, hoja, ratio, desde, hasta) {
        const total = nuevoAcum();
        const porTienda = {};
        const porModo = { interior: nuevoAcum(), costo: nuevoAcum(), costoPct: nuevoAcum() };
        const productos = new Map();
        const entregados = [];      // { fecha, compro, ganancia, facturado } para el gráfico
        const pendiente = nuevoAcum();

        Object.keys(tiendas).forEach(id => {
            const t = tiendas[id];
            const regla = T.normalizarReglaCosto(t.costo);
            const a = porTienda[id] = Object.assign(nuevoAcum(), { id, modo: regla.modo, regla });
            (pedidosPorTienda[id] || []).forEach(p => {
                if (p.status !== ENTREGADO) {
                    if (p.status) sumar(pendiente, cifrasPedido(p, regla, hoja, ratio));
                    return;
                }
                const f = fechaFacturacion(p);
                if (f < desde || f > hasta) return;
                const c = cifrasPedido(p, regla, hoja, ratio);
                sumar(a, c);
                sumar(total, c);
                sumar(porModo[regla.modo], c);
                a.ultimo = Math.max(a.ultimo, f);
                entregados.push({ fecha: f, facturado: c.facturado, compro: c.compro, ganancia: c.compro - c.real });
                c.items.forEach(it => {
                    const x = productos.get(it.clave) || { nombre: it.nombre, unidades: 0, compro: 0, ganancia: 0, tiendas: new Set() };
                    x.unidades += it.cant;
                    x.compro += it.compro;
                    x.ganancia += it.compro - it.real;
                    x.tiendas.add(id);
                    productos.set(it.clave, x);
                });
            });
        });
        return { total, porTienda, porModo, productos, entregados, pendiente };
    }

    // Filas de la hoja → Map(código → { e, h }) y la proporción H/E promedio
    function leerHoja(filas) {
        const mapa = new Map();
        let sumaE = 0, sumaH = 0;
        (filas || []).forEach(f => {
            const codigo = String((f && f[2]) || '').trim();
            if (!codigo) return;
            const e = T.costoDeFila(f, { modo: 'interior' });
            const h = T.costoDeFila(f, { modo: 'costo' });
            if (!(e > 0) || !(h > 0)) return;
            mapa.set(codigo, { e, h });
            sumaE += e; sumaH += h;
        });
        return { mapa, ratio: sumaE > 0 ? sumaH / sumaE : null };
    }

    // ======================================================================
    // 2 · CARGA
    // ======================================================================
    async function cargarHoja() {
        const c = typeof HOJA_COSTOS !== 'undefined' ? HOJA_COSTOS : null;
        if (!c || !c.API_KEY) throw new Error('Falta HOJA_COSTOS en config.js');
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${c.SPREADSHEET_ID}/values/${encodeURIComponent(c.RANGO)}?key=${c.API_KEY}`;
        const r = await fetch(url, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return leerHoja((await r.json()).values);
    }

    async function cargar() {
        const { db, tiendas } = est.ctx;
        const limite = T.limitePedidos();
        est.error = '';
        const ids = Object.keys(tiendas);
        const [pedidos, hoja] = await Promise.all([
            Promise.all(ids.map(id => db.ref('tiendas/' + id + '/pedidos').orderByChild('fecha').startAt(limite).once('value')
                .then(s => { const v = s.val() || {}; return [id, Object.keys(v).map(k => v[k]).filter(Boolean)]; })
                .catch(e => { console.warn('No se pudieron leer los pedidos de', id, e); return [id, []]; }))),
            cargarHoja().catch(e => { console.warn('No se pudo leer la hoja de costos:', e); return null; })
        ]);
        est.pedidos = Object.fromEntries(pedidos);
        est.hoja = hoja ? hoja.mapa : null;
        est.ratioPromedio = hoja ? hoja.ratio : null;
        est.cargado = true;
    }

    // ======================================================================
    // 3 · PINTADO
    // ======================================================================
    function animarNumero(el, valor, formato) {
        if (!el) return;
        const fin = Number(valor) || 0;
        const ini = Number(el.dataset.valor) || 0;
        el.dataset.valor = String(fin);
        if (reducirMovimiento || ini === fin) { el.textContent = formato(fin); return; }
        const t0 = performance.now(), dur = 650;
        const paso = (t) => {
            const k = Math.min(1, (t - t0) / dur);
            const e = 1 - Math.pow(1 - k, 3);
            el.textContent = formato(ini + (fin - ini) * e);
            if (k < 1 && el.dataset.valor === String(fin)) requestAnimationFrame(paso);
        };
        requestAnimationFrame(paso);
    }

    function variacion(actual, previo) {
        if (!(previo > 0)) return '';
        const v = Math.round((actual - previo) / previo * 100);
        if (!isFinite(v)) return '';
        const clase = v > 0 ? 'sube' : v < 0 ? 'baja' : 'igual';
        const icono = v > 0 ? 'fa-arrow-trend-up' : v < 0 ? 'fa-arrow-trend-down' : 'fa-equals';
        return `<span class="variacion ${clase}" title="Comparado con el período anterior de igual duración"><i class="fas ${icono}"></i>${v > 0 ? '+' : ''}${v}%</span>`;
    }

    function kpi(id, icono, etiqueta, clase) {
        return `<div class="kpi ${clase || ''}">
            <span class="kpi-etiqueta"><i class="fas ${icono}"></i>${etiqueta}</span>
            <strong class="kpi-valor" data-kpi="${id}" data-valor="0">${fm(0)}</strong>
            <span class="kpi-detalle" data-det="${id}"></span>
        </div>`;
    }

    function prepararKpis() {
        const tuyos = $('estKpisTuyos'), tiendas = $('estKpisTiendas');
        if (tuyos.dataset.listo) return;
        tuyos.innerHTML =
            kpi('compro', 'fa-hand-holding-dollar', 'Te compraron') +
            kpi('real', 'fa-boxes-stacked', 'Tu costo real') +
            kpi('ganancia', 'fa-sack-dollar', 'Tu ganancia limpia', 'kpi-ganancia') +
            kpi('pendiente', 'fa-hourglass-half', 'Ganancia por cobrar');
        tiendas.innerHTML =
            kpi('facturado', 'fa-cash-register', 'Facturación total') +
            kpi('gananciaTiendas', 'fa-store', 'Ganancia de las tiendas') +
            kpi('pedidos', 'fa-circle-check', 'Pedidos entregados') +
            kpi('activas', 'fa-signal', 'Tiendas con ventas');
        tuyos.dataset.listo = '1';
    }

    function pintarKpis(r, previo, nTiendas) {
        prepararKpis();
        const t = r.total, pr = previo && previo.total;
        const v = (id, val, fmt) => animarNumero(document.querySelector(`[data-kpi="${id}"]`), val, fmt || fm);
        const det = (id, html) => { const el = document.querySelector(`[data-det="${id}"]`); if (el) el.innerHTML = html; };
        const ganancia = t.compro - t.real;
        const margen = pct(ganancia, t.compro);
        const ganTiendas = t.facturado - t.compro;
        const activas = Object.values(r.porTienda).filter(x => x.pedidos > 0).length;
        const pend = r.pendiente.compro - r.pendiente.real;

        v('compro', t.compro);
        det('compro', pr ? (variacion(t.compro, pr.compro) || 'Sin ventas en el período anterior') : 'Lo que las tiendas te pagan por la mercadería');
        v('real', t.real);
        det('real', t.compro > 0 ? `${fmPct(100 - margen)} de lo que te compraron` : 'Lo que te cuesta la mercadería');
        v('ganancia', ganancia);
        det('ganancia', `<span class="margen-barra"><span style="width:${Math.max(0, Math.min(100, margen))}%"></span></span>${fmPct(margen)} de margen${pr ? ' ' + variacion(ganancia, pr.compro - pr.real) : ''}`);
        v('pendiente', pend);
        det('pendiente', r.pendiente.pedidos ? `${r.pendiente.pedidos} ${r.pendiente.pedidos === 1 ? 'pedido abierto' : 'pedidos abiertos'} · todavía no entregados` : 'No hay pedidos abiertos');

        v('facturado', t.facturado);
        det('facturado', pr ? (variacion(t.facturado, pr.facturado) || 'Sin ventas en el período anterior') : 'Lo que cobraron todas las tiendas');
        v('gananciaTiendas', ganTiendas);
        det('gananciaTiendas', t.facturado > 0 ? `${fmPct(pct(ganTiendas, t.facturado))} de margen promedio` : 'Facturación menos lo que te pagan');
        v('pedidos', t.pedidos, n => String(Math.round(n)));
        det('pedidos', t.pedidos ? `Ticket promedio ${fm(t.facturado / t.pedidos)} · ${t.unidades} u.` : 'Ninguno en el período');
        v('activas', activas, n => `${Math.round(n)} de ${nTiendas}`);
        det('activas', activas ? `${fmPct(pct(ganancia, t.facturado))} de cada peso vendido es tuyo` : 'Ninguna vendió en el período');
    }

    function pintarGrafico(rango, entregados) {
        const cont = $('estGrafico');
        const dias = Math.max(1, Math.round((inicioDia(rango.hasta) - inicioDia(rango.desde)) / DIA) + 1);
        const semanal = dias > 31;
        const paso = semanal ? 7 * DIA : DIA;
        const cubetas = [];
        for (let t = inicioDia(rango.desde); t <= rango.hasta; t += paso) cubetas.push({ desde: t, hasta: Math.min(t + paso - 1, rango.hasta), compro: 0, ganancia: 0, facturado: 0, pedidos: 0 });
        entregados.forEach(e => {
            const c = cubetas.find(x => e.fecha >= x.desde && e.fecha <= x.hasta) || cubetas[cubetas.length - 1];
            c.compro += e.compro; c.ganancia += e.ganancia; c.facturado += e.facturado; c.pedidos++;
        });
        const max = Math.max(...cubetas.map(c => c.compro), 0);
        if (!max) {
            cont.innerHTML = '<div class="grafico-vacio"><i class="fas fa-chart-simple"></i><span>Todavía no hay entregas en este período.</span></div>';
            return;
        }
        const mag = Math.pow(10, Math.floor(Math.log10(max)));
        const tope = [1, 2, 2.5, 5, 10].map(k => k * mag).find(x => x >= max);
        const fmtCorto = (n) => n >= 1e6 ? '$' + (n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M' : n >= 1e3 ? '$' + Math.round(n / 1e3).toLocaleString('es-AR') + ' mil' : '$' + Math.round(n);
        const cada = Math.ceil(cubetas.length / (window.innerWidth < 700 ? 5 : 10));
        const fmtX = (c) => semanal
            ? new Date(c.desde).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })
            : (dias <= 7 ? new Date(c.desde).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }) : new Date(c.desde).getDate() + '/' + (new Date(c.desde).getMonth() + 1));
        cont.innerHTML = `
            <div class="grafico-eje">${[1, .5, 0].map(k => `<span>${fmtCorto(tope * k)}</span>`).join('')}</div>
            <div class="grafico-area">
                <div class="grafico-guias"><span></span><span></span><span></span></div>
                <div class="grafico-barras" style="--n:${cubetas.length}">
                    ${cubetas.map((c, i) => {
                        const rango = semanal ? `Semana del ${new Date(c.desde).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}` : new Date(c.desde).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
                        const tip = `${rango}\nTe compraron: ${fm(c.compro)}\nTu ganancia: ${fm(c.ganancia)}\nFacturación tiendas: ${fm(c.facturado)}\n${c.pedidos} ${c.pedidos === 1 ? 'pedido' : 'pedidos'}`;
                        return `<div class="g-col" tabindex="0" data-tip="${esc(tip)}" style="--d:${Math.min(i, 40) * 14}ms">
                            <div class="g-barra" style="height:${(c.compro / tope * 100).toFixed(2)}%"><div class="g-ganancia" style="height:${c.compro > 0 ? Math.max(0, Math.min(100, c.ganancia / c.compro * 100)).toFixed(2) : 0}%"></div></div>
                            <span class="g-x">${i % cada === 0 ? esc(fmtX(c)) : ''}</span>
                        </div>`;
                    }).join('')}
                </div>
                <div class="grafico-tip" hidden></div>
            </div>`;
    }

    // Tooltip del gráfico (mouse, teclado y toque)
    function engancharTooltip() {
        const g = $('estGrafico');
        const mostrar = (col) => {
            const tip = g.querySelector('.grafico-tip');
            if (!tip || !col) return;
            const lineas = col.dataset.tip.split('\n');
            tip.innerHTML = `<strong>${esc(lineas[0])}</strong>` + lineas.slice(1).map(l => `<span>${esc(l)}</span>`).join('');
            tip.hidden = false;
            const area = g.querySelector('.grafico-area').getBoundingClientRect();
            const c = col.getBoundingClientRect();
            tip.style.left = Math.max(80, Math.min(area.width - 80, c.left - area.left + c.width / 2)) + 'px';
            g.querySelectorAll('.g-col.activa').forEach(e => e.classList.remove('activa'));
            col.classList.add('activa');
        };
        const ocultar = () => {
            const tip = g.querySelector('.grafico-tip');
            if (tip) tip.hidden = true;
            g.querySelectorAll('.g-col.activa').forEach(e => e.classList.remove('activa'));
        };
        g.addEventListener('mouseover', e => mostrar(e.target.closest('.g-col')));
        g.addEventListener('focusin', e => mostrar(e.target.closest('.g-col')));
        g.addEventListener('click', e => mostrar(e.target.closest('.g-col')));
        g.addEventListener('mouseleave', ocultar);
        g.addEventListener('focusout', ocultar);
        window.addEventListener('resize', ocultar);
    }

    const COLUMNAS = [
        { id: 'nombre', texto: 'Tienda' },
        { id: 'pedidos', texto: 'Pedidos', num: true },
        { id: 'facturado', texto: 'Facturación', num: true },
        { id: 'compro', texto: 'Te compró', num: true },
        { id: 'ganancia', texto: 'Tu ganancia', num: true },
        { id: 'margen', texto: 'Tu margen', num: true },
        { id: 'gananciaTienda', texto: 'Ganancia tienda', num: true },
        { id: 'margenTienda', texto: 'Margen tienda', num: true }
    ];

    function filasTabla(r) {
        const { nombreTienda } = est.ctx;
        return Object.values(r.porTienda).map(a => {
            const ganancia = a.compro - a.real;
            const gananciaTienda = a.facturado - a.compro;
            return {
                id: a.id, nombre: nombreTienda(a.id), modo: a.modo, regla: a.regla, ultimo: a.ultimo,
                pedidos: a.pedidos, unidades: a.unidades, facturado: a.facturado, compro: a.compro, real: a.real, ganancia,
                margen: pct(ganancia, a.compro), gananciaTienda, margenTienda: pct(gananciaTienda, a.facturado),
                ticket: a.pedidos ? a.facturado / a.pedidos : 0, estimados: a.estimados, sinCosto: a.sinCosto
            };
        });
    }

    function pintarTabla(r) {
        const filas = filasTabla(r);
        const { col, desc } = est.orden;
        filas.sort((a, b) => {
            const x = a[col], y = b[col];
            const c = typeof x === 'string' ? x.localeCompare(y, 'es') : (x - y);
            return (desc ? -c : c) || a.nombre.localeCompare(b.nombre, 'es');
        });
        const totalGan = r.total.compro - r.total.real;
        const cab = COLUMNAS.map(c => {
            const activa = c.id === col;
            return `<th class="${c.num ? 'num' : ''}" aria-sort="${activa ? (desc ? 'descending' : 'ascending') : 'none'}"><button type="button" class="est-orden${activa ? ' activa' : ''}" data-orden="${c.id}">${c.texto}${activa ? `<i class="fas fa-arrow-${desc ? 'down' : 'up'}"></i>` : ''}</button></th>`;
        }).join('');
        const cuerpo = filas.map(f => {
            const sinVentas = !f.pedidos;
            const aviso = f.estimados ? ' <i class="fas fa-circle-info est-estimado" title="Parte del costo real es estimado: hay artículos que ya no están en la hoja"></i>' : '';
            const parte = totalGan > 0 && f.ganancia > 0 ? f.ganancia / totalGan * 100 : 0;
            return `<tr class="${sinVentas ? 'est-sin-ventas' : ''}">
                <td><span class="est-tienda"><strong>${esc(f.nombre)}</strong><small><span class="pill neutro">${esc(T.textoReglaCosto(f.regla))}</span>${f.ultimo ? ' · última entrega ' + new Date(f.ultimo).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }) : ''}</small></span></td>
                <td class="num">${f.pedidos || '—'}</td>
                <td class="num">${sinVentas ? '—' : fm(f.facturado)}</td>
                <td class="num">${sinVentas ? '—' : fm(f.compro)}</td>
                <td class="num est-ganancia">${sinVentas ? '—' : fm(f.ganancia) + aviso}${parte ? `<span class="est-parte" title="${fmPct(parte)} de tu ganancia total"><span style="width:${parte.toFixed(1)}%"></span></span>` : ''}</td>
                <td class="num">${sinVentas ? '—' : fmPct(f.margen)}</td>
                <td class="num">${sinVentas ? '—' : fm(f.gananciaTienda)}</td>
                <td class="num">${sinVentas ? '—' : fmPct(f.margenTienda)}</td>
            </tr>`;
        }).join('');
        const t = r.total, g = t.compro - t.real;
        const pie = `<tr class="est-total">
            <td>Total</td><td class="num">${t.pedidos}</td><td class="num">${fm(t.facturado)}</td><td class="num">${fm(t.compro)}</td>
            <td class="num">${fm(g)}</td><td class="num">${fmPct(pct(g, t.compro))}</td>
            <td class="num">${fm(t.facturado - t.compro)}</td><td class="num">${fmPct(pct(t.facturado - t.compro, t.facturado))}</td></tr>`;
        $('estTabla').innerHTML = filas.length
            ? `<table class="tabla-productos est-tabla"><thead><tr>${cab}</tr></thead><tbody>${cuerpo}</tbody><tfoot>${pie}</tfoot></table>`
            : '<p class="vacio">Todavía no hay tiendas.</p>';
    }

    function pintarTop(r) {
        const top = [...r.productos.values()].sort((a, b) => b.ganancia - a.ganancia).slice(0, 8);
        const max = Math.max(...top.map(x => x.ganancia), 1);
        $('estTop').innerHTML = top.length
            ? `<ol class="ranking">${top.map((x, i) => `
                <li>
                    <span class="ranking-pos">${i + 1}</span>
                    <span class="ranking-nombre"><strong title="${esc(x.nombre)}">${esc(x.nombre)}</strong><small>${x.unidades} u. · ${fm(x.compro)} vendido · ${x.tiendas.size} ${x.tiendas.size === 1 ? 'tienda' : 'tiendas'}</small>
                        <span class="ranking-barra"><span style="width:${Math.max(4, x.ganancia / max * 100).toFixed(1)}%"></span></span></span>
                    <span class="ranking-valor">${fm(x.ganancia)}</span>
                </li>`).join('')}</ol>`
            : '<div class="grafico-vacio chico"><i class="fas fa-box-open"></i><span>Sin ventas en el período.</span></div>';
    }

    function pintarModos(r) {
        const total = r.total.compro - r.total.real;
        const tiendasPorModo = { interior: 0, costo: 0, costoPct: 0 };
        Object.values(r.porTienda).forEach(a => { tiendasPorModo[a.modo]++; });
        $('estModos').innerHTML = `<ul class="est-modos">${['interior', 'costoPct', 'costo'].map(m => {
            const a = r.porModo[m];
            const g = a.compro - a.real;
            const parte = total > 0 ? Math.max(0, g / total * 100) : 0;
            return `<li>
                <div class="est-modo-fila"><strong>${NOMBRE_MODO[m]}</strong><span>${fm(g)}</span></div>
                <div class="ranking-barra"><span style="width:${parte.toFixed(1)}%"></span></div>
                <small>${tiendasPorModo[m]} ${tiendasPorModo[m] === 1 ? 'tienda' : 'tiendas'} · ${a.pedidos} ${a.pedidos === 1 ? 'pedido' : 'pedidos'}${a.compro > 0 ? ` · ${fmPct(pct(g, a.compro))} de margen` : ''}${m === 'costo' ? ' · no te deja ganancia' : ''}</small>
            </li>`;
        }).join('')}</ul>`;
    }

    function pintarAlertas(r) {
        const filas = filasTabla(r);
        const items = [];
        const sinVentas = filas.filter(f => !f.pedidos);
        if (sinVentas.length) items.push(['fa-moon', `<strong>${sinVentas.length} ${sinVentas.length === 1 ? 'tienda no vendió' : 'tiendas no vendieron'}</strong> en el período: ${sinVentas.slice(0, 6).map(f => esc(f.nombre)).join(', ')}${sinVentas.length > 6 ? '…' : ''}.`]);
        const costoCero = filas.filter(f => f.modo === 'costo' && f.pedidos);
        if (costoCero.length) items.push(['fa-scale-balanced', `${costoCero.map(f => `<strong>${esc(f.nombre)}</strong>`).join(', ')} ${costoCero.length === 1 ? 'compra' : 'compran'} a <em>Valor Costo</em>: ${fm(costoCero.reduce((s, f) => s + f.compro, 0))} vendidos sin ganancia para vos.`]);
        const margenBajo = filas.filter(f => f.pedidos && f.facturado > 0 && f.margenTienda < 10);
        if (margenBajo.length) items.push(['fa-triangle-exclamation', `Margen bajo de la tienda (menos del 10%): ${margenBajo.map(f => `<strong>${esc(f.nombre)}</strong> (${fmPct(f.margenTienda)})`).join(', ')}. Puede que sus escalas de precios estén muy ajustadas.`]);
        const mejor = filas.filter(f => f.pedidos).sort((a, b) => b.ganancia - a.ganancia)[0];
        const totalGan = r.total.compro - r.total.real;
        if (mejor && totalGan > 0 && filas.filter(f => f.pedidos).length > 1) items.push(['fa-trophy', `<strong>${esc(mejor.nombre)}</strong> es la que más te dejó: ${fm(mejor.ganancia)} (${fmPct(pct(mejor.ganancia, totalGan))} de tu ganancia).`]);
        if (r.total.estimados) items.push(['fa-circle-info', `${r.total.estimados} ${r.total.estimados === 1 ? 'unidad vendida' : 'unidades vendidas'} con Descuento Interior ya no ${r.total.estimados === 1 ? 'está' : 'están'} en la hoja: su costo real se estimó con la proporción promedio.`]);
        if (r.total.sinCosto) items.push(['fa-circle-question', `${r.total.sinCosto} ${r.total.sinCosto === 1 ? 'unidad no tiene' : 'unidades no tienen'} costo guardado (pedidos viejos o artículos sin costo en la hoja): no suman a tus cifras.`]);
        $('estAlertasTarjeta').hidden = !items.length;
        $('estAlertas').innerHTML = items.map(([i, t]) => `<li><i class="fas ${i}"></i><span>${t}</span></li>`).join('');
    }

    function pintar() {
        if (!est.cargado) return;
        const tiendas = est.ctx.tiendas;
        const rango = rangoPeriodo(est.periodo);
        const r = calcular(est.pedidos, tiendas, est.hoja, est.ratioPromedio, rango.desde, rango.hasta);
        const dur = rango.hasta - rango.desde;
        const previo = rango.desde - dur - 1 >= T.limitePedidos()
            ? calcular(est.pedidos, tiendas, est.hoja, est.ratioPromedio, rango.desde - dur - 1, rango.desde - 1) : null;
        est.ultimo = { r, rango };

        const fmtDia = (ts) => new Date(ts).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
        $('estRango').innerHTML = `<strong>${esc(rango.texto)}</strong> · ${fmtDia(rango.desde)} al ${fmtDia(rango.hasta)}${rango.recortado ? ' <span class="pill neutro">limitado a 90 días</span>' : ''}`;
        $('estAviso').innerHTML = est.hoja ? '' :
            `<div class="banda est-banda"><i class="fas fa-triangle-exclamation"></i><div>No se pudo leer la hoja de productos, así que tu costo real con <strong>Descuento Interior</strong> no se puede calcular y esas ventas no suman a tu ganancia. Probá con <i class="fas fa-rotate"></i> arriba a la derecha.</div></div>`;

        pintarKpis(r, previo, Object.keys(tiendas).length);
        pintarGrafico(rango, r.entregados);
        pintarTabla(r);
        pintarTop(r);
        pintarModos(r);
        pintarAlertas(r);
        $('estDescargar').disabled = false;
    }

    function pintarCargando() {
        $('estRango').innerHTML = '<span class="cargando-linea"><span class="spinner"></span>Leyendo los pedidos de todas las tiendas y la hoja de costos…</span>';
    }

    // ======================================================================
    // 4 · CSV
    // ======================================================================
    function descargarCsv() {
        if (!est.ultimo) return;
        const { r, rango } = est.ultimo;
        const filas = filasTabla(r).sort((a, b) => b.ganancia - a.ganancia);
        const n = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
        const c = (x) => '"' + String(x).replace(/"/g, '""') + '"';
        const lineas = [['Tienda', 'ID', 'Variable de costos', 'Pedidos', 'Unidades', 'Facturación', 'Te compró', 'Tu costo real', 'Tu ganancia', 'Tu margen %', 'Ganancia tienda', 'Margen tienda %', 'Ticket promedio'].map(c).join(';')];
        filas.forEach(f => lineas.push([c(f.nombre), c(f.id), c(T.textoReglaCosto(f.regla)), f.pedidos, f.unidades, n(f.facturado), n(f.compro), n(f.real), n(f.ganancia), n(f.margen), n(f.gananciaTienda), n(f.margenTienda), n(f.ticket)].join(';')));
        const iso = (ts) => new Date(ts).toISOString().slice(0, 10);
        const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `estadisticas_${iso(rango.desde)}_${iso(rango.hasta)}.csv`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    // ======================================================================
    // 5 · ENTRADA
    // ======================================================================
    let enganchado = false;
    function enganchar() {
        if (enganchado) return;
        enganchado = true;
        document.querySelectorAll('input[name="estPeriodo"]').forEach(x => x.addEventListener('change', () => {
            if (!x.checked) return;
            est.periodo = x.value;
            pintar();
        }));
        $('estTabla').addEventListener('click', e => {
            const b = e.target.closest('[data-orden]');
            if (!b) return;
            const col = b.dataset.orden;
            est.orden = est.orden.col === col ? { col, desc: !est.orden.desc } : { col, desc: col !== 'nombre' };
            if (est.ultimo) pintarTabla(est.ultimo.r);
        });
        $('estDescargar').addEventListener('click', descargarCsv);
        engancharTooltip();
    }

    // La llama gestion-tiendas.js al abrir la sección (y al tocar "Actualizar")
    function activar(ctx) {
        enganchar();
        est.ctx = ctx;
        if (est.cargando) return;
        if (est.cargado && !ctx.recargar) { pintar(); return; }
        pintarCargando();
        est.cargando = cargar()
            .then(pintar)
            .catch(e => {
                console.error(e);
                $('estRango').innerHTML = '<span class="pill mal">No se pudieron leer los datos</span> Revisá la conexión y tocá <i class="fas fa-rotate"></i> arriba a la derecha.';
            })
            .finally(() => { est.cargando = null; });
    }

    window.GestionEstadisticas = { activar, _calcular: calcular, _leerHoja: leerHoja, _costoReal: costoReal };
})();
