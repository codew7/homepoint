/* ==========================================================================
   editores.js · secciones del panel
   Cada sección: { id, grupo, titulo, icono, descripcion, render(ctx, app), insignia?(app) }
   ========================================================================== */
import {
    CATALOGOS, MODOS_ESTADO, ESTILOS_ANUNCIO, FORMATOS_POPUP, DISPARADORES, FRECUENCIAS, AUDIENCIAS,
    ACCIONES_CTA, ESTILOS_POPUP, COLORES_INSIGNIA, ACENTOS, DECORACIONES, PLANTILLAS, URL_SITIO,
    nuevoAnuncio, nuevoPopup, nuevoBanner, nuevaInsignia, nuevaPregunta, estadoVigencia, aLista, clonar, diferencias
} from './schema.js';
import {
    h, icono, campo, fila, inputTexto, textarea, inputNumero, interruptor, segmentado, selector, muestras,
    editorRico, selectorIcono, vigencia, fechaHora, selectorImagen, listaEditable, boton, botonIcono, tarjeta, aviso,
    chipVigencia, toast, dialogo, confirmar, fecha, relativo, moneda, formatearTel, sanear, escapar
} from './ui.js';

const textoPlano = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return d.textContent.trim(); };

function botonRestaurar(ctx, ruta, alRestaurar) {
    const b = h('button', { type: 'button', class: 'restaurar', title: 'Volver al texto original del catálogo' }, icono('fa-solid fa-rotate-left'), 'Original');
    b.addEventListener('click', () => { ctx.set(ruta, '', { estructura: true }); if (alRestaurar) alRestaurar(); });
    return b;
}

function etiquetaPorDefecto(valor) {
    return valor === undefined || valor === null || valor === ''
        ? h('span', { class: 'etiqueta-def' }, 'del código')
        : h('span', { class: 'etiqueta-def etiqueta-def--cambiado' }, 'personalizado');
}

/* ================================================================ RESUMEN */

function resumenCatalogo(app, cat) {
    const meta = CATALOGOS[cat];
    const pub = app.publicadoDe(cat);
    const bor = app.borradorDe(cat);
    const ahora = app.ahora();
    const e = pub.estado || {};
    const modoVig = e.modo && e.modo !== 'abierto' && estadoVigencia({ desde: e.desde, hasta: e.hasta }, ahora) === 'activo' ? e.modo : 'abierto';
    const modo = MODOS_ESTADO.find((m) => m.valor === modoVig);
    const anuncios = aLista(pub.anuncios && pub.anuncios.items).filter((a) => estadoVigencia(a, ahora) === 'activo').length;
    const popups = aLista(pub.popups).filter((p) => estadoVigencia(p, ahora) === 'activo').length;
    const insignias = aLista(pub.insignias).filter((p) => estadoVigencia(p, ahora) === 'activo').length;
    const pendientes = app.cambiosDe(cat);
    const m = pub.meta || app.metaPublicadoDe(cat);

    const stat = (n, texto, ic) => h('div', { class: 'stat' }, h('span', { class: 'stat-num' }, String(n)), h('span', { class: 'stat-texto' }, icono(ic), texto));
    return h('article', { class: 'cat-card' + (cat === app.cat ? ' is-actual' : ''), style: { '--cat-color': meta.color } },
        h('header', { class: 'cat-card-cabeza' },
            h('div', null,
                h('span', { class: 'cat-card-eyebrow' }, meta.archivo),
                h('h3', { class: 'cat-card-titulo' }, meta.nombre),
                h('p', { class: 'cat-card-desc' }, meta.descripcion)),
            h('span', { class: 'estado-pill estado-pill--' + modoVig }, icono(modo.icono), modo.etiqueta)),
        h('div', { class: 'cat-card-stats' },
            stat(anuncios, 'anuncios', 'fa-solid fa-bullhorn'),
            stat(popups, 'pop-ups', 'fa-regular fa-window-restore'),
            stat(insignias, 'insignias', 'fa-solid fa-certificate')),
        h('footer', { class: 'cat-card-pie' },
            h('span', { class: 'cat-card-meta' }, m && m.actualizado
                ? ['Publicado ', relativo(m.actualizado, ahora), m.autor ? ' · ' + m.autor.split('@')[0] : ''].join('')
                : 'Sin publicaciones todavía'),
            pendientes ? h('span', { class: 'pendientes' }, `${pendientes} sin publicar`) : null,
            cat === app.cat ? null : boton('Editar', { variante: 'fantasma', tamano: 'chico', icono: 'fa-solid fa-arrow-right', accion: () => app.cambiarCatalogo(cat) })));
}

function eventosProgramados(app) {
    const ahora = app.ahora();
    const eventos = [];
    Object.keys(CATALOGOS).forEach((cat) => {
        const c = app.borradorDe(cat);
        const nombre = CATALOGOS[cat].nombre;
        const agregar = (o, que, ic, seccion) => {
            if (!o || o.activo === false) return;
            if (o.desde && o.desde > ahora) eventos.push({ cuando: o.desde, que: que + ' empieza', ic, cat: nombre, catId: cat, seccion });
            if (o.hasta && o.hasta > ahora) eventos.push({ cuando: o.hasta, que: que + ' termina', ic, cat: nombre, catId: cat, seccion });
        };
        if (c.estado.modo !== 'abierto') agregar(c.estado, c.estado.modo === 'pausado' ? 'Pausa de pedidos' : 'Aviso', 'fa-solid fa-circle-pause', 'estado');
        c.anuncios.items.forEach((a) => agregar(a, 'Anuncio «' + textoPlano(a.texto).slice(0, 38) + '»', 'fa-solid fa-bullhorn', 'anuncios'));
        c.popups.forEach((p) => agregar(p, 'Pop-up «' + (p.nombre || p.titulo) + '»', 'fa-regular fa-window-restore', 'popups'));
        ['principal', 'pie'].forEach((k) => c.banners[k].items.forEach((b) => agregar(b, 'Banner ' + (b.alt || k), 'fa-regular fa-images', 'banners')));
        c.insignias.forEach((n) => agregar(n, 'Insignia «' + n.texto + '»', 'fa-solid fa-certificate', 'insignias'));
        if (c.apariencia.decoracion.tipo !== 'ninguna') agregar(c.apariencia.decoracion, 'Decoración ' + c.apariencia.decoracion.tipo, 'fa-solid fa-snowflake', 'apariencia');
    });
    return eventos.sort((a, b) => a.cuando - b.cuando).slice(0, 12);
}

