/* ==========================================================================
   preview.js · vista previa en vivo
   Carga el catálogo real con ?cmsPreview=1 dentro de un iframe y le manda el
   borrador por postMessage. En ese modo el catálogo no lee la base y bloquea
   el envío de pedidos (ver CatalogoWeb/cms/catalogo-cms.js).
   ========================================================================== */
import { CATALOGOS, URL_SITIO, paraGuardar } from './schema.js';
import { h, icono, botonIcono, toast } from './ui.js';

const DISPOSITIVOS = {
    escritorio: { ancho: 1280, alto: 820, etiqueta: 'Computadora', icono: 'fa-solid fa-desktop' },
    movil: { ancho: 390, alto: 844, etiqueta: 'Celular', icono: 'fa-solid fa-mobile-screen-button' }
};

export function urlBase() {
    let b = '';
    try { b = localStorage.getItem('hpcms:urlBase') || ''; } catch (e) { b = ''; }
    return (b && /^https?:\/\//.test(b) ? b.replace(/\/?$/, '/') : URL_SITIO);
}

export function crearPreview({ obtenerConfig, obtenerAhora }) {
    let cat = null;
    let dispositivo = 'movil';
    try { dispositivo = localStorage.getItem('hpcms:dispositivo') || 'movil'; } catch (e) { /* nada */ }
    let listo = false;
    let temporizador = null;
    let pendiente = null;

    const iframe = h('iframe', { class: 'pv-iframe', title: 'Vista previa del catálogo', loading: 'eager', referrerpolicy: 'no-referrer-when-downgrade' });
    const escena = h('div', { class: 'pv-escena' }, h('div', { class: 'pv-dispositivo' }, iframe));
    const estado = h('span', { class: 'pv-estado' }, h('span', { class: 'pv-luz' }), h('span', { class: 'pv-estado-texto' }, 'Conectando…'));
    const cargando = h('div', { class: 'pv-cargando' }, h('div', { class: 'pv-spinner' }), h('span', null, 'Cargando el catálogo…'));
    const fallo = h('div', { class: 'pv-fallo', hidden: true },
        icono('fa-solid fa-plug-circle-xmark'),
        h('strong', null, 'La vista previa no respondió'),
        h('p', null, 'El catálogo publicado todavía no tiene el script del panel (cms/catalogo-cms.js) o tardó demasiado en cargar.'),
        h('button', { type: 'button', class: 'btn btn--secundario btn--chico', onclick: () => recargar() }, icono('fa-solid fa-rotate-right'), h('span', null, 'Reintentar')));

    const segDisp = h('div', { class: 'seg seg--chico pv-disp', role: 'radiogroup', 'aria-label': 'Dispositivo' },
        Object.entries(DISPOSITIVOS).map(([k, d]) => {
            const b = h('button', { type: 'button', class: 'seg-op', role: 'radio', 'aria-checked': String(k === dispositivo), title: d.etiqueta }, icono(d.icono), h('span', { class: 'solo-ancho' }, d.etiqueta));
            b.addEventListener('click', () => {
                dispositivo = k;
                try { localStorage.setItem('hpcms:dispositivo', k); } catch (e) { /* nada */ }
                segDisp.querySelectorAll('.seg-op').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
                ajustar();
            });
            return b;
        }));

    const barra = h('div', { class: 'pv-barra' },
        estado,
        h('div', { class: 'pv-herramientas' },
            segDisp,
            botonIcono('fa-solid fa-rotate-right', 'Recargar vista previa', () => recargar()),
            botonIcono('fa-solid fa-arrow-up-right-from-square', 'Abrir el catálogo publicado', () => window.open(urlBase() + CATALOGOS[cat].archivo, '_blank', 'noopener'))));

    const raiz = h('aside', { class: 'pv', 'aria-label': 'Vista previa' }, barra, h('div', { class: 'pv-marco' }, escena, cargando, fallo));

    function ajustar() {
        const d = DISPOSITIVOS[dispositivo];
        const marco = raiz.querySelector('.pv-marco');
        const disp = raiz.querySelector('.pv-dispositivo');
        if (!marco) return;
        const disponibleW = marco.clientWidth - 32;
        const disponibleH = marco.clientHeight - 32;
        const escala = Math.min(1, disponibleW / d.ancho, disponibleH / d.alto);
        disp.style.width = d.ancho + 'px';
        disp.style.height = d.alto + 'px';
        disp.style.transform = `scale(${escala})`;
        disp.dataset.dispositivo = dispositivo;
        escena.style.width = Math.round(d.ancho * escala) + 'px';
        escena.style.height = Math.round(d.alto * escala) + 'px';
    }
    new ResizeObserver(ajustar).observe(raiz);

    function origenIframe() {
        try { return new URL(urlBase()).origin; } catch (e) { return '*'; }
    }

    function marcarEstado(tipo, texto) {
        estado.className = 'pv-estado pv-estado--' + tipo;
        estado.querySelector('.pv-estado-texto').textContent = texto;
    }

    function enviar() {
        if (!listo || !iframe.contentWindow) return;
        iframe.contentWindow.postMessage({ tipo: 'hpcms:config', config: paraGuardar(obtenerConfig()), ahora: obtenerAhora() }, origenIframe());
    }

    window.addEventListener('message', (e) => {
        if (e.source !== iframe.contentWindow) return;
        if (origenIframe() !== '*' && e.origin !== origenIframe()) return;
        const d = e.data || {};
        if (d.tipo === 'hpcms:listo') {
            listo = true;
            clearTimeout(temporizador);
            cargando.hidden = true;
            fallo.hidden = true;
            marcarEstado('ok', 'En vivo · borrador');
            enviar();
            if (pendiente) { iframe.contentWindow.postMessage(pendiente, origenIframe()); pendiente = null; }
        } else if (d.tipo === 'hpcms:aplicado') {
            marcarEstado('ok', 'En vivo · borrador');
        }
    });

    function recargar() {
        if (!cat) return;
        listo = false;
        cargando.hidden = false;
        fallo.hidden = true;
        marcarEstado('cargando', 'Cargando…');
        clearTimeout(temporizador);
        temporizador = setTimeout(() => {
            if (listo) return;
            cargando.hidden = true;
            fallo.hidden = false;
            marcarEstado('error', 'Sin conexión');
        }, 20000);
        iframe.src = urlBase() + CATALOGOS[cat].archivo + '?cmsPreview=1&t=' + Date.now();
    }

    let debounce = null;
    return {
        elemento: raiz,
        cargar(nuevoCat) { cat = nuevoCat; recargar(); requestAnimationFrame(ajustar); },
        actualizar() {
            if (!listo) return;
            marcarEstado('sync', 'Aplicando…');
            clearTimeout(debounce);
            debounce = setTimeout(enviar, 140);
        },
        probarPopup(popup) {
            const msg = { tipo: 'hpcms:probarPopup', popup: JSON.parse(JSON.stringify(popup)) };
            if (!listo) { pendiente = msg; toast('La vista previa todavía está cargando; el pop-up se mostrará al terminar.', 'info'); return; }
            iframe.contentWindow.postMessage(msg, origenIframe());
            if (dispositivo === 'movil' && popup.audiencia === 'escritorio') toast('Ojo: este pop-up está configurado sólo para computadora.', 'alerta');
        },
        ajustar
    };
}
