/* ==========================================================================
   ui.js · componentes del panel
   Cada control recibe un "ctx" { get(ruta), set(ruta, valor, opciones) } y
   escribe directo en el borrador. Ningún control re-renderiza la sección al
   escribir (así no se pierde el foco); los cambios de estructura (agregar,
   borrar, reordenar) llaman a ctx.render().
   ========================================================================== */
import { ICONOS, estadoVigencia } from './schema.js';

/* ---------------------------------------------------------- helpers DOM */

export function h(tag, attrs, ...hijos) {
    const el = document.createElement(tag);
    if (attrs) {
        Object.entries(attrs).forEach(([k, v]) => {
            if (v == null || v === false) return;
            if (k === 'class') el.className = v;
            else if (k === 'html') el.innerHTML = v;
            else if (k === 'text') el.textContent = v;
            else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
            else if (v === true) el.setAttribute(k, '');
            else el.setAttribute(k, v);
        });
    }
    hijos.flat(Infinity).forEach((c) => {
        if (c == null || c === false) return;
        el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return el;
}

export function icono(clase) { return h('i', { class: clase, 'aria-hidden': 'true' }); }

export function escapar(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
}

let idSeq = 0;
const nuevoIdCampo = () => 'c' + (++idSeq);

/* ------------------------------------------------------------- fechas */

export function aLocal(ms) {
    if (!ms) return '';
    const d = new Date(Number(ms));
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function deLocal(v) { return v ? new Date(v).getTime() : 0; }

const fmtFecha = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtFechaLarga = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export function fecha(ms, larga) { return ms ? (larga ? fmtFechaLarga : fmtFecha).format(new Date(Number(ms))) : ''; }

export function relativo(ms, ahora = Date.now()) {
    if (!ms) return '';
    const dif = Number(ms) - ahora;
    const abs = Math.abs(dif);
    const rtf = new Intl.RelativeTimeFormat('es-AR', { numeric: 'auto' });
    if (abs < 60e3) return dif >= 0 ? 'en instantes' : 'recién';
    if (abs < 3600e3) return rtf.format(Math.round(dif / 60e3), 'minute');
    if (abs < 86400e3) return rtf.format(Math.round(dif / 3600e3), 'hour');
    if (abs < 30 * 86400e3) return rtf.format(Math.round(dif / 86400e3), 'day');
    return fecha(ms);
}

export function moneda(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR'); }

export function formatearTel(numero) {
    const d = String(numero || '').replace(/\D+/g, '');
    const m = d.match(/^54(9)?(11|\d{3,4})(\d{3,4})(\d{4})$/);
    if (!m) return d ? '+' + d : '';
    return '+54 ' + (m[1] ? '9 ' : '') + m[2] + ' ' + m[3] + '-' + m[4];
}

/* -------------------------------------------------------------- campos */

export function campo({ etiqueta, ayuda, control, extra, ancho, id, clase }) {
    const cid = id || (control && control.dataset && control.dataset.campoId) || nuevoIdCampo();
    if (control && control.matches && control.matches('input,select,textarea')) control.id = control.id || cid;
    return h('div', { class: 'campo' + (ancho ? ' campo--' + ancho : '') + (clase ? ' ' + clase : '') },
        etiqueta ? h('div', { class: 'campo-cabeza' },
            h('label', { class: 'campo-etiqueta', for: control && control.id ? control.id : null }, etiqueta),
            extra || null) : null,
        control,
        ayuda ? h('p', { class: 'campo-ayuda', html: ayuda }) : null);
}

export function fila(...hijos) { return h('div', { class: 'fila' }, ...hijos); }

export function inputTexto(ctx, ruta, { placeholder = '', tipo = 'text', mono = false, max, alCambiar, lista } = {}) {
    const el = h('input', {
        type: tipo, class: 'control' + (mono ? ' control--mono' : ''), placeholder,
        value: ctx.get(ruta) ?? '', maxlength: max, autocomplete: 'off', spellcheck: tipo === 'text' ? 'true' : 'false', list: lista
    });
    el.addEventListener('input', () => { ctx.set(ruta, el.value); if (alCambiar) alCambiar(el.value); });
    return el;
}

export function textarea(ctx, ruta, { placeholder = '', filas = 3, mono = false, alCambiar } = {}) {
    const el = h('textarea', { class: 'control control--area' + (mono ? ' control--mono' : ''), placeholder, rows: filas });
    el.value = ctx.get(ruta) ?? '';
    el.addEventListener('input', () => { ctx.set(ruta, el.value); if (alCambiar) alCambiar(el.value); });
    return el;
}

export function inputNumero(ctx, ruta, { placeholder = '', min, max, paso = 1, prefijo, sufijo, alCambiar, vacioPermitido = true } = {}) {
    const actual = ctx.get(ruta);
    const el = h('input', {
        type: 'number', inputmode: 'decimal', class: 'control control--num', placeholder,
        min, max, step: paso, value: actual === undefined || actual === null || actual === '' ? '' : actual
    });
    el.addEventListener('input', () => {
        const v = el.value === '' ? (vacioPermitido ? '' : 0) : Number(el.value);
        ctx.set(ruta, v);
        if (alCambiar) alCambiar(v);
    });
    if (!prefijo && !sufijo) return el;
    return h('div', { class: 'control-grupo' },
        prefijo ? h('span', { class: 'control-afijo' }, prefijo) : null, el,
        sufijo ? h('span', { class: 'control-afijo' }, sufijo) : null);
}

// invertido: el switch encendido guarda false (p. ej. "Mostrar" sobre una clave "ocultar").
// porDefecto: valor efectivo cuando el campo nunca se tocó (vacío = lo del código).
export function interruptor(ctx, ruta, { etiqueta, descripcion, alCambiar, invertido = false, porDefecto = false } = {}) {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch-input' });
    const v = ctx.get(ruta);
    const efectivo = typeof v === 'boolean' ? v : porDefecto;
    input.checked = invertido ? !efectivo : efectivo;
    input.addEventListener('change', () => {
        const nuevo = invertido ? !input.checked : input.checked;
        ctx.set(ruta, nuevo, { inmediato: true });
        if (alCambiar) alCambiar(nuevo);
    });
    return h('label', { class: 'switch' },
        input,
        h('span', { class: 'switch-pista', 'aria-hidden': 'true' }, h('span', { class: 'switch-perilla' })),
        etiqueta || descripcion ? h('span', { class: 'switch-texto' },
            etiqueta ? h('span', { class: 'switch-etiqueta' }, etiqueta) : null,
            descripcion ? h('span', { class: 'switch-desc' }, descripcion) : null) : null);
}

export function segmentado(ctx, ruta, opciones, { alCambiar, tamano } = {}) {
    const actual = ctx.get(ruta) ?? opciones[0].valor;
    const grupo = h('div', { class: 'seg' + (tamano ? ' seg--' + tamano : ''), role: 'radiogroup' });
    const pill = h('span', { class: 'seg-pill', 'aria-hidden': 'true' });
    grupo.appendChild(pill);
    const mover = () => {
        const sel = grupo.querySelector('.seg-op[aria-checked="true"]');
        if (!sel) { pill.style.opacity = 0; return; }
        pill.style.opacity = 1;
        pill.style.width = sel.offsetWidth + 'px';
        pill.style.transform = `translateX(${sel.offsetLeft - 3}px)`;
    };
    opciones.forEach((o) => {
        const b = h('button', { type: 'button', class: 'seg-op', role: 'radio', 'aria-checked': String(o.valor === actual), title: o.ayuda || null },
            o.icono ? icono(o.icono) : null, h('span', null, o.etiqueta));
        b.addEventListener('click', () => {
            grupo.querySelectorAll('.seg-op').forEach((x) => x.setAttribute('aria-checked', 'false'));
            b.setAttribute('aria-checked', 'true');
            mover();
            ctx.set(ruta, o.valor, { inmediato: true });
            if (alCambiar) alCambiar(o.valor);
        });
        grupo.appendChild(b);
    });
    requestAnimationFrame(() => { grupo.classList.add('sin-animacion'); mover(); requestAnimationFrame(() => grupo.classList.remove('sin-animacion')); });
    new ResizeObserver(mover).observe(grupo);
    return grupo;
}

export function selector(ctx, ruta, opciones, { alCambiar } = {}) {
    const el = h('select', { class: 'control control--select' },
        opciones.map((o) => h('option', { value: o.valor }, o.etiqueta)));
    el.value = ctx.get(ruta) ?? opciones[0].valor;
    el.addEventListener('change', () => { ctx.set(ruta, el.value, { inmediato: true }); if (alCambiar) alCambiar(el.value); });
    return el;
}

export function muestras(ctx, ruta, opciones, { alCambiar, conPersonalizado = false } = {}) {
    const caja = h('div', { class: 'muestras', role: 'radiogroup' });
    const marcar = (v) => caja.querySelectorAll('.muestra').forEach((m) => m.setAttribute('aria-checked', String(m.dataset.valor === v)));
    opciones.forEach((o) => {
        const b = h('button', { type: 'button', class: 'muestra', role: 'radio', 'data-valor': o.valor, title: o.etiqueta, 'aria-label': o.etiqueta },
            h('span', { class: 'muestra-color' + (o.valor === '' ? ' muestra-color--nada' : ''), style: { background: o.muestra || o.valor || 'transparent' } }));
        b.addEventListener('click', () => { ctx.set(ruta, o.valor, { inmediato: true }); marcar(o.valor); if (picker) picker.value = o.valor || '#376550'; if (alCambiar) alCambiar(o.valor); });
        caja.appendChild(b);
    });
    let picker = null;
    if (conPersonalizado) {
        picker = h('input', { type: 'color', class: 'muestra-picker', title: 'Color personalizado', 'aria-label': 'Color personalizado' });
        picker.value = /^#[0-9a-f]{6}$/i.test(ctx.get(ruta) || '') ? ctx.get(ruta) : '#376550';
        picker.addEventListener('input', () => { ctx.set(ruta, picker.value); marcar(picker.value); if (alCambiar) alCambiar(picker.value); });
        caja.appendChild(h('label', { class: 'muestra muestra--picker', title: 'Elegir otro color' }, picker, icono('fa-solid fa-eye-dropper')));
    }
    marcar(ctx.get(ruta) ?? '');
    return caja;
}

/* ------------------------------------------------------ texto enriquecido */

const ETIQUETAS_OK = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'A', 'SPAN']);
export function sanear(html) {
    const t = document.createElement('template');
    t.innerHTML = String(html || '');
    (function limpiar(n) {
        [...n.childNodes].forEach((c) => {
            if (c.nodeType === 3) return;
            if (c.nodeType !== 1) { c.remove(); return; }
            if (c.tagName === 'DIV' || c.tagName === 'P') {
                limpiar(c);
                const frag = document.createDocumentFragment();
                if (c.previousSibling) frag.appendChild(document.createElement('br'));
                while (c.firstChild) frag.appendChild(c.firstChild);
                c.replaceWith(frag);
                return;
            }
            if (!ETIQUETAS_OK.has(c.tagName)) {
                if (/^(SCRIPT|STYLE|IFRAME)$/.test(c.tagName)) { c.remove(); return; }
                limpiar(c);
                c.replaceWith(...c.childNodes);
                return;
            }
            [...c.attributes].forEach((a) => {
                const ok = (c.tagName === 'A' && a.name === 'href' && /^(https:\/\/|mailto:|#)/i.test(a.value)) ||
                    (a.name === 'class' && /^(welcome-titulo-acento|hpcms-[\w-]+)$/.test(a.value));
                if (!ok) c.removeAttribute(a.name);
            });
            limpiar(c);
        });
    })(t.content);
    const d = document.createElement('div');
    d.appendChild(t.content);
    return d.innerHTML.replace(/(<br>)+$/, '').replace(/&nbsp;/g, ' ').trim();
}

export function editorRico(ctx, ruta, { placeholder = '', unaLinea = false, alCambiar } = {}) {
    const area = h('div', {
        class: 'rico-area' + (unaLinea ? ' rico-area--linea' : ''), contenteditable: 'true', role: 'textbox',
        'aria-multiline': String(!unaLinea), 'data-placeholder': placeholder, spellcheck: 'true'
    });
    area.innerHTML = sanear(ctx.get(ruta) || '');
    const guardar = () => {
        const v = sanear(area.innerHTML);
        ctx.set(ruta, v);
        area.classList.toggle('is-vacio', !area.textContent.trim());
        if (alCambiar) alCambiar(v);
    };
    area.classList.toggle('is-vacio', !area.textContent.trim());
    area.addEventListener('input', guardar);
    area.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && unaLinea) e.preventDefault();
        if ((e.ctrlKey || e.metaKey) && /^[bi]$/i.test(e.key)) { e.preventDefault(); document.execCommand(e.key.toLowerCase() === 'b' ? 'bold' : 'italic'); guardar(); }
    });
    area.addEventListener('paste', (e) => {
        e.preventDefault();
        const txt = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, unaLinea ? txt.replace(/\s*\n\s*/g, ' ') : txt);
    });
    const boton = (ic, titulo, accion) => {
        const b = h('button', { type: 'button', class: 'rico-btn', title: titulo, 'aria-label': titulo }, icono(ic));
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => { area.focus(); accion(); guardar(); });
        return b;
    };
    const barra = h('div', { class: 'rico-barra' },
        boton('fa-solid fa-bold', 'Negrita (Ctrl+B)', () => document.execCommand('bold')),
        boton('fa-solid fa-italic', 'Cursiva (Ctrl+I)', () => document.execCommand('italic')),
        boton('fa-solid fa-link', 'Enlace', () => {
            const url = prompt('Dirección del enlace (https://…)', 'https://');
            if (url && /^https:\/\//i.test(url)) document.execCommand('createLink', false, url);
        }),
        boton('fa-solid fa-text-slash', 'Quitar formato', () => { document.execCommand('removeFormat'); document.execCommand('unlink'); }),
        h('span', { class: 'rico-sep' }),
        ...['🎄', '🎁', '🔥', '⚡', '🚚', '💝', '✨', '📅'].map((em) => {
            const b = h('button', { type: 'button', class: 'rico-btn rico-btn--emoji', title: 'Insertar ' + em }, em);
            b.addEventListener('mousedown', (e) => e.preventDefault());
            b.addEventListener('click', () => { area.focus(); document.execCommand('insertText', false, em); guardar(); });
            return b;
        }));
    const caja = h('div', { class: 'rico' }, barra, area);
    caja.valor = (v) => { area.innerHTML = sanear(v || ''); guardar(); };
    return caja;
}