const resumen = {
    id: 'resumen', grupo: 'General', titulo: 'Resumen', icono: 'fa-solid fa-gauge-high',
    descripcion: 'El estado de los dos catálogos de un vistazo: qué está publicado, qué está programado y qué falta publicar.',
    render(ctx, app) {
        const eventos = eventosProgramados(app);
        const accion = (texto, ic, desc, fn) => {
            const b = h('button', { type: 'button', class: 'accion-rapida' },
                h('span', { class: 'accion-icono' }, icono(ic)),
                h('span', { class: 'accion-textos' }, h('strong', null, texto), h('span', null, desc)));
            b.addEventListener('click', fn);
            return b;
        };
        const pausado = ctx.get('estado.modo') === 'pausado';
        return h('div', { class: 'pila' },
            h('div', { class: 'grilla-cats' }, Object.keys(CATALOGOS).map((c) => resumenCatalogo(app, c))),
            tarjeta({
                titulo: 'Acciones rápidas', icono: 'fa-solid fa-bolt',
                descripcion: `Sobre el catálogo <b>${CATALOGOS[app.cat].nombre}</b>. Todo queda en borrador hasta que publiques.`,
                cuerpo: h('div', { class: 'acciones-rapidas' },
                    accion(pausado ? 'Reanudar pedidos' : 'Pausar pedidos', pausado ? 'fa-solid fa-play' : 'fa-solid fa-pause',
                        pausado ? 'Vuelve a habilitar el envío de pedidos' : 'Para feriados, inventario o cierres', () => {
                            if (pausado) ctx.set('estado.modo', 'abierto', { estructura: true });
                            else { ctx.set('estado.modo', 'pausado', { estructura: true }); app.ir('estado'); }
                        }),
                    accion('Nuevo anuncio', 'fa-solid fa-bullhorn', 'Barra superior con mensaje y enlace', () => app.nuevo('anuncio')),
                    accion('Nuevo pop-up', 'fa-regular fa-window-restore', 'Modal, hoja inferior o aviso flotante', () => app.nuevo('popup')),
                    accion('Aplicar una temporada', 'fa-solid fa-wand-magic-sparkles', 'Navidad, Black Friday, Hot Sale…', () => app.ir('plantillas')),
                    accion('Cambiar el mínimo', 'fa-solid fa-scale-balanced', 'Monto y unidades para envíos', () => app.ir('condiciones')),
                    accion('Ver el catálogo', 'fa-solid fa-arrow-up-right-from-square', 'Abre la versión publicada', () => window.open(URL_SITIO + CATALOGOS[app.cat].archivo, '_blank', 'noopener')))
            }),
            tarjeta({
                titulo: 'Próximos eventos', icono: 'fa-regular fa-calendar',
                descripcion: 'Lo que empieza o termina solo, según las fechas que configuraste (borradores incluidos).',
                cuerpo: eventos.length
                    ? h('ol', { class: 'linea-tiempo' }, eventos.map((ev) => h('li', { class: 'lt-item' },
                        h('span', { class: 'lt-punto' }, icono(ev.ic)),
                        h('div', { class: 'lt-texto' },
                            h('strong', null, ev.que),
                            h('span', null, `${ev.cat} · ${fecha(ev.cuando, true)}`)),
                        h('span', { class: 'lt-cuando' }, relativo(ev.cuando, app.ahora())))))
                    : h('div', { class: 'lista-vacia' }, 'No hay nada programado. Usá las fechas de inicio y fin en anuncios, pop-ups o banners para automatizar campañas.')
            }));
    }
};

/* ================================================================= ESTADO */

const estado = {
    id: 'estado', grupo: 'General', titulo: 'Estado del sitio', icono: 'fa-solid fa-signal',
    descripcion: 'Abrí, avisá o pausá la toma de pedidos. La pausa bloquea el envío, pero el catálogo se puede seguir viendo.',
    insignia: (app) => (app.borrador.estado.modo !== 'abierto' ? { texto: app.borrador.estado.modo === 'pausado' ? 'Pausa' : 'Aviso', tipo: app.borrador.estado.modo === 'pausado' ? 'alerta' : 'info' } : null),
    render(ctx) {
        const modo = ctx.get('estado.modo') || 'abierto';
        const tarjetasModo = h('div', { class: 'modos' }, MODOS_ESTADO.map((m) => {
            const b = h('button', { type: 'button', class: 'modo modo--' + m.valor, 'aria-pressed': String(modo === m.valor) },
                h('span', { class: 'modo-icono' }, icono(m.icono)),
                h('strong', null, m.etiqueta),
                h('span', null, m.ayuda));
            b.addEventListener('click', () => ctx.set('estado.modo', m.valor, { estructura: true }));
            return b;
        }));
        const detalle = modo === 'abierto' ? null : tarjeta({
            titulo: modo === 'pausado' ? 'Mensaje de la pausa' : 'Contenido del aviso', icono: 'fa-regular fa-message',
            descripcion: modo === 'pausado'
                ? 'Se muestra en una franja bajo el encabezado y al intentar enviar un pedido.'
                : 'Se muestra al entrar, una vez por visita. Si lo modificás, vuelve a mostrarse a todos.',
            cuerpo: h('div', { class: 'pila' },
                campo({ etiqueta: 'Título', control: inputTexto(ctx, 'estado.titulo', { placeholder: modo === 'pausado' ? 'Pedidos en pausa' : 'Aviso importante', max: 80 }) }),
                campo({ etiqueta: 'Mensaje', control: editorRico(ctx, 'estado.mensaje', { placeholder: modo === 'pausado' ? 'Por el momento no estamos tomando pedidos web…' : 'Contale a tus clientes qué pasa…' }) }),
                campo({ etiqueta: 'Vigencia', control: vigencia(ctx, 'estado'), ayuda: 'Al terminar, el catálogo vuelve solo a la normalidad.' }))
        });
        return h('div', { class: 'pila' },
            tarjeta({ titulo: 'Modo', icono: 'fa-solid fa-toggle-on', cuerpo: tarjetasModo }),
            detalle,
            aviso('La pausa sólo impide <b>enviar</b> pedidos desde la web (envío y retiro). No modifica pedidos existentes ni el registro de datos.', 'info'));
    }
};

/* =============================================================== ANUNCIOS */

const anuncios = {
    id: 'anuncios', grupo: 'Comunicación', titulo: 'Barra de anuncios', icono: 'fa-solid fa-bullhorn',
    descripcion: 'Mensajes destacados sobre el encabezado: promociones, envíos, horarios especiales o cuentas regresivas.',
    insignia: (app) => { const n = app.borrador.anuncios.items.filter((a) => estadoVigencia(a, app.ahora()) === 'activo').length; return n ? { texto: String(n) } : null; },
    render(ctx, app) {
        const ajustes = tarjeta({
            titulo: 'Apariencia de la barra', icono: 'fa-solid fa-sliders',
            cuerpo: h('div', { class: 'pila' },
                campo({ etiqueta: 'Estilo', control: muestras(ctx, 'anuncios.estilo', ESTILOS_ANUNCIO) }),
                fila(
                    campo({ etiqueta: 'Movimiento', control: segmentado(ctx, 'anuncios.modo', [
                        { valor: 'rotar', etiqueta: 'Rotar', icono: 'fa-solid fa-arrows-rotate' },
                        { valor: 'marquee', etiqueta: 'Desplazar', icono: 'fa-solid fa-arrow-right-long' }], { alCambiar: () => ctx.render() }) }),
                    ctx.get('anuncios.modo') === 'marquee'
                        ? campo({ etiqueta: 'Velocidad', control: inputNumero(ctx, 'anuncios.velocidad', { min: 20, max: 200, paso: 5, sufijo: 'px/s' }) })
                        : campo({ etiqueta: 'Cambiar cada', control: inputNumero(ctx, 'anuncios.intervalo', { min: 3, max: 30, sufijo: 'seg' }) })),
                interruptor(ctx, 'anuncios.cerrable', { etiqueta: 'Permitir cerrar la barra', descripcion: 'El cliente puede ocultarla durante su visita.' }))
        });
        const lista = listaEditable(ctx, 'anuncios.items', {
            crear: nuevoAnuncio,
            etiquetaAgregar: 'Agregar anuncio',
            vacio: 'Todavía no hay anuncios. Agregá uno para mostrarlo arriba del encabezado.',
            titulo: (a) => textoPlano(a.texto) || 'Anuncio sin texto',
            subtitulo: (a) => chipVigencia(a, app.ahora()),
            cuerpo: (c) => h('div', { class: 'pila' },
                campo({ etiqueta: 'Texto', control: editorRico(c, 'texto', { unaLinea: true, placeholder: 'Ej: 🚚 Envío gratis en compras mayores a $200.000' }) }),
                campo({ etiqueta: 'Ícono', control: selectorIcono(c, 'icono') }),
                fila(
                    campo({ etiqueta: 'Enlace (opcional)', control: inputTexto(c, 'enlace', { tipo: 'url', mono: true, placeholder: 'https://…' }) }),
                    campo({ etiqueta: 'Texto del enlace', control: inputTexto(c, 'enlaceTexto', { placeholder: 'Ver más', max: 24 }) })),
                campo({ etiqueta: 'Cuenta regresiva hasta (opcional)', control: fechaHora(c, 'cuentaRegresiva'), ayuda: 'Muestra días, horas y minutos restantes junto al texto.' }),
                campo({ etiqueta: 'Vigencia', control: vigencia(c, '', { alCambiar: () => ctx.render() }) }))
        });
        return h('div', { class: 'pila' }, ajustes, tarjeta({ titulo: 'Anuncios', icono: 'fa-solid fa-list', descripcion: 'Si hay varios activos, se alternan en el orden de la lista.', cuerpo: lista }));
    }
};

