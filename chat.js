// === MENSAJERÍA INTERNA ENTRE EQUIPOS ===
// Canal general en Firebase RTDB, con presencia de equipos, mensajes rápidos y
// llamado urgente. Usa el `db` global que inicializa cada pantalla de la caja
// (ingresoPedidoV2.html, historialRecientes.html).
//
// Datos:
//   chat/mensajes/{pushId}          { de, texto, tipo: 'texto'|'rapido'|'urgente', ts, para?,
//                                     menciones?: { {clave}: nombre, todos?: 'todos' },
//                                     vistos?: { {clave}: ts } }
//     (`para` = nombre del equipo al que va el timbre; sólo en los 'urgente')
//     (`menciones` = a quién se arrobó con @Nombre o @todos; `vistos` = quién
//      ya cerró la tarjeta flotante de esa mención, para que el que la mandó
//      vea "✓ Visto")
//   chat/presencia/{clave}          { nombre, ultimaVez, conexiones: { {pushId}: ts },
//                                     expulsadas?: { {pushId}: ts } }
//     (una conexión por pestaña abierta, con la hora en que se abrió;
//      `expulsadas` = conexiones que otro equipo descartó con "Entrar igual",
//      ver usuarioActivo.js)
//
// Regla de oro: el chat nunca roba el foco del campo principal de la pantalla
// (el marcado con data-foco-principal: en la caja, el buscador donde escribe
// la pistola). Sólo toma el foco cuando la persona abre el panel.
(function() {
  'use strict';

  const MAX_MENSAJES = 100;
  const DIAS_RETENCION = 7;
  const URGENTE_VIGENCIA_MS = 2 * 60 * 1000; // un llamado más viejo que esto ya no suena
  const TOAST_MS = 10000;
  const LS_NOMBRE = 'chatEquipoNombre';
  const LS_LEIDO = 'chatUltimoLeido';
  const LS_SONIDO = 'chatSonido';
  const LS_LIMPIEZA = 'chatUltimaLimpieza';
  const MAX_CARACTERES = 100;
  // Firebase borra la conexión de una pestaña al cerrarse. Si la PC se apaga
  // de golpe puede tardar unos minutos en enterarse: para ese caso está
  // "Entrar igual" en el selector de usuario. No hay renovación periódica.
  const LIMPIEZA_PRESENCIA_MS = 5 * 60 * 1000;
  // Pasar de la caja al historial (o volver) suelta la conexión y la anota de
  // nuevo al cargar. Un equipo que se fue hace menos que esto sigue en la tira,
  // así no parpadea "desconectado" cada vez que alguien cambia de pantalla.
  const GRACIA_NAVEGACION_MS = 8 * 1000;
  // Menciones (@Nombre): la tarjeta flotante queda hasta que se la toca. Si
  // la caja se recarga o se cambia de pantalla, vuelve a aparecer mientras no
  // se haya visto y tenga menos que esto.
  const MENCION_VIGENCIA_MS = 12 * 3600000;
  const MENCIONES_VISIBLES = 3;
  const CLAVE_TODOS = 'todos';

  const refMensajes = db.ref('chat/mensajes');
  const refPresencia = db.ref('chat/presencia');

  // Con el selector de usuario (usuarioActivo.js) el nombre del chat es el de
  // quien está en la caja; sin él, el nombre del equipo que se guardó acá.
  const conSelector = !!window.UsuarioActivo;
  let miNombre = (conSelector ? UsuarioActivo.actual() : lsGet(LS_NOMBRE)) || '';
  let miConexionRef = null;
  // Todas las conexiones que abrió esta pestaña con el nombre actual: una
  // expulsión puede llegar tarde (equipo sin internet) y apuntar a una vieja.
  let misConexiones = new Set();
  let ultimaLimpiezaPresencia = 0;
  let ultimoLeido = Number(lsGet(LS_LEIDO)) || 0;
  let offsetServidor = 0;
  let cargaInicial = true;
  let iniciado = false;
  let presencias = {};
  let mensajes = [];          // [{ id, de, texto, tipo, ts }] en orden
  let abierto = false;
  let alarmaTimer = null;
  let tituloOriginal = document.title;
  // Arranca en silencio: sólo suena si alguien lo activó en este equipo.
  let sonidoActivo = lsGet(LS_SONIDO) === 'on';

  // ------------------------------------------------------------- helpers --
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  function ahoraServidor() { return Date.now() + offsetServidor; }

  // Las claves de RTDB no aceptan . $ # [ ] /
  function claveDe(nombre) {
    return nombre.trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'equipo';
  }

  function iniciales(nombre) {
    const partes = nombre.trim().split(/\s+/);
    return ((partes[0] || '')[0] || '') + ((partes[1] || '')[0] || '');
  }

  function normalizar(t) {
    return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function escRegex(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function horaCorta(ts) {
    return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  function etiquetaDia(ts) {
    const d = new Date(ts);
    const hoy = new Date();
    const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
    if (d.toDateString() === hoy.toDateString()) return 'Hoy';
    if (d.toDateString() === ayer.toDateString()) return 'Ayer';
    return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'short' });
  }

  function devolverFocoAlBuscador() {
    const main = document.getElementById('mainContainer');
    if (main && main.style.display === 'none') return;
    const s = document.querySelector('[data-foco-principal]');
    if (s && !s.disabled) s.focus();
  }

  // Los push IDs de Firebase arrancan con el timestamp codificado en 8
  // caracteres: armando ese prefijo se pueden pedir "las claves anteriores a X"
  // ordenando por clave, sin necesitar un índice en las reglas.
  const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
  function prefijoPushDe(ms) {
    let s = '';
    for (let i = 0; i < 8; i++) { s = PUSH_CHARS.charAt(ms % 64) + s; ms = Math.floor(ms / 64); }
    return s;
  }

  // -------------------------------------------------------------- sonido --
  let audioCtx = null;
  function ctx() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }
  // El navegador sólo deja sonar audio después de una interacción: se
  // "despierta" el contexto con el primer clic o tecla.
  ['pointerdown', 'keydown'].forEach(ev =>
    document.addEventListener(ev, function despertar() { ctx(); document.removeEventListener(ev, despertar, true); }, true));

  function tono(freq, inicio, dur, vol) {
    const c = ctx(); if (!c) return;
    const t0 = c.currentTime + inicio;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  // El silencio apaga sólo el aviso de mensajes. El timbre suena igual: va
  // dirigido a este equipo y es justamente para cuando hace falta llamar.
  function sonarMensaje() { if (!sonidoActivo) return; tono(880, 0, 0.18, 0.12); tono(1318.5, 0.09, 0.28, 0.1); }
  // La mención va dirigida a este equipo: suena aunque los mensajes estén en
  // silencio, pero bajito y una sola vez (no es un timbre).
  function sonarMencion() { tono(659.3, 0, 0.16, 0.09); tono(987.8, 0.11, 0.3, 0.08); }
  function sonarUrgente() {
    [0, 0.16, 0.32].forEach(t => { tono(1046.5, t, 0.13, 0.22); tono(1568, t + 0.06, 0.1, 0.14); });
  }

  // ------------------------------------------------------------------ DOM --
  const navBtn = document.getElementById('chatNavBtn');
  const badge = document.getElementById('chatBadge');

  const raiz = document.createElement('div');
  raiz.id = 'chatRaiz';
  raiz.innerHTML = `
    <div class="chat-velo" data-cerrar></div>
    <aside class="chat-drawer" role="dialog" aria-modal="false" aria-labelledby="chatTitulo">
      <header class="chat-head">
        <div class="chat-head-row">
          <h2 id="chatTitulo" class="chat-titulo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z"/></svg>
            Mensajes
          </h2>
          <div class="chat-head-acciones">
          <button type="button" id="chatSonidoBtn" class="chat-cerrar chat-sonido" aria-pressed="true"></button>
          <button type="button" class="chat-cerrar" data-cerrar title="Cerrar (Esc)" aria-label="Cerrar mensajes">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          </div>
        </div>
        <div id="chatEquipos" class="chat-equipos" aria-label="Equipos"></div>
      </header>

      <div id="chatLista" class="chat-lista" aria-live="polite"></div>

      <footer class="chat-pie">
        <div id="chatTimbreMenu" class="chat-timbre-menu" role="menu" aria-label="Elegí a quién llamar" hidden>
          <div class="chat-timbre-titulo">¿A quién llamás?</div>
          <div id="chatTimbreLista" class="chat-timbre-lista"></div>
        </div>
        <div id="chatMencionMenu" class="chat-timbre-menu chat-mencion-menu" role="listbox" aria-label="Mencionar a" hidden>
          <div class="chat-timbre-titulo">Mencionar a…</div>
          <div id="chatMencionLista" class="chat-timbre-lista"></div>
        </div>
        <div class="chat-compose">
          <button type="button" id="chatUrgenteBtn" class="chat-btn-circ chat-urgente-btn" title="Tocar timbre a un equipo" aria-label="Tocar timbre a un equipo" aria-haspopup="menu" aria-expanded="false">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          </button>
          <textarea id="chatInput" class="chat-input" rows="1" maxlength="${MAX_CARACTERES}" placeholder="Escribí un mensaje… (@ para mencionar)" aria-label="Mensaje"></textarea>
          <button type="button" id="chatEnviarBtn" class="chat-btn-circ chat-enviar" title="Enviar (Enter)" aria-label="Enviar" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </button>
        </div>
      </footer>
    </aside>

    <div id="chatToasts" class="chat-toasts" aria-live="polite"><div id="chatMenciones" class="chat-menciones"></div></div>

    <div id="chatAlarma" class="chat-alarma" role="alertdialog" aria-labelledby="chatAlarmaDe">
      <div class="chat-alarma-card">
        <div class="chat-alarma-icono">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
        </div>
        <h3 id="chatAlarmaDe" class="chat-alarma-de"></h3>
        <p class="chat-alarma-sub">te está llamando · <span id="chatAlarmaHora"></span></p>
        <div class="chat-alarma-acciones">
          <button type="button" id="chatAlarmaOk" class="chat-alarma-ok">Cerrar</button>
          <button type="button" id="chatAlarmaVoy" class="chat-alarma-voy">Voy</button>
        </div>
      </div>
    </div>

    <div id="chatNombreOverlay" class="modal-overlay" style="display:none; z-index:10060;">
      <div class="modal-card">
        <h3 class="modal-titulo">¿Cómo se llama este equipo?</h3>
        <p class="modal-sub">Así lo van a ver los demás en los mensajes. Se pide una sola vez.</p>
        <div id="chatNombreError" class="modal-error"></div>
        <input type="text" id="chatNombreInput" class="modal-input" maxlength="24" placeholder="Ej: Caja 1" autocomplete="off">
        <div class="chat-nombre-ejemplos">
          ${['Venta #', 'Caja #', 'WhatsApp', 'Otro'].map(n => `<button type="button" data-ejemplo="${n}">${n}</button>`).join('')}
        </div>
        <div class="modal-acciones">
          <button type="button" id="chatNombreCancelar" class="modal-btn-sec">Más tarde</button>
          <button type="button" id="chatNombreOk" class="modal-btn-pri">Guardar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(raiz);

  const $ = id => document.getElementById(id);
  const lista = $('chatLista');
  const input = $('chatInput');
  const enviarBtn = $('chatEnviarBtn');
  const equiposEl = $('chatEquipos');
  const toasts = $('chatToasts');
  const alarma = $('chatAlarma');
  const nombreOverlay = $('chatNombreOverlay');
  const nombreInput = $('chatNombreInput');
  const nombreError = $('chatNombreError');
  const sonidoBtn = $('chatSonidoBtn');
  const timbreBtn = $('chatUrgenteBtn');
  const timbreMenu = $('chatTimbreMenu');
  const timbreLista = $('chatTimbreLista');
  const mencionMenu = $('chatMencionMenu');
  const mencionLista = $('chatMencionLista');
  const mencionesEl = $('chatMenciones');

  // -------------------------------------------------------------- silencio --
  const ICONO_SONIDO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/></svg>';
  const ICONO_MUDO = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="m22 9-6 6M16 9l6 6"/></svg>';

  function pintarSonido() {
    sonidoBtn.innerHTML = sonidoActivo ? ICONO_SONIDO : ICONO_MUDO;
    sonidoBtn.classList.toggle('apagado', !sonidoActivo);
    sonidoBtn.setAttribute('aria-pressed', String(sonidoActivo));
    const txt = sonidoActivo ? 'Sonido de mensajes activado (clic para silenciar)' : 'Sonido de mensajes silenciado (clic para activar)';
    sonidoBtn.title = txt;
    sonidoBtn.setAttribute('aria-label', txt);
  }
  sonidoBtn.addEventListener('click', () => {
    sonidoActivo = !sonidoActivo;
    lsSet(LS_SONIDO, sonidoActivo ? 'on' : 'off');
    pintarSonido();
    if (sonidoActivo) sonarMensaje();
  });
  pintarSonido();

  // ----------------------------------------------------------- abrir/cerrar --
  function abrir() {
    if (!miNombre) { pedirNombre(); return; }
    abierto = true;
    raiz.classList.add('chat-abierto');
    navBtn.setAttribute('aria-expanded', 'true');
    marcarLeido();
    verMencionesPendientes();
    scrollAlFinal();
    setTimeout(() => input.focus(), 120);
  }

  function cerrar() {
    if (!abierto) return;
    abierto = false;
    cerrarTimbreMenu();
    cerrarMencionMenu();
    raiz.classList.remove('chat-abierto');
    navBtn.setAttribute('aria-expanded', 'false');
    devolverFocoAlBuscador();
  }

  navBtn.addEventListener('click', () => abierto ? cerrar() : abrir());
  raiz.querySelectorAll('[data-cerrar]').forEach(el => el.addEventListener('click', cerrar));

  document.addEventListener('keydown', function(e) {
    if (e.key === 'F2') { e.preventDefault(); abierto ? cerrar() : abrir(); return; }
    if (e.key === 'Escape') {
      if (alarma.classList.contains('visible')) { cerrarAlarma(); return; }
      if (!timbreMenu.hidden) { cerrarTimbreMenu(); input.focus(); return; }
      if (nombreOverlay.style.display !== 'none') { cerrarNombre(); return; }
      if (abierto) cerrar();
    }
  });

  // ------------------------------------------------------- nombre equipo --
  function pedirNombre() {
    if (conSelector) { cerrar(); UsuarioActivo.abrir(); return; }
    nombreInput.value = miNombre;
    nombreError.style.display = 'none';
    nombreOverlay.style.display = 'flex';
    setTimeout(() => { nombreInput.focus(); nombreInput.select(); }, 80);
  }

  function cerrarNombre() {
    nombreOverlay.style.display = 'none';
    if (abierto) input.focus(); else devolverFocoAlBuscador();
  }

  function guardarNombre() {
    const nombre = nombreInput.value.trim().replace(/\s+/g, ' ');
    if (nombre.length < 2) return errorNombre('Escribí un nombre de al menos 2 letras.');
    const clave = claveDe(nombre);
    const otro = presencias[clave];
    const esMio = miNombre && claveDe(miNombre) === clave;
    if (otro && !esMio && conexionesVivas(otro).length) {
      return errorNombre('"' + otro.nombre + '" ya está conectado en otro equipo. Elegí otro nombre.');
    }
    usarNombre(nombre);
    nombreOverlay.style.display = 'none';
    abrir();
  }

  function usarNombre(nombre) {
    const anterior = miNombre;
    miNombre = nombre;
    if (nombre) lsSet(LS_NOMBRE, nombre);
    if (anterior !== nombre) {
      misConexiones.clear();
      // Antes de iniciar(), la presencia la anota '.info/connected'.
      if (iniciado) conectarPresencia();
      // Si el nombre viejo quedó sin pestañas abiertas, se borra de la lista
      // para que no figure para siempre como un equipo desconectado. Va en
      // una transacción: si en el mismo instante otro equipo entró con ese
      // nombre ("Entrar igual"), su conexión nueva no se borra.
      if (anterior && claveDe(anterior) !== claveDe(nombre)) {
        refPresencia.child(claveDe(anterior)).transaction(actual =>
          actual && actual.conexiones ? undefined : null
        ).catch(() => {});
      }
      renderEquipos();
      renderMensajes();
      recalcularMenciones();
    }
  }

  // Cada vez que alguien elige su nombre en el selector de la caja. Con
  // nombre vacío (se abrió el selector para cambiar) el equipo se desconecta.
  document.addEventListener('usuarioactivo:cambio', e => {
    if (e.detail) usarNombre(e.detail.nombre || '');
  });

  function errorNombre(msg) {
    nombreError.textContent = msg;
    nombreError.style.display = 'block';
  }

  $('chatNombreOk').addEventListener('click', guardarNombre);
  $('chatNombreCancelar').addEventListener('click', cerrarNombre);
  nombreInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); guardarNombre(); } });
  // "Venta #" y "Caja #" dejan escrito "Venta " con el cursor al final para
  // completar el número; "Otro" vacía el campo para escribir libre.
  raiz.querySelectorAll('[data-ejemplo]').forEach(b => b.addEventListener('click', () => {
    const ej = b.dataset.ejemplo;
    nombreInput.value = ej === 'Otro' ? '' : ej.replace(/#$/, '');
    nombreInput.focus();
    const fin = nombreInput.value.length;
    nombreInput.setSelectionRange(fin, fin);
  }));

  // ------------------------------------------------------------ presencia --
  // Cada pestaña abierta registra una "conexión" bajo su equipo y Firebase la
  // borra sola al cerrarse. Un equipo está en línea si tiene alguna conexión:
  // así dos pestañas en la misma PC no se pisan.
  function conectarPresencia() {
    if (miConexionRef) {
      // Se suelta antes de borrarla: el aviso de presencia que dispara el
      // borrado no tiene que volver a anotarla (ver asegurarMiConexion).
      const vieja = miConexionRef;
      miConexionRef = null;
      vieja.onDisconnect().cancel();
      vieja.remove();
    }
    if (!miNombre) return;
    const ref = refPresencia.child(claveDe(miNombre));
    miConexionRef = ref.child('conexiones').push();
    misConexiones.add(miConexionRef.key);
    ref.child('ultimaVez').onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);
    miConexionRef.onDisconnect().remove();
    miConexionRef.set(firebase.database.ServerValue.TIMESTAMP);
    ref.update({ nombre: miNombre, ultimaVez: firebase.database.ServerValue.TIMESTAMP });
  }

  // Una conexión cuenta mientras exista: Firebase la borra al cerrarse la
  // pestaña, y "Entrar igual" la descarta a mano.
  function conexionesVivas(p) {
    if (!p || !p.conexiones) return [];
    return Object.keys(p.conexiones);
  }

  // Si otra pestaña borró la conexión de esta (por ejemplo, al limpiar el
  // nombre que acababa de soltar justo cuando este equipo entraba con él),
  // se vuelve a anotar. Sin esto el equipo figuraría libre hasta recargar.
  let saliendo = false;

  function asegurarMiConexion() {
    if (saliendo || !miConexionRef || !miNombre) return;
    if (miConexionRef.parent.parent.key !== claveDe(miNombre)) return;
    const p = presencias[claveDe(miNombre)];
    if (p && p.conexiones && p.conexiones[miConexionRef.key] !== undefined && p.nombre) return;
    miConexionRef.set(firebase.database.ServerValue.TIMESTAMP);
    refPresencia.child(claveDe(miNombre)).update({ nombre: miNombre });
  }

  // Otro equipo eligió este mismo usuario con "Entrar igual": esta pestaña lo
  // suelta y vuelve al selector, en vez de quedar los dos con el mismo nombre.
  function revisarExpulsion() {
    if (!miNombre) return;
    const clave = claveDe(miNombre);
    const exp = presencias[clave] && presencias[clave].expulsadas;
    if (!exp) return;
    const mias = Object.keys(exp).filter(k => misConexiones.has(k));
    if (!mias.length) return;
    const cambios = {};
    mias.forEach(k => { cambios['expulsadas/' + k] = null; });
    if (miConexionRef) {
      miConexionRef.onDisconnect().cancel();
      cambios['conexiones/' + miConexionRef.key] = null;
      miConexionRef = null;
    }
    misConexiones.clear();
    refPresencia.child(clave).update(cambios).catch(() => {});
    const nombre = miNombre;
    if (conSelector) {
      UsuarioActivo.expulsado(nombre);
    } else {
      usarNombre('');
      pedirNombre();
    }
  }

  // Borra las marcas de expulsión de más de un día (las que nunca leyó una
  // caja que ya estaba apagada). La hace cualquier pestaña, como mucho cada
  // 5 minutos.
  function limpiarPresencia() {
    const ahora = ahoraServidor();
    if (ahora - ultimaLimpiezaPresencia < LIMPIEZA_PRESENCIA_MS) return;
    ultimaLimpiezaPresencia = ahora;
    const cambios = {};
    Object.keys(presencias).forEach(clave => {
      const p = presencias[clave] || {};
      Object.keys(p.expulsadas || {}).forEach(k => {
        const v = p.expulsadas[k];
        if (typeof v !== 'number' || ahora - v > 86400000) cambios[clave + '/expulsadas/' + k] = null;
      });
    });
    if (Object.keys(cambios).length) refPresencia.update(cambios).catch(() => {});
  }

  function recienSalido(p) {
    return typeof p.ultimaVez === 'number' && ahoraServidor() - p.ultimaVez < GRACIA_NAVEGACION_MS;
  }

  // Los otros equipos conectados ahora mismo (o que acaban de cambiar de
  // pantalla). Este equipo no figura: su usuario ya se ve en el encabezado.
  function otrosConectados() {
    return Object.keys(presencias).map(k => presencias[k])
      .filter(p => p && p.nombre && claveDe(p.nombre) !== claveDe(miNombre) &&
        (conexionesVivas(p).length || recienSalido(p)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  // En la tira de conectados va sólo el comienzo de cada nombre (3 letras) para
  // que entren más; el nombre completo queda en el tooltip.
  function nombreCorto(nombre) {
    return nombre.trim().split(/\s+/).map(n => n.slice(0, 3)).join(' ');
  }

  let revisionGracia = null;

  function renderEquipos() {
    // Si alguien quedó en la tira sólo por la gracia, se vuelve a mirar cuando
    // vence, aunque nadie más escriba en la presencia.
    clearTimeout(revisionGracia);
    if (Object.keys(presencias).some(k => presencias[k] && !conexionesVivas(presencias[k]).length && recienSalido(presencias[k]))) {
      revisionGracia = setTimeout(renderEquipos, 2000);
    }
    equiposEl.innerHTML = otrosConectados().map(p =>
      `<button type="button" class="chat-equipo online" data-mencionar="${esc(p.nombre)}" title="${esc(p.nombre)} · Conectado · clic para mencionar"><span class="chat-punto"></span>${esc(nombreCorto(p.nombre))}</button>`
    ).join('') || '<span class="chat-equipo offline">No hay otros equipos conectados</span>';
  }

  // ------------------------------------------------------------- mensajes --
  function enviar(texto, tipo, para) {
    texto = (texto || '').trim();
    if (!texto || !miNombre) return;
    const msg = {
      de: miNombre,
      texto: texto.slice(0, MAX_CARACTERES),
      tipo: tipo || 'texto',
      ts: firebase.database.ServerValue.TIMESTAMP
    };
    if (para) msg.para = para;
    const menciones = msg.tipo === 'texto' ? detectarMenciones(msg.texto) : null;
    if (menciones) msg.menciones = menciones;
    // Registro diario (registroCaja.js): sólo quién y a quién, nunca el texto.
    if (window.Registro) {
      const nombres = menciones ? Object.keys(menciones).map(k => menciones[k]).join(', ') : '';
      Registro.anotar('CHAT', `Envió ${msg.tipo === 'urgente' ? 'un TIMBRE' : 'un mensaje'} a ${para || 'todos los equipos'}` +
        (nombres ? ` · mencionó a ${nombres}` : ''));
    }
    refMensajes.push(msg).catch(err => {
      console.error('Chat: no se pudo enviar', err);
      mostrarToast({ de: 'Mensajes', texto: 'No se pudo enviar el mensaje. Revisá la conexión.' }, true);
    });
  }

  function enviarDesdeInput() {
    enviar(input.value, 'texto');
    input.value = '';
    ajustarAlto();
    input.focus();
  }

  function ajustarAlto() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    enviarBtn.disabled = !input.value.trim();
  }

  input.addEventListener('input', () => { ajustarAlto(); revisarMencion(); });
  input.addEventListener('keydown', e => {
    if (teclaMencion(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarDesdeInput(); }
  });
  enviarBtn.addEventListener('click', enviarDesdeInput);

  function esMio(m) { return miNombre && m.de === miNombre; }

  // Un timbre es para mí si me nombra; los viejos sin `para` eran para todos.
  function esParaMi(m) {
    return !m.para || (miNombre && claveDe(m.para) === claveDe(miNombre));
  }

  // ------------------------------------------------------------ menciones --
  // Se escribe @ en el campo y aparece la lista de conectados; también se
  // puede tocar un nombre de la tira de arriba. Al enviar, se detecta a quién
  // se nombró y se guarda en `menciones`. Al que lo nombraron le aparece una
  // tarjeta flotante abajo a la derecha que no toma el foco (la pistola sigue
  // escribiendo en el buscador) y sólo se va cuando la toca.

  // Todos los nombres que figuran en la presencia, conectados o no: así una
  // mención escrita a mano a alguien que salió un momento le llega al volver.
  function nombresConocidos() {
    const vistos = new Set();
    return Object.keys(presencias).map(k => presencias[k] && presencias[k].nombre)
      .filter(n => n && claveDe(n) !== claveDe(miNombre) && !vistos.has(claveDe(n)) && vistos.add(claveDe(n)));
  }

  // { clave: nombre } de cada @Nombre del texto (sin importar mayúsculas ni
  // tildes), más @todos. Los nombres largos van primero, para que "@Ana María"
  // no cuente también como "@Ana".
  function detectarMenciones(texto) {
    let base = normalizar(texto);
    const encontradas = {};
    nombresConocidos().sort((a, b) => b.length - a.length).forEach(n => {
      const buscado = '@' + normalizar(n);
      let i = base.indexOf(buscado);
      while (i !== -1) {
        // Tiene que ser una palabra suelta: "ana@ana.com" no es una mención.
        const previo = i ? base.charAt(i - 1) : '';
        const sig = base.charAt(i + buscado.length);
        if (!/[a-z0-9]/.test(previo) && !/[a-z0-9]/.test(sig)) {
          encontradas[claveDe(n)] = n;
          base = base.slice(0, i) + ' '.repeat(buscado.length) + base.slice(i + buscado.length);
          break;
        }
        i = base.indexOf(buscado, i + 1);
      }
    });
    if (/(^|[^a-z0-9])@todos(?![a-z0-9])/.test(base)) encontradas[CLAVE_TODOS] = 'todos';
    return Object.keys(encontradas).length ? encontradas : null;
  }

  function esMencionParaMi(m) {
    if (!m || !m.menciones || !miNombre || esMio(m) || m.tipo === 'urgente') return false;
    return !!(m.menciones[claveDe(miNombre)] || m.menciones[CLAVE_TODOS]);
  }

  function mencionVista(m) { return !!(m.vistos && miNombre && m.vistos[claveDe(miNombre)]); }

  function mencionPendiente(m) {
    return esMencionParaMi(m) && !mencionVista(m) &&
      ahoraServidor() - (m.ts || ahoraServidor()) < MENCION_VIGENCIA_MS;
  }

  // El texto del mensaje con cada @Nombre resaltado (el propio, más fuerte).
  function textoConMenciones(m) {
    const html = esc(m.texto);
    if (!m.menciones) return html;
    const nombres = Object.keys(m.menciones).map(k => k === CLAVE_TODOS ? 'todos' : String(m.menciones[k]))
      .sort((a, b) => b.length - a.length);
    if (!nombres.length) return html;
    const re = new RegExp('@(' + nombres.map(n => escRegex(esc(n))).join('|') + ')(?![\\p{L}\\p{N}])', 'giu');
    return html.replace(re, (todo, nombre) => {
      const yo = !esMio(m) && miNombre &&
        (normalizar(nombre) === normalizar(esc(miNombre)) || normalizar(nombre) === CLAVE_TODOS);
      return `<span class="chat-mencion${yo ? ' yo' : ''}">${todo}</span>`;
    });
  }

  // Debajo de un mensaje propio con menciones: quién ya lo vio.
  function lineaVistos(m) {
    if (!esMio(m) || !m.menciones) return '';
    const vistos = m.vistos || {};
    const partes = Object.keys(m.menciones).filter(k => k !== CLAVE_TODOS).map(k => {
      const v = vistos[k];
      return `<span class="${v ? 'visto' : 'pendiente'}" title="${v ? 'Lo vio a las ' + horaCorta(v) : 'Todavía no lo vio'}">` +
        `${v ? '✓' : '○'} ${esc(m.menciones[k])}</span>`;
    });
    if (m.menciones[CLAVE_TODOS]) {
      const n = Object.keys(vistos).length;
      partes.push(`<span class="${n ? 'visto' : 'pendiente'}">${n ? '✓' : '○'} @todos · ${n} lo ${n === 1 ? 'vio' : 'vieron'}</span>`);
    }
    return `<div class="chat-vistos">${partes.join('')}</div>`;
  }

  // --- menú al escribir @ ---
  const OPCION_TODOS = '\u0000todos';
  let mencionOpciones = [];
  let mencionIdx = 0;

  // La palabra que empieza con @ justo antes del cursor, si la hay.
  function tokenMencion() {
    const pos = input.selectionStart;
    if (pos !== input.selectionEnd) return null;
    const m = /(^|\s)@([^\s@]{0,24})$/.exec(input.value.slice(0, pos));
    return m ? { desde: pos - m[2].length - 1, hasta: pos, consulta: m[2] } : null;
  }

  function revisarMencion() {
    const tk = tokenMencion();
    if (!tk) { cerrarMencionMenu(); return; }
    const q = normalizar(tk.consulta);
    const otros = otrosConectados().map(p => p.nombre);
    mencionOpciones = otros.filter(n => normalizar(n).split(/\s+/).some(p => p.startsWith(q)));
    if (otros.length > 1 && CLAVE_TODOS.startsWith(q)) mencionOpciones.push(OPCION_TODOS);
    if (!mencionOpciones.length) { cerrarMencionMenu(); return; }
    mencionIdx = Math.min(mencionIdx, mencionOpciones.length - 1);
    pintarMencionMenu();
    mencionMenu.hidden = false;
  }

  function pintarMencionMenu() {
    mencionLista.innerHTML = mencionOpciones.map((n, i) => {
      const todos = n === OPCION_TODOS;
      return `<button type="button" class="chat-timbre-item online${i === mencionIdx ? ' activo' : ''}" role="option"
          aria-selected="${i === mencionIdx}" data-i="${i}" tabindex="-1">
        ${todos ? '<span class="chat-mencion-todos" aria-hidden="true">@</span>' : '<span class="chat-punto"></span>'}
        <span class="chat-timbre-nombre">${todos ? 'todos' : esc(n)}</span>
        <span class="chat-timbre-estado">${todos ? 'Todos los conectados' : 'Conectado'}</span>
      </button>`;
    }).join('');
  }

  function cerrarMencionMenu() {
    mencionMenu.hidden = true;
    mencionOpciones = [];
    mencionIdx = 0;
  }

  function elegirMencion(i) {
    const tk = tokenMencion();
    const opcion = mencionOpciones[i];
    if (!tk || opcion === undefined) { cerrarMencionMenu(); return; }
    const nombre = opcion === OPCION_TODOS ? CLAVE_TODOS : opcion;
    const antes = input.value.slice(0, tk.desde) + '@' + nombre + ' ';
    const despues = input.value.slice(tk.hasta).replace(/^\s+/, '');
    if ((antes + despues).length > MAX_CARACTERES) { cerrarMencionMenu(); return; }
    input.value = antes + despues;
    input.setSelectionRange(antes.length, antes.length);
    cerrarMencionMenu();
    ajustarAlto();
  }

  // Flechas, Enter/Tab y Esc mientras la lista está abierta. Devuelve true
  // si la tecla era para la lista (y entonces no envía el mensaje).
  function teclaMencion(e) {
    if (mencionMenu.hidden) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = mencionOpciones.length;
      mencionIdx = (mencionIdx + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      pintarMencionMenu();
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); elegirMencion(mencionIdx); return true; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrarMencionMenu(); return true; }
    return false;
  }

  // El clic en la lista no saca el foco del campo.
  mencionLista.addEventListener('mousedown', e => e.preventDefault());
  mencionLista.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (b) elegirMencion(Number(b.dataset.i));
  });
  input.addEventListener('click', revisarMencion);
  input.addEventListener('keyup', e => { if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(e.key)) revisarMencion(); });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) cerrarMencionMenu(); }, 100));

  // Agrega "@Nombre " al final de lo que se está escribiendo.
  function insertarMencion(nombre) {
    if (!abierto) abrir();
    if (!abierto) return;
    let v = input.value.replace(/\s+$/, '');
    if (normalizar(v).includes('@' + normalizar(nombre))) { input.focus(); return; }
    v = (v ? v + ' ' : '') + '@' + nombre + ' ';
    if (v.length > MAX_CARACTERES) return;
    input.value = v;
    ajustarAlto();
    input.focus();
    input.setSelectionRange(v.length, v.length);
  }

  equiposEl.addEventListener('click', e => {
    const b = e.target.closest('[data-mencionar]');
    if (b) insertarMencion(b.dataset.mencionar);
  });

  // --- tarjetas flotantes ---
  let colaMenciones = [];               // menciones sin ver, por orden de llegada
  const tarjetasMencion = new Map();    // id del mensaje → tarjeta en pantalla
  let masMencionesEl = null;

  function haceCuanto(ts) {
    const min = Math.floor((ahoraServidor() - ts) / 60000);
    if (min < 1) return 'recién';
    if (min < 60) return `hace ${min} min`;
    return `hace ${Math.floor(min / 60)} h`;
  }

  function crearTarjetaMencion(m, nueva) {
    const t = document.createElement('div');
    t.className = 'chat-mencion-card' + (nueva ? ' nueva' : '');
    t.dataset.ts = String(m.ts || 0);
    t.setAttribute('role', 'status');
    const aTodos = m.menciones[CLAVE_TODOS] && !m.menciones[claveDe(miNombre)];
    t.innerHTML = `<span class="chat-avatar">${esc(iniciales(m.de) || '?')}</span>
      <div class="chat-mencion-cuerpo">
        <div class="chat-mencion-cabeza">
          <span class="chat-mencion-arroba" aria-hidden="true">@</span>
          <span class="chat-mencion-de"><b>${esc(m.de)}</b> ${aTodos ? 'mencionó a todos' : 'te mencionó'}</span>
          <span class="chat-mencion-hace" data-ts="${m.ts || ''}">${haceCuanto(m.ts || ahoraServidor())}</span>
        </div>
        <div class="chat-mencion-texto">${textoConMenciones(m)}</div>
        <div class="chat-mencion-pie">
          <span>Tocá para cerrar</span>
          <button type="button" class="chat-mencion-responder" tabindex="-1">Responder</button>
        </div>
      </div>`;
    // Nunca toma el foco: el buscador de la caja lo conserva.
    t.addEventListener('mousedown', e => e.preventDefault());
    t.addEventListener('click', e => {
      const responder = !!e.target.closest('.chat-mencion-responder');
      verMencion(m.id);
      if (responder) insertarMencion(m.de);
    });
    return t;
  }

  function sacarTarjeta(el) {
    if (el.classList.contains('cerrando')) return;
    el.classList.add('cerrando');
    setTimeout(() => {
      // Después de desvanecerse se achica, así las de arriba bajan suave.
      el.style.height = el.offsetHeight + 'px';
      void el.offsetHeight;
      el.classList.add('colapsando');
      el.style.height = '0px';
      el.style.marginTop = el.previousElementSibling ? 'calc(-1 * var(--s2))' : '0px';
      setTimeout(() => el.remove(), 220);
    }, 160);
  }

  function pintarMenciones(idNueva) {
    const mostrar = abierto ? [] : colaMenciones.slice(-MENCIONES_VISIBLES);
    const ids = new Set(mostrar.map(m => m.id));
    tarjetasMencion.forEach((el, id) => {
      if (!ids.has(id)) { tarjetasMencion.delete(id); sacarTarjeta(el); }
    });
    mostrar.forEach(m => {
      if (tarjetasMencion.has(m.id)) return;
      const el = crearTarjetaMencion(m, m.id === idNueva);
      tarjetasMencion.set(m.id, el);
      // En orden de llegada: la más nueva queda abajo, cerca del rincón.
      const despues = [...mencionesEl.querySelectorAll('.chat-mencion-card:not(.cerrando)')]
        .find(c => Number(c.dataset.ts) > (m.ts || 0));
      mencionesEl.insertBefore(el, despues || null);
    });
    const resto = abierto ? 0 : colaMenciones.length - mostrar.length;
    if (resto > 0) {
      if (!masMencionesEl) {
        masMencionesEl = document.createElement('button');
        masMencionesEl.type = 'button';
        masMencionesEl.className = 'chat-mencion-mas';
        masMencionesEl.tabIndex = -1;
        masMencionesEl.addEventListener('mousedown', e => e.preventDefault());
        masMencionesEl.addEventListener('click', abrir);
      }
      masMencionesEl.textContent = `+${resto} ${resto === 1 ? 'mención anterior' : 'menciones anteriores'} · ver en el chat`;
      mencionesEl.prepend(masMencionesEl);
    } else if (masMencionesEl) {
      masMencionesEl.remove();
    }
  }

  // Marca la mención como vista en Firebase (el que la mandó ve "✓ Visto").
  // Con transacción: si el mensaje ya se borró, no se crea uno vacío.
  function marcarMencionVista(m) {
    if (!miNombre || !m || !m.id) return;
    const clave = claveDe(miNombre);
    const cuando = ahoraServidor();
    refMensajes.child(m.id).transaction(actual => {
      if (!actual) return;
      actual.vistos = actual.vistos || {};
      if (actual.vistos[clave]) return;
      actual.vistos[clave] = cuando;
      return actual;
    }).catch(() => {});
  }

  function verMencion(id) {
    const m = colaMenciones.find(x => x.id === id);
    colaMenciones = colaMenciones.filter(x => x.id !== id);
    if (m) {
      marcarMencionVista(m);
      if (window.Registro) Registro.anotar('CHAT', `Vio la mención de ${m.de || '—'}`);
    }
    pintarMenciones();
  }

  // Al abrir el panel se ven en la conversación: todas pasan a vistas.
  function verMencionesPendientes() {
    if (!colaMenciones.length) { pintarMenciones(); return; }
    const pendientes = colaMenciones;
    colaMenciones = [];
    pendientes.forEach(m => {
      marcarMencionVista(m);
      if (window.Registro) Registro.anotar('CHAT', `Vio la mención de ${m.de || '—'} (abrió el chat)`);
    });
    pintarMenciones();
  }

  // Al cargar o al cambiar de usuario: las menciones sin ver de quien está ahora.
  function recalcularMenciones() {
    if (cargaInicial) return;
    colaMenciones = mensajes.filter(mencionPendiente);
    pintarMenciones();
  }

  setInterval(() => {
    mencionesEl.querySelectorAll('.chat-mencion-hace[data-ts]').forEach(el => {
      const ts = Number(el.dataset.ts);
      if (ts) el.textContent = haceCuanto(ts);
    });
  }, 30000);

  // ---------------------------------------------------------------- timbre --
  function abrirTimbreMenu() {
    const otros = otrosConectados();
    timbreLista.innerHTML = otros.length ? otros.map(p =>
      `<button type="button" class="chat-timbre-item online" role="menuitem" data-para="${esc(p.nombre)}">
        <span class="chat-punto"></span>
        <span class="chat-timbre-nombre">${esc(p.nombre)}</span>
        <span class="chat-timbre-estado">Tocar timbre</span>
      </button>`
    ).join('') : '<div class="chat-timbre-vacio">No hay otros equipos conectados.</div>';
    timbreMenu.hidden = false;
    timbreBtn.setAttribute('aria-expanded', 'true');
    const primero = timbreLista.querySelector('button');
    if (primero) primero.focus();
  }

  function cerrarTimbreMenu() {
    timbreMenu.hidden = true;
    timbreBtn.setAttribute('aria-expanded', 'false');
  }

  timbreBtn.addEventListener('click', e => {
    e.stopPropagation();
    timbreMenu.hidden ? abrirTimbreMenu() : cerrarTimbreMenu();
  });
  timbreLista.addEventListener('click', e => {
    const b = e.target.closest('[data-para]');
    if (!b || b.disabled) return;
    enviar('Timbre', 'urgente', b.dataset.para);
    cerrarTimbreMenu();
    input.focus();
  });
  document.addEventListener('click', e => {
    if (!timbreMenu.hidden && !timbreMenu.contains(e.target) && e.target !== timbreBtn) cerrarTimbreMenu();
  });

  function renderMensajes() {
    if (!mensajes.length) {
      lista.innerHTML = `<div class="chat-vacio">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z"/></svg>
        Todavía no hay mensajes.<br>Escribí algo para empezar.</div>`;
      return;
    }
    let html = '';
    let diaPrevio = '';
    let autorPrevio = '';
    let tsPrevio = 0;
    mensajes.forEach(m => {
      const ts = m.ts || ahoraServidor();
      const dia = new Date(ts).toDateString();
      if (dia !== diaPrevio) {
        html += `<div class="chat-dia">${esc(etiquetaDia(ts))}</div>`;
        diaPrevio = dia;
        autorPrevio = '';
      }
      const tipo = m.tipo === 'urgente' ? 'urgente' : m.tipo === 'rapido' ? 'rapido' : '';
      // Mensajes seguidos del mismo equipo dentro de 3 min se agrupan.
      const agrupado = !tipo.includes('urgente') && m.de === autorPrevio && ts - tsPrevio < 180000;
      // Los timbres entre otros dos equipos se ven atenuados: quedan de
      // registro pero no son con este equipo.
      const ajeno = tipo === 'urgente' && !esMio(m) && !esParaMi(m);
      const clases = ['chat-msg', esMio(m) ? 'mio' : '', tipo, agrupado ? 'agrupado' : '', ajeno ? 'ajeno' : '',
        esMencionParaMi(m) ? 'para-mi' : ''].join(' ');
      let cuerpo;
      if (tipo === 'urgente') {
        cuerpo = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          <span>${textoTimbre(m)}</span>
          <span class="chat-hora">${horaCorta(ts)}</span>`;
      } else {
        cuerpo = `${tipo === 'rapido' ? '<span class="chat-rayo" aria-hidden="true">⚡</span>' : ''}${textoConMenciones(m)}<span class="chat-hora">${horaCorta(ts)}</span>`;
      }
      html += `<div class="${clases}">
        ${esMio(m) ? '' : `<span class="chat-autor">${esc(m.de)}</span>`}
        <div class="chat-burbuja">${cuerpo}</div>
        ${lineaVistos(m)}
      </div>`;
      autorPrevio = tipo === 'urgente' ? '' : m.de;
      tsPrevio = ts;
    });
    lista.innerHTML = html;
  }

  function textoTimbre(m) {
    const de = esMio(m) ? 'Tocaste timbre' : esc(m.de) + ' tocó timbre';
    if (!m.para) return de + ' a todos';
    const aMi = !esMio(m) && esParaMi(m);
    return de + ' a ' + (aMi ? '<strong>vos</strong>' : esc(m.para));
  }

  function scrollAlFinal() { lista.scrollTop = lista.scrollHeight; }

  // ----------------------------------------------------------- no leídos --
  function noLeidos() {
    return mensajes.filter(m => !esMio(m) && (m.ts || 0) > ultimoLeido && (m.tipo !== 'urgente' || esParaMi(m)));
  }

  function marcarLeido() {
    const ultimo = mensajes.length ? mensajes[mensajes.length - 1].ts || 0 : 0;
    if (ultimo > ultimoLeido) {
      ultimoLeido = ultimo;
      lsSet(LS_LEIDO, String(ultimoLeido));
    }
    actualizarBadge();
  }

  function actualizarBadge() {
    const pend = noLeidos();
    const n = pend.length;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('visible', n > 0);
    badge.classList.toggle('urgente', pend.some(m => m.tipo === 'urgente'));
    navBtn.setAttribute('aria-label', n ? `Mensajes, ${n} sin leer` : 'Mensajes');
    document.title = n ? `(${n}) ${tituloOriginal}` : tituloOriginal;
  }

  // -------------------------------------------------------------- toasts --
  function mostrarToast(m, esSistema) {
    const t = document.createElement('div');
    t.className = 'chat-toast';
    t.setAttribute('role', 'status');
    t.innerHTML = `<span class="chat-avatar">${esc(iniciales(m.de) || '?')}</span>
      <div class="chat-toast-cuerpo">
        <div class="chat-toast-de">${esc(m.de)}</div>
        <div class="chat-toast-texto">${m.tipo === 'rapido' ? '⚡ ' : ''}${esc(m.texto)}</div>
      </div>`;
    if (!esSistema) t.addEventListener('click', () => { quitar(); abrir(); });
    // El clic no debe dejar el foco en el toast: el buscador lo conserva.
    t.addEventListener('mousedown', e => e.preventDefault());
    toasts.appendChild(t);
    const comunes = toasts.querySelectorAll(':scope > .chat-toast');
    if (comunes.length > 3) comunes[0].remove();
    let ido = false;
    function quitar() {
      if (ido) return; ido = true;
      t.classList.add('saliendo');
      setTimeout(() => t.remove(), 180);
    }
    setTimeout(quitar, TOAST_MS);
  }

  // ----------------------------------------------------- llamado urgente --
  function mostrarAlarma(m) {
    $('chatAlarmaDe').textContent = m.de;
    $('chatAlarmaHora').textContent = horaCorta(m.ts || ahoraServidor());
    alarma.classList.add('visible');
    sonarUrgente();
    clearInterval(alarmaTimer);
    let veces = 0;
    // Suena cada 2,5 s durante un minuto como máximo, para no quedar sonando
    // eternamente si el equipo está solo.
    alarmaTimer = setInterval(() => {
      if (++veces >= 24) { clearInterval(alarmaTimer); return; }
      sonarUrgente();
    }, 2500);
  }

  function cerrarAlarma() {
    clearInterval(alarmaTimer);
    alarma.classList.remove('visible');
    marcarLeido();
    if (abierto) input.focus(); else devolverFocoAlBuscador();
  }

  $('chatAlarmaOk').addEventListener('click', cerrarAlarma);
  $('chatAlarmaVoy').addEventListener('click', () => {
    if (miNombre) enviar('Voy', 'rapido');
    cerrarAlarma();
  });

  // ---------------------------------------------------------- llegada --
  function alLlegar(m) {
    if (cargaInicial || esMio(m)) return;
    const mencion = esMencionParaMi(m);
    if (window.Registro && (!m.para || esParaMi(m))) {
      Registro.anotar('CHAT', `Recibió ${m.tipo === 'urgente' ? 'un TIMBRE' : mencion ? 'una MENCIÓN' : 'un mensaje'} de ${m.de || '—'}`);
    }
    const reciente = !m.ts || ahoraServidor() - m.ts < URGENTE_VIGENCIA_MS;
    if (m.tipo === 'urgente') {
      if (reciente && esParaMi(m)) mostrarAlarma(m);
      return;
    }
    const visible = abierto && document.visibilityState === 'visible';
    if (mencion) {
      sonarMencion();
      if (visible) { marcarLeido(); marcarMencionVista(m); return; }
      colaMenciones.push(m);
      pintarMenciones(m.id);
      return;
    }
    if (visible) { marcarLeido(); sonarMensaje(); return; }
    sonarMensaje();
    if (!abierto) mostrarToast(m);
  }

  // Al volver a la pestaña con el panel abierto, lo nuevo pasa a leído.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && abierto) { marcarLeido(); verMencionesPendientes(); }
  });

  // Un timbre que llegó mientras se cambiaba de pantalla (caja ↔ historial)
  // entra con la carga inicial, que no suena. Si es para este equipo, no se
  // atendió todavía y sigue vigente, se muestra igual.
  function sonarTimbrePendiente() {
    const pendientes = mensajes.filter(m => m.tipo === 'urgente' && !esMio(m) && esParaMi(m) &&
      (m.ts || 0) > ultimoLeido && ahoraServidor() - (m.ts || 0) < URGENTE_VIGENCIA_MS);
    if (pendientes.length) mostrarAlarma(pendientes[pendientes.length - 1]);
  }

  // ------------------------------------------------------------- arranque --
  // Sólo trae los mensajes vencidos (los que va a borrar), y cada equipo lo
  // hace como mucho una vez cada 12 h para no consultar Firebase de más.
  function limpiarViejos() {
    const ultima = Number(lsGet(LS_LIMPIEZA)) || 0;
    if (Date.now() - ultima < 12 * 3600000) return;
    lsSet(LS_LIMPIEZA, String(Date.now()));
    const corte = prefijoPushDe(ahoraServidor() - DIAS_RETENCION * 86400000);
    refMensajes.orderByKey().endAt(corte).limitToFirst(200).once('value').then(snap => {
      const borrar = {};
      snap.forEach(c => { borrar[c.key] = null; });
      if (Object.keys(borrar).length) return refMensajes.update(borrar);
    }).catch(() => {});
  }

  function iniciar() {
    if (iniciado) return;
    iniciado = true;


    db.ref('.info/serverTimeOffset').on('value', s => { offsetServidor = s.val() || 0; });

    // Al reconectar (corte de internet), se vuelve a anotar la conexión.
    db.ref('.info/connected').on('value', s => { if (s.val() === true) conectarPresencia(); });

    refPresencia.on('value', snap => {
      presencias = snap.val() || {};
      revisarExpulsion();
      asegurarMiConexion();
      renderEquipos();
      limpiarPresencia();
    });

    const consulta = refMensajes.limitToLast(MAX_MENSAJES);
    consulta.on('child_added', snap => {
      const m = Object.assign({ id: snap.key }, snap.val());
      mensajes.push(m);
      if (mensajes.length > MAX_MENSAJES) mensajes.shift();
      if (!cargaInicial) {
        const cerca = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 120;
        renderMensajes();
        if (cerca || esMio(m)) scrollAlFinal();
        actualizarBadge();
      }
      alLlegar(m);
    });
    // El ts del servidor llega después en los mensajes propios: se actualiza.
    consulta.on('child_changed', snap => {
      const i = mensajes.findIndex(x => x.id === snap.key);
      if (i >= 0) { mensajes[i] = Object.assign({ id: snap.key }, snap.val()); renderMensajes(); }
      // Vista desde otra pantalla o PC con el mismo usuario: se va también acá.
      if (colaMenciones.some(x => x.id === snap.key)) {
        colaMenciones = colaMenciones.map(x => x.id === snap.key ? mensajes[i] || x : x).filter(mencionPendiente);
        pintarMenciones();
      }
    });
    consulta.on('child_removed', snap => {
      mensajes = mensajes.filter(x => x.id !== snap.key);
      colaMenciones = colaMenciones.filter(x => x.id !== snap.key);
      pintarMenciones();
      renderMensajes();
      actualizarBadge();
    });
    // 'value' llega después de todos los child_added iniciales: recién ahí
    // termina la carga del historial y lo que siga es nuevo.
    consulta.once('value').then(() => {
      cargaInicial = false;
      renderMensajes();
      scrollAlFinal();
      actualizarBadge();
      limpiarViejos();
      sonarTimbrePendiente();
      recalcularMenciones();
    });

    // Con selector, el nombre lo pide usuarioActivo.js al entrar.
    if (!miNombre && !conSelector) setTimeout(pedirNombre, 600);
  }

  // Al irse (o al pasar a la otra pantalla) se retira la conexión y se anota
  // la hora en la misma escritura: con eso los demás aplican la gracia.
  // pagehide y no beforeunload: la caja puede cancelar la salida mientras
  // guarda un pedido, y entonces el equipo tiene que seguir conectado.
  window.addEventListener('pagehide', () => {
    saliendo = true;
    if (!miConexionRef || !miNombre) return;
    refPresencia.child(claveDe(miNombre)).update({
      ['conexiones/' + miConexionRef.key]: null,
      ultimaVez: firebase.database.ServerValue.TIMESTAMP
    });
  });

  renderMensajes();
  firebase.auth().onAuthStateChanged(user => { if (user) iniciar(); });
})();
