/* ==========================================================================
   app.js · Panel de Catálogos
   Orquesta: acceso root, estado por catálogo, deshacer/rehacer, autoguardado
   del borrador, publicación, historial, vista previa y paleta de comandos.
   ========================================================================== */
import { CATALOGOS, URL_SITIO, normalizar, clonar, leer, escribir, diferencias, contarCambios, validar, nuevoAnuncio, nuevoPopup, paraGuardar } from './schema.js';
import * as store from './store.js';
import { h, icono, boton, botonIcono, toast, dialogo, confirmar, aviso, fecha, relativo, escapar } from './ui.js';
import { SECCIONES } from './editores.js';
import { crearPreview } from './preview.js';

const $ = (s, r = document) => r.querySelector(s);

const app = {
    cat: 'mayorista',
    seccion: 'resumen',
    usuario: null,
    datos: {},          // cat -> { publicado, publicadoMeta, borrador, borradorMeta, cargado }
    deshacerPila: {},   // cat -> [json]
    rehacerPila: {},
    offset: 0,
    guardando: false,
    guardadoPendiente: false,
    ultimoGuardado: 0,
    categorias: null,
    codigos: null,
    get borrador() { return this.datos[this.cat].borrador; },
    set borrador(v) { this.datos[this.cat].borrador = v; },
    get publicado() { return this.datos[this.cat].publicado; }
};

/* ================================================================ arranque */

const { auth } = store.iniciarFirebase();
aplicarTema();

const temporizadorAuth = setTimeout(() => irALogin(), 8000);
auth.onAuthStateChanged(async (user) => {
    clearTimeout(temporizadorAuth);
    if (!user) { irALogin(); return; }
    app.usuario = user;
    const root = await store.esRoot(user.email);
    if (!root) { pantallaRestringida(user); return; }
    try {
        app.offset = (await store.horaServidor()) - Date.now();
        try { const c = localStorage.getItem('hpcms:panel:cat'); if (CATALOGOS[c]) app.cat = c; } catch (e) { /* nada */ }
        const hash = location.hash.replace(/^#\/?/, '').split('/');
        if (CATALOGOS[hash[0]]) app.cat = hash[0];
        if (SECCIONES.some((s) => s.id === hash[1])) app.seccion = hash[1];
        await Promise.all(Object.keys(CATALOGOS).map(cargarDatos));
        montar();
    } catch (e) {
        console.error(e);
        pantallaError(e);
    }
});

function irALogin() {
    location.href = '../login.html?redirect=' + encodeURIComponent(location.href);
}

async function cargarDatos(cat) {
    const d = await store.cargarCatalogo(cat);
    app.datos[cat] = Object.assign(d, { cargado: true });
    app.deshacerPila[cat] = [];
    app.rehacerPila[cat] = [];
    // Siempre al día con lo publicado (otro admin, otra pestaña)
    store.escucharPublicado(cat, (pub, meta) => {
        app.datos[cat].publicado = pub;
        app.datos[cat].publicadoMeta = meta;
        if (app.montado) actualizarCromo();
    });
    store.escucharBorrador(cat, (bor, meta) => {
        if (!meta || meta.sesion === store.SESION) return;
        const actual = JSON.stringify(paraGuardar(app.datos[cat].borrador));
        if (actual === JSON.stringify(paraGuardar(bor))) return;
        if (cat === app.cat && (app.guardadoPendiente || app.guardando)) return;
        app.datos[cat].borrador = bor;
        app.datos[cat].borradorMeta = meta;
        if (app.montado && cat === app.cat) {
            renderSeccion();
            app.preview.actualizar();
            toast(`${(meta.editor || 'Otro administrador').split('@')[0]} actualizó el borrador de ${CATALOGOS[cat].nombre}.`, 'info');
        }
        if (app.montado) actualizarCromo();
    });
}

/* ================================================================== tema */

function aplicarTema() {
    let t = 'auto';
    try { t = localStorage.getItem('hpcms:tema') || 'auto'; } catch (e) { /* nada */ }
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
}
function alternarTema() {
    const oscuroSistema = matchMedia('(prefers-color-scheme: dark)').matches;
    const actual = document.documentElement.getAttribute('data-theme') || (oscuroSistema ? 'dark' : 'light');
    const nuevo = actual === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('hpcms:tema', nuevo); } catch (e) { /* nada */ }
    document.documentElement.classList.add('tema-transicion');
    aplicarTema();
    setTimeout(() => document.documentElement.classList.remove('tema-transicion'), 400);
}

/* ============================================================== contexto */

let temporizadorGuardar = null;
let ultimaRuta = null;
let ultimoCambio = 0;