/* ================================================================ POP-UPS */

function resumenPopup(p) {
    const d = DISPARADORES.find((x) => x.valor === p.disparador);
    const f = FRECUENCIAS.find((x) => x.valor === p.frecuencia);
    const fo = FORMATOS_POPUP.find((x) => x.valor === p.formato);
    return [fo && fo.etiqueta, d && d.etiqueta.toLowerCase(), f && f.etiqueta.toLowerCase()].filter(Boolean).join(' · ');
}

const popups = {
    id: 'popups', grupo: 'Comunicación', titulo: 'Pop-ups', icono: 'fa-regular fa-window-restore',
    descripcion: 'Mensajes emergentes con imagen, cupón, cuenta regresiva y botón de acción. Elegí cuándo, a quién y cada cuánto se muestran.',
    insignia: (app) => { const n = app.borrador.popups.filter((a) => estadoVigencia(a, app.ahora()) === 'activo').length; return n ? { texto: String(n) } : null; },
    render(ctx, app) {
        const lista = listaEditable(ctx, 'popups', {
            crear: nuevoPopup,
            etiquetaAgregar: 'Crear pop-up',
            vacio: 'No hay pop-ups. Creá uno o aplicá una plantilla de temporada.',
            titulo: (p) => p.nombre || p.titulo || 'Pop-up',
            subtitulo: (p) => h('span', { class: 'item-sub-linea' }, chipVigencia(p, app.ahora()), h('span', { class: 'item-sub-texto' }, resumenPopup(p))),
            cuerpo: (c, p) => {
                const ctaTipo = c.get('ctaTipo') || 'cerrar';
                const disp = c.get('disparador') || 'carga';
                const frec = c.get('frecuencia') || 'sesion';
                const probar = boton('Probar en la vista previa', { icono: 'fa-solid fa-play', variante: 'secundario', accion: () => app.probarPopup(c.get('')) });
                const reiniciar = boton('Volver a mostrar a todos', {
                    icono: 'fa-solid fa-rotate', variante: 'fantasma', titulo: 'Quienes ya lo vieron lo verán otra vez',
                    accion: () => { c.set('rev', (Number(c.get('rev')) || 0) + 1, { estructura: true }); toast('Se volverá a mostrar a todos al publicar.', 'ok'); }
                });
                return h('div', { class: 'pila' },
                    h('div', { class: 'barra-acciones' }, probar, reiniciar),
                    h('div', { class: 'subseccion' }, h('h4', null, 'Contenido'),
                        fila(
                            campo({ etiqueta: 'Nombre interno', control: inputTexto(c, 'nombre', { placeholder: 'Ej: Promo diciembre', max: 50 }), ayuda: 'Sólo lo ves vos.' }),
                            campo({ etiqueta: 'Etiqueta superior', control: inputTexto(c, 'etiqueta', { placeholder: 'Ej: Nuevo', max: 24 }) })),
                        campo({ etiqueta: 'Formato', control: segmentado(c, 'formato', FORMATOS_POPUP) }),
                        campo({ etiqueta: 'Estilo', control: segmentado(c, 'estilo', ESTILOS_POPUP, { tamano: 'chico' }) }),
                        campo({ etiqueta: 'Título', control: inputTexto(c, 'titulo', { placeholder: '¡Llegaron las ofertas!', max: 90 }) }),
                        campo({ etiqueta: 'Texto', control: editorRico(c, 'cuerpo', { placeholder: 'Contá la promoción en una o dos frases…' }) }),
                        selectorImagen(c, 'imagen', { subir: app.subir, anchoMax: 1200, etiqueta: 'Imagen (opcional)', recomendacion: 'Horizontal, ideal 1200×700px' }),
                        c.get('imagen') ? null : campo({ etiqueta: 'Ícono', control: selectorIcono(c, 'icono') }),
                        fila(
                            campo({ etiqueta: 'Código de cupón (opcional)', control: inputTexto(c, 'codigo', { mono: true, placeholder: 'FIESTAS10', max: 24 }), ayuda: 'Se puede copiar con un toque.' }),
                            campo({ etiqueta: 'Cuenta regresiva hasta', control: fechaHora(c, 'cuentaRegresiva') }))),
                    h('div', { class: 'subseccion' }, h('h4', null, 'Botón'),
                        fila(
                            campo({ etiqueta: 'Texto del botón', control: inputTexto(c, 'ctaTexto', { placeholder: 'Ver productos', max: 30 }), ayuda: 'Vacío = sin botón.' }),
                            campo({ etiqueta: 'Acción', control: selector(c, 'ctaTipo', ACCIONES_CTA, { alCambiar: () => ctx.render() }) })),
                        ctaTipo === 'url' ? campo({ etiqueta: 'Enlace', control: inputTexto(c, 'ctaValor', { tipo: 'url', mono: true, placeholder: 'https://…' }) }) : null,
                        ctaTipo === 'whatsapp' ? fila(
                            campo({ etiqueta: 'Número de WhatsApp', control: inputTexto(c, 'ctaValor', { tipo: 'tel', mono: true, placeholder: '5491121891006' }) }),
                            campo({ etiqueta: 'Mensaje inicial', control: inputTexto(c, 'ctaMensaje', { placeholder: 'Hola, quiero consultar por…' }) })) : null,
                        ctaTipo === 'categoria' ? campo({ etiqueta: 'Categoría', control: inputTexto(c, 'ctaValor', { placeholder: 'Ej: Cocina', lista: 'hp-categorias' }), ayuda: 'Filtra el catálogo por esa categoría al tocar el botón.' }) : null),
                    h('div', { class: 'subseccion' }, h('h4', null, 'Cuándo y a quién'),
                        fila(
                            campo({ etiqueta: 'Se muestra', control: selector(c, 'disparador', DISPARADORES, { alCambiar: () => ctx.render() }) }),
                            disp === 'tiempo' ? campo({ etiqueta: 'Después de', control: inputNumero(c, 'segundos', { min: 1, max: 600, sufijo: 'seg' }) }) : null),
                        fila(
                            campo({ etiqueta: 'Frecuencia', control: selector(c, 'frecuencia', FRECUENCIAS, { alCambiar: () => ctx.render() }) }),
                            frec === 'dias' ? campo({ etiqueta: 'Cada', control: inputNumero(c, 'dias', { min: 1, max: 365, sufijo: 'días' }) }) : null),
                        fila(
                            campo({ etiqueta: 'Dispositivos', control: segmentado(c, 'audiencia', AUDIENCIAS, { tamano: 'chico' }) }),
                            campo({ etiqueta: 'Prioridad', control: inputNumero(c, 'prioridad', { min: 0, max: 100 }), ayuda: 'Si coinciden dos, gana el número más alto.' })),
                        campo({ etiqueta: 'Vigencia', control: vigencia(c, '', { alCambiar: () => ctx.render() }) })));
            }
        });
        return h('div', { class: 'pila' },
            tarjeta({ titulo: 'Pop-ups', icono: 'fa-regular fa-window-restore', descripcion: 'Se muestra uno a la vez y nunca encima de otro modal del catálogo.', cuerpo: lista }),
            aviso('Los pop-ups son independientes de la bienvenida del catálogo: también los ven quienes marcaron «No volver a mostrar».', 'info'));
    }
};

