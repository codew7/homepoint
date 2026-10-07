// === USUARIO ACTIVO DE LA CAJA ===
// Al entrar (después del login de Firebase) se pregunta quién está usando el
// equipo. El nombre elegido:
//   · completa el campo Vendedor de cada pedido nuevo (ingresoPedidoV2.js),
//   · es el nombre con el que este equipo aparece en Mensajes (chat.js),
//   · queda visible en el encabezado (#usuarioActualBtn), que permite cambiarlo.
//
// La lista sale de la planilla (Vendedores!A:A), la misma que arma el
// desplegable de vendedores. "WhatsApp" no es una persona sino un modo, así
// que no aparece como botón.
//
// Se recuerda por pestaña (sessionStorage): después de guardar un pedido la
// página se recarga y no tiene sentido volver a preguntar. Una pestaña o
// ventana nueva sí vuelve a preguntar.
//
// Un usuario no puede estar en dos equipos a la vez: el selector lee la
// presencia que publica chat.js (chat/presencia) y marca como "Conectado" a
// quien ya está en otra caja. Abrir el selector desconecta al usuario de esta
// pestaña (queda libre para otro equipo) y no se cierra sin elegir a alguien.
//
// Si una caja se cerró de golpe (corte de luz, PC apagada, internet caído),
// Firebase puede tardar unos minutos en darla por desconectada. Para no
// quedar trabado, tocar a alguien "Conectado" ofrece "Entrar igual", que pide
// confirmación: esa conexión se descarta y, si el otro equipo en verdad
// seguía abierto, chat.js lo devuelve a este selector con un aviso.
//
// "WhatsApp" no es una persona sino un modo con contraseña. La pide este
// archivo (no la página), así funciona igual en la caja y en el historial; la
// marca 'hpModoWhatsapp' de sessionStorage la lee ingresoPedidoV2.js para
// prender la búsqueda manual y el vendedor WhatsApp.
//
// Se carga en <head>, antes del script de login: el resto del archivo sólo
// toca el DOM cuando hace falta.
(function() {
  'use strict';

  const RANGO = 'Vendedores!A:A';
  const SS_ACTUAL = 'hpUsuarioActivo';
  const LS_ULTIMO = 'hpUsuarioUltimo';
  const LS_CACHE = 'hpVendedoresCache';
  const EVENTO = 'usuarioactivo:cambio';
  const NO_PERSONAS = ['whatsapp'];
  const RUTA_PRESENCIA = 'chat/presencia';
  // Al pasar de una pantalla a otra la pestaña suelta su conexión y la vuelve
  // a anotar al cargar: durante ese instante el usuario no cuenta como libre.
  const GRACIA_NAVEGACION_MS = 8 * 1000;
  // Modo WhatsApp de esta pestaña (lo lee ingresoPedidoV2.js) y su contraseña.
  const SS_MODO_WHATSAPP = 'hpModoWhatsapp';
  const CLAVE_WHATSAPP = '2381';

  // Identidad de cada vendedor: un color y un animal. Se reparten por la
  // posición en la planilla, así dos personas nunca comparten color ni animal
  // (mientras la lista no pase de 12; de ahí en más el color se genera y
  // sigue sin repetirse, el animal sí puede volver a aparecer).
  // Colores apagados, pensados para leerse sobre grafito y sobre blanco.
  const TONOS = [
    '#7c5fd0', '#3f8fe6', '#1f9d86', '#d08a1e', '#d6604f', '#b25cc4',
    '#2fa3c7', '#7d9446', '#d1517f', '#4f5fd1', '#3fa35a', '#a86b3c'
  ];

  // Íconos de línea en 24×24, trazo blanco. Caras de frente para que todos
  // se lean igual de grandes dentro del círculo.
  const ANIMALES = {
    gato:     '<path d="M4.5 4.5 8 7.6A7 7 0 0 1 16 7.6l3.5-3.1V12a7.5 7.5 0 0 1-15 0Z"/><path d="M9.5 12h.01M14.5 12h.01"/><path d="M10.8 15h2.4L12 16.3Z"/>',
    perro:    '<path d="M7 7.5c1-2 2.8-3 5-3s4 1 5 3V14a5 5 0 0 1-10 0Z"/><path d="M7 8C5 6 3 7 3 9.5S4.5 14 6.5 13.5M17 8c2-2 4-1 4 1.5S19.5 14 17.5 13.5"/><path d="M10 10.5h.01M14 10.5h.01"/><path d="M11 14h2l-1 1.2Z"/>',
    zorro:    '<path d="M4 4l4 3.5h8L20 4l-1 8-7 8-7-8Z"/><path d="M9.5 11.5h.01M14.5 11.5h.01M12 16h.01"/>',
    oso:      '<circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="6.5" r="2.5"/><circle cx="12" cy="13" r="7"/><ellipse cx="12" cy="15.5" rx="2.6" ry="2"/><path d="M9.5 11h.01M14.5 11h.01M12 15h.01"/>',
    conejo:   '<ellipse cx="9.5" cy="5.5" rx="1.6" ry="4"/><ellipse cx="14.5" cy="5.5" rx="1.6" ry="4"/><circle cx="12" cy="15" r="6"/><path d="M10 14.5h.01M14 14.5h.01M12 17h.01"/>',
    buho:     '<path d="M5 5l2.5 2.2A6.5 6.5 0 0 1 16.5 7.2L19 5v9a7 7 0 0 1-14 0Z"/><circle cx="9.3" cy="12" r="2"/><circle cx="14.7" cy="12" r="2"/><path d="M11.2 15.2h1.6L12 16.5Z"/>',
    pinguino: '<path d="M12 3c-3.5 0-5.5 3-5.5 8v4c0 3.3 2.5 6 5.5 6s5.5-2.7 5.5-6v-4c0-5-2-8-5.5-8Z"/><path d="M6.5 12 4 15M17.5 12l2.5 3"/><path d="M10 7.5h.01M14 7.5h.01"/><path d="M11 9.6h2L12 10.9Z"/>',
    raton:    '<circle cx="6.5" cy="7.5" r="3.5"/><circle cx="17.5" cy="7.5" r="3.5"/><circle cx="12" cy="14" r="6"/><path d="M10 13.5h.01M14 13.5h.01M12 16.5h.01"/>',
    cerdo:    '<circle cx="12" cy="12.5" r="7.5"/><path d="M6.4 7.4 5.2 3.6l4 2.2M17.6 7.4l1.2-3.8-4 2.2"/><ellipse cx="12" cy="14.6" rx="3" ry="2.2"/><path d="M11 14.6h.01M13 14.6h.01M9 10.5h.01M15 10.5h.01"/>',
    rana:     '<circle cx="8" cy="7" r="2.5"/><circle cx="16" cy="7" r="2.5"/><path d="M4 13c0-3 2-5 4-5.5h8c2 .5 4 2.5 4 5.5 0 4-3.6 6.5-8 6.5S4 17 4 13Z"/><path d="M8.5 14.5c2 1.5 5 1.5 7 0M8 7h.01M16 7h.01"/>',
    pez:      '<path d="M3 12c3-5 9-6.5 13-3l4-3v12l-4-3c-4 3.5-10 2-13-3Z"/><path d="M8 11h.01"/><path d="M11 9.5c.8 1.6.8 3.4 0 5"/>',
    tortuga:  '<path d="M3 15a8 7 0 0 1 16 0Z"/><path d="M7.5 15l1.5-4h4l1.5 4M9 11l2-3 2 3"/><path d="M6 15v2.5M16 15v2.5"/><path d="M19 13.5c.5-1.6 2.5-1.9 3-.3s-.6 2.3-2 2.3"/>'
  };
  const ORDEN_ANIMALES = Object.keys(ANIMALES);

  function svgAnimal(clave) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ANIMALES[clave] + '</svg>';
  }

  // Más allá de la paleta fija, ángulo áureo: cada tono nuevo cae lejos de
  // los anteriores y nunca se repite.
  function tonoPorIndice(i) {
    if (i < TONOS.length) return TONOS[i];
    return `hsl(${Math.round((i * 137.508) % 360)} 52% 50%)`;
  }

  // La lista vigente de personas (la última que respondió la planilla, o la
  // de la caché mientras tanto) define quién lleva cada color y animal.
  let listaIdentidades = [];

  // "WhatsApp" no es una persona de la planilla sino el modo homónimo: va
  // siempre al final de la grilla, con su verde y su globo de chat.
  const WHATSAPP = 'WhatsApp';
  const TONO_WHATSAPP = '#25d366';
  const ICONO_WHATSAPP = '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1Z"/><path d="M9 8.6c0 3.4 2.9 6.4 6.4 6.4l1-1.5-2-1-1 .9a5 5 0 0 1-2.7-2.7l.9-1-1-2Z"/>';

  function esWhatsapp(nombre) { return nombre.toLowerCase() === WHATSAPP.toLowerCase(); }

  function svgAvatar(id) {
    if (id.whatsapp) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONO_WHATSAPP + '</svg>';
    }
    return svgAnimal(id.animal);
  }

  function identidad(nombre) {
    if (esWhatsapp(nombre)) return { tono: TONO_WHATSAPP, whatsapp: true };
    const clave = nombre.toLowerCase();
    let i = listaIdentidades.findIndex(n => n.toLowerCase() === clave);
    if (i < 0) {
      // Alguien que no está en la lista: se le da el primer lugar libre.
      i = listaIdentidades.length;
    }
    return { tono: tonoPorIndice(i), animal: ORDEN_ANIMALES[i % ORDEN_ANIMALES.length] };
  }

  let actual = ssGet(SS_ACTUAL) || '';
  let promesaVendedores = null;

  // ------------------------------------------------------------- helpers --
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (_) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function cuandoListo(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function reduceMovimiento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------------------------------------------------------- vendedores --
  // Una sola consulta a la planilla por carga de página; la comparten el
  // selector y el desplegable de Vendedor. Resuelve [] si la planilla no
  // responde: cada consumidor decide su respaldo.
  function cargarVendedores() {
    if (promesaVendedores) return promesaVendedores;
    if (typeof GOOGLE_SHEETS_CONFIG === 'undefined') {
      promesaVendedores = Promise.resolve([]);
      return promesaVendedores;
    }
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(RANGO)}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
    promesaVendedores = fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      .then(data => {
        const vistos = new Set();
        const nombres = [];
        (data.values || []).forEach((fila, i) => {
          const nombre = (fila && fila[0] ? String(fila[0]) : '').trim();
          if (!nombre) return;
          // El rango arranca en A1: si esa celda es el rótulo de la columna, no es un vendedor.
          if (i === 0 && ['vendedor', 'vendedores', 'nombre'].includes(nombre.toLowerCase())) return;
          const clave = nombre.toLowerCase();
          if (vistos.has(clave)) return;
          vistos.add(clave);
          nombres.push(nombre);
        });
        if (nombres.length) lsSet(LS_CACHE, JSON.stringify(nombres));
        return nombres;
      })
      .catch(err => {
        console.warn('No se pudo cargar la lista de vendedores desde Google Sheets:', err);
        return [];
      });
    return promesaVendedores;
  }

  function soloPersonas(nombres) {
    return nombres.filter(n => !NO_PERSONAS.includes(n.toLowerCase()));
  }

  // Lo último que respondió la planilla, para pintar los botones al instante.
  function cacheVendedores() {
    try {
      const v = JSON.parse(lsGet(LS_CACHE) || '[]');
      return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : [];
    } catch (_) { return []; }
  }

  // Último recurso sin planilla ni caché: las <option> de respaldo del HTML.
  function respaldoHtml() {
    const sel = document.getElementById('vendedor');
    if (!sel) return [];
    return Array.from(sel.options).map(o => o.value.trim()).filter(Boolean);
  }

  // ------------------------------------------------------------- markup --
  let overlay, grilla, estadoEl, headerBtn;
  let abierto = false;
  // Mensaje que queda fijo en el selector mientras está abierto (por ejemplo,
  // "tu usuario se abrió en otro equipo"); se borra al elegir a alguien.
  let aviso = '';

  function limpiarEstado() { estadoEl.textContent = aviso; }
  let ultimaTeclaImprimible = 0;

  function construir() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'usuarioOverlay';
    overlay.className = 'usr-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'usrTitulo');
    overlay.setAttribute('aria-describedby', 'usrSub');
    overlay.innerHTML = `
      <div class="usr-panel">
        <header class="usr-head">
          <span class="usr-eyebrow"><span class="usr-eyebrow-punto" aria-hidden="true"></span><span id="usrFecha"></span></span>
          <h1 id="usrTitulo" class="usr-titulo">Selecciona Usuario</h1>
          <p id="usrSub" class="usr-sub">Toca tu nombre para continuar</p>
        </header>
        <div id="usrGrilla" class="usr-grilla" role="listbox" aria-labelledby="usrTitulo"></div>
        <div id="usrEstado" class="usr-estado" role="status" aria-live="polite"></div>
        <footer class="usr-pie">
          <span class="usr-pie-tecla" aria-hidden="true">←</span><span class="usr-pie-tecla" aria-hidden="true">→</span>
          para moverte ·
          <span class="usr-pie-tecla" aria-hidden="true">Enter</span>
          para elegir · Podés cambiar de usuario desde el encabezado
        </footer>
      </div>`;
    document.body.appendChild(overlay);

    grilla = overlay.querySelector('#usrGrilla');
    estadoEl = overlay.querySelector('#usrEstado');
    construirClave();
    grilla.addEventListener('click', e => {
      const b = e.target.closest('.usr-tile');
      if (b) elegir(b.dataset.nombre, b);
    });
    overlay.addEventListener('keydown', teclado, true);
  }

  // --------------------------------------------------- clave WhatsApp --
  // Va fuera del overlay: el teclado del selector descarta las teclas
  // imprimibles (por la pistola) y acá hay que poder escribir.
  let claveEl, claveInput, claveError, alResolverClave = null;

  function construirClave() {
    claveEl = document.createElement('div');
    claveEl.id = 'usrClave';
    claveEl.className = 'usr-clave';
    claveEl.hidden = true;
    claveEl.setAttribute('role', 'dialog');
    claveEl.setAttribute('aria-modal', 'true');
    claveEl.setAttribute('aria-labelledby', 'usrClaveTitulo');
    claveEl.innerHTML = `
      <form class="usr-clave-card" novalidate>
        <span class="usr-avatar usr-clave-avatar" style="--tono:${TONO_WHATSAPP}" aria-hidden="true">${svgAvatar({ whatsapp: true })}</span>
        <h2 id="usrClaveTitulo" class="usr-clave-titulo">Modo WhatsApp</h2>
        <p class="usr-clave-sub">Ingresá la contraseña para atender los pedidos de WhatsApp.</p>
        <input type="password" class="usr-clave-input" autocomplete="off" aria-label="Contraseña" aria-describedby="usrClaveError">
        <div id="usrClaveError" class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar">Cancelar</button>
          <button type="submit" class="usr-clave-btn usr-clave-ok">Entrar</button>
        </div>
      </form>`;
    document.body.appendChild(claveEl);
    claveInput = claveEl.querySelector('.usr-clave-input');
    claveError = claveEl.querySelector('.usr-clave-error');
    const card = claveEl.querySelector('.usr-clave-card');
    card.addEventListener('submit', e => {
      e.preventDefault();
      if (claveInput.value === CLAVE_WHATSAPP) { resolverClave(true); return; }
      claveError.textContent = 'Contraseña incorrecta';
      claveInput.value = '';
      claveInput.focus();
      // Sacudida corta: el error se siente sin tener que leerlo.
      card.classList.remove('usr-clave-mal');
      void card.offsetWidth;
      card.classList.add('usr-clave-mal');
    });
    claveEl.querySelector('.usr-clave-cancelar').addEventListener('click', () => resolverClave(false));
    claveEl.addEventListener('click', e => { if (e.target === claveEl) resolverClave(false); });
    claveEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resolverClave(false); }
    });
  }

  function pedirClave(cb) {
    alResolverClave = cb;
    claveInput.value = '';
    claveError.textContent = '';
    claveEl.querySelector('.usr-clave-card').classList.remove('usr-clave-mal');
    claveEl.hidden = false;
    setTimeout(() => claveInput.focus(), 60);
  }

  function resolverClave(ok) {
    if (claveEl.hidden) return;
    claveEl.hidden = true;
    const cb = alResolverClave;
    alResolverClave = null;
    if (cb) cb(ok);
  }

  function modoWhatsappActivo() { return ssGet(SS_MODO_WHATSAPP) === '1'; }

  // ------------------------------------------- confirmar "Entrar igual" --
  // Misma tarjeta que la contraseña: entrar igual cierra la sesión del otro
  // equipo, así que se explica antes de hacerlo.
  let confirmarEl, alResolverConfirmar = null;

  function construirConfirmar() {
    confirmarEl = document.createElement('div');
    confirmarEl.id = 'usrConfirmar';
    confirmarEl.className = 'usr-clave';
    confirmarEl.hidden = true;
    confirmarEl.setAttribute('role', 'alertdialog');
    confirmarEl.setAttribute('aria-modal', 'true');
    confirmarEl.setAttribute('aria-labelledby', 'usrConfirmarTitulo');
    confirmarEl.setAttribute('aria-describedby', 'usrConfirmarSub');
    confirmarEl.innerHTML = `
      <div class="usr-clave-card">
        <span class="usr-avatar usr-clave-avatar" aria-hidden="true"></span>
        <h2 id="usrConfirmarTitulo" class="usr-clave-titulo"></h2>
        <p id="usrConfirmarSub" class="usr-clave-sub usr-confirmar-sub"></p>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar">Cancelar</button>
          <button type="button" class="usr-clave-btn usr-confirmar-ok">Entrar igual</button>
        </div>
      </div>`;
    document.body.appendChild(confirmarEl);
    confirmarEl.querySelector('.usr-clave-cancelar').addEventListener('click', () => resolverConfirmar(false));
    confirmarEl.querySelector('.usr-confirmar-ok').addEventListener('click', () => resolverConfirmar(true));
    confirmarEl.addEventListener('click', e => { if (e.target === confirmarEl) resolverConfirmar(false); });
    confirmarEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resolverConfirmar(false); }
    });
  }

  function pedirConfirmacion(nombre, cb) {
    if (!confirmarEl) construirConfirmar();
    alResolverConfirmar = cb;
    const id = identidad(nombre);
    const av = confirmarEl.querySelector('.usr-avatar');
    av.style.setProperty('--tono', id.tono);
    av.innerHTML = svgAvatar(id);
    confirmarEl.querySelector('.usr-clave-titulo').textContent = '¿Entrar como ' + nombre + '?';
    confirmarEl.querySelector('.usr-confirmar-sub').innerHTML =
      `<strong>${esc(nombre)}</strong> figura conectado en otro equipo. Al confirmar, esa caja se cierra ` +
      'y vuelve a la pantalla de selección de usuario. Usalo sólo si esa caja quedó cerrada o colgada.';
    confirmarEl.hidden = false;
    // El foco arranca en Cancelar: un Enter apurado no cierra otra caja.
    setTimeout(() => confirmarEl.querySelector('.usr-clave-cancelar').focus(), 60);
  }

  function resolverConfirmar(ok) {
    if (!confirmarEl || confirmarEl.hidden) return;
    confirmarEl.hidden = true;
    const cb = alResolverConfirmar;
    alResolverConfirmar = null;
    if (cb) cb(ok);
  }

  function pintarFecha() {
    const el = overlay.querySelector('#usrFecha');
    const txt = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    el.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  function pintarTiles(personas) {
    listaIdentidades = personas.slice();
    pintarHeader();
    const nombres = personas.concat(WHATSAPP);
    const ultimo = (actual || lsGet(LS_ULTIMO) || '').toLowerCase();
    grilla.innerHTML = nombres.map((n, i) => {
      const esUltimo = n.toLowerCase() === ultimo;
      const esActual = actual && n.toLowerCase() === actual.toLowerCase();
      const id = identidad(n);
      return `
        <button type="button" class="usr-tile${esUltimo ? ' es-ultimo' : ''}${id.whatsapp ? ' usr-tile-whatsapp' : ''}" role="option"
                aria-selected="${esActual ? 'true' : 'false'}"
                data-nombre="${esc(n)}" style="--tono:${id.tono}; --i:${i}">
          <span class="usr-avatar" aria-hidden="true">${svgAvatar(id)}</span>
          <span class="usr-tile-nombre">${esc(n)}</span>
          <span class="usr-tile-check" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>
          </span>
        </button>`;
    }).join('');
    grilla.dataset.cantidad = String(nombres.length);
    marcarOcupados();
  }

  function pintarCargando() {
    grilla.innerHTML = Array.from({ length: 6 }, (_, i) =>
      `<div class="usr-tile usr-tile-fantasma" style="--i:${i}" aria-hidden="true"><span class="usr-avatar"></span><span class="usr-tile-nombre"></span></div>`
    ).join('');
    estadoEl.textContent = 'Cargando vendedores…';
  }

  function pintarError() {
    grilla.innerHTML = '';
    estadoEl.innerHTML = `No se pudo traer la lista de vendedores.
      <button type="button" class="usr-reintentar">Reintentar</button>`;
    estadoEl.querySelector('.usr-reintentar').addEventListener('click', () => {
      promesaVendedores = null;
      poblar();
    });
  }

  // Pinta lo que haya a mano (caché o respaldo) y lo reemplaza cuando responde
  // la planilla, sin mover el foco si la persona ya estaba navegando.
  function poblar() {
    const inmediato = soloPersonas(cacheVendedores());
    if (inmediato.length) { pintarTiles(inmediato); limpiarEstado(); enfocarInicial(); }
    else pintarCargando();

    cargarVendedores().then(nombres => {
      if (!abierto) return;
      let lista = soloPersonas(nombres);
      if (!lista.length) lista = inmediato.length ? inmediato : soloPersonas(respaldoHtml());
      if (!lista.length) { pintarError(); return; }
      const mismo = JSON.stringify(lista) === JSON.stringify(inmediato);
      if (mismo) return;
      const foco = document.activeElement && document.activeElement.closest && document.activeElement.closest('.usr-tile');
      const nombreFoco = foco ? foco.dataset.nombre : null;
      pintarTiles(lista);
      limpiarEstado();
      const reenfocar = nombreFoco && grilla.querySelector(`.usr-tile[data-nombre="${CSS.escape(nombreFoco)}"]`);
      if (reenfocar) reenfocar.focus({ preventScroll: true }); else enfocarInicial();
    });
  }

  function tiles() { return Array.from(grilla.querySelectorAll('.usr-tile:not(.usr-tile-fantasma)')); }

  function enfocarInicial() {
    const t = grilla.querySelector('.usr-tile[aria-selected="true"]') || grilla.querySelector('.usr-tile.es-ultimo') || tiles()[0];
    if (t) t.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------- teclado --
  // Ojo con la pistola: escribe un código a ráfaga y termina en Enter. Si se
  // escanea con el selector abierto, ese Enter no puede elegir a nadie.
  function teclado(e) {
    if (e.key && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      ultimaTeclaImprimible = Date.now();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && Date.now() - ultimaTeclaImprimible < 150) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Sin salida: el selector sólo se cierra eligiendo a alguien.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Tab') {
      // Trampa de foco: el resto de la página está inert, pero por las dudas.
      const focos = Array.from(overlay.querySelectorAll('button:not([hidden]):not(:disabled)'));
      if (!focos.length) return;
      const i = focos.indexOf(document.activeElement);
      const sig = e.shiftKey ? (i <= 0 ? focos.length - 1 : i - 1) : (i === focos.length - 1 ? 0 : i + 1);
      e.preventDefault();
      focos[sig].focus();
      return;
    }
    const flechas = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 'abajo', ArrowUp: 'arriba', Home: 'inicio', End: 'fin' };
    if (!(e.key in flechas)) return;
    const lista = tiles();
    if (!lista.length) return;
    e.preventDefault();
    const i = Math.max(0, lista.indexOf(document.activeElement));
    const columnas = Math.max(1, getComputedStyle(grilla).gridTemplateColumns.split(' ').length);
    const mov = flechas[e.key];
    let j = i;
    if (mov === 1 || mov === -1) j = i + mov;
    else if (mov === 'abajo') j = i + columnas;
    else if (mov === 'arriba') j = i - columnas;
    else if (mov === 'inicio') j = 0;
    else if (mov === 'fin') j = lista.length - 1;
    j = Math.min(lista.length - 1, Math.max(0, j));
    lista[j].focus();
  }

  // ----------------------------------------------------------- presencia --
  // Misma clave que usa chat.js para cada nombre (las de RTDB no aceptan . $ # [ ] /).
  function claveDe(nombre) {
    return nombre.trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'equipo';
  }

  // Claves de los usuarios con alguna pestaña abierta en otro equipo. El
  // usuario de esta misma pestaña no cuenta: su propia conexión no lo bloquea.
  let ocupados = new Set();
  let refPresencia = null;
  let refOffset = null;
  let offsetServidor = 0;
  let presencias = {};

  function alOffset(s) { offsetServidor = s.val() || 0; }

  // Igual que en chat.js: una conexión cuenta mientras exista. Firebase la
  // borra al cerrarse la pestaña; si la caja se apagó de golpe, para eso está
  // "Entrar igual".
  function conexionesVivas(p) {
    if (!p || !p.conexiones) return [];
    return Object.keys(p.conexiones);
  }

  // Quien se acaba de ir (sin conexiones, pero con `ultimaVez` de hace unos
  // segundos) probablemente sólo cambió de pantalla: sigue contando como
  // ocupado un momento, para que nadie tome su usuario en ese hueco.
  function recienSalido(p) {
    return !!p && typeof p.ultimaVez === 'number' &&
      Date.now() + offsetServidor - p.ultimaVez < GRACIA_NAVEGACION_MS;
  }

  let revisionGracia = null;

  function recalcularOcupados() {
    const propia = actual ? claveDe(actual) : '';
    let enGracia = false;
    ocupados = new Set(Object.keys(presencias).filter(k => {
      if (k === propia) return false;
      if (conexionesVivas(presencias[k]).length) return true;
      if (recienSalido(presencias[k])) { enGracia = true; return true; }
      return false;
    }));
    marcarOcupados();
    // Al vencer la gracia se vuelve a mirar, aunque nadie escriba nada.
    clearTimeout(revisionGracia);
    if (enGracia && refPresencia) revisionGracia = setTimeout(recalcularOcupados, 2000);
  }

  function alCambiarPresencia(snap) {
    presencias = snap.val() || {};
    recalcularOcupados();
  }

  function escucharPresencia(si) {
    if (typeof firebase === 'undefined' || !firebase.apps.length) return;
    if (si && !refPresencia) {
      refOffset = firebase.database().ref('.info/serverTimeOffset');
      refOffset.on('value', alOffset);
      refPresencia = firebase.database().ref(RUTA_PRESENCIA);
      refPresencia.on('value', alCambiarPresencia, err => console.warn('Presencia de usuarios no disponible:', err));
      // Una caja que se apagó no avisa: el "Conectado" se cae solo cuando su
      // conexión vence, aunque nadie más escriba en la presencia.
    } else if (!si && refPresencia) {
      refPresencia.off('value', alCambiarPresencia);
      refPresencia = null;
      refOffset.off('value', alOffset);
      refOffset = null;
      clearTimeout(revisionGracia);
    }
  }

  // "Entrar igual": se borran las conexiones del otro equipo y se le deja la
  // marca de expulsión que revisa chat.js. Si ese equipo estaba apagado, la
  // marca nunca se lee y chat.js la limpia con el tiempo.
  function expulsarConexiones(nombre) {
    if (!refPresencia) return;
    const clave = claveDe(nombre);
    const p = presencias[clave];
    if (!p || !p.conexiones) return;
    const cambios = {};
    Object.keys(p.conexiones).forEach(k => {
      cambios['conexiones/' + k] = null;
      cambios['expulsadas/' + k] = firebase.database.ServerValue.TIMESTAMP;
    });
    refPresencia.child(clave).update(cambios)
      .catch(err => console.warn('No se pudo liberar el usuario en el otro equipo:', err));
  }

  function estaOcupado(nombre) { return ocupados.has(claveDe(nombre)); }

  // Actualiza los botones ya pintados sin rehacer la grilla (no mueve el foco).
  function marcarOcupados() {
    if (!grilla) return;
    tiles().forEach(t => {
      const ocupado = estaOcupado(t.dataset.nombre);
      t.classList.toggle('usr-tile-ocupado', ocupado);
      t.setAttribute('aria-disabled', ocupado ? 'true' : 'false');
      t.title = ocupado ? t.dataset.nombre + ' figura conectado en otro equipo. Tocalo si querés entrar igual.' : '';
      // El indicador va debajo del nombre.
      let marca = t.querySelector('.usr-tile-conectado');
      if (ocupado && !marca) {
        marca = document.createElement('span');
        marca.className = 'usr-tile-conectado';
        marca.innerHTML = '<span class="usr-tile-conectado-punto" aria-hidden="true"></span>Conectado';
        t.querySelector('.usr-tile-nombre').after(marca);
      } else if (!ocupado && marca) {
        marca.remove();
      }
    });
  }

  // --------------------------------------------------------- abrir/cerrar --
  function bloquearPagina(si) {
    const main = document.getElementById('mainContainer');
    if (main) main.inert = si;
    document.documentElement.classList.toggle('usr-abierto', si);
  }

  function abrir() {
    construir();
    if (abierto) return;
    abierto = true;
    // Si un modal de la caja quedó abierto, el selector va por encima igual.
    const chatPanel = document.querySelector('.chat-abierto');
    if (chatPanel) chatPanel.classList.remove('chat-abierto');
    soltar();
    pintarFecha();
    overlay.classList.remove('usr-saliendo', 'usr-eligiendo');
    overlay.hidden = false;
    bloquearPagina(true);
    // Forzar el estilo inicial antes de animar la entrada.
    void overlay.offsetWidth;
    overlay.classList.add('usr-visible');
    limpiarEstado();
    escucharPresencia(true);
    poblar();
  }

  function cerrar() {
    if (!abierto) return;
    abierto = false;
    escucharPresencia(false);
    overlay.classList.remove('usr-visible');
    overlay.classList.add('usr-saliendo');
    bloquearPagina(false);
    const fin = () => {
      overlay.hidden = true;
      overlay.classList.remove('usr-saliendo', 'usr-eligiendo');
    };
    if (reduceMovimiento()) fin();
    else setTimeout(fin, 320);
    // El foco vuelve al campo principal de la pantalla (en la caja, donde
    // escribe la pistola).
    setTimeout(() => {
      const s = document.querySelector('[data-foco-principal]');
      if (s && !s.disabled) s.focus();
    }, 60);
  }

  // WhatsApp pide su contraseña y prende el modo; cualquier persona lo apaga.
  let esperandoClave = false;

  // `forzar` = se confirmó "Entrar igual" sobre alguien que figuraba conectado.
  function elegir(nombre, tile, forzar) {
    if (!nombre || esperandoClave || overlay.classList.contains('usr-eligiendo')) return;
    if (estaOcupado(nombre) && !forzar) {
      ofrecerEntrarIgual(nombre, tile);
      return;
    }
    if (esWhatsapp(nombre)) {
      // Con el modo ya prendido en esta pestaña no se vuelve a pedir.
      if (modoWhatsappActivo()) { confirmarEleccion(WHATSAPP, tile, forzar); return; }
      esperandoClave = true;
      pedirClave(ok => {
        esperandoClave = false;
        if (ok) ssSet(SS_MODO_WHATSAPP, '1');
        // Pudo conectarse en otro equipo mientras se escribía la contraseña.
        if (ok && estaOcupado(WHATSAPP) && !forzar) {
          ofrecerEntrarIgual(WHATSAPP, tile);
          if (tile) tile.focus({ preventScroll: true });
        } else if (ok) confirmarEleccion(WHATSAPP, tile, forzar);
        else if (tile) tile.focus({ preventScroll: true });
      });
      return;
    }
    // Cualquier persona apaga el modo WhatsApp.
    ssDel(SS_MODO_WHATSAPP);
    confirmarEleccion(nombre, tile, forzar);
  }

  function ofrecerEntrarIgual(nombre, tile) {
    estadoEl.innerHTML = `${esc(nombre)} figura conectado en otro equipo. Si esa caja ya está cerrada, podés entrar igual.
      <button type="button" class="usr-reintentar">Entrar igual</button>`;
    const btn = estadoEl.querySelector('.usr-reintentar');
    btn.addEventListener('click', () => pedirConfirmacion(nombre, ok => {
      if (ok) elegir(nombre, tile, true);
      else btn.focus({ preventScroll: true });
    }));
  }

  function confirmarEleccion(nombre, tile, forzar) {
    if (forzar) expulsarConexiones(nombre);
    aviso = '';
    overlay.classList.add('usr-eligiendo');
    tiles().forEach(t => t.setAttribute('aria-selected', t === tile ? 'true' : 'false'));
    if (tile) tile.classList.add('es-elegido');
    establecer(nombre);
    // Un instante para que se vea la confirmación sobre el botón tocado.
    setTimeout(() => cerrar(), reduceMovimiento() ? 0 : 260);
  }

  // ------------------------------------------------------------- estado --
  // El último usuario que se soltó al abrir el selector: para el que elija
  // después cuenta como "anterior" (así el campo Vendedor se reemplaza).
  let soltado = '';

  // Cambiar de usuario desconecta al actual: chat.js retira su presencia y
  // ese nombre queda libre para otro equipo mientras acá se elige.
  function soltar() {
    if (!actual) return;
    const anterior = actual;
    soltado = anterior;
    actual = '';
    ssDel(SS_ACTUAL);
    pintarHeader();
    document.dispatchEvent(new CustomEvent(EVENTO, { detail: { nombre: '', anterior } }));
  }

  function establecer(nombre) {
    const anterior = actual || soltado;
    soltado = '';
    actual = nombre;
    ssSet(SS_ACTUAL, nombre);
    lsSet(LS_ULTIMO, nombre);
    pintarHeader();
    document.dispatchEvent(new CustomEvent(EVENTO, { detail: { nombre, anterior } }));
  }

  function pintarHeader() {
    headerBtn = headerBtn || document.getElementById('usuarioActualBtn');
    if (!headerBtn) return;
    const av = headerBtn.querySelector('.usr-chip-avatar');
    const nom = headerBtn.querySelector('.usr-chip-nombre');
    if (actual) {
      const id = identidad(actual);
      av.innerHTML = svgAvatar(id);
      headerBtn.style.setProperty('--tono', id.tono);
      nom.textContent = actual;
      headerBtn.title = 'Usuario: ' + actual + ' · Cambiar de usuario';
      headerBtn.setAttribute('aria-label', 'Usuario actual: ' + actual + '. Cambiar de usuario');
      headerBtn.hidden = false;
    } else {
      headerBtn.hidden = true;
    }
  }

  cuandoListo(() => {
    construir();
    headerBtn = document.getElementById('usuarioActualBtn');
    if (headerBtn) headerBtn.addEventListener('click', () => abrir());
    pintarHeader();
  });

  // Arranca la consulta a la planilla ya mismo: cuando termine el login la
  // lista suele estar lista. Con la lista fresca se recalculan los colores
  // del chip del encabezado.
  listaIdentidades = soloPersonas(cacheVendedores());
  cargarVendedores().then(nombres => {
    const personas = soloPersonas(nombres);
    if (!personas.length) return;
    listaIdentidades = personas;
    cuandoListo(pintarHeader);
  });

  // ---------------------------------------------------------------- API --
  window.UsuarioActivo = {
    EVENTO,
    actual: () => actual,
    cargarVendedores,
    abrir: () => cuandoListo(() => abrir()),
    // Lo llama chat.js cuando otro equipo entró con el usuario de esta pestaña
    // ("Entrar igual"): se suelta el usuario y se vuelve a preguntar.
    expulsado(nombre) {
      cuandoListo(() => {
        aviso = (nombre || 'Tu usuario') + ' se abrió en otro equipo. Elegí con qué usuario seguir en esta caja.';
        if (abierto) limpiarEstado(); else abrir();
      });
    },
    // Lo llama el script de login cuando hay sesión. Si esta pestaña ya eligió
    // usuario sigue de largo; si no, muestra el selector sobre la caja.
    alAutenticar(mostrarCaja) {
      cuandoListo(() => {
        mostrarCaja();
        if (actual) {
          pintarHeader();
          document.dispatchEvent(new CustomEvent(EVENTO, { detail: { nombre: actual, anterior: '' } }));
          return;
        }
        abrir();
      });
    }
  };
})();
