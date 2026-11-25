/* ==========================================================================
   schema.js · formato de la configuración de los catálogos
   --------------------------------------------------------------------------
   Fuente única del formato que escribe el panel y lee el runtime
   (CatalogoWeb/cms/catalogo-cms.js). Un campo vacío significa "usar lo que
   está en el código del catálogo": por eso los valores originales viven acá
   como referencia (placeholders y botón Restaurar) y no se guardan.
   ========================================================================== */

export const CATALOGOS = {
    mayorista: {
        id: 'mayorista',
        nombre: 'Mayorista',
        archivo: 'catalogo.html',
        descripcion: 'Distribuidora mayorista · envío y retiro en sucursal',
        color: '#376550',
        tieneDescuento: true,
        tieneRetiro: true,
        defaults: {
            minimo: { monto: 50000, unidades: 0 },
            descuento: { habilitado: true, umbral: 100000, unidades: 5, porcentaje: 10 }
        },
        whatsapp: [
            { clave: 'munro', etiqueta: 'Atención al público · Munro', ayuda: 'Menú de WhatsApp, pie de página y pedidos de retiro en Munro.', original: '5491121891006' },
            { clave: 'caseros', etiqueta: 'Sucursal Caseros', ayuda: 'Menú de WhatsApp, pie de página y pedidos de retiro en Caseros.', original: '5491124038349' },
            { clave: 'envios', etiqueta: 'Envíos y despachos', ayuda: 'Opción "Envíos & despachos" del menú de WhatsApp.', original: '5491176460030' }
        ],
        textos: [
            { grupo: 'Encabezado', clave: 'brandTag', etiqueta: 'Etiqueta junto al logo', original: 'Distribuidora Mayorista' },
            { grupo: 'Franja informativa', clave: 'infoBand1', etiqueta: 'Ítem 1', rico: true, icono: 'infoBand1Icono', iconoOriginal: 'fas fa-truck', ocultable: true, original: '<strong>Envíos a todo el país</strong> Rápidos y seguros' },
            { grupo: 'Franja informativa', clave: 'infoBand2', etiqueta: 'Ítem 2', rico: true, icono: 'infoBand2Icono', iconoOriginal: 'fas fa-dollar-sign', ocultable: true, original: 'Los valores publicados se encuentran <b>en pesos argentinos</b>' },
            { grupo: 'Bienvenida', clave: 'bienvenidaTitulo', etiqueta: 'Título del pop-up de bienvenida', original: 'Bienvenido al catálogo' },
            { grupo: 'Bienvenida', clave: 'bienvenidaSubtitulo', etiqueta: 'Subtítulo', original: 'PREGUNTAS FRECUENTES' },
            { grupo: 'Pantalla de carga', clave: 'cargando', etiqueta: 'Título', original: 'Cargando catálogo…' },
            { grupo: 'Pantalla de carga', clave: 'cargandoSub', etiqueta: 'Detalle', original: 'Estamos trayendo los productos y el stock actualizado desde el servidor.' },
            { grupo: 'Carrito', clave: 'descuentoNota', etiqueta: 'Nota bajo el descuento', original: 'No acumulable con otros descuentos o vouchers de compra' },
            { grupo: 'Pie de página', clave: 'footerMarca', etiqueta: 'Descripción de la marca', largo: true, original: 'Distribuidora mayorista de artículos para el hogar y uso personal, con envíos a todo el país.' },
            { grupo: 'Pie de página', clave: 'legal1', etiqueta: 'Línea legal izquierda', original: 'HomePoint · Distribuidora Mayorista' },
            { grupo: 'Pie de página', clave: 'legal2', etiqueta: 'Línea legal derecha', original: 'Los valores publicados están sujetos a la cotización del día.' }
        ],
        lugares: [
            { clave: 'direccionMunro', etiqueta: 'Dirección Munro (pie)', original: 'Vélez Sarsfield 4127, Munro, Buenos Aires' },
            { clave: 'direccionCaseros', etiqueta: 'Dirección Caseros (pie)', original: 'Av. San Martín 2724, Caseros, Buenos Aires' },
            { clave: 'horario', etiqueta: 'Horario de atención (pie)', original: 'Lunes a sábados de 10 a 19 hs' }
        ],
        faq: [
            { clave: 'minimo', pregunta: '¿Cuál es el mínimo de compra?', respuesta: 'En nuestros locales <strong>no hay</strong> requisitos ni minimos de compra. Podés venir y llevarte todo lo que necesites.<br>* No aplicable a envios.' },
            { clave: 'envios', pregunta: '¿Hacen envíos?', respuesta: 'Sí, enviamos a todo el país por medio de <strong>motomensajeria y fletes</strong> o encomiendas a través de <strong>Expreso Viacargo y Correo Argentino</strong>.<br>El costo de las encomiendas es determinado por estas empresas, y varía según el peso y tamaño de la caja.<br><strong>Los envíos cuentan con un mínimo de compra de $50.000</strong>', nota: 'El monto del mínimo se actualiza solo con lo que definas en Condiciones.' },
            { clave: 'video', pregunta: '¿Cómo hago mi primera compra con envío?', soloOcultar: true, nota: 'Abre el video tutorial: sólo se puede ocultar.' },
            { clave: 'pagos', pregunta: '¿Cuáles son las formas de pago?', respuesta: 'Aceptamos pagos en <strong>Efectivo</strong> y <strong>Transferencia Bancaria</strong> o de <strong>MercadoPago</strong>.<br>Tarjetas únicamente acercándote a nuestros locales.' },
            { clave: 'ubicacion', pregunta: '¿Donde estan ubicados?', soloPregunta: true, nota: 'Incluye el mapa: se puede cambiar la pregunta u ocultarla.' },
            { clave: 'garantia', pregunta: '¿Los articulos cuentan con garantia?', respuesta: 'Sí, los productos cuentan con cambio o reparación por defectos de fabricación a corto plazo, sujeto a evaluación técnica previa.<br>Los tiempos de respuesta pueden variar según el producto en cuestión.<br><strong>La garantía no cubre costos de envío o despacho.</strong>' }
        ],
        banners: {
            principal: ['image2.jpg', 'image3.jpg'],
            pie: ['imagepie1.jpg', 'imagepie2.jpg', 'imagepie3.jpg', 'imagepie4.jpg', 'imagepie5.jpg']
        }
    },
    interior: {
        id: 'interior',
        nombre: 'Interior',
        archivo: 'catalogoInterior.html',
        descripcion: 'Envíos al interior del país · precios de oferta',
        color: '#2a6a82',
        tieneDescuento: false,
        tieneRetiro: false,
        defaults: {
            minimo: { monto: 90000, unidades: 3 },
            descuento: { habilitado: false, umbral: 0, unidades: 0, porcentaje: 0 }
        },
        whatsapp: [
            { clave: 'envios', etiqueta: 'Envíos y despachos', ayuda: 'Botón de WhatsApp del encabezado y envío del pedido por WhatsApp.', original: '5491176460030' },
            { clave: 'munro', etiqueta: 'Contacto · pie de página', ayuda: 'Número que figura en el pie de página.', original: '5491121891006' }
        ],
        textos: [
            { grupo: 'Encabezado', clave: 'brandTag', etiqueta: 'Etiqueta junto al logo', original: 'Catálogo exclusivo Despachos' },
            { grupo: 'Franja informativa', clave: 'infoBand1', etiqueta: 'Ítem 1', rico: true, icono: 'infoBand1Icono', iconoOriginal: 'fas fa-truck', ocultable: true, original: '<strong>Envíos a todo el país</strong> Rápidos y seguros' },
            { grupo: 'Franja informativa', clave: 'infoBand2', etiqueta: 'Ítem 2', rico: true, icono: 'infoBand2Icono', iconoOriginal: 'fas fa-dollar-sign', ocultable: true, original: 'Los valores publicados se encuentran <b>en pesos argentinos</b>' },
            { grupo: 'Bienvenida · paso 1', clave: 'bienvenidaEtiqueta', etiqueta: 'Etiqueta superior', original: 'Catálogo del Interior' },
            { grupo: 'Bienvenida · paso 1', clave: 'bienvenidaTitulo', etiqueta: 'Título', rico: true, original: '¡Bienvenido a nuestro catálogo exclusivo para envíos al <span class="welcome-titulo-acento">Interior del País</span>!' },
            { grupo: 'Bienvenida · paso 1', clave: 'bienvenidaIntro', etiqueta: 'Introducción', original: 'Aquí vas a encontrar todos nuestros artículos con:' },
            { grupo: 'Bienvenida · paso 2', clave: 'faqTitulo', etiqueta: 'Título', original: 'Antes de empezar' },
            { grupo: 'Bienvenida · paso 2', clave: 'bienvenidaSubtitulo', etiqueta: 'Subtítulo', original: 'Preguntas frecuentes' },
            { grupo: 'Pantalla de carga', clave: 'cargando', etiqueta: 'Título', original: 'Cargando catálogo…' },
            { grupo: 'Pantalla de carga', clave: 'cargandoSub', etiqueta: 'Detalle', original: 'Estamos trayendo los productos y el stock actualizado desde el servidor.' },
            { grupo: 'Pie de página', clave: 'footerMarca', etiqueta: 'Descripción de la marca', largo: true, original: 'Distribuidora mayorista de artículos para el hogar y uso personal, con envíos a todo el país.' },
            { grupo: 'Pie de página', clave: 'legal1', etiqueta: 'Línea legal izquierda', original: 'HomePoint · Distribuidora Mayorista' },
            { grupo: 'Pie de página', clave: 'legal2', etiqueta: 'Línea legal derecha', original: 'Los valores publicados están sujetos a la cotización del día.' }
        ],
        lugares: [
            { clave: 'direccionMunro', etiqueta: 'Dirección (pie)', original: 'Vélez Sarsfield 4127, Munro, Buenos Aires' },
            { clave: 'horario', etiqueta: 'Horario de atención (pie)', original: 'Lunes a sábados de 10 a 19 hs' }
        ],
        faq: [
            { clave: 'minimo', pregunta: '¿Cuál es el mínimo de compra?', respuesta: 'El minimo de compra es de $90.000 y deben ser al menos 3 articulos (iguales o distintos) para poder realizar un pedido con envío.', nota: 'Monto y unidades se actualizan solos con lo que definas en Condiciones.' },
            { clave: 'envios', pregunta: '¿Como se hacen los envíos?', respuesta: 'Enviamos a todo el país por medio de encomiendas a través de <strong>Expreso Viacargo y Correo Argentino</strong>.<br>El costo de las encomiendas es determinado por estas empresas, y varía según el peso y tamaño que tenga finalmente el pedido.' },
            { clave: 'video', pregunta: '¿Cómo hago mi primera compra con envío?', soloOcultar: true, nota: 'Abre el video tutorial: sólo se puede ocultar.' },
            { clave: 'pagos', pregunta: '¿Cuáles son las formas de pago?', respuesta: 'Por el momento y para poder ofrecer el mejor precio posible, podes abonar mediante <strong>Transferencia Bancaria</strong> o de <strong>MercadoPago</strong>.<br>No contamos con opciones de financiación.' },
            { clave: 'ubicacion', pregunta: '¿Donde estan ubicados?', soloPregunta: true, nota: 'Incluye el mapa: se puede cambiar la pregunta u ocultarla.' },
            { clave: 'garantia', pregunta: '¿Los articulos cuentan con garantia?', respuesta: 'Sí, los productos cuentan con cambio o reparación por defectos de fabricación a corto plazo, sujeto a evaluación técnica previa.<br>Los tiempos de respuesta pueden variar según el producto en cuestión.<br><strong>La garantía no cubre costos de envío o despacho.</strong>' }
        ],
        banners: {
            principal: ['image3.jpg'],
            pie: ['imagepie1.jpg', 'imagepie2.jpg', 'imagepie3.jpg', 'imagepie4.jpg', 'imagepie5.jpg']
        }
    }
};