/* ================================================================ BANNERS */

function seccionBanners(ctx, app, clave, titulo, desc) {
    const base = `banners.${clave}`;
    const usar = ctx.get(base + '.usar') === true;
    const originales = CATALOGOS[app.cat].banners[clave];
    const cuerpo = h('div', { class: 'pila' },
        interruptor(ctx, base + '.usar', { etiqueta: 'Usar banners del panel', descripcion: 'Apagado: se muestran los del código.', alCambiar: () => ctx.render() }),
        usar ? null : h('div', { class: 'originales' },
            h('span', { class: 'originales-titulo' }, 'Banners actuales del código'),
            h('div', { class: 'originales-lista' }, originales.map((f) => h('img', { src: URL_SITIO + f, alt: f, loading: 'lazy' })))),
        usar ? campo({ etiqueta: 'Cambiar cada', control: inputNumero(ctx, base + '.intervalo', { min: 3, max: 30, sufijo: 'seg' }) }) : null,
        usar ? listaEditable(ctx, base + '.items', {
            crear: nuevoBanner,
            etiquetaAgregar: 'Agregar banner',
            vacio: 'Sin banners: mientras la lista esté vacía se siguen viendo los del código.',
            titulo: (b, i) => b.alt || `Banner ${i + 1}`,
            subtitulo: (b) => chipVigencia(b, app.ahora()),
            cuerpo: (c) => h('div', { class: 'pila' },
                h('div', { class: 'fila fila--img' },
                    selectorImagen(c, 'desktop', { subir: app.subir, anchoMax: 1920, etiqueta: 'Computadora', recomendacion: 'Mismo formato que los actuales · ancho 1920px' }),
                    selectorImagen(c, 'mobile', { subir: app.subir, anchoMax: 900, etiqueta: 'Celular (opcional)', recomendacion: 'Más alto que ancho · 900px' })),
                fila(
                    campo({ etiqueta: 'Descripción (accesibilidad)', control: inputTexto(c, 'alt', { placeholder: 'Ej: Ofertas de fin de año' }) }),
                    campo({ etiqueta: 'Enlace al tocar (opcional)', control: inputTexto(c, 'enlace', { tipo: 'url', mono: true, placeholder: 'https://…' }) })),
                campo({ etiqueta: 'Vigencia', control: vigencia(c, '', { alCambiar: () => ctx.render() }) }))
        }) : null);
    return tarjeta({ titulo, descripcion: desc, icono: 'fa-regular fa-images', cuerpo });
}

const banners = {
    id: 'banners', grupo: 'Comunicación', titulo: 'Banners', icono: 'fa-regular fa-images',
    descripcion: 'Reemplazá las imágenes del carrusel principal y del pie, con versión para celular y fechas de campaña.',
    render(ctx, app) {
        return h('div', { class: 'pila' },
            seccionBanners(ctx, app, 'principal', 'Carrusel principal', 'Debajo del encabezado.'),
            seccionBanners(ctx, app, 'pie', 'Carrusel del pie', 'Al final de la página, después del pie.'),
            aviso('Si todos los banners del panel vencen o se pausan, el catálogo vuelve a mostrar automáticamente los del código.', 'info'));
    }
};

/* ================================================================= TEXTOS */

const textos = {
    id: 'textos', grupo: 'Contenido', titulo: 'Textos', icono: 'fa-solid fa-font',
    descripcion: 'Editá los textos fijos del catálogo. Un campo vacío muestra el texto original del código.',
    render(ctx, app) {
        const meta = CATALOGOS[app.cat];
        const grupos = {};
        meta.textos.forEach((t) => { (grupos[t.grupo] = grupos[t.grupo] || []).push(t); });
        return h('div', { class: 'pila' }, Object.keys(grupos).map((g) => tarjeta({
            titulo: g, icono: 'fa-solid fa-paragraph',
            cuerpo: h('div', { class: 'pila' }, grupos[g].map((t) => {
                const ruta = 'textos.' + t.clave;
                const valor = ctx.get(ruta);
                const control = t.rico
                    ? editorRico(ctx, ruta, { unaLinea: !t.largo, placeholder: textoPlano(t.original) })
                    : (t.largo ? textarea(ctx, ruta, { placeholder: t.original, filas: 2 }) : inputTexto(ctx, ruta, { placeholder: t.original }));
                const partes = [campo({ etiqueta: t.etiqueta, control, extra: h('span', { class: 'campo-extras' }, etiquetaPorDefecto(valor), valor ? botonRestaurar(ctx, ruta) : null,
                    t.rico && !valor ? h('button', { type: 'button', class: 'restaurar', onclick: () => ctx.set(ruta, t.original, { estructura: true }) }, icono('fa-solid fa-pen'), 'Editar original') : null) })];
                if (t.icono) partes.push(campo({ etiqueta: 'Ícono', control: selectorIcono(ctx, 'textos.' + t.icono, { original: t.iconoOriginal }) }));
                if (t.ocultable) partes.push(interruptor(ctx, 'ocultar.' + t.clave, { etiqueta: 'Mostrar este ítem', invertido: true }));
                return h('div', { class: 'grupo-texto' }, partes);
            }))
        })));
    }
};

/* ==================================================================== FAQ */