/* -------------------------------------------------------------- iconos */

export function selectorIcono(ctx, ruta, { permitirVacio = true, original } = {}) {
    const caja = h('div', { class: 'iconos' });
    const actual = () => ctx.get(ruta) || '';
    const pintar = () => caja.querySelectorAll('.icono-op').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.valor === actual())));
    const lista = permitirVacio ? [''].concat(ICONOS) : ICONOS;
    lista.forEach((ic) => {
        const b = h('button', { type: 'button', class: 'icono-op', 'data-valor': ic, title: ic ? ic.replace(/^fa[bs]? fa-/, '') : (original ? 'Original' : 'Sin ícono') },
            ic ? icono(ic) : (original ? icono(original + ' is-original') : h('span', { class: 'icono-nada' }, '∅')));
        b.addEventListener('click', () => { ctx.set(ruta, ic, { inmediato: true }); pintar(); });
        caja.appendChild(b);
    });
    pintar();
    return caja;
}

/* ------------------------------------------------------------ vigencia */

export function chipVigencia(o, ahora) {
    const e = estadoVigencia(o, ahora);
    const textos = {
        activo: o && o.hasta ? 'Activo · termina ' + relativo(o.hasta, ahora) : 'Activo',
        programado: 'Programado · ' + relativo(o.desde, ahora),
        vencido: 'Finalizado',
        inactivo: 'Pausado'
    };
    return h('span', { class: 'chip chip--' + e }, h('span', { class: 'chip-punto' }), textos[e]);
}