const ctx = {
    get(ruta) { return ruta ? leer(app.borrador, ruta) : app.borrador; },
    set(ruta, valor, { estructura = false } = {}) {
        const ahora = Date.now();
        // Agrupa en un solo paso de deshacer las teclas seguidas sobre el mismo campo
        if (ruta !== ultimaRuta || ahora - ultimoCambio > 900 || estructura) apilarDeshacer();
        ultimaRuta = estructura ? null : ruta;
        ultimoCambio = ahora;
        escribir(app.borrador, ruta, valor);
        alCambiar(estructura);
    },
    reemplazar(cfg) {
        apilarDeshacer();
        app.borrador = normalizar(cfg);
        alCambiar(true);
    },
    render() { renderSeccion(); }
};

function apilarDeshacer() {
    const pila = app.deshacerPila[app.cat];
    pila.push(JSON.stringify(app.borrador));
    if (pila.length > 120) pila.shift();
    app.rehacerPila[app.cat] = [];
}

function alCambiar(estructura) {
    app.guardadoPendiente = true;
    marcarGuardado('pendiente');
    clearTimeout(temporizadorGuardar);
    temporizadorGuardar = setTimeout(guardar, 900);
    app.preview.actualizar();
    if (estructura) renderSeccion();
    actualizarCromo();
}

async function guardar() {
    if (app.guardando) { temporizadorGuardar = setTimeout(guardar, 400); return; }
    app.guardando = true;
    app.guardadoPendiente = false;
    marcarGuardado('guardando');
    try {
        await store.guardarBorrador(app.cat, app.borrador, app.usuario);
        app.ultimoGuardado = Date.now();
        marcarGuardado('ok');
    } catch (e) {
        app.guardadoPendiente = true;
        marcarGuardado('error');
        errorFirebase(e, 'No se pudo guardar el borrador');
    } finally {
        app.guardando = false;
    }
}

async function guardarAhora() {
    clearTimeout(temporizadorGuardar);
    if (app.guardadoPendiente) await guardar();
}

app.deshacer = function () {
    const pila = app.deshacerPila[app.cat];
    if (!pila.length) { toast('No hay nada para deshacer.', 'info', { duracion: 1600 }); return; }
    app.rehacerPila[app.cat].push(JSON.stringify(app.borrador));
    app.borrador = normalizar(JSON.parse(pila.pop()));
    ultimaRuta = null;
    alCambiarSinPila();
};
app.rehacer = function () {
    const pila = app.rehacerPila[app.cat];
    if (!pila.length) return;
    app.deshacerPila[app.cat].push(JSON.stringify(app.borrador));
    app.borrador = normalizar(JSON.parse(pila.pop()));
    alCambiarSinPila();
};
function alCambiarSinPila() {
    app.guardadoPendiente = true;
    clearTimeout(temporizadorGuardar);
    temporizadorGuardar = setTimeout(guardar, 900);
    app.preview.actualizar();
    renderSeccion();
    actualizarCromo();
}

function errorFirebase(e, prefijo) {
    console.error(e);
    const denegado = e && /permission|PERMISSION_DENIED/i.test(String(e.code || e.message));
    toast(denegado
        ? `${prefijo}: Firebase negó el permiso. Desplegá las reglas de catalogoCMS (database.rules.munro.json).`
        : `${prefijo}: ${e.message || e}`, 'error', { duracion: 8000 });
}

/* ========================================================= API para secciones */

