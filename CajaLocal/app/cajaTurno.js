// === CAJA: TURNOS Y CIERRE DE EFECTIVO ===
// Cada cajón de plata es una "caja" (Caja 1, Caja 2…) de la base del punto
// de venta. Un equipo que cobra se marca una vez como esa caja (lo hacen
// Alejandro o Javier desde el botón Caja del encabezado). Los equipos sin marcar sólo
// ingresan pedidos y no tocan nada de esto.
//
// Turno: se abre contando el cambio inicial y se cierra contando la plata
// "a ciegas": el cajero no ve cuánto debería haber hasta que guarda su
// conteo. La caja es de quienes la atienden: el cierre dice si falta o sobra;
// cada movimiento igual queda con el nombre de quien lo hizo.
//
// Firebase (lo mínimo, sin totales guardados que se puedan desfasar):
//   cajas/{cajaId}            = { nombre, turno?, ultimo? }   turno = id del turno abierto
//   cajaTurnos/{turnoId}      = { caja, cajaNombre, abiertoPor, abiertoTs, fondo,
//                                 cerradoPor?, cerradoTs?, contado?, esperado?, diferencia?, nota?, billetes? }
//   cajaTurnos/{turnoId}/movs = { t: venta|devolucion|retiro|ingreso, monto, pedido?, motivo?, por, ts }
//   cajaPendientes/{pedidoId} = { efectivo, cliente, vendedor, ts }
//     "Por cobrar": pedido en efectivo cargado en un puesto de sólo ingreso.
//     La caja escucha este nodo (fichas chicas, no los pedidos enteros) y al
//     cobrar, en un solo update: pedido.cobro, borra la ficha y suma al turno.
// En el pedido: cobro = { pendiente: true } o { caja, turno, por, ts, efectivo }.
// Lo esperado = fondo + suma de los movimientos. Un turno cerrado no se
// puede modificar (database.rules.*.json). El equipo escucha sólo su propio
// nodo cajas/{cajaId}: unos pocos bytes.
//
// La venta en efectivo la suma ingresoPedidoV2.js en el mismo guardado
// atómico del pedido (CajaTurno.registrarCobro): o se guardan los dos o
// ninguno.
//
// Va después de usuarioActivo.js y antes de ingresoPedidoV2.js.
(function() {
  'use strict';

  const PUNTO_VENTA = window.PuntoVenta ? PuntoVenta.actual() : null;
  const SUFIJO_PV = PUNTO_VENTA && PUNTO_VENTA !== '1' ? '_' + PUNTO_VENTA : '';
  // Caja que cobra este equipo (vacío = sólo ingresa pedidos).
  const LS_PUESTO = 'hpCajaPuesto' + SUFIJO_PV;
  const BILLETES = [20000, 10000, 2000, 1000, 500, 200, 100];

  const ICONO_CAJA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="10" width="18" height="10" rx="2"/><path d="M7 10V6.5A1.5 1.5 0 0 1 8.5 5h7A1.5 1.5 0 0 1 17 6.5V10"/><path d="M3 14h18"/><path d="M10.5 17h3"/></svg>';

  // ------------------------------------------------------------- helpers --
  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function pesos(n) {
    const v = Math.round(Number(n) || 0);
    return (v < 0 ? '−$ ' : '$ ') + Math.abs(v).toLocaleString('es-AR');
  }
  function leerMonto(texto) { return parseInt(String(texto || '').replace(/\D/g, ''), 10) || 0; }
  function hora(ts) {
    return ts ? new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
  }
  function fechaHora(ts) {
    return ts ? new Date(ts).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  }
  function usuario() { return window.UsuarioActivo ? UsuarioActivo.actual() : ''; }
  function esAdmin() { return typeof window.esUsuarioAdmin === 'function' && window.esUsuarioAdmin(usuario()); }
  // Marcar o cambiar el puesto de cobro de un equipo: sólo Alejandro y Javier.
  const CONFIGURAN_PUESTO = ['alejandro', 'javier'];
  // "Otro" (usuario genérico, usuarioActivo.js): vende, pero no opera la caja.
  function usuarioGenerico() {
    return !!(window.UsuarioActivo && typeof UsuarioActivo.esGenerico === 'function' && UsuarioActivo.esGenerico(usuario()));
  }
  function puedeConfigurar() { return CONFIGURAN_PUESTO.includes(String(usuario() || '').trim().toLowerCase()); }
  function hayFirebase() { return typeof firebase !== 'undefined' && !!firebase.apps && firebase.apps.length > 0; }
  function db() { return firebase.database(); }
  function reg(texto) { if (window.Registro) window.Registro.anotar('CAJA', texto); }
  function conLimite(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Sin respuesta de internet')), ms))]);
  }

  // Formato de miles mientras se escribe un importe.
  function formatearAlEscribir(input) {
    input.addEventListener('input', () => {
      const n = leerMonto(input.value);
      input.value = n ? n.toLocaleString('es-AR') : '';
    });
  }

  // Efectivo que entra (o sale, si es negativo) con un pedido.
  function efectivoDe(pagos) {
    if (!pagos) return 0;
    if (pagos.medioPago === 'Efectivo') return Math.round(Number(pagos.totalFinal) || 0);
    if (pagos.medioPago === 'Parcial' && Array.isArray(pagos.desglose)) {
      return pagos.desglose.reduce((s, p) => s + (p && p.medio === 'Efectivo' ? Math.round(Number(p.monto) || 0) : 0), 0);
    }
    return 0;
  }

  // Modo WhatsApp (usuarioActivo.js): esos pedidos se pagan con el envío, no
  // en el cajón, así que no pasan por la caja.
  function modoWhatsapp() { try { return sessionStorage.getItem('hpModoWhatsapp') === '1'; } catch (_) { return false; } }

  // --------------------------------------------------------------- estado --
  let cajaId = lsGet(LS_PUESTO) || '';
  let caja = null;          // último valor de cajas/{cajaId}
  let refCaja = null;
  // ¿Hay alguna caja en esta sucursal? Sin cajas, nada queda "por cobrar".
  let hayCajas = null;
  // Por cobrar: cajaPendientes/{pedidoId} = { efectivo, cliente, vendedor, ts }.
  // Fichas chicas que deja el puesto de sólo ingreso; la caja las escucha.
  let pendientes = {};
  let refPend = null;
  let avisoPend = '';

  // Se recuerda en la PC: sin internet (modo Offline) no se puede preguntar.
  const LS_HAY_CAJAS = 'hpHayCajas' + SUFIJO_PV;
  if (lsGet(LS_HAY_CAJAS) === '1') hayCajas = true;

  function cargarHayCajas() {
    if (!hayFirebase()) return;
    db().ref('cajas').once('value')
      .then(s => {
        hayCajas = s.exists();
        if (hayCajas) lsSet(LS_HAY_CAJAS, '1'); else lsDel(LS_HAY_CAJAS);
      })
      .catch(err => console.warn('Cajas no disponibles:', err));
  }

  // Tipo de cada ficha de "Por cobrar":
  //   cobro      pedido cargado en un puesto de sólo ingreso (el cliente paga acá)
  //   offline    venta en efectivo hecha sin internet: la plata ya está en el cajón
  //   ajuste     se editó un pedido ya cobrado y cambió el efectivo
  //   anulacion  se canceló un pedido ya cobrado: hay que devolver la plata
  const TIPOS_FICHA = {
    cobro: 'Por cobrar',
    offline: 'Venta sin conexión',
    ajuste: 'Diferencia por edición',
    anulacion: 'Pedido cancelado'
  };
  function tipoFicha(f) { return (f && TIPOS_FICHA[f.tipo]) ? f.tipo : 'cobro'; }

  function ficha(tipo, efectivo, pedidoObj, ts) {
    const f = {
      efectivo,
      cliente: String((pedidoObj.cliente && pedidoObj.cliente.nombre) || '').slice(0, 50),
      vendedor: String(pedidoObj.vendedor || '').slice(0, 30),
      ts: ts || Date.now()
    };
    if (tipo !== 'cobro') f.tipo = tipo;
    return f;
  }

  // Turno abierto desde otro día: alguien se olvidó de cerrarlo.
  function mismoDia(ts) {
    if (!ts) return true;
    const a = new Date(ts), b = new Date();
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }
  function turnoViejo() { return !!(caja && caja.turno && caja.desde && !mismoDia(caja.desde)); }

  function alCambiarPendientes(snap) {
    pendientes = {};
    snap.forEach(ch => {
      const v = ch.val();
      if (v && Number(v.efectivo)) pendientes[ch.key] = v;
    });
    pintarBoton();
    // Con la lista abierta, se repinta sola.
    if (dlg && !dlg.hidden && dlg.dataset.paso === 'pendientes') pasoPendientes();
  }

  function escucharPendientes() {
    if (refPend) { refPend.off('value', alCambiarPendientes); refPend = null; }
    pendientes = {};
    if (!cajaId || !hayFirebase()) return;
    refPend = db().ref('cajaPendientes');
    refPend.on('value', alCambiarPendientes, err => console.warn('Por cobrar no disponible:', err));
  }
  function cantidadPendientes() { return Object.keys(pendientes).length; }

  function alCambiarCaja(snap) {
    caja = snap.val();
    if (!caja) {
      // La caja se borró desde otro lado: el equipo vuelve a sólo ingresar.
      console.warn('Caja: la caja de este equipo ya no existe.');
    }
    pintarBoton();
  }

  function escucharCaja() {
    if (refCaja) { refCaja.off('value', alCambiarCaja); refCaja = null; }
    caja = null;
    if (!cajaId || !hayFirebase()) { pintarBoton(); return; }
    refCaja = db().ref('cajas/' + cajaId);
    refCaja.on('value', alCambiarCaja, err => console.warn('Caja no disponible:', err));
  }

  // ------------------------------------------------------ botón del header --
  let boton = null;

  function pintarBoton() {
    boton = boton || document.getElementById('cajaNavBtn');
    if (!boton) return;
    const texto = boton.querySelector('.caja-nav-texto');
    const badge = boton.querySelector('.caja-nav-badge');
    const n = cajaId ? cantidadPendientes() : 0;
    if (badge) {
      badge.textContent = String(n);
      badge.hidden = !n;
    }
    boton.classList.toggle('caja-nav-con-pendientes', n > 0);
    if (cajaId) {
      const abierta = !!(caja && caja.turno);
      const viejo = turnoViejo();
      boton.hidden = false;
      boton.dataset.estado = viejo ? 'vieja' : abierta ? 'abierta' : 'cerrada';
      texto.textContent = (caja && caja.nombre) || 'Caja';
      boton.title = ((caja && caja.nombre) || 'Caja') +
        (viejo ? ' · el turno quedó abierto desde otro día: cerralo' : abierta ? ' · turno abierto' : ' · sin turno abierto') +
        (n ? ` · ${n} por cobrar` : '');
    } else {
      // Sin caja asignada sólo lo ven Alejandro y Javier, para configurar el equipo.
      boton.hidden = !puedeConfigurar();
      boton.dataset.estado = 'sin';
      texto.textContent = 'Caja';
      boton.title = 'Este equipo no cobra. Tocá para marcarlo como puesto de cobro.';
    }
  }

  // --------------------------------------------------------------- ventana --
  let dlg = null, alCerrarDlg = null;

  function construirDlg() {
    dlg = document.createElement('div');
    dlg.id = 'cajaDlg';
    dlg.className = 'usr-clave caja-dlg';
    dlg.hidden = true;
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', 'cajaDlgTitulo');
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target === dlg && !dlg.dataset.ocupado) cerrarDlg(null); });
    dlg.addEventListener('keydown', e => {
      // La caja captura teclas (pistola, Tab al buscador): acá no llegan.
      e.stopPropagation();
      if (e.key === 'Escape' && !dlg.dataset.ocupado) { e.preventDefault(); cerrarDlg(null); return; }
      if (e.key === 'Tab') {
        const focos = Array.from(dlg.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea'));
        if (!focos.length) return;
        const i = focos.indexOf(document.activeElement);
        const sig = e.shiftKey ? (i <= 0 ? focos.length - 1 : i - 1) : (i === focos.length - 1 ? 0 : i + 1);
        e.preventDefault();
        focos[sig].focus();
      }
    });
  }

  // Pinta un paso. alCerrar recibe el resultado al cerrar la ventana.
  function mostrar(html, foco, alCerrar) {
    if (!dlg) construirDlg();
    if (alCerrar !== undefined) alCerrarDlg = alCerrar;
    dlg.innerHTML = html;
    delete dlg.dataset.ocupado;
    delete dlg.dataset.paso;
    dlg.hidden = false;
    setTimeout(() => {
      const f = foco ? dlg.querySelector(foco) : dlg.querySelector('input, button');
      if (f) f.focus();
    }, 60);
  }

  function cerrarDlg(resultado) {
    if (!dlg || dlg.hidden) return;
    dlg.hidden = true;
    dlg.innerHTML = '';
    const cb = alCerrarDlg;
    alCerrarDlg = null;
    if (cb) cb(resultado);
    const s = document.querySelector('[data-foco-principal]');
    if (s && !s.disabled) s.focus();
  }

  function ocupado(si, btn, texto) {
    if (si) dlg.dataset.ocupado = '1'; else delete dlg.dataset.ocupado;
    dlg.querySelectorAll('button, input, textarea').forEach(el => { el.disabled = !!si; });
    if (btn && texto) btn.textContent = texto;
  }

  function error(texto) {
    const el = dlg.querySelector('.usr-clave-error');
    if (el) el.textContent = texto;
  }

  function cabecera(titulo, sub) {
    return `
      <span class="usr-avatar usr-clave-avatar" style="--tono:#1f9d86" aria-hidden="true">${ICONO_CAJA}</span>
      <h2 id="cajaDlgTitulo" class="usr-clave-titulo">${esc(titulo)}</h2>
      ${sub ? `<p class="usr-clave-sub">${sub}</p>` : ''}`;
  }

  function nombreCaja() { return (caja && caja.nombre) || 'Caja'; }

  // Lectura fresca de la caja (no se confía en el listener para cobrar).
  async function leerCaja() {
    const snap = await conLimite(db().ref('cajas/' + cajaId).once('value'), 8000);
    caja = snap.val();
    pintarBoton();
    return caja;
  }

  async function leerTurno(turnoId) {
    const snap = await conLimite(db().ref('cajaTurnos/' + turnoId).once('value'), 8000);
    return snap.val();
  }

  function movsDe(turno) {
    return Object.values((turno && turno.movs) || {}).filter(Boolean).sort((a, b) => (a.ts || 0) - (b.ts || 0));
  }
  function esperadoDe(turno) {
    return Math.round((Number(turno && turno.fondo) || 0) + movsDe(turno).reduce((s, m) => s + (Number(m.monto) || 0), 0));
  }

  // ---------------------------------------------------------------- panel --
  async function abrirPanel() {
    if (!hayFirebase()) return;
    if (usuarioGenerico()) { pasoGenerico(); return; }
    if (!cajaId) { if (puedeConfigurar()) pasoConfig(); return; }
    mostrar(`<div class="usr-clave-card caja-card">${cabecera(nombreCaja(), 'Cargando…')}</div>`, null, null);
    let turno = null;
    try {
      await leerCaja();
      if (!caja) {
        mostrar(`<div class="usr-clave-card caja-card">${cabecera('Caja', 'La caja de este equipo ya no existe. Alejandro o Javier tienen que volver a configurarla.')}
          ${pieAcciones('')}</div>`);
        conectarPie();
        return;
      }
      if (caja.turno) turno = await leerTurno(caja.turno);
    } catch (err) {
      mostrar(`<div class="usr-clave-card caja-card">${cabecera(nombreCaja(), 'No se pudo leer la caja. Revisá internet e intentá de nuevo.')}
        ${pieAcciones('')}</div>`);
      conectarPie();
      return;
    }
    if (caja.turno && turno) pasoTurnoAbierto(turno);
    else pasoSinTurno();
  }

  // Arriba de todo en el panel: lo que dejaron los puestos de sólo ingreso.
  function botonPendientes() {
    const n = cantidadPendientes();
    if (!n) return '';
    return `<button type="button" class="caja-pend-btn" data-accion="pendientes">
        <span>Por cobrar</span><span class="caja-pend-n">${n}</span>
      </button>`;
  }
  function conectarPendientes() {
    const b = dlg.querySelector('[data-accion="pendientes"]');
    if (b) b.addEventListener('click', pasoPendientes);
  }

  // El usuario genérico no abre ni cierra turnos, no cobra "Por cobrar" ni
  // saca o ingresa efectivo: nada de eso puede quedar a nombre de "Otro".
  function pasoGenerico() {
    const quien = usuario() || 'Otro';
    mostrar(`
      <div class="usr-clave-card caja-card">
        ${cabecera(nombreCaja(), `<strong>${esc(quien)}</strong> es un usuario genérico: puede vender, pero no puede operar la caja (abrir o cerrar el turno, cobrar lo pendiente, sacar o ingresar efectivo).`)}
        <p class="caja-ayuda">Para usar la caja, elegí tu propio usuario.</p>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="cerrar">Cerrar</button>
          <button type="button" class="usr-clave-btn caja-btn-pri" data-accion="usuario">Cambiar de usuario</button>
        </div>
      </div>`, '[data-accion="usuario"]', null);
    reg(`${quien} intentó abrir la caja (usuario genérico: no permitido)`);
    dlg.querySelector('[data-accion="cerrar"]').addEventListener('click', () => cerrarDlg(null));
    dlg.querySelector('[data-accion="usuario"]').addEventListener('click', () => {
      cerrarDlg(null);
      const chip = document.getElementById('usuarioActualBtn');
      if (chip) chip.click();
    });
  }

  function pieAcciones(extra) {
    return `
      <div class="caja-pie">
        ${extra}
        <button type="button" class="caja-enlace" data-accion="cerrar">Cerrar</button>
        ${puedeConfigurar() ? '<button type="button" class="caja-enlace" data-accion="config">Configurar puesto</button>' : ''}
      </div>`;
  }
  function conectarPie() {
    dlg.querySelectorAll('[data-accion="cerrar"]').forEach(b => b.addEventListener('click', () => cerrarDlg(null)));
    dlg.querySelectorAll('[data-accion="config"]').forEach(b => b.addEventListener('click', pasoConfig));
  }

  function pasoSinTurno() {
    const u = caja && caja.ultimo;
    const ultimo = u
      ? `<div class="caja-ultimo">Último cierre: ${esc(fechaHora(u.ts))} · ${esc(u.por || '')}<br>
           Contado ${pesos(u.contado)} · <span class="${difClase(u.diferencia)}">${textoDif(u.diferencia)}</span></div>`
      : '';
    mostrar(`
      <div class="usr-clave-card caja-card">
        ${cabecera(nombreCaja(), 'No hay un turno abierto. Para cobrar en efectivo hay que abrir uno contando el cambio.')}
        ${botonPendientes()}
        ${ultimo}
        ${cierrePendienteHtml()}
        <div class="usr-clave-error" role="alert"></div>
        <button type="button" class="usr-clave-btn caja-btn-pri caja-btn-ancho" data-accion="abrir">Abrir turno</button>
        ${pieAcciones('')}
      </div>`, '[data-accion="abrir"]', null);
    dlg.querySelector('[data-accion="abrir"]').addEventListener('click', () => pasoAbrir(null));
    conectarCierrePendiente();
    conectarPendientes();
    conectarPie();
  }

  function pasoTurnoAbierto(turno) {
    const movs = movsDe(turno);
    const ventas = movs.filter(m => m.t === 'venta').length;
    const devoluciones = movs.filter(m => m.t === 'devolucion').length;
    const manuales = movs.filter(m => m.t === 'retiro' || m.t === 'ingreso');
    const lista = manuales.length
      ? `<ul class="caja-movs">${manuales.map(m => `
          <li><span class="caja-mov-hora">${esc(hora(m.ts))}</span>
            <span class="caja-mov-det">${m.t === 'retiro' ? 'Sacó' : 'Ingresó'} · ${esc(m.motivo || '')} · ${esc(m.por || '')}</span>
            <span class="caja-mov-monto ${m.monto < 0 ? 'neg' : 'pos'}">${pesos(m.monto)}</span></li>`).join('')}</ul>`
      : '';
    // Las ventas se cuentan, no se suman: el cierre es a ciegas.
    const resumen = `${ventas} ${ventas === 1 ? 'venta' : 'ventas'} en efectivo` +
      (devoluciones ? ` · ${devoluciones} ${devoluciones === 1 ? 'devolución' : 'devoluciones'}` : '');
    mostrar(`
      <div class="usr-clave-card caja-card">
        ${cabecera(nombreCaja(), `Turno abierto por <strong>${esc(turno.abiertoPor || '')}</strong> ${mismoDia(turno.abiertoTs) ? 'a las ' + esc(hora(turno.abiertoTs)) : 'el ' + esc(fechaHora(turno.abiertoTs))}`)}
        ${mismoDia(turno.abiertoTs) ? '' : `<p class="caja-aviso-viejo" role="alert">Este turno quedó abierto desde otro día. Cerralo contando la plata y abrí uno nuevo para hoy.</p>`}
        ${botonPendientes()}
        <div class="caja-resumen">${resumen}</div>
        ${lista}
        <div class="caja-acciones-3">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="retiro">Sacar efectivo</button>
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="ingreso">Ingresar efectivo</button>
        </div>
        <button type="button" class="usr-clave-btn caja-btn-pri caja-btn-ancho" data-accion="cerrarTurno">Cerrar turno y contar</button>
        ${pieAcciones('')}
      </div>`, '[data-accion="cerrarTurno"]', null);
    dlg.querySelector('[data-accion="retiro"]').addEventListener('click', () => pasoMovimiento('retiro'));
    dlg.querySelector('[data-accion="ingreso"]').addEventListener('click', () => pasoMovimiento('ingreso'));
    dlg.querySelector('[data-accion="cerrarTurno"]').addEventListener('click', () => pasoCerrar(turno));
    conectarPendientes();
    conectarPie();
  }

  // ------------------------------------------------------------ por cobrar --
  // Pedidos en efectivo cargados en un puesto de sólo ingreso: el cliente
  // paga acá. Recién al confirmar entran al turno abierto de esta caja.
  function ticketCorto(id) { return String(id || '').slice(-8).toUpperCase(); }

  function pasoPendientes() {
    const ids = Object.keys(pendientes).sort((a, b) => (pendientes[a].ts || 0) - (pendientes[b].ts || 0));
    const aviso = avisoPend;
    avisoPend = '';
    mostrar(`
      <div class="usr-clave-card caja-card">
        ${cabecera('Por cobrar · ' + nombreCaja(), ids.length
          ? 'Pedidos en efectivo cargados en otros puestos. Tocá el del cliente que vino a pagar.'
          : 'No hay nada por cobrar.')}
        ${aviso ? `<p class="caja-aviso-ok" role="status">${esc(aviso)}</p>` : ''}
        ${ids.length ? `<div class="caja-pend-lista">${ids.map(id => {
          const p = pendientes[id];
          const devolver = Number(p.efectivo) < 0;
          const tipo = tipoFicha(p);
          return `
            <button type="button" class="caja-pend-item" data-pedido="${esc(id)}">
              <span class="caja-pend-cliente">${esc(p.cliente || 'Sin nombre')}</span>
              <span class="caja-pend-meta">${tipo !== 'cobro' ? `<em class="caja-pend-tipo caja-pend-${tipo}">${esc(TIPOS_FICHA[tipo])}</em> · ` : ''}${esc(mismoDia(p.ts) ? hora(p.ts) : fechaHora(p.ts))} · ${esc(p.vendedor || '')} · Ticket ${esc(ticketCorto(id))}</span>
              <span class="caja-pend-monto${devolver ? ' neg' : ''}">${devolver ? 'Devolver ' + pesos(-p.efectivo) : pesos(p.efectivo)}</span>
            </button>`;
        }).join('')}</div>` : ''}
        <div class="caja-pie">
          <button type="button" class="caja-enlace" data-accion="volver">Volver</button>
        </div>
      </div>`, '.caja-pend-item', null);
    dlg.dataset.paso = 'pendientes';
    dlg.querySelectorAll('[data-pedido]').forEach(b => b.addEventListener('click', () => pasoConfirmarCobro(b.dataset.pedido)));
    dlg.querySelector('[data-accion="volver"]').addEventListener('click', abrirPanel);
  }

  // Quita una ficha que ya no corresponde (pedido borrado, cancelado, ya cobrado…).
  async function soltarPendiente(id, motivo) {
    try { await conLimite(db().ref('cajaPendientes/' + id).remove(), 8000); } catch (err) { console.warn(err); }
    avisoPend = motivo;
    reg(`Quitó de "Por cobrar" el ticket ${ticketCorto(id)}: ${motivo}`);
  }

  // Qué hay que hacer con una ficha, mirando el pedido como está ahora (pudo
  // cambiar desde que se dejó la ficha). { motivo } si ya no corresponde.
  function evaluarFicha(f, pedido) {
    const tipo = tipoFicha(f);
    if (!pedido) return { motivo: 'el pedido ya no existe.' };
    const cancelado = String(pedido.status || '').toUpperCase() === 'CANCELADO';
    const cobro = pedido.cobro || {};
    const cobrado = Math.round(Number(cobro.efectivo) || 0);
    if (tipo === 'anulacion') {
      if (!cancelado) return { motivo: 'el pedido ya no está cancelado.' };
      if (!cobro.caja || !cobrado) return { motivo: 'no queda efectivo para devolver.' };
      return { tipo, monto: -cobrado, t: 'anulacion', efectivoFinal: 0 };
    }
    if (cancelado) return { motivo: 'el pedido está cancelado.' };
    const actual = efectivoDe(pedido.pagos);
    if (tipo === 'ajuste') {
      if (!cobro.caja) return { motivo: 'el pedido no estaba cobrado.' };
      if (actual === cobrado) return { motivo: 'ya no hay diferencia para cobrar.' };
      return { tipo, monto: actual - cobrado, t: 'ajuste', efectivoFinal: actual, antes: cobrado };
    }
    if (cobro.caja) return { motivo: 'el pedido ya estaba cobrado.' };
    if (!actual) return { motivo: 'el pedido ya no se paga en efectivo.' };
    return { tipo, monto: actual, t: actual < 0 ? 'devolucion' : 'venta', efectivoFinal: actual };
  }

  function textosFicha(ev) {
    const devolver = ev.monto < 0;
    if (ev.tipo === 'offline') return {
      titulo: 'Venta sin conexión',
      ayuda: 'Se cargó mientras no había internet: la plata ya está en el cajón. Sumala al turno.',
      boton: 'Sumar al turno'
    };
    if (ev.tipo === 'anulacion') return {
      titulo: 'Devolver por cancelación',
      ayuda: 'Se canceló un pedido que ya estaba cobrado en efectivo.',
      boton: 'Ya lo devolví'
    };
    if (ev.tipo === 'ajuste') return {
      titulo: devolver ? 'Devolver la diferencia' : 'Cobrar la diferencia',
      ayuda: `Se modificó un pedido ya cobrado: antes eran ${pesos(ev.antes)} en efectivo, ahora ${pesos(ev.efectivoFinal)}.`,
      boton: devolver ? 'Ya lo devolví' : 'Ya lo cobré'
    };
    return {
      titulo: devolver ? 'Devolver efectivo' : 'Cobrar en efectivo',
      ayuda: '',
      boton: devolver ? 'Ya lo devolví' : 'Ya lo cobré'
    };
  }

  async function pasoConfirmarCobro(id) {
    const f = pendientes[id] || {};
    mostrar(`<div class="usr-clave-card caja-card">${cabecera('Por cobrar', 'Cargando el pedido…')}</div>`, null, null);
    let pedido = null;
    try {
      pedido = (await conLimite(db().ref('pedidos/' + id).once('value'), 8000)).val();
      await leerCaja();
    } catch (err) {
      avisoPend = 'No se pudo leer el pedido. Revisá internet e intentá de nuevo.';
      pasoPendientes();
      return;
    }
    const ev = evaluarFicha(f, pedido);
    if (ev.motivo) { await soltarPendiente(id, ev.motivo); pasoPendientes(); return; }

    const tx = textosFicha(ev);
    const devolver = ev.monto < 0;
    const cliente = (pedido.cliente && pedido.cliente.nombre) || 'Sin nombre';
    const parcial = ev.tipo !== 'anulacion' && pedido.pagos && pedido.pagos.medioPago === 'Parcial';
    const sinTurno = !(caja && caja.turno);
    mostrar(`
      <div class="usr-clave-card caja-card">
        ${cabecera(tx.titulo, `${esc(cliente)} · Ticket ${esc(ticketCorto(id))} · cargó ${esc(pedido.vendedor || '')}`)}
        <div class="caja-dif-grande ${devolver ? 'caja-dif-falta' : 'caja-dif-ok'}">${devolver ? 'Devolver ' : ''}${pesos(Math.abs(ev.monto))}</div>
        ${tx.ayuda ? `<p class="caja-ayuda">${esc(tx.ayuda)}</p>` : ''}
        ${parcial ? `<p class="caja-ayuda">Pago Parcial: en efectivo es sólo esta parte. El resto (${esc((pedido.pagos.desglose || []).filter(p => p.medio !== 'Efectivo').map(p => p.medio + ' ' + pesos(p.monto)).join(' + '))}) no pasa por el cajón.</p>` : ''}
        ${sinTurno ? '<p class="caja-ayuda">No hay un turno abierto: al confirmar se pide abrirlo.</p>' : ''}
        <div class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="volver">Volver</button>
          <button type="button" class="usr-clave-btn caja-btn-pri" data-accion="ok">${esc(tx.boton)}</button>
        </div>
        ${esAdmin() ? '<div class="caja-pie"><button type="button" class="caja-enlace" data-accion="quitar">Quitar de la lista sin sumar a la caja</button></div>' : ''}
      </div>`, '[data-accion="ok"]', null);
    dlg.querySelector('[data-accion="volver"]').addEventListener('click', pasoPendientes);
    const quitar = dlg.querySelector('[data-accion="quitar"]');
    if (quitar) quitar.addEventListener('click', async () => {
      if (!confirm('¿Quitar este pedido de "Por cobrar"? No va a sumar a ninguna caja.')) return;
      await soltarPendiente(id, `lo quitó ${usuario()} sin sumarlo a la caja.`);
      pasoPendientes();
    });
    dlg.querySelector('[data-accion="ok"]').addEventListener('click', () => {
      if (!usuario()) { error('Elegí quién está en la caja.'); return; }
      if (caja && caja.turno) { cobrarPendiente(id, pedido, ev, caja.turno); return; }
      pasoAbrir(turnoId => {
        if (turnoId) cobrarPendiente(id, pedido, ev, turnoId);
        else pasoPendientes();
      });
    });
  }

  async function cobrarPendiente(id, pedido, ev, turnoId) {
    const quien = usuario();
    const ts = Date.now();
    const cliente = (pedido.cliente && pedido.cliente.nombre) || 'Sin nombre';
    mostrar(`<div class="usr-clave-card caja-card">${cabecera('Por cobrar', 'Guardando…')}</div>`, null, null);
    dlg.dataset.ocupado = '1';
    const mov = { t: ev.t, monto: ev.monto, pedido: id, por: quien, ts, porCobrar: true };
    if (ev.tipo === 'offline') mov.offline = true;
    const escrituras = {
      ['cajaPendientes/' + id]: null,
      ['cajaTurnos/' + turnoId + '/movs/' + db().ref().push().key]: mov
    };
    // Primer cobro: el pedido queda cobrado en esta caja (las reglas impiden
    // cobrarlo dos veces). Ajuste o anulación: el cobro original se mantiene
    // y sólo cambia cuánto efectivo quedó.
    if (ev.tipo === 'cobro' || ev.tipo === 'offline') {
      escrituras['pedidos/' + id + '/cobro'] = { caja: cajaId, turno: turnoId, por: quien, ts, efectivo: ev.efectivoFinal };
    } else {
      escrituras['pedidos/' + id + '/cobro/efectivo'] = ev.efectivoFinal;
    }
    try {
      await conLimite(db().ref().update(escrituras), 8000);
      const verbo = ev.tipo === 'offline' ? 'Sumó al turno' : ev.monto < 0 ? 'Devolvió' : 'Cobró';
      reg(`${verbo} ${pesos(Math.abs(ev.monto))} del ticket ${ticketCorto(id)} (${cliente}, ${TIPOS_FICHA[ev.tipo]}) en ${nombreCaja()} (${quien})`);
      avisoPend = `${ev.tipo === 'offline' ? 'Sumado al turno' : ev.monto < 0 ? 'Devuelto' : 'Cobrado'}: ${pesos(Math.abs(ev.monto))} de ${cliente}.`;
    } catch (err) {
      console.warn('Cobrar pendiente:', err);
      avisoPend = 'No se pudo guardar. Puede que ya lo haya cobrado otra caja o que el turno se haya cerrado: revisá y probá de nuevo.';
    }
    pasoPendientes();
  }

  // ------------------------------------------------------------ abrir turno --
  // resolver: si viene de una venta, recibe el id del turno abierto o null.
  function pasoAbrir(resolver) {
    const u = caja && caja.ultimo;
    const sugerido = u && Number(u.contado) > 0 ? Number(u.contado) : 0;
    mostrar(`
      <form class="usr-clave-card caja-card" novalidate>
        ${cabecera('Abrir turno · ' + nombreCaja(), resolver
          ? 'Para cobrar en efectivo hay que abrir el turno. Contá el cambio que hay en el cajón.'
          : 'Contá el cambio que hay en el cajón.')}
        <label class="caja-campo-label" for="cajaFondo">Cambio inicial</label>
        <input id="cajaFondo" class="caja-input" inputmode="numeric" autocomplete="off" placeholder="$ 0"
               value="${sugerido ? sugerido.toLocaleString('es-AR') : ''}">
        ${sugerido ? `<p class="caja-ayuda">Es lo que se contó en el último cierre. Si no coincide, corregilo.</p>` : ''}
        ${cierrePendienteHtml()}
        <div class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="volver">Cancelar</button>
          <button type="submit" class="usr-clave-btn caja-btn-pri">Abrir turno</button>
        </div>
      </form>`, '#cajaFondo', resolver ? (r => resolver(r || null)) : null);
    const form = dlg.querySelector('form');
    const input = dlg.querySelector('#cajaFondo');
    formatearAlEscribir(input);
    conectarCierrePendiente();
    input.select();
    dlg.querySelector('[data-accion="volver"]').addEventListener('click', () => {
      if (resolver) cerrarDlg(null); else abrirPanel();
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const quien = usuario();
      if (!quien) { error('Elegí quién está en la caja antes de abrir el turno.'); return; }
      const fondo = leerMonto(input.value);
      const btn = form.querySelector('[type="submit"]');
      ocupado(true, btn, 'Abriendo…');
      try {
        const turnoId = db().ref('cajaTurnos').push().key;
        const ahora = Date.now();
        // Atómico: si otro equipo de la misma caja abrió un turno recién, las
        // reglas rechazan esto (cajas/{id}/turno sólo se escribe vacío).
        await conLimite(db().ref().update({
          ['cajas/' + cajaId + '/turno']: turnoId,
          ['cajas/' + cajaId + '/desde']: ahora,
          ['cajaTurnos/' + turnoId]: {
            caja: cajaId, cajaNombre: nombreCaja(), abiertoPor: quien, abiertoTs: ahora, fondo
          }
        }), 8000);
        reg(`Abrió turno de ${nombreCaja()} con cambio ${pesos(fondo)} (${quien})`);
        caja = Object.assign({}, caja, { turno: turnoId, desde: ahora });
        pintarBoton();
        if (resolver) cerrarDlg(turnoId);
        else abrirPanel();
      } catch (err) {
        console.warn('Abrir turno:', err);
        ocupado(false, btn, 'Abrir turno');
        let abierto = null;
        try { abierto = (await leerCaja() || {}).turno; } catch (_) {}
        if (abierto) {
          // Lo abrió otro equipo de esta caja mientras tanto: se usa ese.
          if (resolver) cerrarDlg(abierto); else abrirPanel();
          return;
        }
        error('No se pudo abrir el turno. Revisá internet e intentá de nuevo.');
      }
    });
  }

  // ------------------------------------------------ sacar / ingresar efectivo --
  function pasoMovimiento(tipo) {
    const sale = tipo === 'retiro';
    mostrar(`
      <form class="usr-clave-card caja-card" novalidate>
        ${cabecera((sale ? 'Sacar efectivo' : 'Ingresar efectivo') + ' · ' + nombreCaja(),
          sale ? 'Plata que sale del cajón sin ser una venta: pago a un proveedor, retiro, etc.'
               : 'Plata que entra al cajón sin ser una venta: más cambio, etc.')}
        <label class="caja-campo-label" for="cajaMovMonto">Importe</label>
        <input id="cajaMovMonto" class="caja-input" inputmode="numeric" autocomplete="off" placeholder="$ 0">
        <label class="caja-campo-label" for="cajaMovMotivo">Motivo</label>
        <input id="cajaMovMotivo" class="caja-input caja-input-texto" maxlength="80" autocomplete="off"
               placeholder="${sale ? 'Ej.: pago a proveedor, retiro del dueño' : 'Ej.: cambio'}">
        <div class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="volver">Cancelar</button>
          <button type="submit" class="usr-clave-btn caja-btn-pri">Guardar</button>
        </div>
      </form>`, '#cajaMovMonto', null);
    const form = dlg.querySelector('form');
    const monto = dlg.querySelector('#cajaMovMonto');
    const motivo = dlg.querySelector('#cajaMovMotivo');
    formatearAlEscribir(monto);
    dlg.querySelector('[data-accion="volver"]').addEventListener('click', abrirPanel);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const quien = usuario();
      const n = leerMonto(monto.value);
      const m = motivo.value.trim();
      if (!quien) { error('Elegí quién está en la caja.'); return; }
      if (!n) { error('Ingresá el importe.'); monto.focus(); return; }
      if (!m) { error('Escribí el motivo.'); motivo.focus(); return; }
      const btn = form.querySelector('[type="submit"]');
      ocupado(true, btn, 'Guardando…');
      try {
        await leerCaja();
        if (!caja || !caja.turno) throw new Error('sin turno');
        await conLimite(db().ref('cajaTurnos/' + caja.turno + '/movs').push({
          t: tipo, monto: sale ? -n : n, motivo: m, por: quien, ts: Date.now()
        }), 8000);
        reg(`${sale ? 'Sacó' : 'Ingresó'} ${pesos(n)} de ${nombreCaja()}: ${m} (${quien})`);
        abrirPanel();
      } catch (err) {
        console.warn('Movimiento de caja:', err);
        ocupado(false, btn, 'Guardar');
        error(err && err.message === 'sin turno'
          ? 'El turno ya se cerró. Volvé y abrí uno nuevo.'
          : 'No se pudo guardar. Revisá internet e intentá de nuevo.');
      }
    });
  }

  // ----------------------------------------------------------- cerrar turno --
  function difClase(d) { d = Math.round(Number(d) || 0); return d === 0 ? 'caja-dif-ok' : d < 0 ? 'caja-dif-falta' : 'caja-dif-sobra'; }
  function textoDif(d) {
    d = Math.round(Number(d) || 0);
    return d === 0 ? 'Sin diferencia' : d < 0 ? 'Faltan ' + pesos(-d) : 'Sobran ' + pesos(d);
  }

  function pasoCerrar(turno) {
    mostrar(`
      <form class="usr-clave-card caja-card caja-card-ancha" novalidate>
        ${cabecera('Cerrar turno · ' + nombreCaja(), 'Contá toda la plata del cajón, incluido el cambio. Recién al guardar vas a ver si coincide.')}
        <div class="caja-billetes">
          ${BILLETES.map(b => `
            <label class="caja-billete">
              <span class="caja-billete-valor">${pesos(b)}</span>
              <input class="caja-billete-cant" data-valor="${b}" inputmode="numeric" autocomplete="off" placeholder="0" aria-label="Cantidad de billetes de ${pesos(b)}">
            </label>`).join('')}
          <label class="caja-billete">
            <span class="caja-billete-valor">Monedas / otros</span>
            <input class="caja-billete-otros" inputmode="numeric" autocomplete="off" placeholder="$ 0" aria-label="Monedas y otros, en pesos">
          </label>
        </div>
        <div class="caja-total-contado">Total contado <strong data-total>$ 0</strong></div>
        <input class="caja-input caja-input-texto" data-nota maxlength="200" autocomplete="off" placeholder="Nota (opcional)">
        <div class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="volver">Cancelar</button>
          <button type="submit" class="usr-clave-btn caja-btn-pri">Guardar conteo</button>
        </div>
      </form>`, '.caja-billete-cant', null);
    const form = dlg.querySelector('form');
    const otros = dlg.querySelector('.caja-billete-otros');
    const totalEl = dlg.querySelector('[data-total]');
    formatearAlEscribir(otros);
    function contar() {
      const billetes = {};
      let total = leerMonto(otros.value);
      dlg.querySelectorAll('.caja-billete-cant').forEach(inp => {
        const c = leerMonto(inp.value);
        // Clave "b20000": con claves numéricas Firebase puede devolver una lista.
        if (c) { billetes['b' + inp.dataset.valor] = c; total += c * Number(inp.dataset.valor); }
      });
      if (leerMonto(otros.value)) billetes.otros = leerMonto(otros.value);
      return { total, billetes };
    }
    dlg.querySelectorAll('.caja-billete-cant').forEach(inp => inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 4);
    }));
    form.addEventListener('input', () => { totalEl.textContent = pesos(contar().total); });
    // Enter en una cantidad pasa a la siguiente, en vez de guardar.
    form.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || !e.target.matches('.caja-billete-cant')) return;
      e.preventDefault();
      const todos = Array.from(dlg.querySelectorAll('.caja-billete-cant, .caja-billete-otros'));
      const sig = todos[todos.indexOf(e.target) + 1];
      if (sig) sig.focus();
    });
    dlg.querySelector('[data-accion="volver"]').addEventListener('click', abrirPanel);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const quien = usuario();
      if (!quien) { error('Elegí quién está en la caja.'); return; }
      const { total, billetes } = contar();
      if (!total && !confirm('El conteo da $ 0. ¿Guardar igual?')) return;
      const nota = dlg.querySelector('[data-nota]').value.trim();
      const btn = form.querySelector('[type="submit"]');
      ocupado(true, btn, 'Guardando…');
      try {
        // Se vuelve a leer el turno para incluir lo último que se cobró.
        await leerCaja();
        const turnoId = caja && caja.turno;
        if (!turnoId) throw new Error('sin turno');
        const fresco = await leerTurno(turnoId);
        if (!fresco || fresco.cerradoTs) throw new Error('sin turno');
        const esperado = esperadoDe(fresco);
        const diferencia = total - esperado;
        const ahora = Date.now();
        const base = 'cajaTurnos/' + turnoId + '/';
        await conLimite(db().ref().update({
          [base + 'cerradoPor']: quien,
          [base + 'cerradoTs']: ahora,
          [base + 'contado']: total,
          [base + 'esperado']: esperado,
          [base + 'diferencia']: diferencia,
          [base + 'billetes']: billetes,
          [base + 'nota']: nota || null,
          ['cajas/' + cajaId + '/turno']: null,
          ['cajas/' + cajaId + '/desde']: null,
          ['cajas/' + cajaId + '/ultimo']: { turno: turnoId, contado: total, diferencia, por: quien, ts: ahora }
        }), 8000);
        reg(`Cerró turno de ${nombreCaja()}: contado ${pesos(total)}, esperado ${pesos(esperado)}, ${textoDif(diferencia)} (${quien})`);
        caja = Object.assign({}, caja, { turno: null, desde: null });
        pintarBoton();
        pasoResultado(turnoId, Object.assign({}, fresco, {
          contado: total, esperado, diferencia, cerradoPor: quien, cerradoTs: ahora, cajaNombre: fresco.cajaNombre || nombreCaja()
        }));
      } catch (err) {
        console.warn('Cerrar turno:', err);
        ocupado(false, btn, 'Guardar conteo');
        error(err && err.message === 'sin turno'
          ? 'Este turno ya se cerró desde otro equipo.'
          : 'No se pudo guardar el cierre. Revisá internet e intentá de nuevo.');
      }
    });
  }

  // Renglones del resumen de un turno cerrado (pantalla y ticket).
  function filasCierre(turno) {
    const movs = movsDe(turno);
    const suma = t => movs.filter(m => m.t === t).reduce((s, m) => s + (Number(m.monto) || 0), 0);
    return [
      ['Cambio inicial', turno.fondo],
      ['Ventas en efectivo', suma('venta')],
      ['Devoluciones en efectivo', suma('devolucion')],
      ['Diferencias por edición', suma('ajuste')],
      ['Pedidos cancelados', suma('anulacion')],
      ['Ingresos', suma('ingreso')],
      ['Salidas', suma('retiro')]
    ].filter(([, v], i) => i < 2 || v);
  }

  // Comprobante del cierre para la térmica (ingresoPedidoV2.js →
  // imprimirTicketPOS). Sale todo de lo guardado en el turno, así se puede
  // reimprimir después igual que al cerrar.
  function ticketCierre(turno) {
    const p = v => pesos(v).replace('−', '-');
    return [
      { texto: 'CIERRE DE CAJA', negrita: true, centrado: true },
      { texto: turno.cajaNombre || nombreCaja(), centrado: true },
      { sep: true },
      { fila: ['Apertura', fechaHora(turno.abiertoTs) + ' ' + (turno.abiertoPor || '')] },
      { fila: ['Cierre', fechaHora(turno.cerradoTs) + ' ' + (turno.cerradoPor || '')] },
      { sep: true }
    ].concat(filasCierre(turno).map(([k, v]) => ({ fila: [k, p(v)] })), [
      { sep: true },
      { fila: ['Deberia haber', p(turno.esperado)], negrita: true },
      { fila: ['Contado', p(turno.contado)], negrita: true },
      { fila: ['Diferencia', textoDif(turno.diferencia).replace('−', '-')], negrita: true },
      { sep: true },
      { texto: 'Firma: ______________________' }
    ]);
  }

  function puedeImprimir() { return typeof window.imprimirTicketPOS === 'function'; }

  // Imprime el cierre y, si sale, lo marca como impreso en la caja (sólo si
  // sigue siendo el último cierre). Devuelve true si se imprimió.
  async function imprimirCierre(turnoId, turno) {
    await window.imprimirTicketPOS(ticketCierre(turno));
    reg(`Imprimió el cierre de ${turno.cajaNombre || nombreCaja()} del ${fechaHora(turno.cerradoTs)}`);
    try {
      const ultimo = (await leerCaja() || {}).ultimo;
      if (ultimo && ultimo.turno === turnoId) {
        await conLimite(db().ref('cajas/' + cajaId + '/ultimo/impreso').set(true), 8000);
        caja.ultimo = Object.assign({}, ultimo, { impreso: true });
      }
    } catch (err) {
      console.warn('Marcar cierre impreso:', err);
    }
    return true;
  }

  function errorImpresion() {
    return 'No se pudo imprimir. Revisá que QZ Tray esté abierto y la impresora encendida.';
  }

  // Al abrir un turno nuevo (o mirar la caja sin turno): si el último cierre
  // no se llegó a imprimir, se ofrece imprimirlo frente a la operación.
  function cierrePendienteHtml() {
    const u = caja && caja.ultimo;
    if (!u || !u.turno || u.impreso || !puedeImprimir()) return '';
    return `
      <div class="caja-cierre-pend" data-cierre-pend>
        <span>El cierre anterior (${esc(fechaHora(u.ts))} · ${esc(u.por || '')}) no se imprimió.</span>
        <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="imprimirAnterior">Imprimir cierre anterior</button>
      </div>`;
  }
  function conectarCierrePendiente() {
    const btn = dlg.querySelector('[data-accion="imprimirAnterior"]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const u = caja && caja.ultimo;
      if (!u || !u.turno) return;
      btn.disabled = true;
      btn.textContent = 'Imprimiendo…';
      try {
        const turno = await leerTurno(u.turno);
        if (!turno || !turno.cerradoTs) throw new Error('No se encontró el cierre anterior');
        await imprimirCierre(u.turno, turno);
        const aviso = dlg.querySelector('[data-cierre-pend]');
        if (aviso) aviso.innerHTML = '<span>Cierre anterior impreso.</span>';
      } catch (err) {
        console.warn('Imprimir cierre anterior:', err);
        btn.disabled = false;
        btn.textContent = 'Imprimir cierre anterior';
        error(errorImpresion());
      }
    });
  }

  // turno: el turno ya cerrado, con contado, esperado, diferencia y cierre.
  function pasoResultado(turnoId, turno) {
    const filas = filasCierre(turno);
    mostrar(`
      <div class="usr-clave-card caja-card">
        ${cabecera('Turno cerrado · ' + nombreCaja(), '')}
        <div class="caja-dif-grande ${difClase(turno.diferencia)}">${textoDif(turno.diferencia)}</div>
        <dl class="caja-detalle">
          ${filas.map(([k, v]) => `<div><dt>${k}</dt><dd>${pesos(v)}</dd></div>`).join('')}
          <div class="caja-detalle-total"><dt>Debería haber</dt><dd>${pesos(turno.esperado)}</dd></div>
          <div class="caja-detalle-total"><dt>Contado</dt><dd>${pesos(turno.contado)}</dd></div>
        </dl>
        <p class="caja-ayuda">El próximo turno va a proponer ${pesos(turno.contado)} como cambio inicial.${puedeImprimir() ? ' Si ahora no se imprime, se va a poder imprimir al abrir el turno siguiente.' : ''}</p>
        <div class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="imprimir">Imprimir</button>
          <button type="button" class="usr-clave-btn caja-btn-pri" data-accion="listo">Listo</button>
        </div>
      </div>`, '[data-accion="imprimir"]', null);
    dlg.querySelector('[data-accion="listo"]').addEventListener('click', () => cerrarDlg(null));
    const imprimir = dlg.querySelector('[data-accion="imprimir"]');
    if (!puedeImprimir()) imprimir.hidden = true;
    imprimir.addEventListener('click', async () => {
      imprimir.disabled = true;
      imprimir.textContent = 'Imprimiendo…';
      try {
        await imprimirCierre(turnoId, turno);
        imprimir.textContent = 'Impreso';
      } catch (err) {
        console.warn('Imprimir cierre:', err);
        imprimir.disabled = false;
        imprimir.textContent = 'Imprimir';
        error(errorImpresion());
      }
    });
  }

  // ------------------------------------------------------ configurar puesto --
  async function pasoConfig() {
    if (!puedeConfigurar()) return;
    mostrar(`<div class="usr-clave-card caja-card">${cabecera('Puesto de cobro', 'Cargando cajas…')}</div>`, null, null);
    let cajas = {};
    try {
      cajas = (await conLimite(db().ref('cajas').once('value'), 8000)).val() || {};
    } catch (err) {
      mostrar(`<div class="usr-clave-card caja-card">${cabecera('Puesto de cobro', 'No se pudieron leer las cajas. Revisá internet.')}${pieAcciones('')}</div>`);
      conectarPie();
      return;
    }
    const ids = Object.keys(cajas).sort((a, b) => String(cajas[a].nombre || '').localeCompare(String(cajas[b].nombre || ''), 'es', { numeric: true }));
    mostrar(`
      <form class="usr-clave-card caja-card" novalidate>
        ${cabecera('Puesto de cobro', '¿Qué cajón de plata cobra este equipo? Dos equipos pueden compartir la misma caja.')}
        <div class="caja-opciones">
          ${ids.map(id => `
            <button type="button" class="caja-opcion${id === cajaId ? ' es-actual' : ''}" data-caja="${esc(id)}">
              ${esc(cajas[id].nombre || id)}${cajas[id].turno ? ' <small>· turno abierto</small>' : ''}
            </button>`).join('')}
          <button type="button" class="caja-opcion caja-opcion-no${!cajaId ? ' es-actual' : ''}" data-caja="">Este equipo no cobra</button>
        </div>
        <label class="caja-campo-label" for="cajaNueva">O crear una caja nueva</label>
        <div class="caja-nueva">
          <input id="cajaNueva" class="caja-input caja-input-texto" maxlength="30" autocomplete="off" placeholder="Ej.: Caja ${ids.length + 1}">
          <button type="submit" class="usr-clave-btn caja-btn-pri">Crear</button>
        </div>
        <div class="usr-clave-error" role="alert"></div>
        ${pieAcciones('')}
      </form>`, '.caja-opcion', null);
    conectarPie();
    dlg.querySelectorAll('[data-caja]').forEach(b => b.addEventListener('click', () => asignar(b.dataset.caja, cajas)));
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const nombre = dlg.querySelector('#cajaNueva').value.trim();
      if (!nombre) { error('Escribí el nombre de la caja.'); return; }
      if (ids.some(id => String(cajas[id].nombre || '').toLowerCase() === nombre.toLowerCase())) {
        error('Ya hay una caja con ese nombre: elegila de la lista.');
        return;
      }
      ocupado(true);
      try {
        const ref = db().ref('cajas').push();
        await conLimite(ref.set({ nombre }), 8000);
        reg(`Creó la caja "${nombre}" (${usuario()})`);
        asignar(ref.key, Object.assign({}, cajas, { [ref.key]: { nombre } }));
      } catch (err) {
        console.warn('Crear caja:', err);
        ocupado(false);
        error('No se pudo crear la caja. Revisá internet.');
      }
    });
  }

  function asignar(id, cajas) {
    cajaId = id || '';
    if (cajaId) lsSet(LS_PUESTO, cajaId); else lsDel(LS_PUESTO);
    reg(cajaId ? `Equipo marcado como puesto de cobro: ${(cajas[cajaId] || {}).nombre || cajaId}` : 'Equipo marcado como sólo ingreso de pedidos');
    caja = cajaId ? (cajas[cajaId] || null) : null;
    hayCajas = true;
    escucharCaja();
    escucharPendientes();
    if (cajaId) abrirPanel(); else cerrarDlg(null);
  }

  // ------------------------------------------------- API para la caja --
  // ¿Esta venta tiene que pasar por el turno de caja?
  function necesitaTurno(pagos) {
    return !!cajaId && !modoWhatsapp() && efectivoDe(pagos) !== 0;
  }

  // Puesto de sólo ingreso: un pedido con efectivo queda "por cobrar" en la
  // caja. Devuelve la ficha para el update atómico del pedido (o nada si no
  // corresponde: este equipo cobra, modo WhatsApp, o la sucursal no tiene cajas).
  function marcarPendiente(pedidoId, pedidoObj) {
    if (cajaId || modoWhatsapp() || !hayCajas) return {};
    const monto = efectivoDe(pedidoObj.pagos);
    if (!monto) return {};
    pedidoObj.cobro = { pendiente: true };
    return {
      ['cajaPendientes/' + pedidoId]: {
        efectivo: monto,
        cliente: String((pedidoObj.cliente && pedidoObj.cliente.nombre) || '').slice(0, 50),
        vendedor: String(pedidoObj.vendedor || '').slice(0, 30),
        ts: Date.now()
      }
    };
  }

  // Resuelve el id del turno abierto (pidiendo abrirlo si no hay), o null si
  // se canceló o no hay conexión.
  async function asegurarTurno() {
    if (!cajaId || !hayFirebase()) return null;
    try {
      await leerCaja();
    } catch (err) {
      console.warn('Caja:', err);
      return null;
    }
    if (!caja) return null;
    if (caja.turno) return caja.turno;
    // Sin turno, el genérico no lo abre: la venta queda en "Por cobrar".
    if (usuarioGenerico()) return null;
    return new Promise(res => pasoAbrir(res));
  }

  // Venta en efectivo de un usuario genérico en un puesto de cobro sin turno
  // abierto: la venta se guarda igual y la plata queda "Por cobrar", para que
  // la sume al turno quien abra la caja.
  function dejarPorCobrar(pedidoId, pedidoObj) {
    const monto = efectivoDe(pedidoObj.pagos);
    if (!monto) return {};
    pedidoObj.cobro = { pendiente: true };
    return { ['cajaPendientes/' + pedidoId]: ficha('cobro', monto, pedidoObj) };
  }

  // Venta hecha sin internet (modo Offline): no se sabe si hay turno abierto,
  // así que queda como ficha "Venta sin conexión" y viaja en el mismo paquete
  // que sube modoOffline.js. Al volver internet, la caja la suma al turno.
  function fichaOffline(pedidoId, pedidoObj) {
    if (modoWhatsapp() || !(cajaId || hayCajas)) return {};
    const monto = efectivoDe(pedidoObj.pagos);
    if (!monto) return {};
    pedidoObj.cobro = { pendiente: true };
    return { ['cajaPendientes/' + pedidoId]: ficha('offline', monto, pedidoObj) };
  }

  // Al editar un pedido (ingresoPedidoV2.js, con el cobro ya copiado del
  // anterior): si cambió el efectivo, la ficha lo refleja.
  //   · todavía por cobrar → la ficha se reescribe con el importe nuevo (o
  //     se borra si ya no hay efectivo);
  //   · ya cobrado → ficha "Diferencia por edición" con lo que hay que cobrar
  //     o devolver (o se borra si volvió a coincidir).
  // Pedidos de antes de la caja (sin cobro) no se tocan: ya se pagaron.
  function ajusteDeEdicion(pedidoId, anterior, pedidoObj) {
    const cobro = anterior && anterior.cobro;
    if (!cobro) return {};
    const ruta = 'cajaPendientes/' + pedidoId;
    const actual = efectivoDe(pedidoObj.pagos);
    if (cobro.pendiente) {
      if (!actual) {
        delete pedidoObj.cobro;
        return { [ruta]: null };
      }
      return { [ruta]: ficha(anterior.sinConexion ? 'offline' : 'cobro', actual, pedidoObj, anterior.timestamp) };
    }
    if (!cobro.caja) return {};
    const dif = actual - Math.round(Number(cobro.efectivo) || 0);
    return { [ruta]: dif ? ficha('ajuste', dif, pedidoObj) : null };
  }

  // Marca el pedido como cobrado en esta caja y devuelve las escrituras del
  // movimiento, para sumarlas al update atómico del pedido.
  function registrarCobro(pedidoId, pedidoObj, turnoId) {
    const monto = efectivoDe(pedidoObj.pagos);
    if (!monto || !turnoId) return {};
    const quien = usuario();
    const ts = Date.now();
    pedidoObj.cobro = { caja: cajaId, turno: turnoId, por: quien, ts, efectivo: monto };
    const movId = db().ref().push().key;
    return {
      ['cajaTurnos/' + turnoId + '/movs/' + movId]: {
        t: monto < 0 ? 'devolucion' : 'venta', monto, pedido: pedidoId, por: quien, ts
      }
    };
  }

  window.CajaTurno = {
    esPuestoCobro: () => !!cajaId,
    efectivoDe,
    necesitaTurno,
    marcarPendiente,
    dejarPorCobrar,
    usuarioGenerico,
    fichaOffline,
    ajusteDeEdicion,
    asegurarTurno,
    registrarCobro,
    abrirPanel,
    nombre: nombreCaja
  };

  // --------------------------------------------------------------- arranque --
  function cuandoListo(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  cuandoListo(() => {
    boton = document.getElementById('cajaNavBtn');
    if (boton) boton.addEventListener('click', abrirPanel);
    pintarBoton();
    if (hayFirebase() && firebase.auth) {
      firebase.auth().onAuthStateChanged(u => {
        if (u) {
          escucharCaja();
          escucharPendientes();
          cargarHayCajas();
        } else {
          if (refCaja) { refCaja.off('value', alCambiarCaja); refCaja = null; }
          if (refPend) { refPend.off('value', alCambiarPendientes); refPend = null; }
        }
      });
    }
  });
  // Cambiar de usuario puede mostrar u ocultar el botón (sólo Alejandro y Javier configuran).
  document.addEventListener('usuarioactivo:cambio', pintarBoton);
  // esUsuarioAdmin lo define ingresoPedidoV2.js, que corre después.
  window.addEventListener('load', pintarBoton);
  // Pasada la medianoche, un turno abierto pasa a "de otro día" (sin leer nada).
  setInterval(pintarBoton, 10 * 60 * 1000);
})();