const faq = {
    id: 'faq', grupo: 'Contenido', titulo: 'Preguntas frecuentes', icono: 'fa-regular fa-circle-question',
    descripcion: 'Las preguntas del pop-up de bienvenida: ocultá, reescribí o sumá preguntas temporales.',
    render(ctx, app) {
        const meta = CATALOGOS[app.cat];
        const existentes = h('div', { class: 'faq-lista' }, meta.faq.map((q) => {
            const oculta = ctx.get('faq.ocultar.' + q.clave) === true;
            const rutaP = `faq.cambios.${q.clave}.pregunta`;
            const rutaR = `faq.cambios.${q.clave}.respuesta`;
            const modificada = !!(ctx.get(rutaP) || ctx.get(rutaR));
            const abierta = (ctx.abiertos || (ctx.abiertos = new Set())).has('faq-' + q.clave);
            const cab = h('div', { class: 'faq-cabeza' },
                h('button', { type: 'button', class: 'faq-titulo', 'aria-expanded': String(abierta), onclick: () => { abierta ? ctx.abiertos.delete('faq-' + q.clave) : ctx.abiertos.add('faq-' + q.clave); ctx.render(); } },
                    h('span', null, ctx.get(rutaP) || q.pregunta),
                    modificada ? h('span', { class: 'etiqueta-def etiqueta-def--cambiado' }, 'editada') : null,
                    oculta ? h('span', { class: 'etiqueta-def' }, 'oculta') : null),
                interruptor(ctx, 'faq.ocultar.' + q.clave, { invertido: true, alCambiar: () => ctx.render() }));
            const cuerpo = abierta && !q.soloOcultar ? h('div', { class: 'faq-cuerpo pila' },
                q.nota ? aviso(q.nota, 'info') : null,
                campo({ etiqueta: 'Pregunta', control: inputTexto(ctx, rutaP, { placeholder: q.pregunta }), extra: ctx.get(rutaP) ? botonRestaurar(ctx, rutaP) : null }),
                q.soloPregunta ? null : campo({
                    etiqueta: 'Respuesta', control: editorRico(ctx, rutaR, { placeholder: textoPlano(q.respuesta) }),
                    extra: ctx.get(rutaR) ? botonRestaurar(ctx, rutaR)
                        : h('button', { type: 'button', class: 'restaurar', onclick: () => ctx.set(rutaR, q.respuesta, { estructura: true }) }, icono('fa-solid fa-pen'), 'Editar original')
                })) : (abierta && q.nota ? h('div', { class: 'faq-cuerpo' }, aviso(q.nota, 'info')) : null);
            return h('div', { class: 'faq-fila' + (oculta ? ' is-oculta' : '') }, cab, cuerpo);
        }));
        const extra = listaEditable(ctx, 'faq.extra', {
            crear: nuevaPregunta,
            etiquetaAgregar: 'Agregar pregunta',
            vacio: 'Sin preguntas extra. Útiles para horarios de fiestas, demoras de envío o promociones.',
            titulo: (q) => q.pregunta || 'Pregunta nueva',
            subtitulo: (q) => chipVigencia(q, app.ahora()),
            cuerpo: (c) => h('div', { class: 'pila' },
                campo({ etiqueta: 'Pregunta', control: inputTexto(c, 'pregunta', { placeholder: '¿Atienden durante las fiestas?' }) }),
                campo({ etiqueta: 'Respuesta', control: editorRico(c, 'respuesta', { placeholder: 'Sí, el 24 y 31 atendemos hasta las 14 hs…' }) }),
                campo({ etiqueta: 'Ubicación', control: segmentado(c, 'posicion', [{ valor: 'inicio', etiqueta: 'Al principio' }, { valor: 'final', etiqueta: 'Al final' }], { tamano: 'chico' }) }),
                campo({ etiqueta: 'Vigencia', control: vigencia(c, '', { alCambiar: () => ctx.render() }) }))
        });
        return h('div', { class: 'pila' },
            tarjeta({ titulo: 'Preguntas del catálogo', icono: 'fa-solid fa-list-check', descripcion: 'Tocá una pregunta para editarla. El interruptor la muestra u oculta.', cuerpo: existentes }),
            tarjeta({ titulo: 'Preguntas extra', icono: 'fa-solid fa-plus', cuerpo: extra }));
    }
};

/* =============================================================== CONTACTO */

const contacto = {
    id: 'contacto', grupo: 'Contenido', titulo: 'Contacto y horarios', icono: 'fa-brands fa-whatsapp',
    descripcion: 'Números de WhatsApp, email, redes, direcciones y horarios. Vacío = el valor actual del código.',
    render(ctx, app) {
        const meta = CATALOGOS[app.cat];
        const wa = meta.whatsapp.map((w) => {
            const ruta = 'contacto.whatsapp.' + w.clave;
            const vista = h('span', { class: 'tel-vista' });
            const actualizar = () => { const v = ctx.get(ruta); vista.textContent = formatearTel(v || w.original) + (v ? '' : ' · actual'); };
            const input = inputTexto(ctx, ruta, { tipo: 'tel', mono: true, placeholder: w.original, alCambiar: actualizar });
            actualizar();
            const probar = h('a', { class: 'btn-icono', title: 'Probar en WhatsApp', target: '_blank', rel: 'noopener', href: '#' }, icono('fa-solid fa-arrow-up-right-from-square'));
            probar.addEventListener('click', () => { probar.href = 'https://api.whatsapp.com/send/?phone=' + String(ctx.get(ruta) || w.original).replace(/\D/g, ''); });
            return campo({ etiqueta: w.etiqueta, ayuda: w.ayuda, control: h('div', { class: 'control-grupo' }, input, probar), extra: vista });
        });
        return h('div', { class: 'pila' },
            tarjeta({ titulo: 'WhatsApp', icono: 'fa-brands fa-whatsapp', descripcion: 'Con código de país y área, sin espacios ni signos. Ej: 5491121891006.', cuerpo: h('div', { class: 'pila' }, wa) }),
            tarjeta({
                titulo: 'Email y redes', icono: 'fa-solid fa-at', cuerpo: h('div', { class: 'pila' },
                    campo({ etiqueta: 'Email', control: inputTexto(ctx, 'contacto.email', { tipo: 'email', mono: true, placeholder: 'distribuidorahomepoint@gmail.com' }) }),
                    fila(
                        campo({ etiqueta: 'Instagram', control: inputTexto(ctx, 'contacto.instagram', { tipo: 'url', mono: true, placeholder: 'https://www.instagram.com/distribuidora.homepoint/' }) }),
                        campo({ etiqueta: 'TikTok', control: inputTexto(ctx, 'contacto.tiktok', { tipo: 'url', mono: true, placeholder: 'https://www.tiktok.com/@sdistribuidora.homepoint/' }) })))
            }),
            tarjeta({
                titulo: 'Direcciones y horarios', icono: 'fa-regular fa-clock', descripcion: 'Ideal para horarios especiales de fiestas o vacaciones.',
                cuerpo: h('div', { class: 'pila' }, meta.lugares.map((l) => {
                    const ruta = 'textos.' + l.clave;
                    return campo({ etiqueta: l.etiqueta, control: inputTexto(ctx, ruta, { placeholder: l.original }), extra: ctx.get(ruta) ? botonRestaurar(ctx, ruta) : null });
                }))
            }));
    }
};

/* ============================================================= CONDICIONES */