Object.assign(app, {
    ahora: () => Date.now() + app.offset,
    publicadoDe: (cat) => app.datos[cat].publicado,
    metaPublicadoDe: (cat) => app.datos[cat].publicadoMeta,
    borradorDe: (cat) => app.datos[cat].borrador,
    cambiosDe: (cat) => contarCambios(app.datos[cat].publicado, app.datos[cat].borrador),
    ir: (id) => irA(id),
    cambiarCatalogo: (cat) => cambiarCatalogo(cat),
    subir: (archivo, opciones) => store.subirImagen(app.cat, archivo, opciones),
    probarPopup: (p) => app.preview.probarPopup(p),
    historial: () => store.cargarHistorial(app.cat),
    plantillasPropias: () => store.cargarPlantillas().catch(() => []),
    guardarPlantilla: (nombre, secciones) => store.guardarPlantilla(nombre, secciones, app.borrador, app.usuario).catch((e) => errorFirebase(e, 'No se pudo guardar la plantilla')),
    borrarPlantilla: (id) => store.borrarPlantilla(id).catch((e) => errorFirebase(e, 'No se pudo borrar')),
    nuevo(tipo) {
        if (tipo === 'anuncio') {
            const a = nuevoAnuncio();
            (ctx.abiertos || (ctx.abiertos = new Set())).add(a.id);
            irA('anuncios', false);
            ctx.set('anuncios.items', app.borrador.anuncios.items.concat([a]), { estructura: true });
        } else if (tipo === 'popup') {
            const p = nuevoPopup();
            (ctx.abiertos || (ctx.abiertos = new Set())).add(p.id);
            irA('popups', false);
            ctx.set('popups', app.borrador.popups.concat([p]), { estructura: true });
        }
    },
    async copiarA(otro, secciones) {
        const destino = clonar(app.datos[otro].borrador);
        secciones.forEach((s) => { destino[s] = clonar(app.borrador[s]); });
        app.datos[otro].borrador = normalizar(destino);
        try { await store.guardarBorrador(otro, app.datos[otro].borrador, app.usuario); actualizarCromo(); }
        catch (e) { errorFirebase(e, 'No se pudo copiar'); }
    },
    async restaurar(version) {
        const ok = await confirmar(`¿Restaurar la versión ${version.version || ''}?`,
            `Se publica de inmediato en <b>${CATALOGOS[app.cat].nombre}</b> y reemplaza tu borrador. Queda registrada como una versión nueva.`, { aceptar: 'Restaurar y publicar' });
        if (!ok) return;
        ctx.reemplazar(version.config);
        await publicarAhora(`Restaurada la versión ${version.version || ''} (${fecha(version.fecha)})`);
    },
    vistaDiferencias,
    cargarCategorias
});

/* ======================================================= categorías / códigos */

let cargandoCategorias = null;
function cargarCategorias() {
    if (app.categorias || cargandoCategorias || typeof GOOGLE_SHEETS_CONFIG === 'undefined') return cargandoCategorias;
    const c = GOOGLE_SHEETS_CONFIG;
    cargandoCategorias = fetch(`https://sheets.googleapis.com/v4/spreadsheets/${c.SPREADSHEET_ID}/values/${encodeURIComponent('Lista!A2:D')}?key=${c.API_KEY}`)
        .then((r) => r.json())
        .then((j) => {
            const cats = new Set(), codigos = new Set(), visibles = new Set();
            (j.values || []).forEach((f) => {
                if (!f[3]) return;
                if (f[0]) { cats.add(String(f[0]).trim().toLowerCase()); visibles.add(String(f[0]).trim()); }
                if (f[2]) codigos.add(String(f[2]).trim().toLowerCase());
            });
            app.categorias = cats;
            app.codigos = codigos;
            const dl = $('#hp-categorias');
            if (dl) { dl.innerHTML = ''; [...visibles].sort().forEach((v) => dl.appendChild(h('option', { value: v }))); }
            if (app.seccion === 'insignias') renderSeccion();
        })
        .catch(() => { cargandoCategorias = null; });
    return cargandoCategorias;
}

/* ================================================================ montaje */