export const URL_SITIO = 'https://home-point.com.ar/';

/* ------------------------------------------------------------ opciones */

export const MODOS_ESTADO = [
    { valor: 'abierto', etiqueta: 'Abierto', icono: 'fa-solid fa-circle-check', ayuda: 'El catálogo funciona con normalidad.' },
    { valor: 'aviso', etiqueta: 'Aviso informativo', icono: 'fa-solid fa-circle-info', ayuda: 'Muestra un aviso al entrar, una vez por sesión. Los pedidos siguen habilitados.' },
    { valor: 'pausado', etiqueta: 'Pedidos en pausa', icono: 'fa-solid fa-circle-pause', ayuda: 'Se puede navegar el catálogo, pero no enviar pedidos. Ideal para feriados o inventario.' }
];

export const ESTILOS_ANUNCIO = [
    { valor: 'oscuro', etiqueta: 'Grafito', muestra: '#111827' },
    { valor: 'acento', etiqueta: 'Acento', muestra: 'var(--cat-color)' },
    { valor: 'alerta', etiqueta: 'Alerta', muestra: '#b42318' },
    { valor: 'suave', etiqueta: 'Suave', muestra: '#eef3f0' },
    { valor: 'festivo', etiqueta: 'Festivo', muestra: 'linear-gradient(100deg,#b91c1c,#166534)' }
];