export function vigencia(ctx, base, { alCambiar } = {}) {
    const ruta = (k) => (base ? base + '.' : '') + k;
    const resumen = h('span', { class: 'vig-resumen' });
    const actualizarResumen = () => {
        const d = ctx.get(ruta('desde')), hst = ctx.get(ruta('hasta'));
        resumen.textContent = !d && !hst ? 'Siempre visible'
            : (d ? 'Desde ' + fecha(d) : 'Desde ahora') + (hst ? ' hasta ' + fecha(hst) : ', sin fecha de fin');
    };
    const inp = (k) => {
        const el = h('input', { type: 'datetime-local', class: 'control control--fecha', value: aLocal(ctx.get(ruta(k))) });
        el.addEventListener('change', () => { ctx.set(ruta(k), deLocal(el.value), { inmediato: true }); actualizarResumen(); if (alCambiar) alCambiar(); });
        return el;
    };
    const desde = inp('desde');
    const hasta = inp('hasta');
    const atajo = (texto, fn) => {
        const b = h('button', { type: 'button', class: 'atajo' }, texto);
        b.addEventListener('click', () => {
            const [k, v] = fn();
            ctx.set(ruta(k), v, { inmediato: true });
            (k === 'desde' ? desde : hasta).value = aLocal(v);
            actualizarResumen();
            if (alCambiar) alCambiar();
        });
        return b;
    };
    const finDia = (dias) => { const f = new Date(); f.setDate(f.getDate() + dias); f.setHours(23, 59, 0, 0); return f.getTime(); };
    actualizarResumen();
    return h('div', { class: 'vig' },
        h('div', { class: 'vig-cabeza' }, icono('fa-regular fa-calendar'), resumen),
        h('div', { class: 'vig-campos' },
            h('label', { class: 'vig-campo' }, h('span', null, 'Inicio'), desde),
            h('label', { class: 'vig-campo' }, h('span', null, 'Fin'), hasta)),
        h('div', { class: 'vig-atajos' },
            atajo('Empieza ahora', () => ['desde', 0]),
            atajo('Hoy 23:59', () => ['hasta', finDia(0)]),
            atajo('+3 días', () => ['hasta', finDia(3)]),
            atajo('+1 semana', () => ['hasta', finDia(7)]),
            atajo('Sin fin', () => ['hasta', 0])));
}