function montar() {
    document.body.innerHTML = '';
    document.body.classList.remove('cargando-app');
    app.preview = crearPreview({ obtenerConfig: () => app.borrador, obtenerAhora: () => app.ahora() });

    const segCats = h('div', { class: 'seg cat-switch', role: 'radiogroup', 'aria-label': 'Catálogo' },
        h('span', { class: 'seg-pill', 'aria-hidden': 'true' }),
        Object.values(CATALOGOS).map((c) => {
            const b = h('button', { type: 'button', class: 'seg-op', role: 'radio', 'data-cat': c.id, 'aria-checked': String(c.id === app.cat), style: { '--cat-color': c.color } },
                h('span', { class: 'cat-punto' }), h('span', null, c.nombre), h('span', { class: 'cat-pend', hidden: true }));
            b.addEventListener('click', () => cambiarCatalogo(c.id));
            return b;
        }));

    const topbar = h('header', { class: 'topbar' },
        h('div', { class: 'topbar-izq' },
            h('button', { type: 'button', class: 'btn-icono solo-movil', 'aria-label': 'Menú', onclick: () => document.body.classList.toggle('nav-abierta') }, icono('fa-solid fa-bars')),
            h('a', { class: 'marca', href: '../index.html', title: 'Volver a HomePoint' },
                h('span', { class: 'marca-logo' }, 'hp'),
                h('span', { class: 'marca-textos' }, h('strong', null, 'Catálogos'), h('span', null, 'Panel de contenido'))),
            segCats),
        h('div', { class: 'topbar-der' },
            h('span', { class: 'guardado', id: 'guardado' }, h('span', { class: 'guardado-luz' }), h('span', { class: 'guardado-texto' }, 'Al día')),
            botonIcono('fa-solid fa-rotate-left', 'Deshacer (Ctrl+Z)', () => app.deshacer()),
            botonIcono('fa-solid fa-rotate-right', 'Rehacer (Ctrl+Shift+Z)', () => app.rehacer()),
            h('button', { type: 'button', class: 'buscador', onclick: abrirPaleta, title: 'Buscar acciones (Ctrl+K)' },
                icono('fa-solid fa-magnifying-glass'), h('span', { class: 'solo-ancho' }, 'Buscar o actuar'), h('kbd', null, navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K')),
            botonIcono('fa-solid fa-circle-half-stroke', 'Tema claro/oscuro', alternarTema),
            botonIcono('fa-solid fa-table-columns', 'Mostrar u ocultar la vista previa', alternarPreview),
            h('button', { type: 'button', class: 'btn btn--fantasma cambios-btn', id: 'cambiosBtn', onclick: abrirPublicar, hidden: true },
                h('span', { class: 'cambios-num' }, '0'), h('span', { class: 'solo-ancho' }, 'cambios')),
            h('button', { type: 'button', class: 'btn btn--primario publicar-btn', id: 'publicarBtn', onclick: abrirPublicar },
                icono('fa-solid fa-paper-plane'), h('span', null, 'Publicar')),
            h('div', { class: 'usuario', title: app.usuario.email },
                h('span', { class: 'usuario-avatar' }, (app.usuario.email || '?').slice(0, 1).toUpperCase()))));

    const grupos = [];
    SECCIONES.forEach((s) => { let g = grupos.find((x) => x.nombre === s.grupo); if (!g) grupos.push(g = { nombre: s.grupo, items: [] }); g.items.push(s); });
    const nav = h('nav', { class: 'nav', 'aria-label': 'Secciones' },
        grupos.map((g) => h('div', { class: 'nav-grupo' },
            h('span', { class: 'nav-grupo-titulo' }, g.nombre),
            g.items.map((s) => h('a', { class: 'nav-item', href: `#/${app.cat}/${s.id}`, 'data-seccion': s.id, onclick: (e) => { e.preventDefault(); irA(s.id); } },
                icono(s.icono), h('span', { class: 'nav-texto' }, s.titulo), h('span', { class: 'nav-insignia', hidden: true }), h('span', { class: 'nav-punto', hidden: true }))))),
        h('div', { class: 'nav-pie' },
            h('a', { class: 'nav-item nav-item--sutil', href: URL_SITIO + CATALOGOS[app.cat].archivo, target: '_blank', rel: 'noopener', id: 'navVerSitio' }, icono('fa-solid fa-globe'), h('span', { class: 'nav-texto' }, 'Ver catálogo publicado')),
            h('button', { type: 'button', class: 'nav-item nav-item--sutil', onclick: () => auth.signOut().then(irALogin) }, icono('fa-solid fa-arrow-right-from-bracket'), h('span', { class: 'nav-texto' }, 'Cerrar sesión'))));

    const main = h('main', { class: 'editor', id: 'editor', tabindex: '-1' });
    const shell = h('div', { class: 'shell' + (preferenciaPreview() ? '' : ' sin-preview') }, nav, main, app.preview.elemento);
    document.body.append(topbar, shell, h('datalist', { id: 'hp-categorias' }), h('div', { class: 'nav-velo', onclick: () => document.body.classList.remove('nav-abierta') }));
    app.montado = true;

    renderSeccion();
    actualizarCromo();
    app.preview.cargar(app.cat);
    moverPillCats();
    new ResizeObserver(moverPillCats).observe(segCats);
    instalarAtajos();
    setInterval(() => { marcarGuardado(); }, 15000);
    window.addEventListener('hashchange', () => {
        const [c, s] = location.hash.replace(/^#\/?/, '').split('/');
        if (CATALOGOS[c] && c !== app.cat) cambiarCatalogo(c);
        if (s && s !== app.seccion && SECCIONES.some((x) => x.id === s)) irA(s, false);
    });
    window.addEventListener('beforeunload', (e) => { if (app.guardadoPendiente || app.guardando) { guardar(); e.preventDefault(); e.returnValue = ''; } });
}

function preferenciaPreview() {
    try { return localStorage.getItem('hpcms:preview') !== 'oculta'; } catch (e) { return true; }
}
function alternarPreview() {
    const shell = $('.shell');
    // En pantallas angostas la vista previa es un cajón: se abre y cierra aparte
    if (matchMedia('(max-width: 1180px)').matches) {
        shell.classList.toggle('pv-movil');
        setTimeout(() => app.preview.ajustar(), 520);
        return;
    }
    shell.classList.toggle('sin-preview');
    try { localStorage.setItem('hpcms:preview', shell.classList.contains('sin-preview') ? 'oculta' : 'visible'); } catch (e) { /* nada */ }
    setTimeout(() => app.preview.ajustar(), 360);
}

function moverPillCats() {
    const seg = $('.cat-switch');
    if (!seg) return;
    const sel = seg.querySelector('[aria-checked="true"]');
    const pill = seg.querySelector('.seg-pill');
    if (!sel || !pill) return;
    pill.style.width = sel.offsetWidth + 'px';
    pill.style.transform = `translateX(${sel.offsetLeft - 3}px)`;
    pill.style.setProperty('--cat-color', CATALOGOS[app.cat].color);
}

/* ============================================================== navegación */

function irA(id, render = true) {
    app.seccion = id;
    history.replaceState(null, '', `#/${app.cat}/${id}`);
    document.body.classList.remove('nav-abierta');
    document.querySelectorAll('.nav-item[data-seccion]').forEach((a) => {
        a.classList.toggle('is-actual', a.dataset.seccion === id);
        a.href = `#/${app.cat}/${a.dataset.seccion}`;
    });
    if (render) renderSeccion(true);
}

async function cambiarCatalogo(cat) {
    if (cat === app.cat || !CATALOGOS[cat]) return;
    await guardarAhora();
    app.cat = cat;
    ctx.abiertos = new Set();
    try { localStorage.setItem('hpcms:panel:cat', cat); } catch (e) { /* nada */ }
    document.documentElement.style.setProperty('--cat-color', CATALOGOS[cat].color);
    document.querySelectorAll('.cat-switch .seg-op').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.cat === cat)));
    moverPillCats();
    const ver = $('#navVerSitio');
    if (ver) ver.href = URL_SITIO + CATALOGOS[cat].archivo;
    irA(app.seccion, false);
    renderSeccion(true);
    actualizarCromo();
    app.preview.cargar(cat);
}

