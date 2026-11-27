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
  function esAdmin() {
    if (window.UsuarioActivo && typeof UsuarioActivo.esAdmin === 'function') return UsuarioActivo.esAdmin(usuario());
    return typeof window.esUsuarioAdmin === 'function' && window.esUsuarioAdmin(usuario());
  }
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

  // Nombre de cada caja de la sucursal (para "Caja 1 ✓" en el Historial).
  let nombresCajas = {};

  function cargarHayCajas() {
    if (!hayFirebase()) return;
    db().ref('cajas').once('value')
      .then(s => {
        hayCajas = s.exists();
        if (hayCajas) lsSet(LS_HAY_CAJAS, '1'); else lsDel(LS_HAY_CAJAS);
        nombresCajas = {};
        s.forEach(ch => { nombresCajas[ch.key] = (ch.val() || {}).nombre || 'Caja'; });
        avisarCambio();
      })
      .catch(err => console.warn('Cajas no disponibles:', err));
  }

  // Otras pantallas (el Historial) repintan cuando cambia algo de la caja.
  function avisarCambio() {
    try { document.dispatchEvent(new CustomEvent('cajaturno:cambio')); } catch (_) {}
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
    avisarCambio();
  }

  function escucharPendientes() {
    if (refPend) { refPend.off('value', alCambiarPendientes); refPend = null; }
    pendientes = {};
    if (!cajaId || !hayFirebase()) return;
    refPend = db().ref('cajaPendientes');
    refPend.on('value', alCambiarPendientes, err => console.warn('Por cobrar no disponible:', err));
  }

  function alCambiarCaja(snap) {
    caja = snap.val();
    if (!caja) {
      // La caja se borró desde otro lado: el equipo vuelve a sólo ingresar.
      console.warn('Caja: la caja de este equipo ya no existe.');
    } else {
      nombresCajas[cajaId] = caja.nombre || 'Caja';
    }
    pintarBoton();
    avisarCambio();
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
    if (cajaId) {
      const abierta = !!(caja && caja.turno);
      const viejo = turnoViejo();
      boton.hidden = false;
      boton.dataset.estado = viejo ? 'vieja' : abierta ? 'abierta' : 'cerrada';
      texto.textContent = (caja && caja.nombre) || 'Caja';
      boton.title = ((caja && caja.nombre) || 'Caja') +
        (viejo ? ' · el turno quedó abierto desde otro día: cerralo' : abierta ? ' · turno abierto' : ' · sin turno abierto');
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
        ${ultimo}
        ${cierrePendienteHtml()}
        <div class="usr-clave-error" role="alert"></div>
        <button type="button" class="usr-clave-btn caja-btn-pri caja-btn-ancho" data-accion="abrir">Abrir turno</button>
        ${pieAcciones('')}
      </div>`, '[data-accion="abrir"]', null);
    dlg.querySelector('[data-accion="abrir"]').addEventListener('click', () => pasoAbrir(null));
    conectarCierrePendiente();
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
    dlg.querySelector('[data-accion="cerrarTurno"]').addEventListener('click', () => pasoAntesDeContar(turno));
    conectarPie();
  }

  // ------------------------------------------------------------ por cobrar --
  // Pedidos en efectivo cargados en un puesto de sólo ingreso: el cliente
  // paga acá. Se marcan como cobrados desde el Historial (historialRecientes
  // .html): botón "Cobrado", imprimir el ticket o usar la calculadora de vuelto.
  function ticketCorto(id) { return String(id || '').slice(-8).toUpperCase(); }

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

  // Aviso breve abajo de la pantalla: confirma un cobro sin abrir ventanas.
  // accion: { texto, fn } agrega un botón (por ejemplo "Deshacer"); con
  // botón el aviso dura más, para dar tiempo a tocarlo.
  let toastEl = null, toastTimer = null;
  function toast(texto, mal, accion) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'caja-toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = '';
    const span = document.createElement('span');
    span.textContent = texto;
    toastEl.appendChild(span);
    if (accion) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'caja-toast-accion';
      b.textContent = accion.texto;
      b.addEventListener('click', () => {
        toastEl.classList.remove('caja-toast-visible');
        accion.fn();
      }, { once: true });
      toastEl.appendChild(b);
    }
    toastEl.classList.toggle('caja-toast-mal', !!mal);
    toastEl.classList.toggle('caja-toast-con-accion', !!accion);
    toastEl.classList.add('caja-toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('caja-toast-visible'), accion ? 10000 : mal ? 6000 : 3500);
  }

  // Al terminar algo que se hizo en una ventana (confirmar una diferencia o
  // una devolución): muestra el resultado, o cierra si no se hizo nada.
  function volverDeCobro() {
    const aviso = avisoPend;
    avisoPend = '';
    // "Volver" sin haber hecho nada: se cierra y queda el Historial.
    if (!aviso) { cerrarDlg(null); return; }
    mostrar(`
      <div class="usr-clave-card caja-card">
        ${cabecera(nombreCaja(), '')}
        <p class="caja-aviso-ok" role="status">${esc(aviso || 'Listo.')}</p>
        <button type="button" class="usr-clave-btn caja-btn-pri caja-btn-ancho" data-accion="listo">Listo</button>
      </div>`, '[data-accion="listo"]', null);
    dlg.querySelector('[data-accion="listo"]').addEventListener('click', () => cerrarDlg(null));
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
      volverDeCobro();
      return;
    }
    const ev = evaluarFicha(f, pedido);
    if (ev.motivo) { await soltarPendiente(id, ev.motivo); volverDeCobro(); return; }

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
    dlg.querySelector('[data-accion="volver"]').addEventListener('click', volverDeCobro);
    const quitar = dlg.querySelector('[data-accion="quitar"]');
    if (quitar) quitar.addEventListener('click', async () => {
      if (!confirm('¿Quitar este pedido de "Por cobrar"? No va a sumar a ninguna caja.')) return;
      await soltarPendiente(id, `lo quitó ${usuario()} sin sumarlo a la caja.`);
      volverDeCobro();
    });
    dlg.querySelector('[data-accion="ok"]').addEventListener('click', () => {
      if (!usuario()) { error('Elegí quién está en la caja.'); return; }
      if (caja && caja.turno) { cobrarPendiente(id, pedido, ev, caja.turno); return; }
      pasoAbrir(turnoId => {
        if (turnoId) cobrarPendiente(id, pedido, ev, turnoId);
        else volverDeCobro();
      });
    });
  }

  // silencioso: sin ventana, el resultado sale en el aviso breve (toast).
  async function cobrarPendiente(id, pedido, ev, turnoId, silencioso) {
    const quien = usuario();
    const ts = Date.now();
    const cliente = (pedido.cliente && pedido.cliente.nombre) || 'Sin nombre';
    if (!silencioso) {
      mostrar(`<div class="usr-clave-card caja-card">${cabecera('Por cobrar', 'Guardando…')}</div>`, null, null);
      dlg.dataset.ocupado = '1';
    }
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
      if (silencioso) { toast(avisoPend + ' (' + cliente + ')', true); avisoPend = ''; return false; }
    }
    if (silencioso) {
      const deshacer = (ev.tipo === 'cobro' || ev.tipo === 'offline')
        ? { texto: 'Deshacer', fn: () => revertirCobro(id, 'Deshecho al momento', false) }
        : null;
      toast(avisoPend + ' · ' + nombreCaja(), false, deshacer);
      avisoPend = '';
      return true;
    }
    volverDeCobro();
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

  // ------------------------------------------------- antes de contar el cierre --
  // Lo que quedó en efectivo sin marcar (de cualquier día): si alguien se
  // olvidó de tocar "Cobrado", al cierre esa plata aparecería como "sobra"
  // sin explicación. Se muestra antes de contar y se puede marcar ahí mismo.
  // Son de toda la sucursal: sólo se marca lo que se cobró en ESTA caja.
  function pasoAntesDeContar(turno) {
    const ids = Object.keys(pendientes).sort((a, b) => (pendientes[a].ts || 0) - (pendientes[b].ts || 0));
    if (!ids.length) { pasoCerrar(turno); return; }
    const aviso = avisoPend;
    avisoPend = '';
    mostrar(`
      <div class="usr-clave-card caja-card">
        ${cabecera('Antes de contar · ' + nombreCaja(),
          `Quedan <strong>${ids.length}</strong> ${ids.length === 1 ? 'venta' : 'ventas'} en efectivo sin marcar. Marcá sólo las que se cobraron (o devolvieron) en esta caja; el resto queda para quien corresponda.`)}
        ${aviso ? `<p class="caja-aviso-ok" role="status">${esc(aviso)}</p>` : ''}
        <ul class="caja-sinmarcar">${ids.map(id => {
          const f = pendientes[id];
          const tipo = tipoFicha(f);
          const monto = Math.round(Number(f.efectivo) || 0);
          const devolver = monto < 0;
          return `
            <li>
              <span class="caja-sinmarcar-det">
                <strong>${esc(f.cliente || 'Sin nombre')}</strong>
                <small>${tipo !== 'cobro' ? esc(TIPOS_FICHA[tipo]) + ' · ' : ''}${esc(mismoDia(f.ts) ? hora(f.ts) : fechaHora(f.ts))}${f.vendedor ? ' · ' + esc(f.vendedor) : ''}</small>
              </span>
              <span class="caja-sinmarcar-monto${devolver ? ' neg' : ''}">${pesos(Math.abs(monto))}</span>
              <button type="button" class="usr-clave-btn usr-clave-cancelar" data-marcar="${esc(id)}">${devolver ? 'Devuelto' : 'Cobrado'}</button>
            </li>`;
        }).join('')}</ul>
        <div class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="volver">Volver</button>
          <button type="button" class="usr-clave-btn caja-btn-pri" data-accion="contar">Seguir al conteo</button>
        </div>
      </div>`, '[data-accion="contar"]', null);
    dlg.querySelector('[data-accion="volver"]').addEventListener('click', abrirPanel);
    dlg.querySelector('[data-accion="contar"]').addEventListener('click', () => pasoCerrar(turno));
    dlg.querySelectorAll('[data-marcar]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = '…';
      await marcarFichaEnTurno(b.dataset.marcar);
      pasoAntesDeContar(turno);
    }));
  }

  // Marca una ficha cualquiera (venta, sin conexión, diferencia o devolución)
  // en el turno abierto de esta caja, sin ventana.
  async function marcarFichaEnTurno(id) {
    try {
      const pedido = (await conLimite(db().ref('pedidos/' + id).once('value'), 8000)).val();
      await leerCaja();
      if (!caja || !caja.turno) { avisoPend = 'El turno ya no está abierto.'; return; }
      const ev = evaluarFicha(pendientes[id] || {}, pedido);
      if (ev.motivo) { await soltarPendiente(id, ev.motivo); delete pendientes[id]; return; }
      // La lista se vuelve a pintar ya: no espera a que Firebase avise.
      if (await cobrarPendiente(id, pedido, ev, caja.turno, true)) delete pendientes[id];
    } catch (err) {
      console.warn('Marcar antes del cierre:', err);
      avisoPend = 'No se pudo marcar. Revisá internet e intentá de nuevo.';
    }
  }

  // ------------------------------------------------------- revertir un cobro --
  // Para cuando alguien se adjudicó por error una venta en efectivo que no le
  // correspondía. El pedido vuelve a quedar "por cobrar" (con su botón en el
  // Historial) y el turno donde se había sumado recibe un movimiento
  // "Cobro revertido" que la resta. Sólo mientras ese turno siga abierto: si
  // ya se cerró, ese efectivo quedó contado en su cierre.
  // Lo usa "Deshacer" (al momento, en el mismo equipo) y el modo Admin del
  // Historial (con confirmación y clave personal ya validada).
  async function revertirCobro(id, motivo, conVentana) {
    const quien = usuario();
    const fallar = texto => {
      if (conVentana) { avisoPend = texto; volverDeCobro(); } else toast(texto, true);
      return false;
    };
    try {
      const pedido = (await conLimite(db().ref('pedidos/' + id).once('value'), 8000)).val();
      const cobro = (pedido && pedido.cobro) || {};
      if (!pedido || !cobro.caja) return fallar('Ese pedido no estaba cobrado en ninguna caja.');
      if (String(pedido.status || '').toUpperCase() === 'CANCELADO') return fallar('El pedido está cancelado: no se puede revertir el cobro.');
      const cajaCobro = (await conLimite(db().ref('cajas/' + cobro.caja).once('value'), 8000)).val() || {};
      const nombre = cajaCobro.nombre || 'la caja';
      if (!cobro.turno || cajaCobro.turno !== cobro.turno) {
        return fallar(`El turno de ${nombre} donde se cobró ya se cerró: no se puede revertir (ese efectivo quedó en su cierre).`);
      }
      const efectivo = Math.round(Number(cobro.efectivo) || 0);
      const actual = efectivoDe(pedido.pagos);
      const ts = Date.now();
      const escrituras = {
        ['pedidos/' + id + '/cobro']: actual ? { pendiente: true } : { sinEfectivo: true },
        ['cajaPendientes/' + id]: actual ? ficha(pedido.sinConexion ? 'offline' : 'cobro', actual, pedido, pedido.timestamp) : null
      };
      if (efectivo) {
        escrituras['cajaTurnos/' + cobro.turno + '/movs/' + db().ref().push().key] = {
          t: 'reversion', monto: -efectivo, pedido: id, por: quien, ts, motivo: String(motivo || '').slice(0, 80)
        };
      }
      await conLimite(db().ref().update(escrituras), 8000);
      const cliente = (pedido.cliente && pedido.cliente.nombre) || 'Sin nombre';
      reg(`Revirtió el cobro de ${pesos(efectivo)} del ticket ${ticketCorto(id)} (${cliente}) en ${nombre}${motivo ? ': ' + motivo : ''} (${quien})`);
      const texto = `Cobro revertido: ${pesos(efectivo)} de ${cliente} vuelve a quedar por cobrar.`;
      if (conVentana) { avisoPend = texto; volverDeCobro(); } else toast(texto);
      return true;
    } catch (err) {
      console.warn('Revertir cobro:', err);
      return fallar('No se pudo revertir. Revisá internet e intentá de nuevo.');
    }
  }

  // Modo Admin del Historial: confirmación con motivo antes de revertir.
  async function revertirCobroAdmin(id, pedidoVisto) {
    if (!esAdmin()) return;
    const cobro = (pedidoVisto && pedidoVisto.cobro) || {};
    const cliente = (pedidoVisto && pedidoVisto.cliente && pedidoVisto.cliente.nombre) || 'Sin nombre';
    const nombre = nombresCajas[cobro.caja] || 'la caja';
    mostrar(`
      <form class="usr-clave-card caja-card" novalidate>
        ${cabecera('Revertir cobro', `${esc(cliente)} · Ticket ${esc(ticketCorto(id))}`)}
        <div class="caja-dif-grande caja-dif-falta">${pesos(cobro.efectivo)}</div>
        <p class="caja-ayuda">Se cobró en <strong>${esc(nombre)}</strong>${cobro.por ? ' por ' + esc(cobro.por) : ''}${cobro.ts ? ' a las ' + esc(hora(cobro.ts)) : ''}. Al revertirlo se resta de ese turno y la venta vuelve a quedar por cobrar.</p>
        <label class="caja-campo-label" for="cajaRevMotivo">Motivo</label>
        <input id="cajaRevMotivo" class="caja-input caja-input-texto" maxlength="80" autocomplete="off" placeholder="Ej.: lo marcó otra caja por error">
        <div class="usr-clave-error" role="alert"></div>
        <div class="usr-clave-acciones">
          <button type="button" class="usr-clave-btn usr-clave-cancelar" data-accion="volver">Cancelar</button>
          <button type="submit" class="usr-clave-btn caja-btn-pri">Revertir</button>
        </div>
      </form>`, '#cajaRevMotivo', null);
    dlg.querySelector('[data-accion="volver"]').addEventListener('click', () => cerrarDlg(null));
    dlg.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const motivo = dlg.querySelector('#cajaRevMotivo').value.trim();
      if (!motivo) { error('Escribí el motivo.'); return; }
      ocupado(true, dlg.querySelector('[type="submit"]'), 'Revirtiendo…');
      await revertirCobro(id, motivo, true);
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
      ['Cobros revertidos', suma('reversion')],
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
  //   · sin efectivo al cargarlo (marca sinEfectivo) y ahora sí → "Por cobrar".
  // Pedidos de antes de la caja (sin cobro) no se tocan: ya se pagaron.
  function ajusteDeEdicion(pedidoId, anterior, pedidoObj) {
    const cobro = anterior && anterior.cobro;
    if (!cobro) return {};
    const ruta = 'cajaPendientes/' + pedidoId;
    const actual = efectivoDe(pedidoObj.pagos);
    if (cobro.sinEfectivo) {
      if (!actual || modoWhatsapp()) return {};
      pedidoObj.cobro = { pendiente: true };
      return { [ruta]: ficha('cobro', actual, pedidoObj) };
    }
    if (cobro.pendiente) {
      if (!actual) {
        pedidoObj.cobro = { sinEfectivo: true };
        return { [ruta]: null };
      }
      return { [ruta]: ficha(anterior.sinConexion ? 'offline' : 'cobro', actual, pedidoObj, anterior.timestamp) };
    }
    if (!cobro.caja) return {};
    const dif = actual - Math.round(Number(cobro.efectivo) || 0);
    return { [ruta]: dif ? ficha('ajuste', dif, pedidoObj) : null };
  }

  // Estado de caja de un pedido, para la etiqueta del Historial:
  //   { estado: 'pendiente' | 'ajuste' | 'anulacion' | 'cobrado', monto, tipo?, caja?, por?, ts? }
  // o null si el pedido no tiene efectivo que pase por una caja. Las fichas
  // sólo se conocen en un puesto de cobro (las escucha); en el resto se ve
  // lo que dice el propio pedido.
  function estadoCobro(id, pedido) {
    if (!pedido) return null;
    const cobro = pedido.cobro || {};
    const f = pendientes[id];
    if (f) {
      const tipo = tipoFicha(f);
      return {
        estado: tipo === 'cobro' || tipo === 'offline' ? 'pendiente' : tipo,
        tipo, monto: Math.round(Number(f.efectivo) || 0)
      };
    }
    if (cobro.pendiente) {
      const monto = efectivoDe(pedido.pagos);
      return monto ? { estado: 'pendiente', tipo: 'cobro', monto } : null;
    }
    if (cobro.caja) {
      return {
        estado: 'cobrado', monto: Math.round(Number(cobro.efectivo) || 0),
        caja: nombresCajas[cobro.caja] || 'Caja', por: cobro.por || '', ts: cobro.ts || 0
      };
    }
    return null;
  }

  // Cobrar desde una fila del Historial. Modos:
  //   'boton'     el botón "Cobrado" de la fila: cobra en un toque.
  //   'auto'      imprimir el ticket o usar la calculadora con el pago
  //               completo: si había efectivo por cobrar, se da por cobrado.
  //               Sólo ventas en efectivo pendientes; no toca diferencias
  //               ni devoluciones, ni molesta si no hay nada que hacer.
  //   'confirmar' diferencia por edición o devolución: con ventana.
  // Sin turno abierto, en cualquier modo se pide abrirlo.
  const cobrando = new Set();
  async function cobrarDesdeHistorial(id, opciones) {
    const modo = (opciones && opciones.modo) || 'boton';
    const auto = modo === 'auto';
    if (!cajaId || !hayFirebase() || cobrando.has(id)) return;
    if (usuarioGenerico()) { if (!auto) pasoGenerico(); return; }
    if (modo === 'confirmar') { pasoConfirmarCobro(id); return; }
    // Sin nada pendiente a la vista no se consulta nada (imprimir un ticket
    // de transferencia, por ejemplo).
    const visto = estadoCobro(id, opciones && opciones.pedido);
    if (auto && (!visto || visto.estado !== 'pendiente')) return;
    if (!usuario()) { if (!auto) toast('Elegí quién está en la caja antes de cobrar.', true); return; }
    cobrando.add(id);
    try {
      let pedido = null;
      try {
        pedido = (await conLimite(db().ref('pedidos/' + id).once('value'), 8000)).val();
        await leerCaja();
      } catch (err) {
        if (!auto) toast('No se pudo leer el pedido. Revisá internet e intentá de nuevo.', true);
        return;
      }
      const ev = evaluarFicha(pendientes[id] || {}, pedido);
      if (ev.motivo) {
        if (pendientes[id]) { await soltarPendiente(id, ev.motivo); avisoPend = ''; }
        if (!auto) toast('No hay nada para cobrar: ' + ev.motivo, true);
        return;
      }
      if (ev.tipo !== 'cobro' && ev.tipo !== 'offline') {
        if (!auto) pasoConfirmarCobro(id);
        return;
      }
      if (caja && caja.turno) { await cobrarPendiente(id, pedido, ev, caja.turno, true); return; }
      const turnoId = await new Promise(res => pasoAbrir(res));
      if (turnoId) await cobrarPendiente(id, pedido, ev, turnoId, true);
      else toast('No se marcó como cobrado: hace falta abrir el turno de caja.', true);
    } finally {
      cobrando.delete(id);
    }
  }

  // Pedido nuevo sin efectivo, en una sucursal con cajas: queda marcado para
  // que, si después se edita y pasa a pagarse en efectivo, la caja lo cobre
  // (sin la marca no se distingue de un pedido anterior a las cajas).
  function marcarNuevo(pedidoObj) {
    if (pedidoObj.cobro || modoWhatsapp() || !(cajaId || hayCajas)) return;
    if (!efectivoDe(pedidoObj.pagos)) pedidoObj.cobro = { sinEfectivo: true };
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
    marcarNuevo,
    estadoCobro,
    cobrarDesdeHistorial,
    revertirCobroAdmin,
    esAdmin,
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
