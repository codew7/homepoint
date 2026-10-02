// === MENSAJERÍA INTERNA ENTRE EQUIPOS ===
// Canal general en Firebase RTDB, con presencia de equipos, mensajes rápidos y
// llamado urgente. Usa el `db` global que inicializa ingresoPedidoV2.html.
//
// Datos:
//   chat/mensajes/{pushId}          { de, texto, tipo: 'texto'|'rapido'|'urgente', ts, para? }
//     (`para` = nombre del equipo al que va el timbre; sólo en los 'urgente')
//   chat/presencia/{clave}          { nombre, ultimaVez, conexiones: { {pushId}: true } }
//
// Regla de oro: el chat nunca roba el foco del buscador (#searchInput), que es
// donde escribe la pistola. Sólo toma el foco cuando la persona abre el panel.
(function() {
  'use strict';

  const MAX_MENSAJES = 100;
  const DIAS_RETENCION = 7;
  const URGENTE_VIGENCIA_MS = 2 * 60 * 1000; // un llamado más viejo que esto ya no suena
  const TOAST_MS = 5000;
  const LS_NOMBRE = 'chatEquipoNombre';
  const LS_LEIDO = 'chatUltimoLeido';
  const LS_SONIDO = 'chatSonido';
  const LS_LIMPIEZA = 'chatUltimaLimpieza';
  const MAX_CARACTERES = 100;

  const refMensajes = db.ref('chat/mensajes');
  const refPresencia = db.ref('chat/presencia');

  let miNombre = lsGet(LS_NOMBRE) || '';
  let miConexionRef = null;
  let ultimoLeido = Number(lsGet(LS_LEIDO)) || 0;
  let offsetServidor = 0;
  let cargaInicial = true;
  let iniciado = false;
  let presencias = {};
  let mensajes = [];          // [{ id, de, texto, tipo, ts }] en orden
  let abierto = false;
  let alarmaTimer = null;
  let tituloOriginal = document.title;
  let sonidoActivo = lsGet(LS_SONIDO) !== 'off';

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
    const s = document.getElementById('searchInput');
    if (s && document.getElementById('mainContainer').style.display !== 'none') s.focus();
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
        <button type="button" id="chatYo" class="chat-yo" title="Cambiar el nombre de este equipo">
          Este equipo: <strong id="chatYoNombre"></strong>
          <svg class="chat-yo-editar" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <div id="chatEquipos" class="chat-equipos" aria-label="Equipos"></div>
      </header>

      <div id="chatLista" class="chat-lista" aria-live="polite"></div>

      <footer class="chat-pie">
        <div id="chatTimbreMenu" class="chat-timbre-menu" role="menu" aria-label="Elegí a quién llamar" hidden>
          <div class="chat-timbre-titulo">¿A quién llamás?</div>
          <div id="chatTimbreLista" class="chat-timbre-lista"></div>
        </div>
        <div class="chat-compose">
          <button type="button" id="chatUrgenteBtn" class="chat-btn-circ chat-urgente-btn" title="Tocar timbre a un equipo" aria-label="Tocar timbre a un equipo" aria-haspopup="menu" aria-expanded="false">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          </button>
          <textarea id="chatInput" class="chat-input" rows="1" maxlength="${MAX_CARACTERES}" placeholder="Escribí un mensaje…" aria-label="Mensaje"></textarea>
          <button type="button" id="chatEnviarBtn" class="chat-btn-circ chat-enviar" title="Enviar (Enter)" aria-label="Enviar" disabled>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </button>
        </div>
      </footer>
    </aside>

    <div id="chatToasts" class="chat-toasts" aria-live="polite"></div>

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
    scrollAlFinal();
    setTimeout(() => input.focus(), 120);
  }

  function cerrar() {
    if (!abierto) return;
    abierto = false;
    cerrarTimbreMenu();
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
    if (otro && !esMio && otro.conexiones) {
      return errorNombre('"' + otro.nombre + '" ya está conectado en otro equipo. Elegí otro nombre.');
    }
    const anterior = miNombre;
    miNombre = nombre;
    lsSet(LS_NOMBRE, nombre);
    $('chatYoNombre').textContent = nombre;
    if (anterior !== nombre) {
      conectarPresencia();
      // Si el nombre viejo quedó sin pestañas abiertas, se borra de la lista
      // para que no figure para siempre como un equipo desconectado.
      if (anterior && claveDe(anterior) !== clave) {
        const viejo = refPresencia.child(claveDe(anterior));
        viejo.child('conexiones').once('value').then(s => { if (!s.exists()) viejo.remove(); });
      }
    }
    nombreOverlay.style.display = 'none';
    abrir();
  }

  function errorNombre(msg) {
    nombreError.textContent = msg;
    nombreError.style.display = 'block';
  }

  $('chatYo').addEventListener('click', pedirNombre);
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
      miConexionRef.onDisconnect().cancel();
      miConexionRef.remove();
      miConexionRef = null;
    }
    if (!miNombre) return;
    const ref = refPresencia.child(claveDe(miNombre));
    miConexionRef = ref.child('conexiones').push();
    ref.child('ultimaVez').onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);
    miConexionRef.onDisconnect().remove();
    miConexionRef.set(true);
    ref.update({ nombre: miNombre, ultimaVez: firebase.database.ServerValue.TIMESTAMP });
  }

  // Los otros equipos conectados ahora mismo. Este equipo no figura: ya se
  // muestra en "Este equipo".
  function otrosConectados() {
    return Object.keys(presencias).map(k => presencias[k])
      .filter(p => p && p.nombre && p.conexiones && claveDe(p.nombre) !== claveDe(miNombre))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  function renderEquipos() {
    equiposEl.innerHTML = otrosConectados().map(p =>
      `<span class="chat-equipo online" title="Conectado"><span class="chat-punto"></span>${esc(p.nombre)}</span>`
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

  input.addEventListener('input', ajustarAlto);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarDesdeInput(); }
  });
  enviarBtn.addEventListener('click', enviarDesdeInput);

  function esMio(m) { return miNombre && m.de === miNombre; }

  // Un timbre es para mí si me nombra; los viejos sin `para` eran para todos.
  function esParaMi(m) {
    return !m.para || (miNombre && claveDe(m.para) === claveDe(miNombre));
  }

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
      const clases = ['chat-msg', esMio(m) ? 'mio' : '', tipo, agrupado ? 'agrupado' : '', ajeno ? 'ajeno' : ''].join(' ');
      let cuerpo;
      if (tipo === 'urgente') {
        cuerpo = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          <span>${textoTimbre(m)}</span>
          <span class="chat-hora">${horaCorta(ts)}</span>`;
      } else {
        cuerpo = `${tipo === 'rapido' ? '<span class="chat-rayo" aria-hidden="true">⚡</span>' : ''}${esc(m.texto)}<span class="chat-hora">${horaCorta(ts)}</span>`;
      }
      html += `<div class="${clases}">
        ${esMio(m) ? '' : `<span class="chat-autor">${esc(m.de)}</span>`}
        <div class="chat-burbuja">${cuerpo}</div>
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
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
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
    const reciente = !m.ts || ahoraServidor() - m.ts < URGENTE_VIGENCIA_MS;
    if (m.tipo === 'urgente') {
      if (reciente && esParaMi(m)) mostrarAlarma(m);
      return;
    }
    const visible = abierto && document.visibilityState === 'visible';
    if (visible) { marcarLeido(); sonarMensaje(); return; }
    sonarMensaje();
    if (!abierto) mostrarToast(m);
  }

  // Al volver a la pestaña con el panel abierto, lo nuevo pasa a leído.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && abierto) marcarLeido();
  });

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

    $('chatYoNombre').textContent = miNombre || '—';

    db.ref('.info/serverTimeOffset').on('value', s => { offsetServidor = s.val() || 0; });

    // Al reconectar (corte de internet), se vuelve a anotar la conexión.
    db.ref('.info/connected').on('value', s => { if (s.val() === true) conectarPresencia(); });

    refPresencia.on('value', snap => {
      presencias = snap.val() || {};
      renderEquipos();
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
    });
    consulta.on('child_removed', snap => {
      mensajes = mensajes.filter(x => x.id !== snap.key);
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
    });

    if (!miNombre) setTimeout(pedirNombre, 600);
  }

  window.addEventListener('beforeunload', () => {
    if (miConexionRef) miConexionRef.remove();
  });

  renderMensajes();
  firebase.auth().onAuthStateChanged(user => { if (user) iniciar(); });
})();