function renderSeccion(conTransicion) {
    const main = $('#editor');
    if (!main) return;
    const s = SECCIONES.find((x) => x.id === app.seccion) || SECCIONES[0];
    const scroll = main.scrollTop;
    const foco = document.activeElement && main.contains(document.activeElement) ? document.activeElement : null;
    let contenido;
    try { contenido = s.render(ctx, app); }
    catch (e) { console.error(e); contenido = aviso('Esta sección tuvo un error al dibujarse: ' + escapar(e.message), 'peligro'); }
    main.innerHTML = '';
    document.documentElement.style.setProperty('--cat-color', CATALOGOS[app.cat].color);
    main.append(
        h('header', { class: 'editor-cabeza' + (conTransicion ? ' entrando' : '') },
            h('div', { class: 'editor-migas' },
                h('span', { class: 'miga-cat', style: { '--cat-color': CATALOGOS[app.cat].color } }, h('span', { class: 'cat-punto' }), CATALOGOS[app.cat].nombre),
                icono('fa-solid fa-chevron-right'),
                h('span', null, s.grupo)),
            h('h1', { class: 'editor-titulo' }, s.titulo),
            h('p', { class: 'editor-desc' }, s.descripcion)),
        h('div', { class: 'editor-cuerpo' + (conTransicion ? ' entrando' : '') }, contenido));
    document.querySelectorAll('.nav-item[data-seccion]').forEach((a) => a.classList.toggle('is-actual', a.dataset.seccion === app.seccion));
    if (conTransicion) main.scrollTop = 0;
    else {
        main.scrollTop = scroll;
        void foco;
    }
}

/* ============================================================== cromo / estado */

function actualizarCromo() {
    if (!app.montado) return;
    const n = app.cambiosDe(app.cat);
    const btn = $('#cambiosBtn');
    btn.hidden = n === 0;
    btn.querySelector('.cambios-num').textContent = String(n);
    btn.querySelector('.solo-ancho').textContent = n === 1 ? 'cambio' : 'cambios';
    $('#publicarBtn').classList.toggle('tiene-cambios', n > 0);
    document.querySelectorAll('.cat-switch .seg-op').forEach((b) => {
        const p = app.cambiosDe(b.dataset.cat);
        const el = b.querySelector('.cat-pend');
        el.hidden = !p;
        el.textContent = p;
        el.title = `${p} cambios sin publicar`;
    });
    // Insignias y puntos de "modificado" en la navegación
    const dif = diferencias(app.publicado, app.borrador);
    const seccionesCambiadas = new Set(dif.map((d) => d.seccion));
    const mapa = { estado: ['estado'], anuncios: ['anuncios'], popups: ['popups'], banners: ['banners'], textos: ['textos', 'ocultar'], faq: ['faq'], contacto: ['contacto'], condiciones: ['condiciones'], insignias: ['insignias'], apariencia: ['apariencia'] };
    document.querySelectorAll('.nav-item[data-seccion]').forEach((a) => {
        const s = SECCIONES.find((x) => x.id === a.dataset.seccion);
        const ins = s.insignia ? s.insignia(app) : null;
        const elI = a.querySelector('.nav-insignia');
        elI.hidden = !ins;
        if (ins) { elI.textContent = ins.texto; elI.className = 'nav-insignia' + (ins.tipo ? ' nav-insignia--' + ins.tipo : ''); }
        const cambiado = (mapa[s.id] || []).some((k) => seccionesCambiadas.has(k)) ||
            (s.id === 'contacto' && dif.some((d) => d.seccion === 'textos' && d.cambios.some((c) => /direccion|horario/.test(c.ruta))));
        a.querySelector('.nav-punto').hidden = !cambiado;
    });
    document.title = (n ? `(${n}) ` : '') + 'Catálogos · HomePoint';
}