export function fechaHora(ctx, ruta, { alCambiar } = {}) {
    const el = h('input', { type: 'datetime-local', class: 'control control--fecha', value: aLocal(ctx.get(ruta)) });
    el.addEventListener('change', () => { ctx.set(ruta, deLocal(el.value), { inmediato: true }); if (alCambiar) alCambiar(); });
    return el;
}

/* ------------------------------------------------------------ imágenes */

export function selectorImagen(ctx, ruta, { subir, anchoMax = 1920, etiqueta = 'Imagen', recomendacion = '', alCambiar } = {}) {
    const caja = h('div', { class: 'img-picker' });
    const vista = h('div', { class: 'img-vista' });
    const url = h('input', { type: 'url', class: 'control control--mono', placeholder: 'https://… o arrastrá un archivo', value: ctx.get(ruta) || '' });
    const archivo = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const progreso = h('div', { class: 'img-progreso' }, h('span'));
    const info = h('span', { class: 'img-info' });

    const pintar = () => {
        const v = ctx.get(ruta) || '';
        vista.innerHTML = '';
        caja.classList.toggle('tiene-imagen', !!v);
        if (v) {
            const img = h('img', { src: v, alt: '' });
            img.onload = () => { info.textContent = `${img.naturalWidth}×${img.naturalHeight}px`; };
            img.onerror = () => { info.textContent = 'No se pudo cargar la imagen'; };
            const quitar = h('button', { type: 'button', class: 'img-quitar', title: 'Quitar imagen', 'aria-label': 'Quitar imagen' }, icono('fa-solid fa-xmark'));
            quitar.addEventListener('click', () => { ctx.set(ruta, '', { inmediato: true }); url.value = ''; info.textContent = ''; pintar(); if (alCambiar) alCambiar(''); });
            vista.append(img, quitar);
        } else {
            vista.append(h('div', { class: 'img-vacia' },
                icono('fa-regular fa-image'),
                h('strong', null, 'Arrastrá una imagen o hacé clic'),
                h('span', null, recomendacion || 'JPG, PNG o WebP · se optimiza automáticamente')));
        }
    };
    const usar = (v) => { ctx.set(ruta, v, { inmediato: true }); url.value = v; pintar(); if (alCambiar) alCambiar(v); };

    const cargar = async (f) => {
        if (!f || !/^image\//.test(f.type)) { toast('El archivo no es una imagen.', 'error'); return; }
        if (f.size > 15 * 1024 * 1024) { toast('La imagen supera los 15 MB.', 'error'); return; }
        if (!subir) return;
        caja.classList.add('subiendo');
        progreso.firstChild.style.width = '4%';
        try {
            const r = await subir(f, { anchoMax, alProgreso: (p) => { progreso.firstChild.style.width = Math.max(4, p * 100) + '%'; } });
            usar(r.url);
            toast(`Imagen subida · ${(r.bytes / 1024).toFixed(0)} KB`, 'ok');
        } catch (err) {
            toast(err && err.code === 'storage/unauthorized' ? 'Storage rechazó la subida: revisá las reglas de Storage.' : 'No se pudo subir la imagen: ' + (err.message || err), 'error');
        } finally {
            caja.classList.remove('subiendo');
            progreso.firstChild.style.width = '0';
        }
    };

    vista.addEventListener('click', (e) => { if (!e.target.closest('.img-quitar')) archivo.click(); });
    archivo.addEventListener('change', () => { cargar(archivo.files[0]); archivo.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => caja.addEventListener(ev, (e) => { e.preventDefault(); caja.classList.add('arrastrando'); }));
    ['dragleave', 'drop'].forEach((ev) => caja.addEventListener(ev, (e) => { e.preventDefault(); caja.classList.remove('arrastrando'); }));
    caja.addEventListener('drop', (e) => { const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) cargar(f); });
    url.addEventListener('change', () => {
        const v = url.value.trim();
        if (v && !/^https:\/\//i.test(v)) { toast('La URL de la imagen debe empezar con https://', 'error'); return; }
        usar(v);
    });

    pintar();
    caja.append(
        etiqueta ? h('div', { class: 'campo-cabeza' }, h('span', { class: 'campo-etiqueta' }, etiqueta), info) : null,
        vista, progreso, url, archivo);
    return caja;
}

/* ----------------------------------------------------------- listas */

// Lista de elementos editables con agregar, duplicar, borrar y reordenar.
export function listaEditable(ctx, ruta, { crear, titulo, subtitulo, cuerpo, vacio, etiquetaAgregar = 'Agregar', abiertoInicial, max } = {}) {
    const items = () => ctx.get(ruta) || [];
    const caja = h('div', { class: 'lista' });
    const abiertos = ctx.abiertos || (ctx.abiertos = new Set());
    if (abiertoInicial) abiertos.add(abiertoInicial);

    const mover = (i, d) => {
        const arr = items().slice();
        const j = i + d;
        if (j < 0 || j >= arr.length) return;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        ctx.set(ruta, arr, { estructura: true });
    };

    const lista = items();
    if (!lista.length && vacio) caja.appendChild(h('div', { class: 'lista-vacia' }, vacio));

    lista.forEach((item, i) => {
        const id = item.id || String(i);
        const abierto = abiertos.has(id);
        const sub = (k, v, o) => ctx.set(`${ruta}.${i}.${k}`, v, o);
        const subCtx = Object.assign(Object.create(ctx), {
            get: (r) => ctx.get(`${ruta}.${i}${r ? '.' + r : ''}`),
            set: (r, v, o) => sub(r, v, o)
        });
        const tarjeta = h('article', { class: 'item' + (abierto ? ' is-abierto' : '') + (item.activo === false ? ' is-pausado' : ''), 'data-id': id, draggable: 'false' });
        const encabezado = h('div', { class: 'item-cabeza' });
        const asa = h('button', { type: 'button', class: 'item-asa', title: 'Arrastrar para reordenar', 'aria-label': 'Reordenar' }, icono('fa-solid fa-grip-vertical'));
        const tituloEl = h('button', { type: 'button', class: 'item-titulo', 'aria-expanded': String(abierto) },
            h('span', { class: 'item-titulo-texto' }, titulo(item, i) || 'Sin título'),
            subtitulo ? h('span', { class: 'item-sub' }, subtitulo(item, i)) : null);
        tituloEl.addEventListener('click', () => {
            if (abiertos.has(id)) abiertos.delete(id); else abiertos.add(id);
            ctx.render();
        });
        const activo = h('input', { type: 'checkbox', role: 'switch', class: 'switch-input', title: 'Activo' });
        activo.checked = item.activo !== false;
        activo.addEventListener('change', () => { sub('activo', activo.checked, { estructura: true }); });
        const acciones = h('div', { class: 'item-acciones' },
            h('label', { class: 'switch switch--mini', title: item.activo === false ? 'Activar' : 'Pausar' }, activo,
                h('span', { class: 'switch-pista', 'aria-hidden': 'true' }, h('span', { class: 'switch-perilla' }))),
            botonIcono('fa-solid fa-arrow-up', 'Subir', () => mover(i, -1), i === 0),
            botonIcono('fa-solid fa-arrow-down', 'Bajar', () => mover(i, 1), i === lista.length - 1),
            botonIcono('fa-regular fa-copy', 'Duplicar', () => {
                const arr = items().slice();
                const copia = JSON.parse(JSON.stringify(item));
                copia.id = (item.id || 'i').replace(/\d.*$/, '') + Date.now().toString(36);
                if (copia.nombre) copia.nombre += ' (copia)';
                arr.splice(i + 1, 0, copia);
                abiertos.add(copia.id);
                ctx.set(ruta, arr, { estructura: true });
            }, max && lista.length >= max),
            botonIcono('fa-regular fa-trash-can', 'Eliminar', async () => {
                if (!(await confirmar('¿Eliminar este elemento?', 'Podés deshacerlo con Ctrl+Z mientras no publiques.', { peligro: true, aceptar: 'Eliminar' }))) return;
                const arr = items().slice();
                arr.splice(i, 1);
                ctx.set(ruta, arr, { estructura: true });
            }, false, 'peligro'));
        encabezado.append(asa, tituloEl, acciones);
        tarjeta.appendChild(encabezado);
        if (abierto) tarjeta.appendChild(h('div', { class: 'item-cuerpo' }, cuerpo(subCtx, item, i)));

        // Reordenar arrastrando desde el asa
        asa.addEventListener('pointerdown', () => { tarjeta.draggable = true; });
        tarjeta.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); tarjeta.classList.add('arrastrando'); });
        tarjeta.addEventListener('dragend', () => { tarjeta.draggable = false; tarjeta.classList.remove('arrastrando'); });
        tarjeta.addEventListener('dragover', (e) => { e.preventDefault(); tarjeta.classList.add('destino'); });
        tarjeta.addEventListener('dragleave', () => tarjeta.classList.remove('destino'));
        tarjeta.addEventListener('drop', (e) => {
            e.preventDefault();
            tarjeta.classList.remove('destino');
            const desde = Number(e.dataTransfer.getData('text/plain'));
            if (isNaN(desde) || desde === i) return;
            const arr = items().slice();
            const [x] = arr.splice(desde, 1);
            arr.splice(i, 0, x);
            ctx.set(ruta, arr, { estructura: true });
        });
        caja.appendChild(tarjeta);
    });

    if (crear && !(max && lista.length >= max)) {
        const agregar = h('button', { type: 'button', class: 'btn btn--fantasma btn--agregar' }, icono('fa-solid fa-plus'), etiquetaAgregar);
        agregar.addEventListener('click', () => {
            const nuevo = crear();
            abiertos.add(nuevo.id);
            ctx.set(ruta, items().concat([nuevo]), { estructura: true });
        });
        caja.appendChild(agregar);
    }
    return caja;
}

