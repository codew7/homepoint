// === PUNTO DE VENTA DEL EQUIPO ===
// Cada punto de venta trabaja con su propio proyecto de Firebase (pedidos,
// chat y usuarios de login), así que tiene su propio archivo de config. La
// planilla de Google Sheets es la misma para todos y viaja en cada config.
//
// Este archivo decide cuál config cargar ANTES de que arranque Firebase:
//   · Si el equipo ya eligió punto de venta (localStorage), escribe su
//     <script src="configN.js"> en el lugar donde está este script. Queda
//     cargado de forma síncrona, así firebaseConfig y GOOGLE_SHEETS_CONFIG
//     existen igual que cuando la página cargaba config.js fijo.
//   · Si no eligió (primera vez en el equipo), frena la carga de la página
//     (window.stop: no se piden Firebase, login ni caja) y muestra la
//     pantalla de elección. Al elegir se guarda y la página se recarga.
//
// Lo usan: index.html (panel), ingresoPedidoV2.html, historialRecientes.html,
// buscarPedidos.html, pedidosWhatsapp.html y login.html cuando vuelve a una
// de ellas. El resto del panel sigue con config.js.
//
// Cambiarlo es poco común y pide la contraseña de Admin: se ofrece desde el
// selector de usuario (usuarioActivo.js) y, como salida de emergencia, desde
// el login de la caja (por si el equipo quedó en un punto sin credenciales).
//
// Para sumar un punto de venta: una línea en PUNTOS y su archivo configN.js.
//
// Va en <head> después de las hojas CSS (el navegador las termina de cargar
// antes de correr este script, así la pantalla de elección ya tiene estilos)
// y antes de los SDK de Firebase.
(function() {
  'use strict';

  const PUNTOS = [
    { id: '1', nombre: 'Punto de venta 1', config: 'config.js' },
    { id: '2', nombre: 'Punto de venta 2', config: 'config2.js' }
  ];

  const LS_PUNTO = 'hpPuntoVenta';
  // La misma contraseña del acceso Admin de la caja.
  const CLAVE_CAMBIO = '47623212';
  // Lo que queda atado al punto anterior y se descarta al cambiar: la sesión
  // de la pestaña (usuario, modo WhatsApp, marca de sesión) y el "último
  // mensaje leído" del chat, que es de la otra base.
  const SS_A_LIMPIAR = ['hpSesionCaja', 'hpUsuarioActivo', 'hpModoWhatsapp'];
  const LS_A_LIMPIAR = ['chatUltimoLeido'];
  // Hojas que dan estilo a la pantalla de elección y a la tarjeta de cambio.
  const HOJAS = ['caja-tokens.css', 'usuarioActivo.css'];
  const TONOS = ['#7c5fd0', '#3f8fe6', '#1f9d86', '#d08a1e', '#d6604f', '#b25cc4'];

  const ICONO_LOCAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 9.5 5 4.5h14l1.5 5"/><path d="M3.5 9.5a2.8 2.8 0 0 0 5.6 0 2.9 2.9 0 0 0 5.8 0 2.8 2.8 0 0 0 5.6 0"/><path d="M5 12v7.5h14V12"/><path d="M10 19.5v-4.5h4v4.5"/></svg>';
  const ICONO_CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 13 4 4L19 7"/></svg>';

  // Si localStorage no está disponible (ventana privada, sitio bloqueado) se
  // usa sessionStorage: al menos la pestaña no queda en un bucle de elección.
  function leer() {
    try { const v = localStorage.getItem(LS_PUNTO); if (v) return v; } catch (_) {}
    try { return sessionStorage.getItem(LS_PUNTO); } catch (_) { return null; }
  }
  function guardar(id) {
    let ok = false;
    try { localStorage.setItem(LS_PUNTO, id); ok = localStorage.getItem(LS_PUNTO) === id; } catch (_) {}
    if (!ok) { try { sessionStorage.setItem(LS_PUNTO, id); } catch (_) {} }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function reduceMovimiento() {
    return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  const actual = PUNTOS.find(p => p.id === leer()) || null;

  function cambiar(id) {
    const destino = PUNTOS.find(p => p.id === id);
    if (!destino) return;
    guardar(destino.id);
    SS_A_LIMPIAR.forEach(k => { try { sessionStorage.removeItem(k); } catch (_) {} });
    LS_A_LIMPIAR.forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
    // Sin ?id=: un pedido de la otra base no existe en esta.
    location.replace(location.pathname);
  }

  // ----------------------------------------------- pantalla de elección --
  // Mismo material que el selector de usuario (clases .usr-* de
  // usuarioActivo.css). El historial carga esa hoja recién en el <body>, que
  // con la página frenada nunca llega: acá se agrega si falta.
  function asegurarHoja(href) {
    const ya = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .some(l => (l.getAttribute('href') || '').split('?')[0] === href);
    if (ya) return null;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
    return new Promise(r => { link.onload = link.onerror = r; });
  }

  function tileHtml(p, i) {
    return `
      <button type="button" class="usr-tile" role="option" aria-selected="false"
              data-pv="${esc(p.id)}" style="--tono:${TONOS[i % TONOS.length]}; --i:${i}">
        <span class="usr-avatar" aria-hidden="true">${ICONO_LOCAL}</span>
        <span class="usr-tile-nombre">${esc(p.nombre)}</span>
        <span class="usr-tile-check" aria-hidden="true">${ICONO_CHECK}</span>
      </button>`;
  }

  // Frena el resto de la página: <plaintext> hace que el navegador lea todo
  // lo que sigue del documento como texto plano (oculto), así ningún script
  // posterior corre (ni Firebase, ni el login, ni la caja). A diferencia de
  // window.stop(), el documento termina de cargarse normal y se dibuja.
  function pantallaEleccion() {
    document.write('<plaintext hidden style="display:none">');
    document.addEventListener('DOMContentLoaded', montarEleccion);
  }

  function montarEleccion() {
    document.title = 'Punto de venta';
    const body = document.body;
    const cargas = HOJAS.map(asegurarHoja).filter(Boolean);

    const overlay = document.createElement('div');
    overlay.className = 'usr-overlay pv-eleccion';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pvTitulo');
    overlay.setAttribute('aria-describedby', 'pvSub');
    overlay.innerHTML = `
      <div class="usr-panel">
        <header class="usr-head">
          <span class="usr-eyebrow"><span class="usr-eyebrow-punto" aria-hidden="true"></span>Configuración de este equipo</span>
          <h1 id="pvTitulo" class="usr-titulo">Selecciona el punto de venta</h1>
          <p id="pvSub" class="usr-sub">El equipo lo va a recordar. Si alguna vez hace falta, se puede cambiar con la contraseña de administrador.</p>
        </header>
        <div class="usr-grilla" role="listbox" aria-labelledby="pvTitulo">${PUNTOS.map(tileHtml).join('')}</div>
        <footer class="usr-pie">
          <span class="usr-pie-tecla" aria-hidden="true">←</span><span class="usr-pie-tecla" aria-hidden="true">→</span>
          para moverte ·
          <span class="usr-pie-tecla" aria-hidden="true">Enter</span>
          para elegir
        </footer>
      </div>`;
    body.appendChild(overlay);

    const tiles = Array.from(overlay.querySelectorAll('.usr-tile'));
    let eligiendo = false;
    overlay.addEventListener('click', e => {
      const t = e.target.closest('.usr-tile');
      if (!t || eligiendo) return;
      eligiendo = true;
      guardar(t.dataset.pv);
      overlay.classList.add('usr-eligiendo');
      t.classList.add('es-elegido');
      t.setAttribute('aria-selected', 'true');
      setTimeout(() => location.reload(), reduceMovimiento() ? 0 : 320);
    });

    // Un Enter que llega pegado a una ráfaga de teclas es de la pistola, no
    // de una persona: no elige nada.
    let ultimaImprimible = 0;
    overlay.addEventListener('keydown', e => {
      if (e.key && e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        ultimaImprimible = Date.now();
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && Date.now() - ultimaImprimible < 150) { e.preventDefault(); return; }
      const mov = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!mov) return;
      e.preventDefault();
      const i = Math.max(0, tiles.indexOf(document.activeElement));
      tiles[Math.min(tiles.length - 1, Math.max(0, i + mov))].focus();
    });

    Promise.all(cargas).then(() => {
      void overlay.offsetWidth;
      overlay.classList.add('usr-visible');
      if (tiles[0]) tiles[0].focus({ preventScroll: true });
    });
  }

  // ----------------------------------------------------- cambio (Admin) --
  // Tarjeta del mismo material que la contraseña del modo WhatsApp. Primero
  // pide la contraseña y después muestra los puntos de venta.
  let cambioEl = null, alCerrarCambio = null;

  function cerrarCambio() {
    if (!cambioEl || cambioEl.hidden) return;
    cambioEl.hidden = true;
    const cb = alCerrarCambio;
    alCerrarCambio = null;
    if (cb) cb();
  }

  function sacudir(card) {
    card.classList.remove('usr-clave-mal');
    void card.offsetWidth;
    card.classList.add('usr-clave-mal');
  }

  function pasoClave() {
    cambioEl.innerHTML = `
      <form class="usr-clave-card pv-card" novalidate>
        <span class="usr-avatar usr-clave-avatar" style="--tono:#7c5fd0" aria-hidden="true">${ICONO_LOCAL}</span>
        <h2 id="pvCambioTitulo" class="usr-clave-titulo">Cambiar punto de venta</h2>
        <p class="usr-clave-sub">Este equipo trabaja en <strong>${esc(actual ? actual.nombre : '')}</strong>. Ingresá la contraseña de administrador para cambiarlo.</p>
        <input type="password" class="usr-clave-input" autocomplete="off" aria-label="Contraseña" aria-describedby="pvCambioError">
        <div id="pvCambioError" class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar">Cancelar</button>
          <button type="submit" class="usr-clave-btn usr-clave-ok pv-ok">Continuar</button>
        </div>
      </form>`;
    const card = cambioEl.querySelector('.pv-card');
    const input = card.querySelector('.usr-clave-input');
    card.addEventListener('submit', e => {
      e.preventDefault();
      if (input.value === CLAVE_CAMBIO) { pasoLista(); return; }
      card.querySelector('.usr-clave-error').textContent = 'Contraseña incorrecta';
      input.value = '';
      input.focus();
      sacudir(card);
    });
    card.querySelector('.usr-clave-cancelar').addEventListener('click', cerrarCambio);
    setTimeout(() => input.focus(), 60);
  }

  function pasoLista() {
    cambioEl.innerHTML = `
      <div class="usr-clave-card pv-card">
        <span class="usr-avatar usr-clave-avatar" style="--tono:#7c5fd0" aria-hidden="true">${ICONO_LOCAL}</span>
        <h2 id="pvCambioTitulo" class="usr-clave-titulo">Elegí el punto de venta</h2>
        <p class="usr-clave-sub">La página se recarga y pide iniciar sesión con un usuario de ese punto de venta.</p>
        <div class="pv-lista" role="listbox" aria-labelledby="pvCambioTitulo">
          ${PUNTOS.map((p, i) => {
            const esActual = actual && p.id === actual.id;
            return `
              <button type="button" class="pv-opcion" role="option" data-pv="${esc(p.id)}"
                      aria-selected="${esActual ? 'true' : 'false'}" ${esActual ? 'disabled' : ''}
                      style="--tono:${TONOS[i % TONOS.length]}">
                <span class="pv-opcion-icono" aria-hidden="true">${ICONO_LOCAL}</span>
                <span class="pv-opcion-nombre">${esc(p.nombre)}</span>
                ${esActual ? '<span class="pv-opcion-actual">Actual</span>' : ''}
              </button>`;
          }).join('')}
        </div>
        <div class="usr-clave-acciones pv-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar">Cancelar</button>
        </div>
      </div>`;
    const card = cambioEl.querySelector('.pv-card');
    card.querySelector('.usr-clave-cancelar').addEventListener('click', cerrarCambio);
    card.querySelector('.pv-lista').addEventListener('click', e => {
      const b = e.target.closest('.pv-opcion');
      if (!b || b.disabled) return;
      card.querySelectorAll('.pv-opcion').forEach(o => { o.disabled = true; });
      b.classList.add('es-elegido');
      setTimeout(() => cambiar(b.dataset.pv), reduceMovimiento() ? 0 : 260);
    });
    const primera = card.querySelector('.pv-opcion:not(:disabled)') || card.querySelector('.usr-clave-cancelar');
    setTimeout(() => primera.focus(), 60);
  }

  // `alCerrar` se llama si se cancela (para devolver el foco donde estaba).
  function pedirCambio(alCerrar) {
    if (!cambioEl) {
      cambioEl = document.createElement('div');
      cambioEl.className = 'usr-clave pv-cambio';
      cambioEl.hidden = true;
      cambioEl.setAttribute('role', 'dialog');
      cambioEl.setAttribute('aria-modal', 'true');
      cambioEl.setAttribute('aria-labelledby', 'pvCambioTitulo');
      cambioEl.addEventListener('click', e => { if (e.target === cambioEl) cerrarCambio(); });
      cambioEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarCambio(); return; }
        // Trampa de foco: la tarjeta flota sobre el selector o el login.
        if (e.key === 'Tab') {
          const focos = Array.from(cambioEl.querySelectorAll('input, button:not(:disabled)'));
          if (!focos.length) return;
          const i = focos.indexOf(document.activeElement);
          const sig = e.shiftKey ? (i <= 0 ? focos.length - 1 : i - 1) : (i === focos.length - 1 ? 0 : i + 1);
          e.preventDefault();
          focos[sig].focus();
        }
        // Las flechas recorren la lista de puntos de venta.
        const mov = { ArrowDown: 1, ArrowUp: -1 }[e.key];
        if (mov && e.target.closest('.pv-lista')) {
          const ops = Array.from(cambioEl.querySelectorAll('.pv-opcion:not(:disabled)'));
          const i = ops.indexOf(document.activeElement);
          if (ops.length) { e.preventDefault(); ops[Math.min(ops.length - 1, Math.max(0, i + mov))].focus(); }
        }
      });
      document.body.appendChild(cambioEl);
    }
    alCerrarCambio = alCerrar || null;
    // Fuera de la caja (por ejemplo el panel index.html) las hojas de la
    // tarjeta no están: se agregan y se muestra cuando terminan de cargar.
    const cargas = HOJAS.map(asegurarHoja).filter(Boolean);
    Promise.all(cargas).then(() => {
      pasoClave();
      cambioEl.hidden = false;
    });
  }

  // ---------------------------------------------------------------- API --
  window.PuntoVenta = {
    lista: PUNTOS.map(p => ({ id: p.id, nombre: p.nombre })),
    actual: () => (actual ? actual.id : null),
    nombre: () => (actual ? actual.nombre : ''),
    // Hay algo para elegir sólo con más de un punto de venta.
    multiple: () => PUNTOS.length > 1,
    pedirCambio,
    cambiar
  };

  if (actual) {
    document.write('<script src="' + actual.config + '"><\/script>');
  } else {
    pantallaEleccion();
  }
})();