export const FORMATOS_POPUP = [
    { valor: 'modal', etiqueta: 'Modal', icono: 'fa-regular fa-window-maximize' },
    { valor: 'sheet', etiqueta: 'Hoja inferior', icono: 'fa-solid fa-mobile-screen' },
    { valor: 'toast', etiqueta: 'Aviso flotante', icono: 'fa-regular fa-message' }
];

export const DISPARADORES = [
    { valor: 'carga', etiqueta: 'Al entrar al catálogo' },
    { valor: 'tiempo', etiqueta: 'Después de unos segundos' },
    { valor: 'carrito', etiqueta: 'Al agregar un producto al carrito' },
    { valor: 'abrirCarrito', etiqueta: 'Al abrir el carrito' },
    { valor: 'scroll', etiqueta: 'Al recorrer la mitad de la página' },
    { valor: 'salida', etiqueta: 'Al intentar salir (escritorio)' }
];

export const FRECUENCIAS = [
    { valor: 'sesion', etiqueta: 'Una vez por visita' },
    { valor: 'unaVez', etiqueta: 'Una sola vez por persona' },
    { valor: 'dias', etiqueta: 'Cada cierta cantidad de días' },
    { valor: 'siempre', etiqueta: 'Cada vez que se cumpla' }
];

export const AUDIENCIAS = [
    { valor: 'todos', etiqueta: 'Todos' },
    { valor: 'movil', etiqueta: 'Sólo celular' },
    { valor: 'escritorio', etiqueta: 'Sólo computadora' }
];