export function botonIcono(ic, titulo, accion, deshabilitado, variante) {
    const b = h('button', { type: 'button', class: 'btn-icono' + (variante ? ' btn-icono--' + variante : ''), title: titulo, 'aria-label': titulo, disabled: deshabilitado || null }, icono(ic));
    b.addEventListener('click', (e) => { e.stopPropagation(); accion(e); });
    return b;
}

export function boton(texto, { icono: ic, variante = 'secundario', accion, titulo, tamano } = {}) {
    const b = h('button', { type: 'button', class: `btn btn--${variante}` + (tamano ? ' btn--' + tamano : ''), title: titulo }, ic ? icono(ic) : null, texto ? h('span', null, texto) : null);
    if (accion) b.addEventListener('click', accion);
    return b;
}

/* ------------------------------------------------------------ tarjetas */

export function tarjeta({ titulo, descripcion, icono: ic, acciones, cuerpo, clase }) {
    return h('section', { class: 'tarjeta' + (clase ? ' ' + clase : '') },
        titulo ? h('header', { class: 'tarjeta-cabeza' },
            h('div', { class: 'tarjeta-titulos' },
                h('h3', { class: 'tarjeta-titulo' }, ic ? icono(ic) : null, titulo),
                descripcion ? h('p', { class: 'tarjeta-desc', html: descripcion }) : null),
            acciones ? h('div', { class: 'tarjeta-acciones' }, acciones) : null) : null,
        h('div', { class: 'tarjeta-cuerpo' }, cuerpo));
}