const condiciones = {
    id: 'condiciones', grupo: 'Comercial', titulo: 'Condiciones', icono: 'fa-solid fa-scale-balanced',
    descripcion: 'Mínimo de compra y descuento por volumen que el checkout valida y muestra.',
    render(ctx, app) {
        const meta = CATALOGOS[app.cat];
        const d = meta.defaults;
        const sim = { total: 120000, unidades: 6 };
        const resultado = h('div', { class: 'sim-resultado' });
        const valor = (ruta, def) => { const v = ctx.get(ruta); return v === '' || v === undefined || v === null ? def : Number(v); };
        const calcular = () => {
            const mm = valor('condiciones.minimo.monto', d.minimo.monto);
            const mu = valor('condiciones.minimo.unidades', d.minimo.unidades);
            const dh = meta.tieneDescuento ? (ctx.get('condiciones.descuento.habilitado') ?? d.descuento.habilitado) : false;
            const du = valor('condiciones.descuento.umbral', d.descuento.umbral);
            const dn = valor('condiciones.descuento.unidades', d.descuento.unidades);
            const dp = valor('condiciones.descuento.porcentaje', d.descuento.porcentaje);
            const pasa = sim.total >= mm && sim.unidades >= mu;
            const desc = dh && sim.total > du && sim.unidades >= dn ? sim.total * dp / 100 : 0;
            resultado.innerHTML = '';
            resultado.append(
                h('div', { class: 'sim-linea ' + (pasa ? 'ok' : 'no') }, icono(pasa ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'),
                    pasa ? 'Puede enviar el pedido' : `No alcanza el mínimo (${moneda(mm)}${mu ? ` y ${mu} unidades` : ''})`),
                meta.tieneDescuento ? h('div', { class: 'sim-linea ' + (desc ? 'ok' : 'neutro') }, icono('fa-solid fa-tags'),
                    desc ? `Descuento ${dp}%: −${moneda(desc)} → total ${moneda(sim.total - desc)}` : 'Sin descuento') : null);
        };
        const simInput = (k, pre, suf) => {
            const el = h('input', { type: 'number', class: 'control control--num', value: sim[k] });
            el.addEventListener('input', () => { sim[k] = Number(el.value) || 0; calcular(); });
            return h('div', { class: 'control-grupo' }, pre ? h('span', { class: 'control-afijo' }, pre) : null, el, suf ? h('span', { class: 'control-afijo' }, suf) : null);
        };
        calcular();
        const num = (ruta, def, o) => campo({ etiqueta: o.etiqueta, ayuda: `Actual en el código: <b>${o.fmt ? o.fmt(def) : def}</b>`, control: inputNumero(ctx, ruta, Object.assign({ placeholder: String(def), alCambiar: calcular }, o)), extra: etiquetaPorDefecto(ctx.get(ruta)) });

        return h('div', { class: 'pila' },
            aviso('Estos valores cambian lo que el catálogo <b>valida y muestra</b> en el carrito. No cambian cómo se registran los pedidos ni los precios.', 'alerta'),
            tarjeta({
                titulo: 'Mínimo de compra para envíos', icono: 'fa-solid fa-truck',
                descripcion: meta.tieneRetiro ? 'Los retiros en sucursal no tienen mínimo.' : 'Aplica a todos los pedidos de este catálogo.',
                cuerpo: fila(
                    num('condiciones.minimo.monto', d.minimo.monto, { etiqueta: 'Monto mínimo', prefijo: '$', paso: 1000, min: 0, fmt: moneda }),
                    num('condiciones.minimo.unidades', d.minimo.unidades, { etiqueta: 'Unidades mínimas', sufijo: 'u.', min: 0 }))
            }),
            meta.tieneDescuento ? tarjeta({
                titulo: 'Descuento por volumen', icono: 'fa-solid fa-tags',
                descripcion: 'Se aplica sobre pedidos con envío que superen el monto y las unidades.',
                cuerpo: h('div', { class: 'pila' },
                    interruptor(ctx, 'condiciones.descuento.habilitado', { etiqueta: 'Descuento activo', porDefecto: d.descuento.habilitado, alCambiar: calcular }),
                    fila(
                        num('condiciones.descuento.umbral', d.descuento.umbral, { etiqueta: 'A partir de', prefijo: '$', paso: 1000, min: 0, fmt: moneda }),
                        num('condiciones.descuento.unidades', d.descuento.unidades, { etiqueta: 'Con al menos', sufijo: 'u.', min: 0 }),
                        num('condiciones.descuento.porcentaje', d.descuento.porcentaje, { etiqueta: 'Porcentaje', sufijo: '%', min: 0, max: 90, fmt: (v) => v + '%' })),
                    campo({ etiqueta: 'Nota bajo el descuento', control: inputTexto(ctx, 'textos.descuentoNota', { placeholder: 'No acumulable con otros descuentos o vouchers de compra' }) }))
            }) : aviso('El catálogo Interior trabaja con precios de oferta y no aplica descuento por volumen.', 'info'),
            tarjeta({
                titulo: 'Simulador', icono: 'fa-solid fa-calculator', descripcion: 'Probá cómo responde el checkout con un carrito de ejemplo.',
                cuerpo: h('div', { class: 'pila' },
                    fila(campo({ etiqueta: 'Total del carrito', control: simInput('total', '$') }), campo({ etiqueta: 'Unidades', control: simInput('unidades', null, 'u.') })),
                    resultado)
            }));
    }
};

/* ============================================================== APARIENCIA */

function contraste(hex) {
    const m = String(hex || '').match(/^#([0-9a-f]{6})$/i);
    if (!m) return 21;
    const n = parseInt(m[1], 16);
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return 1.05 / (L + 0.05);
}

const apariencia = {
    id: 'apariencia', grupo: 'Estilo', titulo: 'Apariencia y temporada', icono: 'fa-solid fa-palette',
    descripcion: 'Color de acento de botones y precios, y decoración animada para fechas especiales.',
    render(ctx, app) {
        const acento = ctx.get('apariencia.acento') || '';
        const ratio = contraste(acento);
        const muestraVista = h('div', { class: 'acento-vista', style: { '--muestra': acento || CATALOGOS[app.cat].color } },
            h('button', { type: 'button', class: 'acento-btn' }, icono('fa-solid fa-cart-plus'), 'Agregar'),
            h('span', { class: 'acento-precio' }, '$12.500'),
            h('span', { class: 'acento-chip' }, 'Disponible'));
        const tipo = ctx.get('apariencia.decoracion.tipo') || 'ninguna';
        const decos = h('div', { class: 'decos' }, DECORACIONES.map((d) => {
            const b = h('button', { type: 'button', class: 'deco', 'aria-pressed': String(tipo === d.valor) }, h('span', { class: 'deco-simbolo' }, d.simbolo), h('span', null, d.etiqueta));
            b.addEventListener('click', () => ctx.set('apariencia.decoracion.tipo', d.valor, { estructura: true }));
            return b;
        }));
        return h('div', { class: 'pila' },
            tarjeta({
                titulo: 'Color de acento', icono: 'fa-solid fa-droplet',
                descripcion: 'Botones principales, precios y estados. Los colores de stock no cambian.',
                cuerpo: h('div', { class: 'pila' },
                    muestras(ctx, 'apariencia.acento', ACENTOS.map((a) => ({ valor: a.valor, etiqueta: a.etiqueta, muestra: a.valor || CATALOGOS[app.cat].color })), { conPersonalizado: true, alCambiar: () => ctx.render() }),
                    muestraVista,
                    acento && ratio < 4.5 ? aviso(`Contraste bajo con texto blanco (${ratio.toFixed(1)}:1). Para botones legibles conviene 4.5:1 o más: probá un tono más oscuro.`, 'alerta') : null)
            }),
            tarjeta({
                titulo: 'Decoración de temporada', icono: 'fa-solid fa-snowflake',
                descripcion: 'Animación liviana que no bloquea clics. Se desactiva sola para quien prefiere menos movimiento.',
                cuerpo: h('div', { class: 'pila' },
                    decos,
                    tipo !== 'ninguna' ? campo({ etiqueta: 'Duración', control: segmentado(ctx, 'apariencia.decoracion.intensidad', [
                        { valor: 'sutil', etiqueta: 'Sólo al entrar (16 s)' }, { valor: 'continua', etiqueta: 'Continua' }], { tamano: 'chico' }) }) : null,
                    interruptor(ctx, 'apariencia.decoracion.guirnalda', { etiqueta: 'Guirnalda de luces', descripcion: 'Luces titilando bajo el encabezado.' }),
                    tipo !== 'ninguna' || ctx.get('apariencia.decoracion.guirnalda') ? campo({ etiqueta: 'Vigencia', control: vigencia(ctx, 'apariencia.decoracion') }) : null)
            }));
    }
};

/* =============================================================== INSIGNIAS */

const insignias = {
    id: 'insignias', grupo: 'Comercial', titulo: 'Insignias', icono: 'fa-solid fa-certificate',
    descripcion: 'Etiquetas sobre las fotos de productos («Oferta», «Nuevo», «Últimas unidades») por código o por categoría.',
    insignia: (app) => { const n = app.borrador.insignias.filter((a) => estadoVigencia(a, app.ahora()) === 'activo').length; return n ? { texto: String(n) } : null; },
    render(ctx, app) {
        app.cargarCategorias();
        const lista = listaEditable(ctx, 'insignias', {
            crear: nuevaInsignia,
            etiquetaAgregar: 'Agregar insignia',
            vacio: 'Sin insignias. Destacá productos en oferta o recién llegados.',
            titulo: (n) => n.texto || 'Insignia',
            subtitulo: (n) => h('span', { class: 'item-sub-linea' }, chipVigencia(n, app.ahora()),
                h('span', { class: 'item-sub-texto' }, (n.tipo === 'categoria' ? 'Categoría: ' : 'Códigos: ') + (String(n.valores || '').split(/[,\n;]+/).filter((x) => x.trim()).length || 'ninguno'))),
            cuerpo: (c) => {
                const vista = h('span', { class: 'insignia-vista' });
                const pintar = () => { vista.className = 'insignia-vista insignia-vista--' + (c.get('color') || 'rojo'); vista.textContent = c.get('texto') || 'Insignia'; };
                pintar();
                const tipo = c.get('tipo') || 'codigos';
                const validacion = h('p', { class: 'campo-ayuda' });
                const validar = () => {
                    const vals = String(c.get('valores') || '').split(/[,\n;]+/).map((v) => v.trim()).filter(Boolean);
                    const ref = tipo === 'categoria' ? app.categorias : app.codigos;
                    if (!ref || !ref.size || !vals.length) { validacion.textContent = tipo === 'categoria' ? 'Escribí una o más categorías, separadas por coma.' : 'Un código por línea o separados por coma.'; return; }
                    const faltan = vals.filter((v) => !ref.has(v.toLowerCase()));
                    validacion.innerHTML = faltan.length
                        ? `<span class="txt-alerta">No encontrados en la lista: ${faltan.slice(0, 6).map(escapar).join(', ')}${faltan.length > 6 ? '…' : ''}</span>`
                        : `<span class="txt-ok">${vals.length} ${tipo === 'categoria' ? 'categoría(s)' : 'código(s)'} encontrados.</span>`;
                };
                validar();
                return h('div', { class: 'pila' },
                    fila(
                        campo({ etiqueta: 'Texto', control: inputTexto(c, 'texto', { placeholder: 'Oferta', max: 22, alCambiar: () => { pintar(); } }) }),
                        campo({ etiqueta: 'Vista', control: h('div', { class: 'insignia-caja' }, vista) })),
                    campo({ etiqueta: 'Color', control: muestras(c, 'color', COLORES_INSIGNIA, { alCambiar: pintar }) }),
                    campo({ etiqueta: 'Aplicar a', control: segmentado(c, 'tipo', [{ valor: 'codigos', etiqueta: 'Códigos' }, { valor: 'categoria', etiqueta: 'Categorías' }], { alCambiar: () => ctx.render(), tamano: 'chico' }) }),
                    campo({ etiqueta: tipo === 'categoria' ? 'Categorías' : 'Códigos de artículo', control: textarea(c, 'valores', { filas: 3, mono: true, placeholder: tipo === 'categoria' ? 'Cocina, Baño' : 'A102\nB220\nC015', alCambiar: validar }) }),
                    validacion,
                    campo({ etiqueta: 'Vigencia', control: vigencia(c, '', { alCambiar: () => ctx.render() }) }));
            }
        });
        return h('div', { class: 'pila' }, tarjeta({ titulo: 'Insignias', icono: 'fa-solid fa-certificate', descripcion: 'Si un producto coincide con varias, se usa la primera de la lista.', cuerpo: lista }));
    }
};

/* ============================================================== PLANTILLAS */

function aplicarCambiosPlantilla(cfg, cambios) {
    const c = clonar(cfg);
    if (cambios.anuncio) {
        c.anuncios.items.unshift(Object.assign(nuevoAnuncio(), cambios.anuncio));
        if (cambios.anunciosEstilo) c.anuncios.estilo = cambios.anunciosEstilo;
    }
    if (cambios.popup) c.popups.unshift(Object.assign(nuevoPopup(), cambios.popup));
    if (cambios.acento !== undefined) c.apariencia.acento = cambios.acento;
    if (cambios.decoracion) c.apariencia.decoracion = Object.assign({ tipo: 'ninguna', intensidad: 'sutil', guirnalda: false, desde: 0, hasta: 0 }, cambios.decoracion);
    if (cambios.estado) c.estado = Object.assign({}, c.estado, cambios.estado, { desde: 0 });
    return c;
}

const plantillas = {
    id: 'plantillas', grupo: 'Herramientas', titulo: 'Plantillas', icono: 'fa-solid fa-wand-magic-sparkles',
    descripcion: 'Campañas listas para aplicar en un clic, tus propias plantillas y copia entre catálogos.',
    render(ctx, app) {
        const tarjetaPlantilla = (p) => {
            const b = h('article', { class: 'plantilla', style: { '--fondo': p.fondo } },
                h('div', { class: 'plantilla-portada' }, h('span', { class: 'plantilla-emoji' }, p.emoji)),
                h('div', { class: 'plantilla-cuerpo' },
                    h('h4', null, p.nombre),
                    h('p', null, p.resumen),
                    boton('Aplicar al borrador', { variante: 'secundario', tamano: 'chico', icono: 'fa-solid fa-wand-magic-sparkles', accion: async () => {
                        const ok = await confirmar(`Aplicar «${p.nombre}»`, `Se agregan elementos al borrador de <b>${CATALOGOS[app.cat].nombre}</b> con fechas sugeridas. Nada se publica hasta que vos lo decidas, y podés deshacerlo con Ctrl+Z.`, { aceptar: 'Aplicar' });
                        if (!ok) return;
                        ctx.reemplazar(aplicarCambiosPlantilla(app.borrador, p.aplicar()));
                        toast(`Plantilla «${p.nombre}» aplicada. Revisala en la vista previa.`, 'ok', { accion: { texto: 'Deshacer', fn: () => app.deshacer() } });
                    } })));
            return b;
        };
        const propias = h('div', { class: 'propias' }, h('div', { class: 'lista-vacia' }, 'Cargando…'));
        app.plantillasPropias().then((lista) => {
            propias.innerHTML = '';
            if (!lista.length) { propias.appendChild(h('div', { class: 'lista-vacia' }, 'Todavía no guardaste plantillas propias.')); return; }
            lista.forEach((p) => {
                propias.appendChild(h('div', { class: 'propia' },
                    h('div', { class: 'propia-textos' }, h('strong', null, p.nombre), h('span', null, (p.secciones || []).join(', ') + ' · ' + fecha(p.fecha))),
                    boton('Aplicar', { variante: 'secundario', tamano: 'chico', accion: async () => {
                        if (!(await confirmar(`Aplicar «${p.nombre}»`, 'Reemplaza en el borrador las secciones guardadas en la plantilla.', { aceptar: 'Aplicar' }))) return;
                        const c = clonar(app.borrador);
                        Object.keys(p.datos || {}).forEach((s) => { c[s] = clonar(p.datos[s]); });
                        ctx.reemplazar(c);
                        toast('Plantilla aplicada al borrador.', 'ok');
                    } }),
                    botonIcono('fa-regular fa-trash-can', 'Eliminar plantilla', async () => {
                        if (!(await confirmar('¿Eliminar la plantilla?', `«${escapar(p.nombre)}» se borra para todos los administradores.`, { peligro: true, aceptar: 'Eliminar' }))) return;
                        await app.borrarPlantilla(p.id);
                        ctx.render();
                    }, false, 'peligro')));
            });
        });

        const SECCIONES = [['anuncios', 'Anuncios'], ['popups', 'Pop-ups'], ['banners', 'Banners'], ['textos', 'Textos'], ['faq', 'Preguntas'], ['apariencia', 'Apariencia'], ['insignias', 'Insignias'], ['condiciones', 'Condiciones'], ['estado', 'Estado'], ['contacto', 'Contacto']];
        const elegirSecciones = (preseleccion) => {
            const caja = h('div', { class: 'checks' });
            SECCIONES.forEach(([k, n]) => caja.appendChild(h('label', { class: 'check' }, h('input', { type: 'checkbox', value: k, checked: preseleccion.includes(k) || null }), h('span', null, n))));
            return caja;
        };
        const guardarPropia = async () => {
            const nombre = h('input', { class: 'control', placeholder: 'Ej: Campaña invierno' });
            const checks = elegirSecciones(['anuncios', 'popups', 'apariencia']);
            const ok = await dialogo({
                titulo: 'Guardar como plantilla', descripcion: 'Guarda las secciones elegidas del borrador actual para reutilizarlas en cualquier catálogo.',
                cuerpo: h('div', { class: 'pila' }, campo({ etiqueta: 'Nombre', control: nombre }), campo({ etiqueta: 'Secciones', control: checks })),
                acciones: [{ texto: 'Cancelar', variante: 'fantasma', valor: false }, { texto: 'Guardar plantilla', variante: 'primario', valor: true, validar: () => !!nombre.value.trim() || (toast('Poné un nombre.', 'alerta'), false) }]
            });
            if (!ok) return;
            const secs = [...checks.querySelectorAll('input:checked')].map((i) => i.value);
            await app.guardarPlantilla(nombre.value.trim(), secs);
            toast('Plantilla guardada.', 'ok');
            ctx.render();
        };
        const otro = Object.keys(CATALOGOS).find((c) => c !== app.cat);
        const copiar = async () => {
            const checks = elegirSecciones(['anuncios', 'popups', 'apariencia', 'insignias']);
            const ok = await dialogo({
                titulo: `Copiar a ${CATALOGOS[otro].nombre}`,
                descripcion: `Reemplaza esas secciones en el <b>borrador</b> de ${CATALOGOS[otro].nombre}. Después revisá y publicá ese catálogo.`,
                cuerpo: checks,
                acciones: [{ texto: 'Cancelar', variante: 'fantasma', valor: false }, { texto: 'Copiar', variante: 'primario', valor: true }]
            });
            if (!ok) return;
            const secs = [...checks.querySelectorAll('input:checked')].map((i) => i.value);
            await app.copiarA(otro, secs);
            toast(`Copiado al borrador de ${CATALOGOS[otro].nombre}.`, 'ok', { accion: { texto: 'Ir', fn: () => app.cambiarCatalogo(otro) } });
        };
        return h('div', { class: 'pila' },
            tarjeta({ titulo: 'Temporadas y eventos', icono: 'fa-solid fa-star', descripcion: 'Se agregan al borrador con fechas de fin sugeridas: ajustalas antes de publicar.', cuerpo: h('div', { class: 'plantillas' }, PLANTILLAS.map(tarjetaPlantilla)) }),
            tarjeta({ titulo: 'Mis plantillas', icono: 'fa-regular fa-bookmark', acciones: boton('Guardar borrador como plantilla', { variante: 'secundario', tamano: 'chico', icono: 'fa-solid fa-plus', accion: guardarPropia }), cuerpo: propias }),
            tarjeta({ titulo: 'Copiar entre catálogos', icono: 'fa-regular fa-clone', descripcion: `Llevá secciones de <b>${CATALOGOS[app.cat].nombre}</b> al borrador de <b>${CATALOGOS[otro].nombre}</b>.`, cuerpo: boton(`Copiar a ${CATALOGOS[otro].nombre}…`, { variante: 'secundario', icono: 'fa-regular fa-clone', accion: copiar }) }));
    }
};

/* =============================================================== HISTORIAL */

const historial = {
    id: 'historial', grupo: 'Herramientas', titulo: 'Historial', icono: 'fa-solid fa-clock-rotate-left',
    descripcion: 'Cada publicación queda registrada. Compará versiones y restaurá cualquiera en un clic.',
    render(ctx, app) {
        const caja = h('div', { class: 'historial' }, h('div', { class: 'lista-vacia' }, 'Cargando versiones…'));
        app.historial().then((lista) => {
            caja.innerHTML = '';
            if (!lista.length) { caja.appendChild(h('div', { class: 'lista-vacia' }, 'Todavía no hay publicaciones de este catálogo.')); return; }
            lista.forEach((v, i) => {
                const ver = async () => {
                    const dif = diferencias(v.config, app.borrador);
                    await dialogo({
                        titulo: `Versión ${v.version || ''} · ${fecha(v.fecha, true)}`,
                        descripcion: 'Diferencias entre esta versión y tu borrador actual.',
                        ancho: 'lg',
                        cuerpo: app.vistaDiferencias(dif, 'Esta versión es igual a tu borrador.'),
                        acciones: [{ texto: 'Cerrar', variante: 'fantasma' }]
                    });
                };
                caja.appendChild(h('div', { class: 'version' + (i === 0 ? ' is-actual' : '') },
                    h('span', { class: 'version-punto' }),
                    h('div', { class: 'version-textos' },
                        h('div', { class: 'version-linea' },
                            h('strong', null, 'v' + (v.version || lista.length - i)),
                            i === 0 ? h('span', { class: 'chip chip--activo' }, h('span', { class: 'chip-punto' }), 'Publicada') : null,
                            h('span', { class: 'version-fecha' }, fecha(v.fecha, true))),
                        h('span', { class: 'version-nota' }, v.nota || 'Sin nota'),
                        h('span', { class: 'version-autor' }, (v.autor || '').split('@')[0] + (v.cambios ? ` · ${v.cambios} cambio${v.cambios === 1 ? '' : 's'}` : ''))),
                    h('div', { class: 'version-acciones' },
                        boton('Comparar', { variante: 'fantasma', tamano: 'chico', accion: ver }),
                        i === 0 ? null : boton('Cargar en borrador', { variante: 'secundario', tamano: 'chico', accion: async () => {
                            if (!(await confirmar('¿Cargar esta versión?', 'Reemplaza tu borrador por esta versión. Para que la vean los clientes, publicá después.', { aceptar: 'Cargar' }))) return;
                            ctx.reemplazar(v.config);
                            toast('Versión cargada en el borrador.', 'ok', { accion: { texto: 'Deshacer', fn: () => app.deshacer() } });
                        } }),
                        i === 0 ? null : boton('Restaurar', { variante: 'primario', tamano: 'chico', icono: 'fa-solid fa-rotate-left', accion: () => app.restaurar(v) }))));
            });
        }).catch((e) => { caja.innerHTML = ''; caja.appendChild(aviso('No se pudo leer el historial: ' + escapar(e.message || e), 'peligro')); });
        return h('div', { class: 'pila' }, tarjeta({ titulo: 'Versiones publicadas', icono: 'fa-solid fa-code-branch', cuerpo: caja }));
    }
};

export const SECCIONES = [resumen, estado, anuncios, popups, banners, textos, faq, contacto, condiciones, insignias, apariencia, plantillas, historial];
export { sanear };