export const ACCIONES_CTA = [
    { valor: 'cerrar', etiqueta: 'Cerrar el pop-up' },
    { valor: 'url', etiqueta: 'Abrir un enlace' },
    { valor: 'whatsapp', etiqueta: 'Escribir por WhatsApp' },
    { valor: 'categoria', etiqueta: 'Ir a una categoría' }
];

export const ESTILOS_POPUP = [
    { valor: '', etiqueta: 'Claro' },
    { valor: 'festivo', etiqueta: 'Cálido' },
    { valor: 'oscuro', etiqueta: 'Oscuro' }
];

export const COLORES_INSIGNIA = [
    { valor: 'rojo', etiqueta: 'Rojo', muestra: '#b42318' },
    { valor: 'acento', etiqueta: 'Acento', muestra: 'var(--cat-color)' },
    { valor: 'ambar', etiqueta: 'Ámbar', muestra: '#b06a12' },
    { valor: 'azul', etiqueta: 'Azul', muestra: '#1d4ed8' },
    { valor: 'oscuro', etiqueta: 'Grafito', muestra: '#111827' },
    { valor: 'festivo', etiqueta: 'Festivo', muestra: 'linear-gradient(120deg,#b91c1c,#15803d)' }
];

export const ACENTOS = [
    { valor: '', etiqueta: 'Original del catálogo' },
    { valor: '#376550', etiqueta: 'Verde HomePoint' },
    { valor: '#2a6a82', etiqueta: 'Petróleo' },
    { valor: '#1e3a8a', etiqueta: 'Azul profundo' },
    { valor: '#9f1239', etiqueta: 'Bordó' },
    { valor: '#b91c1c', etiqueta: 'Rojo navidad' },
    { valor: '#c2410c', etiqueta: 'Naranja' },
    { valor: '#a16207', etiqueta: 'Dorado' },
    { valor: '#be185d', etiqueta: 'Rosa' },
    { valor: '#6d28d9', etiqueta: 'Violeta' },
    { valor: '#111827', etiqueta: 'Negro' }
];

export const DECORACIONES = [
    { valor: 'ninguna', etiqueta: 'Ninguna', simbolo: '—' },
    { valor: 'nieve', etiqueta: 'Nieve', simbolo: '❄' },
    { valor: 'confeti', etiqueta: 'Confeti', simbolo: '◆' },
    { valor: 'estrellas', etiqueta: 'Estrellas', simbolo: '★' },
    { valor: 'corazones', etiqueta: 'Corazones', simbolo: '♥' },
    { valor: 'hojas', etiqueta: 'Hojas', simbolo: '🍂' },
    { valor: 'globos', etiqueta: 'Globos', simbolo: '🎈' }
];

export const ICONOS = [
    'fas fa-truck', 'fas fa-truck-fast', 'fas fa-box-open', 'fas fa-gift', 'fas fa-tags', 'fas fa-tag', 'fas fa-percent',
    'fas fa-fire', 'fas fa-bolt', 'fas fa-star', 'fas fa-heart', 'fas fa-snowflake', 'fas fa-tree', 'fas fa-sun',
    'fas fa-calendar-days', 'fas fa-clock', 'fas fa-store', 'fas fa-dollar-sign', 'fas fa-credit-card', 'fas fa-circle-info',
    'fas fa-triangle-exclamation', 'fas fa-bullhorn', 'fas fa-champagne-glasses', 'fas fa-cake-candles', 'fab fa-whatsapp',
    'fas fa-shield-halved', 'fas fa-thumbs-up', 'fas fa-cart-shopping'
];