export function aviso(texto, tipo = 'info', ic) {
    const iconos = { info: 'fa-solid fa-circle-info', alerta: 'fa-solid fa-triangle-exclamation', ok: 'fa-solid fa-circle-check', peligro: 'fa-solid fa-circle-exclamation' };
    return h('div', { class: 'aviso aviso--' + tipo }, icono(ic || iconos[tipo]), h('div', { html: texto }));
}

/* -------------------------------------------------------- toasts / diálogos */

let pilaToasts = null;
export function toast(texto, tipo = 'info', { accion, duracion = 4200 } = {}) {
    if (!pilaToasts) { pilaToasts = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(pilaToasts); }
    const iconos = { info: 'fa-solid fa-circle-info', ok: 'fa-solid fa-circle-check', error: 'fa-solid fa-circle-exclamation', alerta: 'fa-solid fa-triangle-exclamation' };
    const t = h('div', { class: 'toast toast--' + tipo }, icono(iconos[tipo] || iconos.info), h('span', { class: 'toast-texto' }, texto));
    if (accion) {
        const b = h('button', { type: 'button', class: 'toast-accion' }, accion.texto);
        b.addEventListener('click', () => { accion.fn(); cerrar(); });
        t.appendChild(b);
    }
    const cerrar = () => { t.classList.add('saliendo'); setTimeout(() => t.remove(), 240); };
    pilaToasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('visible'));
    setTimeout(cerrar, duracion);
    return cerrar;
}

