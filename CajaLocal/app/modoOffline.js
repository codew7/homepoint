// === MODO OFFLINE (emergencia) ===
// Si se corta internet, la Caja HomePoint de escritorio (CajaLocal) puede
// seguir registrando ventas nuevas con el usuario
// "Offline". En la web y en cualquier otra PC este archivo no hace nada: no
// encuentra window.cajaApp.offline y deja la API apagada.
//
// Cuándo está activo (las tres cosas a la vez):
//   1. la caja corre en el programa de escritorio;
//   2. no hay internet (lo prueba el programa) ni conexión con Firebase: recién
//      ahí aparece "Offline" en el selector de usuario, sin hacer nada más;
//   3. se eligió "Offline" y se aceptó el aviso de que vende un solo equipo
//      a la vez (queda en sessionStorage, como el modo WhatsApp).
//
// Cómo se evita perder un pedido:
//   · Cada venta se guarda primero en un archivo en el disco de la PC (lo hace
//     el programa, CajaLocal/electron/offline.js) y recién después la caja
//     dice "guardado". Si no se pudo escribir, el formulario no se limpia.
//   · El id del pedido se genera al vender (push().key funciona sin internet)
//     y el paquete pedido + movimientos se arma una sola vez: subirlo dos
//     veces escribe exactamente lo mismo.
//   · Se suben de a uno, en el orden en que se vendieron. El siguiente sale
//     recién cuando Firebase confirmó el anterior y se verificaron sus
//     movimientos. Si uno falla, la subida se frena y se reintenta: nunca se
//     saltea ni se borra nada.
//   · Un candado entre ventanas (navigator.locks) hace que suba una sola.
//
// Al volver internet en modo Offline, se suben los pendientes, se sale del
// modo y la caja vuelve a pedir un usuario normal. Lo que haya quedado sin
// subir (por ejemplo, si se cerró la caja antes) lo sube cualquier sesión de
// esa PC, en segundo plano.
(function () {
  'use strict';

  const api = window.cajaApp && window.cajaApp.offline;

  const NOMBRE = 'Offline';
  // Palabra que se escribe para confirmar el aviso al entrar como "Offline".
  // No es una contraseña: solo hace que el aviso se lea antes de seguir.
  const PALABRA_CONFIRMAR = 'homepoint';
  const SS_MODO = 'hpModoOffline';
  const SS_SIN_SESION = 'hpOfflineSinSesion';
  // Mismo nombre que usa usuarioActivo.js para el usuario de la pestaña.
  const SS_USUARIO = 'hpUsuarioActivo';
  const EVENTO = 'modooffline:cambio';

  const URL_COTIZACION = 'https://api.bluelytics.com.ar/v2/latest';
  const LIMITE_RED_MS = 4000;          // en modo Offline, cuánto se espera a internet antes de usar la copia
  const LIMITE_LECTURA_MS = 20000;     // una lectura de Firebase durante la subida
  const LIMITE_ESCRITURA_MS = 30000;   // la confirmación de Firebase de un pedido
  const REVISION_ACTIVO_MS = 3000;
  const REVISION_FONDO_MS = 60000;
  const ESPERAS_REINTENTO_MS = [5000, 15000, 30000, 60000, 120000, 300000];
  const COPIAS_MS = 30 * 60 * 1000;

  // Botones que necesitan Firebase: en modo Offline quedan bloqueados.
  const BLOQUEADOS = ['cambiosModeBtn', 'adminModeBtn', 'historialBtn', 'chatNavBtn',
    'cargarClienteBtn', 'registrarClienteBtn', 'editarClienteBtn'];
  const SELECTOR_BLOQUEADOS = BLOQUEADOS.map(id => '#' + id).join(',');
  const TECLAS_BLOQUEADAS = ['F2', 'F4'];

  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
  function ssDel(k) { try { sessionStorage.removeItem(k); } catch (_) {} }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function conLimite(promesa, ms, mensaje) {
    let corte;
    return Promise.race([
      promesa,
      new Promise((_, rechazar) => { corte = setTimeout(() => rechazar(new Error(mensaje)), ms); })
    ]).finally(() => clearTimeout(corte));
  }

  function fetchConLimite(url, ms) {
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), ms);
    return fetch(url, { signal: control.signal, cache: 'no-store' }).finally(() => clearTimeout(corte));
  }

  // ---------------------------------------------------------------- estado --
  const estado = {
    habilitada: !!api,    // en el programa de escritorio siempre está disponible
    internet: true,
    firebase: null,       // .info/connected (null = todavía no se sabe)
    pendientes: [],       // de la base de Firebase de esta caja, en orden
    otrasBases: 0,        // de otro punto de venta (se suben allá)
    subiendo: false,
    progreso: null,       // { hecho, total }
    error: null,
    necesitaSesion: false,
    catalogoFecha: null
  };

  function activo() { return !!api && ssGet(SS_MODO) === '1'; }
  function conectado() { return estado.internet && estado.firebase === true; }
  function disponible() { return !!api && estado.habilitada && !estado.internet && estado.firebase !== true; }

  function emitir() {
    document.documentElement.classList.toggle('modo-offline', activo());
    pintarChip();
    pintarBotonLogin();
    document.dispatchEvent(new CustomEvent(EVENTO, { detail: { ...estado, activo: activo(), disponible: disponible() } }));
  }

  function baseActual() {
    try { return firebase.app().options.databaseURL || ''; } catch (_) { return ''; }
  }

  function puntoVenta() {
    return window.PuntoVenta ? PuntoVenta.actual() : null;
  }

  // ---------------------------------------------------------------- bandeja --
  async function refrescarLista() {
    if (!api) return;
    try {
      const todos = await api.cola.listar();
      const base = baseActual();
      // Un archivo ilegible no tiene base conocida: se queda en esta lista
      // para que frene la subida y se vea.
      estado.pendientes = todos.filter(e => e.ilegible || e.databaseURL === base);
      estado.otrasBases = todos.length - estado.pendientes.length;
    } catch (err) {
      console.error('Modo Offline: no se pudo leer la bandeja de pedidos:', err);
    }
  }

  // Lo llama ingresoPedidoV2.js. Termina recién cuando el pedido está escrito
  // en el disco; si falla, rechaza y la caja no limpia el formulario.
  async function encolar(pedido) {
    if (!api) throw new Error('El modo Offline no está disponible en esta PC');
    const r = await api.cola.guardar({
      id: pedido.id,
      actualizaciones: pedido.actualizaciones,
      movimientos: pedido.movimientos,
      resumen: pedido.resumen || {},
      databaseURL: baseActual(),
      puntoVenta: puntoVenta(),
      version: 1
    });
    await refrescarLista();
    emitir();
    setTimeout(revisar, 500);
    return r;
  }

  // ----------------------------------------------------------------- subida --
  // Escrituras lanzadas por esta página que todavía no confirmó Firebase. Para
  // esos pedidos no se pregunta "¿ya existe?": la respuesta podría salir de la
  // copia local de esta misma página y no del servidor.
  const escrituras = new Map();
  let subidaEnCurso = null;
  let authListo = false;
  let intentoFallido = 0;
  let reintento = null;

  function subirPendientes() {
    if (!api) return Promise.resolve({ completo: true, subidos: 0 });
    if (!subidaEnCurso) {
      subidaEnCurso = subirConCandado().finally(() => { subidaEnCurso = null; });
    }
    return subidaEnCurso;
  }

  function subirConCandado() {
    if (!navigator.locks || !navigator.locks.request) return subirTodos();
    return navigator.locks.request('hp-offline-subida', { ifAvailable: true },
      candado => candado ? subirTodos() : { completo: false, subidos: 0, ocupado: true });
  }

  async function subirTodos() {
    await refrescarLista();
    if (!estado.pendientes.length) {
      estado.error = null;
      emitir();
      return { completo: true, subidos: 0 };
    }
    // Al abrir la página Firebase tarda un instante en recuperar la sesión.
    if (!authListo) return { completo: false, subidos: 0 };
    if (!firebase.auth().currentUser) {
      estado.necesitaSesion = true;
      emitir();
      return { completo: false, subidos: 0 };
    }
    estado.necesitaSesion = false;
    estado.subiendo = true;
    estado.error = null;
    estado.progreso = { hecho: 0, total: estado.pendientes.length };
    document.documentElement.setAttribute('data-offline-subiendo', '');
    emitir();

    let subidos = 0;
    let actual = null;
    try {
      for (const pedido of estado.pendientes.slice()) {
        actual = pedido;
        await subirUno(pedido);
        subidos++;
        estado.progreso.hecho = subidos;
        emitir();
      }
      intentoFallido = 0;
      return { completo: true, subidos };
    } catch (err) {
      const mensaje = (err && err.message) || String(err);
      estado.error = { id: actual && actual.id, orden: actual && actual.orden, mensaje };
      console.error('Modo Offline: se frena la subida en el pedido', actual && actual.id, err);
      if (actual && !actual.ilegible) await api.cola.error(actual.id, mensaje).catch(() => {});
      programarReintento();
      return { completo: false, subidos };
    } finally {
      estado.subiendo = false;
      document.documentElement.removeAttribute('data-offline-subiendo');
      await refrescarLista();
      emitir();
    }
  }

  async function subirUno(pedido) {
    if (pedido.ilegible) throw new Error(pedido.ultimoError || 'Archivo de pedido ilegible');
    const db = firebase.database();
    let escritura = escrituras.get(pedido.id);
    if (!escritura) {
      // ¿Ya se había subido? (por ejemplo, se cortó la luz justo después de
      // confirmar). La escritura es todo o nada: si el pedido está, está entero.
      const previo = await conLimite(db.ref('pedidos/' + pedido.id).once('value'),
        LIMITE_LECTURA_MS, 'Firebase no responde. Se reintenta solo.');
      if (previo.exists()) {
        await api.cola.subido(pedido.id);
        return;
      }
      escritura = db.ref().update(pedido.actualizaciones);
      escrituras.set(pedido.id, escritura);
      // Si Firebase la rechaza, no se escribió nada: se puede volver a mandar.
      escritura.catch(() => escrituras.delete(pedido.id));
    }
    // Si se pasa el tiempo, la escritura sigue viva y se espera en el próximo intento.
    await conLimite(escritura, LIMITE_ESCRITURA_MS, 'Firebase tardó demasiado en confirmar. Se reintenta solo.');

    const verif = await conLimite(
      db.ref('movimientos').orderByChild('pedidoId').equalTo(pedido.id).once('value'),
      LIMITE_LECTURA_MS, 'Firebase no responde. Se reintenta solo.');
    let cantidad = 0;
    verif.forEach(() => { cantidad++; });
    if (cantidad < (pedido.movimientos || 1)) {
      throw new Error(`Movimientos incompletos (${cantidad}/${pedido.movimientos}).`);
    }
    await api.cola.subido(pedido.id);
    escrituras.delete(pedido.id);
  }

  function programarReintento() {
    clearTimeout(reintento);
    const espera = ESPERAS_REINTENTO_MS[Math.min(intentoFallido, ESPERAS_REINTENTO_MS.length - 1)];
    intentoFallido++;
    reintento = setTimeout(() => { reintento = null; revisar(); }, espera);
  }

  // --------------------------------------------------------- ciclo general --
  let overlayDescartado = false;
  let terminando = false;

  function hayVentaEnCurso() {
    if (document.querySelector('#itemsBody tr[data-idx]')) return true;
    const guardando = document.getElementById('overlayBloqueo');
    return !!guardando && guardando.style.display !== 'none';
  }

  function revisar() {
    if (!api || terminando) return;
    if (!conectado()) {
      ocultarSubida();
      overlayDescartado = false;
      return;
    }
    if (activo()) {
      // Volvió internet con el usuario Offline: primero se termina la venta
      // que se está cargando (se guarda en la bandeja, como las demás).
      if (hayVentaEnCurso()) { pintarChip(); return; }
      if (reintento) { if (!overlayDescartado) mostrarSubida(); return; }
      if (!overlayDescartado) mostrarSubida();
      subirPendientes().then(r => {
        if (r.completo && activo() && !hayVentaEnCurso()) terminarModo(r.subidos);
        else if (!overlayDescartado) mostrarSubida();
      });
    } else if (estado.pendientes.length && !reintento) {
      subirPendientes();
    }
  }

  // Todo subido: se sale del modo y la caja vuelve a pedir un usuario.
  function terminarModo(subidos) {
    terminando = true;
    mostrarSubida({ listo: subidos });
    setTimeout(() => {
      ssDel(SS_MODO);
      ssDel(SS_SIN_SESION);
      ssDel(SS_USUARIO);
      window.location.replace('ingresoPedidoV2.html');
    }, 1800);
  }

  function entrar() {
    if (!api) return;
    ssSet(SS_MODO, '1');
    overlayDescartado = false;
    emitir();
    // Sin internet no se pueden editar pedidos guardados.
    if (new URLSearchParams(location.search).has('id')) location.replace('ingresoPedidoV2.html');
  }

  function salir() {
    ssDel(SS_MODO);
    ssDel(SS_SIN_SESION);
    ocultarSubida();
    emitir();
  }

  // Sin sesión guardada y sin internet no se puede iniciar sesión: el login
  // ofrece entrar igual, solo con el usuario Offline.
  function entrarSinSesion() {
    if (!disponible()) return;
    ssSet(SS_SIN_SESION, '1');
    if (typeof window.mostrarPanel === 'function') window.mostrarPanel();
  }

  function soloOffline() {
    if (ssGet(SS_SIN_SESION) !== '1') return false;
    try { return !firebase.auth().currentUser; } catch (_) { return true; }
  }

  // ---------------------------------------------- catálogo y cotización --
  function claveCatalogo() {
    return 'catalogo-pv' + String(puntoVenta() || '1').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Solo en el programa de escritorio: en la web no hay a dónde mandarlo.
  function guardarCopia(clave, datos) {
    if (!api || !estado.habilitada) return;
    api.copia.guardar(clave, datos).catch(err => console.warn('Modo Offline: no se guardó la copia de ' + clave, err));
  }

  // La caja guarda una copia del catálogo cada vez que la planilla responde.
  function guardarCatalogo(data) {
    if (data && Array.isArray(data.values) && data.values.length) guardarCopia(claveCatalogo(), data);
  }

  // En modo Offline: la planilla si responde rápido, si no la última copia.
  async function catalogo(url) {
    try {
      const r = await fetchConLimite(url, LIMITE_RED_MS);
      const data = await r.json();
      if (data && Array.isArray(data.values) && data.values.length) {
        guardarCatalogo(data);
        estado.catalogoFecha = null;
        emitir();
        return data;
      }
    } catch (_) {}
    const copia = api ? await api.copia.leer(claveCatalogo()) : null;
    if (!copia || !copia.datos) throw new Error('No hay una copia del catálogo en esta PC');
    estado.catalogoFecha = copia.fecha;
    emitir();
    return copia.datos;
  }

  function guardarCotizacion(valor) {
    const n = Number(valor);
    if (n > 0) guardarCopia('cotizacion', n);
  }

  // Además de cada vez que la caja carga la planilla, se renuevan cada media
  // hora mientras haya internet.
  function urlCatalogo() {
    if (typeof GOOGLE_SHEETS_CONFIG === 'undefined') return null;
    return `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_CONFIG.SPREADSHEET_ID}/values/${GOOGLE_SHEETS_CONFIG.RANGO}?key=${GOOGLE_SHEETS_CONFIG.API_KEY}`;
  }

  function actualizarCopias() {
    if (!api || !estado.habilitada || !estado.internet || activo()) return;
    const url = urlCatalogo();
    if (url) fetch(url).then(r => r.json()).then(guardarCatalogo).catch(() => {});
    fetch(URL_COTIZACION).then(r => r.json())
      .then(d => guardarCotizacion(d && d.blue && (d.blue.value_sell || d.blue.sell)))
      .catch(() => {});
  }

  // En modo Offline: la cotización de internet si responde rápido, si no la
  // última conocida. Sin ninguna de las dos, rechaza como la caja de siempre.
  async function cotizacion() {
    try {
      const r = await fetchConLimite(URL_COTIZACION, LIMITE_RED_MS);
      const d = await r.json();
      const v = d && d.blue && (d.blue.value_sell || d.blue.sell);
      if (v) { guardarCotizacion(v); return v; }
    } catch (_) {}
    const copia = api ? await api.copia.leer('cotizacion').catch(() => null) : null;
    if (copia && Number(copia.datos) > 0) return Number(copia.datos);
    throw new Error('cotizacion');
  }

  // ------------------------------------------------------------ bloqueos --
  let toastTimer = null;
  function toast(texto) {
    let el = document.getElementById('offToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'offToast';
      el.className = 'off-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = texto;
    el.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
  }

  // En captura sobre window: corre antes que los listeners de la caja.
  window.addEventListener('click', e => {
    if (!activo()) return;
    const el = e.target && e.target.closest && e.target.closest(SELECTOR_BLOQUEADOS);
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toast('Sin conexión: esto necesita internet. En modo Offline solo se cargan ventas nuevas.');
  }, true);

  window.addEventListener('keydown', e => {
    if (!activo() || !TECLAS_BLOQUEADAS.includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toast('Sin conexión: esto necesita internet.');
  }, true);

  // ------------------------------------------------------- chip y lista --
  let chip = null;

  function fechaCorta(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const p = n => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function plural(n, uno, varios) { return n + ' ' + (n === 1 ? uno : varios); }

  function pintarChip() {
    if (!api) return;
    if (!chip) {
      const nav = document.querySelector('.pos-nav');
      if (!nav) return;
      chip = document.createElement('button');
      chip.type = 'button';
      chip.id = 'offlineChip';
      chip.className = 'off-chip';
      chip.innerHTML = '<span class="off-chip-punto" aria-hidden="true"></span>' +
        '<span class="off-chip-texto"><span class="off-chip-titulo"></span><span class="off-chip-sub"></span></span>';
      chip.addEventListener('click', abrirLista);
      nav.insertBefore(chip, nav.firstChild);
    }
    const n = estado.pendientes.length;
    let tipo = '', titulo = '', sub = '';
    if (estado.error && n) {
      tipo = 'error'; titulo = 'Pedidos sin subir'; sub = plural(n, 'pendiente', 'pendientes') + ' · tocá para ver';
    } else if (estado.subiendo && estado.progreso) {
      tipo = 'subiendo'; titulo = 'Subiendo pedidos'; sub = estado.progreso.hecho + ' de ' + estado.progreso.total;
    } else if (activo()) {
      tipo = 'offline';
      titulo = conectado() ? 'Volvió internet' : 'Modo Offline';
      if (conectado() && hayVentaEnCurso()) sub = 'Terminá esta venta para subir los pedidos';
      else sub = plural(n, 'pedido guardado', 'pedidos guardados') +
        (estado.catalogoFecha ? ' · precios del ' + fechaCorta(estado.catalogoFecha) : '');
    } else if (n) {
      tipo = 'pendientes'; titulo = plural(n, 'pedido sin subir', 'pedidos sin subir');
      sub = estado.necesitaSesion ? 'Iniciá sesión para subirlos' : (conectado() ? 'Subiendo…' : 'Esperando internet');
    }
    chip.hidden = !tipo;
    chip.dataset.tipo = tipo;
    chip.querySelector('.off-chip-titulo').textContent = titulo;
    chip.querySelector('.off-chip-sub').textContent = sub;
    chip.title = 'Pedidos guardados en esta PC';
    if (listaEl && !listaEl.hidden) pintarLista();
  }

  let listaEl = null;

  function abrirLista() {
    if (!listaEl) {
      listaEl = document.createElement('div');
      listaEl.className = 'off-modal';
      listaEl.hidden = true;
      listaEl.setAttribute('role', 'dialog');
      listaEl.setAttribute('aria-modal', 'true');
      listaEl.setAttribute('aria-labelledby', 'offListaTitulo');
      listaEl.addEventListener('click', e => {
        if (e.target === listaEl || e.target.closest('[data-cerrar]')) cerrarLista();
        else if (e.target.closest('[data-subir]')) { intentoFallido = 0; clearTimeout(reintento); reintento = null; overlayDescartado = false; revisar(); }
      });
      listaEl.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); cerrarLista(); }
      });
      document.body.appendChild(listaEl);
    }
    refrescarLista().then(() => {
      pintarLista();
      listaEl.hidden = false;
      const b = listaEl.querySelector('[data-cerrar]');
      if (b) b.focus();
    });
  }

  function cerrarLista() {
    if (listaEl) listaEl.hidden = true;
  }

  function pintarLista() {
    const filas = estado.pendientes.map(p => {
      const r = p.resumen || {};
      const conError = p.ultimoError ? `<span class="off-estado off-estado-error" title="${esc(p.ultimoError)}">Error · ${esc(p.ultimoError)}</span>`
        : '<span class="off-estado">Pendiente</span>';
      return `<tr>
        <td class="off-num">${esc(p.orden)}</td>
        <td>${esc(r.fecha || fechaCorta(p.guardadoEn))}</td>
        <td>${esc(r.cliente || '—')}</td>
        <td class="off-num">${r.total != null ? '$ ' + esc(Math.round(r.total).toLocaleString('es-AR')) : '—'}</td>
        <td>${conError}</td>
      </tr>`;
    }).join('');
    listaEl.classList.toggle('ya-visible', !listaEl.hidden);
    const vacio = '<p class="off-vacio">No hay pedidos pendientes de subir.</p>';
    const otras = estado.otrasBases
      ? `<p class="off-nota">Además hay ${plural(estado.otrasBases, 'pedido', 'pedidos')} de otro punto de venta: se suben al volver a ese punto de venta.</p>` : '';
    const aviso = !conectado() ? '<p class="off-nota">Sin internet: se suben solos cuando vuelva la conexión.</p>'
      : estado.necesitaSesion ? '<p class="off-nota">Hay que iniciar sesión para subirlos.</p>' : '';
    listaEl.innerHTML = `
      <div class="off-modal-card">
        <h2 id="offListaTitulo" class="off-modal-titulo">Pedidos guardados en esta PC</h2>
        <p class="off-modal-sub">Se suben a Firebase en este orden. Ninguno se borra hasta que Firebase lo confirma.</p>
        ${filas ? `<div class="off-tabla-wrap"><table class="off-tabla">
          <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th></tr></thead>
          <tbody>${filas}</tbody></table></div>` : vacio}
        ${otras}${aviso}
        <div class="off-modal-acciones">
          <button type="button" class="off-btn off-btn-sec" data-cerrar>Cerrar</button>
          ${filas ? `<button type="button" class="off-btn off-btn-pri" data-subir ${conectado() && !estado.subiendo ? '' : 'disabled'}>Subir ahora</button>` : ''}
        </div>
      </div>`;
  }

  // ------------------------------------------------- pantalla de subida --
  let subidaEl = null;

  function mostrarSubida(opciones) {
    if (!subidaEl) {
      subidaEl = document.createElement('div');
      subidaEl.className = 'off-subida';
      subidaEl.setAttribute('role', 'alertdialog');
      subidaEl.setAttribute('aria-modal', 'true');
      subidaEl.setAttribute('aria-live', 'polite');
      subidaEl.addEventListener('click', e => {
        if (e.target.closest('[data-reintentar]')) { intentoFallido = 0; clearTimeout(reintento); reintento = null; revisar(); }
        else if (e.target.closest('[data-seguir]')) { overlayDescartado = true; ocultarSubida(); }
        else if (e.target.closest('[data-login]')) {
          overlayDescartado = true;
          ocultarSubida();
          if (typeof window.mostrarLogin === 'function') window.mostrarLogin();
        }
      });
      subidaEl.addEventListener('keydown', e => e.stopPropagation());
      document.body.appendChild(subidaEl);
    }
    const listo = opciones && opciones.listo != null;
    let cuerpo;
    if (listo) {
      cuerpo = `<h2 class="off-modal-titulo">Listo</h2>
        <p class="off-modal-sub">${opciones.listo ? plural(opciones.listo, 'pedido subido', 'pedidos subidos') + ' a Firebase.' : 'No había pedidos para subir.'}
        La caja vuelve a pedir un usuario.</p>`;
    } else if (estado.necesitaSesion) {
      cuerpo = `<h2 class="off-modal-titulo">Volvió internet</h2>
        <p class="off-modal-sub">Para subir los ${plural(estado.pendientes.length, 'pedido guardado', 'pedidos guardados')} hay que iniciar sesión.</p>
        <div class="off-modal-acciones">
          <button type="button" class="off-btn off-btn-sec" data-seguir>Seguir en modo Offline</button>
          <button type="button" class="off-btn off-btn-pri" data-login>Iniciar sesión</button>
        </div>`;
    } else if (estado.error && !estado.subiendo) {
      cuerpo = `<h2 class="off-modal-titulo off-error">No se pudo subir un pedido</h2>
        <p class="off-modal-sub">Pedido #${esc(estado.error.orden || '')}: ${esc(estado.error.mensaje)}</p>
        <p class="off-modal-sub">No se perdió nada: sigue guardado en esta PC y se reintenta solo.</p>
        <div class="off-modal-acciones">
          <button type="button" class="off-btn off-btn-sec" data-seguir>Seguir en modo Offline</button>
          <button type="button" class="off-btn off-btn-pri" data-reintentar>Reintentar ahora</button>
        </div>`;
    } else {
      const p = estado.progreso;
      const total = p ? p.total : estado.pendientes.length;
      const hecho = p ? p.hecho : 0;
      cuerpo = `<span class="off-spinner" aria-hidden="true"></span>
        <h2 class="off-modal-titulo">Volvió internet</h2>
        <p class="off-modal-sub">Subiendo los pedidos guardados en esta PC: <strong>${hecho} de ${total}</strong></p>
        <div class="off-barra" aria-hidden="true"><span style="width:${total ? Math.round(hecho / total * 100) : 0}%"></span></div>
        <p class="off-modal-nota">No cierres la caja.</p>`;
    }
    // Si ya estaba a la vista solo cambia el texto: no se repite la entrada.
    subidaEl.classList.toggle('ya-visible', !subidaEl.hidden);
    subidaEl.innerHTML = `<div class="off-modal-card off-subida-card">${cuerpo}</div>`;
    subidaEl.hidden = false;
  }

  function ocultarSubida() {
    if (subidaEl) subidaEl.hidden = true;
  }

  // Mientras se ve la pantalla de subida, se actualiza con cada pedido.
  document.addEventListener(EVENTO, () => {
    if (subidaEl && !subidaEl.hidden && !terminando) mostrarSubida();
  });

  // ------------------------------------------------------------- login --
  function pintarBotonLogin() {
    const b = document.getElementById('loginOfflineBtn');
    if (b) b.hidden = !disponible();
  }

  // ------------------------------------------------------------- inicio --
  function iniciar() {
    if (!api) return;
    api.obtener().then(aplicarEstado).catch(() => {});
    api.alCambiar(aplicarEstado);

    document.addEventListener('DOMContentLoaded', () => {
      if (typeof firebase !== 'undefined' && firebase.apps.length) {
        firebase.database().ref('.info/connected').on('value', s => {
          estado.firebase = s.val() === true;
          emitir();
          revisar();
        });
        firebase.auth().onAuthStateChanged(u => {
          authListo = true;
          if (u) estado.necesitaSesion = false;
          revisar();
        });
      }
      const b = document.getElementById('loginOfflineBtn');
      if (b) b.addEventListener('click', entrarSinSesion);
      if (activo() && new URLSearchParams(location.search).has('id')) location.replace('ingresoPedidoV2.html');
      refrescarLista().then(() => { emitir(); revisar(); });
      setInterval(() => { if (activo()) revisar(); }, REVISION_ACTIVO_MS);
      setInterval(() => { refrescarLista().then(() => { emitir(); revisar(); }); }, REVISION_FONDO_MS);
      setInterval(actualizarCopias, COPIAS_MS);
    });
  }

  function aplicarEstado(nuevo) {
    if (!nuevo) return;
    const volvio = !estado.internet && nuevo.internet;
    estado.habilitada = !!nuevo.habilitada;
    estado.internet = !!nuevo.internet;
    if (volvio) { overlayDescartado = false; intentoFallido = 0; }
    emitir();
    revisar();
  }

  iniciar();

  // ---------------------------------------------------------------- API --
  window.ModoOffline = {
    NOMBRE,
    EVENTO,
    activo,
    disponible,
    // El selector muestra "Offline" sin internet, o si ya se está usando.
    mostrarEnSelector: () => disponible() || activo(),
    soloOffline,
    PALABRA_CONFIRMAR,
    palabraCorrecta: texto => String(texto || '').trim().toLowerCase() === PALABRA_CONFIRMAR,
    esOffline: nombre => String(nombre || '').toLowerCase() === NOMBRE.toLowerCase(),
    entrar,
    salir,
    encolar,
    hayPendientes: () => estado.pendientes.length > 0,
    avisarPendientes: () => toast('Hay ' + plural(estado.pendientes.length, 'pedido', 'pedidos') +
      ' sin subir de este punto de venta. Esperá a que se suban para cambiarlo.'),
    guardarCatalogo,
    catalogo,
    guardarCotizacion,
    cotizacion
  };
})();