function marcarGuardado(estado) {
    const el = $('#guardado');
    if (!el) return;
    if (estado) el.dataset.estado = estado;
    const e = el.dataset.estado;
    const t = el.querySelector('.guardado-texto');
    if (e === 'pendiente') t.textContent = 'Editando…';
    else if (e === 'guardando') t.textContent = 'Guardando…';
    else if (e === 'error') t.textContent = 'Sin guardar';
    else t.textContent = app.ultimoGuardado ? 'Borrador guardado · ' + relativo(app.ultimoGuardado) : 'Al día';
}

/* ============================================================== publicar */

function etiquetaRuta(r) {
    return r.replace(/\[[a-z]\w+\]/g, (m) => ' ›').replace(/\[(\d+)\]/g, ' #$1').replace(/\./g, ' › ')
        .replace(/items|cambios/g, '').replace(/ ›\s*›/g, ' ›').replace(/^\s*›\s*|\s*›\s*$/g, '');
}
function valorCorto(v) {
    if (v === undefined) return '—';
    if (typeof v === 'number' && v > 1e12) return fecha(v);
    const t = String(v).replace(/<[^>]+>/g, '');
    return t.length > 60 ? t.slice(0, 58) + '…' : t;
}

function vistaDiferencias(dif, vacio = 'Sin cambios.') {
    if (!dif.length) return h('div', { class: 'lista-vacia' }, vacio);
    return h('div', { class: 'difs' }, dif.map((g) => h('details', { class: 'dif-grupo', open: dif.length <= 3 || null },
        h('summary', null, h('strong', null, g.etiqueta), h('span', { class: 'dif-num' }, String(g.cambios.length))),
        h('ul', null, g.cambios.slice(0, 40).map((c) => h('li', null,
            h('span', { class: 'dif-ruta' }, etiquetaRuta(c.ruta.replace(/^[^.[]+[.]?/, '')) || g.etiqueta),
            h('span', { class: 'dif-val' },
                h('del', null, valorCorto(c.antes)), icono('fa-solid fa-arrow-right'), h('ins', null, valorCorto(c.despues)))))))));
}

async function abrirPublicar() {
    await guardarAhora();
    const dif = diferencias(app.publicado, app.borrador);
    const errores = validar(app.borrador);
    const nota = h('input', { class: 'control', placeholder: 'Ej: Campaña de Navidad, nuevo mínimo…', maxlength: 120 });
    const nombre = CATALOGOS[app.cat].nombre;
    const acciones = [{ texto: 'Cancelar', variante: 'fantasma', valor: false }];
    if (dif.length) acciones.unshift({ texto: 'Descartar cambios', variante: 'fantasma-peligro', valor: 'descartar' });
    if (dif.length && !errores.length) acciones.push({ texto: `Publicar en ${nombre}`, variante: 'primario', valor: 'publicar', icono: 'fa-solid fa-paper-plane', autofoco: true });
    const r = await dialogo({
        titulo: dif.length ? `Publicar ${nombre}` : 'Nada para publicar',
        descripcion: dif.length ? 'Los cambios llegan al instante a quienes tengan el catálogo abierto.' : 'El borrador es igual a lo publicado.',
        ancho: 'lg',
        cuerpo: h('div', { class: 'pila' },
            errores.length ? aviso('<b>Corregí esto antes de publicar:</b><ul>' + errores.map((e) => `<li>${escapar(e)}</li>`).join('') + '</ul>', 'peligro') : null,
            vistaDiferencias(dif),
            dif.length && !errores.length ? h('div', { class: 'campo' }, h('label', { class: 'campo-etiqueta' }, 'Nota de la versión (opcional)'), nota) : null),
        acciones
    });
    if (r === 'publicar') await publicarAhora(nota.value.trim(), contarCambios(app.publicado, app.borrador));
    else if (r === 'descartar') {
        if (!(await confirmar('¿Descartar los cambios?', 'El borrador vuelve a ser igual a lo publicado. Podés deshacerlo con Ctrl+Z.', { peligro: true, aceptar: 'Descartar' }))) return;
        ctx.reemplazar(app.publicado);
        toast('Cambios descartados.', 'ok', { accion: { texto: 'Deshacer', fn: () => app.deshacer() } });
    }
}

async function publicarAhora(nota, cambios) {
    const btn = $('#publicarBtn');
    btn.classList.add('publicando');
    btn.disabled = true;
    try {
        clearTimeout(temporizadorGuardar);
        app.guardadoPendiente = false;
        const anterior = clonar(app.publicado);
        anterior.meta = app.datos[app.cat].publicadoMeta;
        const pub = await store.publicar(app.cat, app.borrador, anterior, app.usuario, nota, cambios || contarCambios(app.publicado, app.borrador));
        app.datos[app.cat].publicado = pub;
        app.borrador = normalizar(pub);
        app.ultimoGuardado = Date.now();
        marcarGuardado('ok');
        btn.classList.add('publicado');
        setTimeout(() => btn.classList.remove('publicado'), 1600);
        toast(`Publicado en ${CATALOGOS[app.cat].nombre}. Los clientes ya lo ven.`, 'ok', { accion: { texto: 'Ver', fn: () => window.open(URL_SITIO + CATALOGOS[app.cat].archivo, '_blank', 'noopener') } });
        renderSeccion();
        actualizarCromo();
    } catch (e) {
        errorFirebase(e, 'No se pudo publicar');
    } finally {
        btn.classList.remove('publicando');
        btn.disabled = false;
    }
}

/* ========================================================= paleta de comandos */

function comandos() {
    const lista = [];
    SECCIONES.forEach((s) => lista.push({ texto: s.titulo, detalle: 'Ir a la sección', icono: s.icono, fn: () => irA(s.id) }));
    Object.values(CATALOGOS).forEach((c) => { if (c.id !== app.cat) lista.push({ texto: `Cambiar a ${c.nombre}`, detalle: 'Catálogo', icono: 'fa-solid fa-right-left', fn: () => cambiarCatalogo(c.id) }); });
    const pausado = app.borrador.estado.modo === 'pausado';
    lista.push(
        { texto: 'Publicar cambios', detalle: 'Ctrl+S guarda · Publicar los envía', icono: 'fa-solid fa-paper-plane', fn: abrirPublicar },
        { texto: pausado ? 'Reanudar pedidos' : 'Pausar pedidos', detalle: 'Estado del sitio', icono: pausado ? 'fa-solid fa-play' : 'fa-solid fa-pause', fn: () => { ctx.set('estado.modo', pausado ? 'abierto' : 'pausado', { estructura: true }); irA('estado'); } },
        { texto: 'Nuevo anuncio', detalle: 'Barra de anuncios', icono: 'fa-solid fa-bullhorn', fn: () => app.nuevo('anuncio') },
        { texto: 'Nuevo pop-up', detalle: 'Pop-ups', icono: 'fa-regular fa-window-restore', fn: () => app.nuevo('popup') },
        { texto: 'Deshacer', detalle: 'Ctrl+Z', icono: 'fa-solid fa-rotate-left', fn: () => app.deshacer() },
        { texto: 'Rehacer', detalle: 'Ctrl+Shift+Z', icono: 'fa-solid fa-rotate-right', fn: () => app.rehacer() },
        { texto: 'Mostrar u ocultar la vista previa', detalle: 'Ctrl+.', icono: 'fa-solid fa-table-columns', fn: alternarPreview },
        { texto: 'Cambiar tema claro/oscuro', detalle: 'Apariencia del panel', icono: 'fa-solid fa-circle-half-stroke', fn: alternarTema },
        { texto: 'Abrir el catálogo publicado', detalle: CATALOGOS[app.cat].archivo, icono: 'fa-solid fa-arrow-up-right-from-square', fn: () => window.open(URL_SITIO + CATALOGOS[app.cat].archivo, '_blank', 'noopener') }
    );
    return lista;
}

function normalizarTexto(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function abrirPaleta() {
    if ($('.paleta')) return;
    const todos = comandos();
    const input = h('input', { class: 'paleta-input', placeholder: 'Buscá una sección o acción…', 'aria-label': 'Buscar', autocomplete: 'off' });
    const lista = h('ul', { class: 'paleta-lista', role: 'listbox' });
    let sel = 0;
    let filtrados = todos;
    const raiz = h('div', { class: 'paleta' }, h('div', { class: 'paleta-velo' }), h('div', { class: 'paleta-caja', role: 'dialog', 'aria-label': 'Paleta de comandos' },
        h('div', { class: 'paleta-cabeza' }, icono('fa-solid fa-magnifying-glass'), input, h('kbd', null, 'Esc')), lista));
    const cerrar = () => { raiz.classList.remove('abierta'); setTimeout(() => raiz.remove(), 180); };
    const ejecutar = (c) => { cerrar(); setTimeout(() => c.fn(), 60); };
    const pintar = () => {
        const q = normalizarTexto(input.value.trim());
        filtrados = !q ? todos : todos.filter((c) => normalizarTexto(c.texto + ' ' + c.detalle).includes(q));
        sel = Math.min(sel, Math.max(0, filtrados.length - 1));
        lista.innerHTML = '';
        if (!filtrados.length) lista.appendChild(h('li', { class: 'paleta-vacia' }, 'Sin resultados'));
        filtrados.forEach((c, i) => {
            const li = h('li', { class: 'paleta-item' + (i === sel ? ' is-sel' : ''), role: 'option', 'aria-selected': String(i === sel) },
                h('span', { class: 'paleta-icono' }, icono(c.icono)), h('span', { class: 'paleta-texto' }, c.texto), h('span', { class: 'paleta-detalle' }, c.detalle));
            li.addEventListener('mousemove', () => { if (sel !== i) { sel = i; pintar(); } });
            li.addEventListener('click', () => ejecutar(c));
            lista.appendChild(li);
        });
        const s = lista.querySelector('.is-sel');
        if (s) s.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => { sel = 0; pintar(); });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(filtrados.length - 1, sel + 1); pintar(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); pintar(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (filtrados[sel]) ejecutar(filtrados[sel]); }
        else if (e.key === 'Escape') { e.preventDefault(); cerrar(); }
    });
    raiz.querySelector('.paleta-velo').addEventListener('click', cerrar);
    document.body.appendChild(raiz);
    pintar();
    requestAnimationFrame(() => { raiz.classList.add('abierta'); input.focus(); });
}