export function dialogo({ titulo, descripcion, cuerpo, acciones = [], ancho = 'md', alCerrar }) {
    return new Promise((resolve) => {
        const anterior = document.activeElement;
        const raiz = h('div', { class: 'dlg' });
        const caja = h('div', { class: 'dlg-caja dlg-caja--' + ancho, role: 'dialog', 'aria-modal': 'true', 'aria-label': titulo });
        const cerrar = (valor) => {
            raiz.classList.remove('abierto');
            document.removeEventListener('keydown', tecla, true);
            setTimeout(() => { raiz.remove(); if (anterior && anterior.focus) anterior.focus(); }, 220);
            if (alCerrar) alCerrar(valor);
            resolve(valor);
        };
        const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(null); } };
        caja.append(
            h('header', { class: 'dlg-cabeza' },
                h('div', null, h('h2', { class: 'dlg-titulo' }, titulo), descripcion ? h('p', { class: 'dlg-desc', html: descripcion }) : null),
                botonIcono('fa-solid fa-xmark', 'Cerrar', () => cerrar(null))),
            cuerpo ? h('div', { class: 'dlg-cuerpo' }, cuerpo) : null,
            acciones.length ? h('footer', { class: 'dlg-pie' }, acciones.map((a) => {
                const b = boton(a.texto, { variante: a.variante || 'secundario', icono: a.icono });
                b.addEventListener('click', async () => {
                    if (a.validar && !(await a.validar())) return;
                    cerrar(a.valor !== undefined ? a.valor : true);
                });
                if (a.autofoco) setTimeout(() => b.focus(), 60);
                return b;
            })) : null);
        raiz.append(h('div', { class: 'dlg-velo', onclick: () => cerrar(null) }), caja);
        document.body.appendChild(raiz);
        document.addEventListener('keydown', tecla, true);
        requestAnimationFrame(() => requestAnimationFrame(() => raiz.classList.add('abierto')));
        raiz.cerrar = cerrar;
    });
}

export function confirmar(titulo, texto, { peligro = false, aceptar = 'Confirmar', cancelar = 'Cancelar' } = {}) {
    return dialogo({
        titulo, descripcion: texto, ancho: 'sm',
        acciones: [
            { texto: cancelar, variante: 'fantasma', valor: false },
            { texto: aceptar, variante: peligro ? 'peligro' : 'primario', valor: true, autofoco: true }
        ]
    }).then((v) => v === true);
}