/* ------------------------------------------------------- estructura */

export function configVacia() {
    return {
        version: 1,
        estado: { modo: 'abierto', titulo: '', mensaje: '', desde: 0, hasta: 0, rev: 0 },
        anuncios: { estilo: 'oscuro', modo: 'rotar', intervalo: 5, velocidad: 60, cerrable: true, items: [] },
        popups: [],
        banners: {
            principal: { usar: false, intervalo: 5, items: [] },
            pie: { usar: false, intervalo: 5, items: [] }
        },
        textos: {},
        ocultar: {},
        faq: { ocultar: {}, cambios: {}, extra: [] },
        condiciones: { minimo: {}, descuento: {} },
        contacto: { whatsapp: {}, email: '', instagram: '', tiktok: '' },
        apariencia: { acento: '', decoracion: { tipo: 'ninguna', intensidad: 'sutil', guirnalda: false, desde: 0, hasta: 0 } },
        insignias: []
    };
}

const LISTAS = ['anuncios.items', 'popups', 'banners.principal.items', 'banners.pie.items', 'faq.extra', 'insignias'];

function esObjeto(v) { return v && typeof v === 'object' && !Array.isArray(v); }

function fusionar(base, extra) {
    if (!esObjeto(extra)) return base;
    Object.keys(extra).forEach((k) => {
        if (esObjeto(base[k]) && esObjeto(extra[k])) fusionar(base[k], extra[k]);
        else if (extra[k] !== undefined) base[k] = extra[k];
    });
    return base;
}

export function aLista(v) {
    if (Array.isArray(v)) return v.filter(Boolean);
    if (esObjeto(v)) return Object.keys(v).sort((a, b) => Number(a) - Number(b)).map((k) => v[k]).filter(Boolean);
    return [];
}

export function leer(obj, ruta) {
    return String(ruta).split('.').reduce((v, k) => (v == null ? undefined : v[k]), obj);
}

export function escribir(obj, ruta, valor) {
    const partes = String(ruta).split('.');
    let v = obj;
    for (let i = 0; i < partes.length - 1; i++) {
        if (!esObjeto(v[partes[i]]) && !Array.isArray(v[partes[i]])) v[partes[i]] = {};
        v = v[partes[i]];
    }
    v[partes[partes.length - 1]] = valor;
}

// Lleva cualquier cosa que venga de RTDB (arrays como objetos, ramas faltantes) al formato completo.
export function normalizar(cfg) {
    const n = fusionar(configVacia(), clonar(cfg || {}));
    LISTAS.forEach((ruta) => escribir(n, ruta, aLista(leer(n, ruta))));
    return n;
}