function instalarAtajos() {
    document.addEventListener('keydown', (e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        const enTexto = e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]');
        const k = e.key.toLowerCase();
        if (k === 'k') { e.preventDefault(); abrirPaleta(); }
        else if (k === 's') { e.preventDefault(); guardarAhora().then(() => toast('Borrador guardado.', 'ok', { duracion: 1600 })); }
        else if (k === '.') { e.preventDefault(); alternarPreview(); }
        else if (k === 'enter') { e.preventDefault(); abrirPublicar(); }
        else if (k === 'z' && !enTexto) { e.preventDefault(); if (e.shiftKey) app.rehacer(); else app.deshacer(); }
        else if (k === 'y' && !enTexto) { e.preventDefault(); app.rehacer(); }
    });
}

/* ========================================================= pantallas de acceso */

function pantallaRestringida(user) {
    document.body.classList.remove('cargando-app');
    document.body.innerHTML = '';
    document.body.appendChild(h('div', { class: 'puerta' },
        h('div', { class: 'puerta-caja' },
            h('span', { class: 'puerta-icono' }, icono('fa-solid fa-lock')),
            h('h1', null, 'Acceso restringido'),
            h('p', null, 'El Panel de Catálogos es sólo para usuarios con rol ', h('b', null, 'root'), '.'),
            h('p', { class: 'puerta-mail' }, user.email),
            h('div', { class: 'puerta-acciones' },
                boton('Volver a HomePoint', { variante: 'secundario', icono: 'fa-solid fa-arrow-left', accion: () => { location.href = '../index.html'; } }),
                boton('Cambiar de cuenta', { variante: 'fantasma', accion: () => auth.signOut().then(irALogin) })))));
}

function pantallaError(e) {
    document.body.classList.remove('cargando-app');
    document.body.innerHTML = '';
    const denegado = /permission/i.test(String(e && (e.code || e.message)));
    document.body.appendChild(h('div', { class: 'puerta' },
        h('div', { class: 'puerta-caja' },
            h('span', { class: 'puerta-icono puerta-icono--error' }, icono('fa-solid fa-triangle-exclamation')),
            h('h1', null, denegado ? 'Faltan las reglas de Firebase' : 'No se pudo abrir el panel'),
            h('p', { html: denegado
                ? 'Firebase rechazó la lectura de <code>catalogoCMS</code>. Desplegá las reglas de <code>database.rules.munro.json</code> en el proyecto <b>pedidos-87064</b> y recargá.'
                : escapar(e && (e.message || e)) }),
            h('div', { class: 'puerta-acciones' }, boton('Reintentar', { variante: 'primario', icono: 'fa-solid fa-rotate-right', accion: () => location.reload() })))));
}