export function clonar(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

// Lo que se guarda en la base: sin undefined, sin metadatos locales.
export function paraGuardar(cfg) {
    const c = clonar(cfg);
    delete c.meta;
    return c;
}

export function nuevoId(prefijo = 'i') {
    return prefijo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function nuevoAnuncio() {
    return { id: nuevoId('a'), activo: true, texto: '', icono: '', enlace: '', enlaceTexto: '', cuentaRegresiva: 0, desde: 0, hasta: 0 };
}

export function nuevoPopup() {
    return {
        id: nuevoId('p'), activo: true, nombre: 'Nuevo pop-up', formato: 'modal', estilo: '',
        etiqueta: '', icono: 'fas fa-gift', titulo: '', cuerpo: '', imagen: '', codigo: '', cuentaRegresiva: 0,
        ctaTexto: 'Ver productos', ctaTipo: 'cerrar', ctaValor: '', ctaMensaje: '',
        disparador: 'carga', segundos: 8, frecuencia: 'sesion', dias: 3, audiencia: 'todos',
        prioridad: 0, desde: 0, hasta: 0, rev: 0
    };
}

export function nuevoBanner() {
    return { id: nuevoId('b'), activo: true, desktop: '', mobile: '', alt: '', enlace: '', desde: 0, hasta: 0 };
}

export function nuevaInsignia() {
    return { id: nuevoId('n'), activo: true, texto: 'Oferta', color: 'rojo', tipo: 'codigos', valores: '', desde: 0, hasta: 0 };
}

export function nuevaPregunta() {
    return { id: nuevoId('q'), activo: true, pregunta: '', respuesta: '', posicion: 'inicio', desde: 0, hasta: 0 };
}

/* ------------------------------------------------------- vigencias */

export function estadoVigencia(o, ahora = Date.now()) {
    if (!o) return 'inactivo';
    if (o.activo === false) return 'inactivo';
    const desde = Number(o.desde) || 0;
    const hasta = Number(o.hasta) || 0;
    if (hasta && ahora > hasta) return 'vencido';
    if (desde && ahora < desde) return 'programado';
    return 'activo';
}

/* ---------------------------------------------------------- diferencias */

const ETIQUETAS_SECCION = {
    estado: 'Estado del sitio',
    anuncios: 'Anuncios',
    popups: 'Pop-ups',
    banners: 'Banners',
    textos: 'Textos',
    ocultar: 'Textos',
    faq: 'Preguntas frecuentes',
    condiciones: 'Condiciones',
    contacto: 'Contacto',
    apariencia: 'Apariencia',
    insignias: 'Insignias'
};

function aplanar(obj, prefijo = '', salida = {}) {
    if (Array.isArray(obj)) {
        obj.forEach((v, i) => aplanar(v, `${prefijo}[${v && v.id ? v.id : i}]`, salida));
        if (!obj.length) salida[prefijo] = '[]';
    } else if (esObjeto(obj)) {
        const claves = Object.keys(obj);
        claves.forEach((k) => aplanar(obj[k], prefijo ? `${prefijo}.${k}` : k, salida));
    } else {
        const vacio = obj === undefined || obj === null || obj === '' || obj === 0 || obj === false;
        if (!vacio) salida[prefijo] = obj;
    }
    return salida;
}

// Devuelve cambios agrupados por sección: [{ seccion, etiqueta, cambios: [ruta…] }]
export function diferencias(a, b) {
    const fa = aplanar(normalizar(a));
    const fb = aplanar(normalizar(b));
    // version y meta (autor, fecha del servidor) no son cambios de contenido
    Object.keys(fa).concat(Object.keys(fb)).forEach((k) => { if (k === 'version' || /^meta\./.test(k)) { delete fa[k]; delete fb[k]; } });
    const rutas = new Set([...Object.keys(fa), ...Object.keys(fb)]);
    const porSeccion = {};
    rutas.forEach((r) => {
        if (JSON.stringify(fa[r]) === JSON.stringify(fb[r])) return;
        if (/\.rev$/.test(r)) return;
        const sec = r.split(/[.[]/)[0];
        (porSeccion[sec] = porSeccion[sec] || []).push({ ruta: r, antes: fa[r], despues: fb[r] });
    });
    return Object.keys(porSeccion).map((s) => ({ seccion: s, etiqueta: ETIQUETAS_SECCION[s] || s, cambios: porSeccion[s] }));
}

export function contarCambios(a, b) {
    return diferencias(a, b).reduce((n, g) => n + g.cambios.length, 0);
}

/* ------------------------------------------------------- validación */

export function validar(cfg) {
    const errores = [];
    const c = normalizar(cfg);
    const esUrl = (u) => !u || /^https:\/\//i.test(u) || /^#[\w-]*$/.test(u);
    const esImg = (u) => !u || /^https:\/\//i.test(u) || /^[\w\-./]+\.(jpe?g|png|webp|gif|avif|svg)$/i.test(u);
    const rango = (o, donde) => { if (o.desde && o.hasta && Number(o.hasta) <= Number(o.desde)) errores.push(`${donde}: la fecha de fin es anterior al inicio.`); };

    rango(c.estado, 'Estado del sitio');
    if (c.estado.modo !== 'abierto' && !String(c.estado.mensaje || '').trim() && c.estado.modo === 'aviso') errores.push('Estado del sitio: el aviso informativo necesita un mensaje.');
    c.anuncios.items.forEach((a, i) => {
        if (!String(a.texto || '').trim()) errores.push(`Anuncio ${i + 1}: falta el texto.`);
        if (!esUrl(a.enlace)) errores.push(`Anuncio ${i + 1}: el enlace debe empezar con https://`);
        rango(a, `Anuncio ${i + 1}`);
    });
    c.popups.forEach((p) => {
        const n = p.nombre || 'Pop-up';
        if (!String(p.titulo || '').trim() && !String(p.cuerpo || '').trim() && !p.imagen) errores.push(`${n}: necesita título, texto o imagen.`);
        if (p.ctaTipo === 'url' && p.ctaTexto && !/^https:\/\//i.test(p.ctaValor || '')) errores.push(`${n}: el enlace del botón debe empezar con https://`);
        if (p.ctaTipo === 'whatsapp' && p.ctaTexto && String(p.ctaValor || '').replace(/\D/g, '').length < 10) errores.push(`${n}: el número de WhatsApp del botón no es válido.`);
        if (!esImg(p.imagen)) errores.push(`${n}: la imagen debe ser una URL https.`);
        rango(p, n);
    });
    ['principal', 'pie'].forEach((k) => {
        c.banners[k].items.forEach((b, i) => {
            if (!b.desktop && !b.mobile) errores.push(`Banner ${k} ${i + 1}: falta la imagen.`);
            if (!esImg(b.desktop) || !esImg(b.mobile)) errores.push(`Banner ${k} ${i + 1}: las imágenes deben ser URL https.`);
            if (!esUrl(b.enlace)) errores.push(`Banner ${k} ${i + 1}: el enlace debe empezar con https://`);
            rango(b, `Banner ${k} ${i + 1}`);
        });
    });
    const m = c.condiciones.minimo;
    if (m.monto !== undefined && m.monto !== '' && (!(Number(m.monto) >= 0))) errores.push('Condiciones: el monto mínimo no es válido.');
    const d = c.condiciones.descuento;
    if (d.porcentaje !== undefined && d.porcentaje !== '' && (Number(d.porcentaje) < 0 || Number(d.porcentaje) > 90)) errores.push('Condiciones: el porcentaje de descuento debe estar entre 0 y 90.');
    Object.entries(c.contacto.whatsapp || {}).forEach(([k, v]) => {
        if (v && String(v).replace(/\D/g, '').length < 10) errores.push(`Contacto: el WhatsApp "${k}" parece incompleto.`);
    });
    c.insignias.forEach((n, i) => { if (!n.texto) errores.push(`Insignia ${i + 1}: falta el texto.`); rango(n, `Insignia ${i + 1}`); });
    if (c.apariencia.acento && !/^#[0-9a-f]{6}$/i.test(c.apariencia.acento)) errores.push('Apariencia: el color de acento no es válido.');
    return errores;
}

/* ------------------------------------------------------- plantillas */

function finDe(mes, dia, hora = 23, min = 59) {
    const hoy = new Date();
    let anio = hoy.getFullYear();
    const f = new Date(anio, mes - 1, dia, hora, min);
    if (f.getTime() < hoy.getTime()) f.setFullYear(anio + 1);
    return f.getTime();
}
function enDias(n) { const f = new Date(); f.setDate(f.getDate() + n); f.setHours(23, 59, 0, 0); return f.getTime(); }

// Cada plantilla devuelve los cambios que aplica sobre el borrador.
export const PLANTILLAS = [
    {
        id: 'navidad', nombre: 'Navidad y Fin de año', resumen: 'Anuncio festivo, pop-up con regalo, acento rojo, nieve y guirnalda.',
        fondo: 'linear-gradient(135deg,#7f1d1d,#b91c1c 45%,#166534)', emoji: '🎄',
        aplicar: () => {
            const hasta = finDe(1, 6);
            return {
                anuncio: { texto: '🎄 <b>Felices fiestas</b> · Encontrá los regalos para estas fiestas', icono: '', enlaceTexto: '', hasta },
                anunciosEstilo: 'festivo',
                popup: { nombre: 'Navidad', estilo: 'festivo', icono: 'fas fa-gift', etiqueta: 'Fiestas', titulo: '¡Felices fiestas!', cuerpo: 'Preparamos una selección especial para regalar. <b>Hacé tu pedido con tiempo</b> y recibilo antes de Navidad.', ctaTexto: 'Ver productos', ctaTipo: 'cerrar', disparador: 'carga', frecuencia: 'sesion', hasta },
                acento: '#b91c1c',
                decoracion: { tipo: 'nieve', intensidad: 'sutil', guirnalda: true, hasta }
            };
        }
    },
    {
        id: 'blackfriday', nombre: 'Black Friday', resumen: 'Estética negra, cuenta regresiva y pop-up de ofertas por tiempo limitado.',
        fondo: 'linear-gradient(135deg,#0a0a0a,#262626 60%,#facc15)', emoji: '🖤',
        aplicar: () => {
            const hasta = enDias(4);
            return {
                anuncio: { texto: '<b>BLACK FRIDAY</b> · Precios especiales por tiempo limitado', cuentaRegresiva: hasta, hasta },
                anunciosEstilo: 'oscuro',
                popup: { nombre: 'Black Friday', estilo: 'oscuro', icono: 'fas fa-bolt', etiqueta: 'Black Friday', titulo: 'Ofertas por tiempo limitado', cuerpo: 'Aprovechá los precios especiales antes de que termine la promoción.', cuentaRegresiva: hasta, ctaTexto: 'Quiero verlas', ctaTipo: 'cerrar', disparador: 'tiempo', segundos: 5, frecuencia: 'sesion', hasta },
                acento: '#111827',
                decoracion: { tipo: 'ninguna' }
            };
        }
    },
    {
        id: 'hotsale', nombre: 'Hot Sale', resumen: 'Anuncio en rotación, acento naranja y confeti al entrar.',
        fondo: 'linear-gradient(135deg,#9a3412,#ea580c 55%,#fbbf24)', emoji: '🔥',
        aplicar: () => {
            const hasta = enDias(3);
            return {
                anuncio: { texto: '🔥 <b>HOT SALE</b> · Descuentos en toda la tienda', cuentaRegresiva: hasta, hasta },
                anunciosEstilo: 'acento',
                popup: { nombre: 'Hot Sale', icono: 'fas fa-fire', etiqueta: 'Hot Sale', titulo: '¡Llegó el Hot Sale!', cuerpo: 'Durante estos días encontrás <b>precios especiales</b> en una selección de productos.', ctaTexto: 'Empezar a comprar', ctaTipo: 'cerrar', disparador: 'carga', frecuencia: 'sesion', hasta },
                acento: '#c2410c',
                decoracion: { tipo: 'confeti', intensidad: 'sutil', guirnalda: false, hasta }
            };
        }
    },
    {
        id: 'diamadre', nombre: 'Día de la Madre / del Padre', resumen: 'Pop-up de regalo, acento rosa y corazones.',
        fondo: 'linear-gradient(135deg,#831843,#db2777 55%,#fda4af)', emoji: '💝',
        aplicar: () => {
            const hasta = enDias(10);
            return {
                anuncio: { texto: '💝 Ideas para regalar en su día · <b>Pedí con tiempo</b>', hasta },
                anunciosEstilo: 'acento',
                popup: { nombre: 'Día especial', estilo: 'festivo', icono: 'fas fa-heart', etiqueta: 'Regalos', titulo: 'Un regalo para su día', cuerpo: 'Elegí entre cientos de artículos y sorprendé a quien más querés.', ctaTexto: 'Ver ideas', ctaTipo: 'cerrar', disparador: 'tiempo', segundos: 6, frecuencia: 'sesion', hasta },
                acento: '#be185d',
                decoracion: { tipo: 'corazones', intensidad: 'sutil', guirnalda: false, hasta }
            };
        }
    },
    {
        id: 'feriado', nombre: 'Feriado o cierre', resumen: 'Pausa los pedidos con un mensaje claro y anuncio de alerta.',
        fondo: 'linear-gradient(135deg,#78350f,#b45309 60%,#fde68a)', emoji: '📅',
        aplicar: () => {
            const hasta = enDias(1);
            return {
                anuncio: { texto: '📅 <b>Feriado</b> · Los pedidos web se retoman el próximo día hábil', hasta },
                anunciosEstilo: 'alerta',
                estado: { modo: 'pausado', titulo: 'Pedidos en pausa por feriado', mensaje: 'Podés seguir viendo el catálogo. Los pedidos se retoman el próximo día hábil.', hasta }
            };
        }
    },
    {
        id: 'escolar', nombre: 'Vuelta al cole', resumen: 'Anuncio y pop-up para la temporada escolar con acento azul.',
        fondo: 'linear-gradient(135deg,#1e3a8a,#2563eb 55%,#93c5fd)', emoji: '🎒',
        aplicar: () => {
            const hasta = enDias(30);
            return {
                anuncio: { texto: '🎒 <b>Vuelta al cole</b> · Todo para empezar el año', hasta },
                anunciosEstilo: 'acento',
                popup: { nombre: 'Vuelta al cole', icono: 'fas fa-star', etiqueta: 'Temporada escolar', titulo: 'Todo para la vuelta al cole', cuerpo: 'Encontrá artículos para la temporada escolar a precio mayorista.', ctaTexto: 'Ver productos', ctaTipo: 'cerrar', disparador: 'carga', frecuencia: 'unaVez', hasta },
                acento: '#1e3a8a',
                decoracion: { tipo: 'estrellas', intensidad: 'sutil', guirnalda: false, hasta }
            };
        }
    }
];
