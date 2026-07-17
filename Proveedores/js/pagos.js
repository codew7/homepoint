/** Vista de pagos: alta, edición, borrado, filtros y totales. */

import { crearPago, actualizarPago, eliminarPago } from './db.js';
import { getDolar } from './cotizacion.js';
import {
  getState,
  getProveedorPorId,
  getProveedoresActivos,
  getPagosFiltrados,
  calcularTotales,
  setFiltros,
  limpiarFiltros,
  getFacturasConSaldo,
  getFacturaPorId,
  calcularSaldoFactura,
  convertirAMonedaFactura,
  getImputadoEnMonedaDelPago,
} from './store.js';
import {
  formatearMonto,
  formatearFecha,
  hoyISO,
  parsearMonto,
  escaparHtml,
  mostrarToast,
  marcarError,
  limpiarErrores,
  tarjetaTotal,
} from './utils.js';
import { confirmar } from './confirmar.js';

const modal = document.getElementById('modal-pago');
const form = document.getElementById('form-pago');
const tbody = document.getElementById('tbody-pagos');
const vacio = document.getElementById('pagos-vacio');

const METODOS = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  cheque: 'Cheque',
  otro: 'Otro',
};

/* ──────────────────────────────── Render ──────────────────────────────── */

export function renderPagos() {
  const pagos = getPagosFiltrados();

  vacio.classList.toggle('vacio--oculto', pagos.length > 0);
  vacio.textContent = getState().pagos.length
    ? 'No hay pagos que coincidan con los filtros.'
    : 'Todavía no registraste pagos.';

  tbody.innerHTML = pagos
    .map((pago) => {
      const proveedor = getProveedorPorId(pago.proveedorId);
      const esUSD = pago.moneda === 'USD';

      // Mostrar a qué facturas se imputó: es la respuesta a "¿de qué era este pago?".
      const numeros = Object.keys(pago.imputaciones || {})
        .map((id) => getFacturaPorId(id)?.numero)
        .filter(Boolean);

      const detalle = numeros.length
        ? `<span class="pago__facturas">${escaparHtml(numeros.join(', '))}</span>`
        : escaparHtml(pago.concepto) || '<span class="texto-suave">a cuenta</span>';

      return `
        <tr>
          <td class="num" style="text-align:left">${formatearFecha(pago.fecha)}</td>
          <td>${proveedor
            ? escaparHtml(proveedor.nombre)
            : '<span class="texto-suave">Proveedor eliminado</span>'}</td>
          <td>${detalle}</td>
          <td>${METODOS[pago.metodoPago] || '—'}</td>
          <td class="num">
            <span class="chip chip--${esUSD ? 'usd' : 'ars'}">${esUSD ? 'USD' : 'ARS'}</span>
            ${formatearMonto(pago.monto, pago.moneda)}
          </td>
          <td class="num">${esUSD
            ? formatearMonto(pago.cotizacion, 'ARS')
            : '<span class="texto-suave">—</span>'}</td>
          <td class="num"><strong>${formatearMonto(pago.montoARS, 'ARS')}</strong></td>
          <td>
            <div class="acciones">
              <button type="button" class="btn-icono" data-editar="${pago.id}">Editar</button>
              <button type="button" class="btn-icono btn-icono--peligro" data-eliminar="${pago.id}">Eliminar</button>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  renderTotalesPagos(pagos);
}

function renderTotalesPagos(pagos) {
  const t = calcularTotales(pagos);
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  document.getElementById('totales-pagos').innerHTML = [
    tarjetaTotal({
      clase: 'ars',
      label: 'Pesos',
      valor: formatearMonto(t.totalARS, 'ARS'),
      detalle: plural(t.cantidadARS, 'pago', 'pagos'),
    }),
    tarjetaTotal({
      clase: 'usd',
      label: 'Dólares',
      valor: formatearMonto(t.totalUSD, 'USD'),
      detalle: plural(t.cantidadUSD, 'pago', 'pagos'),
    }),
    tarjetaTotal({
      clase: 'general',
      label: 'Total equivalente',
      valor: formatearMonto(t.equivalenteARS, 'ARS'),
      detalle: 'Cotización de cada pago',
    }),
  ].join('');
}

/** Rellena los <select> de proveedor (filtro y formulario) conservando la selección. */
export function renderSelectsProveedores() {
  const filtro = document.getElementById('filtro-proveedor');
  const selectPago = document.getElementById('pago-proveedor');

  const seleccionFiltro = filtro.value;
  const seleccionPago = selectPago.value;

  // El filtro incluye los dados de baja: pueden tener pagos históricos que consultar.
  filtro.innerHTML =
    '<option value="">Todos</option>' +
    getState()
      .proveedores.map(
        (p) =>
          `<option value="${p.id}">${escaparHtml(p.nombre)}${p.activo === false ? ' (baja)' : ''}</option>`
      )
      .join('');
  filtro.value = seleccionFiltro;

  // Al cargar un pago nuevo solo se ofrecen los activos.
  const activos = getProveedoresActivos();
  selectPago.innerHTML =
    '<option value="">Seleccioná un proveedor…</option>' +
    activos.map((p) => `<option value="${p.id}">${escaparHtml(p.nombre)}</option>`).join('');
  selectPago.value = seleccionPago;
}

/* ──────────────────────────────── Modal ──────────────────────────────── */

/**
 * El <select> de moneda tiene tres valores. 'ARS_USD' es un MODO DE CARGA, no una moneda:
 * el usuario tipea pesos y una cotización, y el pago se guarda como si fuera en dólares.
 * Nada de este valor llega a la base; se traduce a 'USD' al guardar.
 */
function modoMoneda() {
  return document.getElementById('pago-moneda').value;
}

/** La moneda REAL del pago (la que se guarda): 'ARS_USD' es en el fondo un pago en USD. */
function monedaEfectiva() {
  return modoMoneda() === 'ARS_USD' ? 'USD' : modoMoneda();
}

/**
 * El monto del pago EN SU MONEDA EFECTIVA. En modo 'ARS_USD' el campo tiene pesos, así que
 * se lo divide por la cotización para obtener los dólares que se van a registrar.
 * Todos los cálculos de imputación deben usar esto, no el valor crudo del campo.
 */
function montoEfectivo() {
  const monto = parsearMonto(document.getElementById('pago-monto').value);
  if (modoMoneda() !== 'ARS_USD') return monto;

  const cotizacion = parsearMonto(document.getElementById('pago-cotizacion').value);
  if (!Number.isFinite(monto) || !Number.isFinite(cotizacion) || cotizacion <= 0) return NaN;
  return monto / cotizacion;
}

/**
 * La cotización hace falta en tres casos:
 *  - el pago es en dólares (para saber su equivalente en pesos),
 *  - el pago se carga en modo Pesos/USD (para convertir los pesos a dólares), o
 *  - el pago se imputa a una factura de otra moneda (para saber cuánto la cubre).
 */
function necesitaCotizacion() {
  if (modoMoneda() === 'USD' || modoMoneda() === 'ARS_USD') return true;

  const moneda = monedaEfectiva();
  return facturasTildadas().some((facturaId) => {
    const factura = getFacturaPorId(facturaId);
    return factura && factura.moneda !== moneda;
  });
}

/** Muestra u oculta el campo de cotización y recalcula el equivalente. */
function actualizarCamposMoneda() {
  const modo = modoMoneda();
  const esUSD = modo === 'USD';
  const esPesosUSD = modo === 'ARS_USD';
  const campoCotizacion = document.getElementById('campo-cotizacion');
  const requerida = necesitaCotizacion();

  campoCotizacion.hidden = !requerida;
  document.getElementById('pago-cotizacion').required = requerida;

  // El equivalente tiene sentido cuando hay conversión: pago en dólares o carga en Pesos/USD.
  document.getElementById('equivalente-ars').hidden = !(esUSD || esPesosUSD);

  // En modo Pesos/USD el monto se ingresa en pesos: hay que decirlo.
  document.querySelector('label[for="pago-monto"]').innerHTML = esPesosUSD
    ? 'Monto en pesos <span class="req">*</span>'
    : 'Monto <span class="req">*</span>';

  // La etiqueta de la cotización explica para qué se pide en cada caso.
  document.querySelector('label[for="pago-cotizacion"]').innerHTML = esUSD
    ? 'Cotización usada en este pago <span class="req">*</span>'
    : esPesosUSD
      ? 'Cotización para convertir a dólares <span class="req">*</span>'
      : 'Cotización para convertir a la factura en dólares <span class="req">*</span>';

  if (esUSD || esPesosUSD) actualizarEquivalente();
}

/** Recalcula en vivo el importe convertido que se va a guardar. */
function actualizarEquivalente() {
  const monto = parsearMonto(document.getElementById('pago-monto').value);
  const cotizacion = parsearMonto(document.getElementById('pago-cotizacion').value);
  const salida = document.getElementById('equivalente-ars');
  const valido = Number.isFinite(monto) && Number.isFinite(cotizacion) && monto > 0 && cotizacion > 0;

  // En Pesos/USD se muestran los dólares resultantes; en USD, el equivalente en pesos.
  if (modoMoneda() === 'ARS_USD') {
    salida.textContent = valido
      ? `Se registrará como: ${formatearMonto(monto / cotizacion, 'USD')}`
      : 'Se registrará como: —';
  } else {
    salida.textContent = valido
      ? `Equivalente en pesos: ${formatearMonto(monto * cotizacion, 'ARS')}`
      : 'Equivalente en pesos: —';
  }
}

/* ─────────────────────────── Imputación a facturas ─────────────────────────── */

const bloqueImputaciones = document.getElementById('bloque-imputaciones');
const listaImputaciones = document.getElementById('lista-imputaciones');

/** Ids de las facturas actualmente tildadas en el modal. */
const facturasTildadas = () =>
  [...listaImputaciones.querySelectorAll('input[type="checkbox"]:checked')].map(
    (cb) => cb.dataset.facturaId
  );

/** Lo imputado a una factura según lo que hay escrito en el modal ahora mismo. */
function montoImputadoEnUI(facturaId) {
  const input = listaImputaciones.querySelector(`input[data-monto-de="${facturaId}"]`);
  return input ? parsearMonto(input.value) : NaN;
}

/**
 * Las imputaciones tildadas en el modal, con la forma { facturaId: monto } que usa la base.
 * Permite reusar los cálculos del store sobre lo que el usuario está escribiendo.
 */
function imputacionesDesdeUI() {
  const imputaciones = {};

  facturasTildadas().forEach((facturaId) => {
    const monto = montoImputadoEnUI(facturaId);
    if (Number.isFinite(monto)) imputaciones[facturaId] = monto;
  });

  return imputaciones;
}

/**
 * Dibuja las facturas con saldo del proveedor elegido.
 * Al editar un pago se excluyen sus propias imputaciones del saldo ajeno (ignorarPagoId) y se
 * incluyen las facturas que ese pago ya tenía imputadas, aunque hayan quedado saldadas.
 */
function renderListaImputaciones(pago = null) {
  const proveedorId = document.getElementById('pago-proveedor').value;
  const idPagoEditado = document.getElementById('pago-id').value || null;

  if (!proveedorId) {
    bloqueImputaciones.hidden = true;
    listaImputaciones.innerHTML = '';
    return;
  }

  // Los saldos ya vienen SIN contar el pago que se está editando, así que representan
  // exactamente cuánto puede imputarle este pago (lo suyo previo vuelve a estar disponible).
  const conSaldo = getFacturasConSaldo(proveedorId, idPagoEditado);

  // Facturas que este pago cubría y que otros pagos ya saldaron: se listan igual para poder
  // desmarcarlas, aunque no admitan más plata.
  const yaImputadas = Object.keys(pago?.imputaciones || {})
    .filter((id) => !conSaldo.some((f) => f.factura.id === id))
    .map((id) => {
      const factura = getFacturaPorId(id);
      return factura ? { factura, saldo: calcularSaldoFactura(factura, idPagoEditado).saldo } : null;
    })
    .filter(Boolean);

  const filas = [...conSaldo, ...yaImputadas];

  bloqueImputaciones.hidden = filas.length === 0;
  if (filas.length === 0) {
    listaImputaciones.innerHTML = '';
    return;
  }

  listaImputaciones.innerHTML = filas
    .map(({ factura, saldo }) => {
      const imputado = Number(pago?.imputaciones?.[factura.id]) || 0;
      const tildada = imputado > 0;
      const disponible = Math.max(saldo, 0);

      return `
        <div class="imputacion">
          <label class="imputacion__check">
            <input type="checkbox" data-factura-id="${factura.id}" ${tildada ? 'checked' : ''}>
            <span class="imputacion__numero">${escaparHtml(factura.numero)}</span>
          </label>
          <span class="imputacion__saldo">
            saldo ${formatearMonto(disponible, factura.moneda)}
          </span>
          <input type="text" class="imputacion__monto" inputmode="decimal"
                 data-monto-de="${factura.id}" placeholder="0,00"
                 value="${tildada ? imputado : ''}" ${tildada ? '' : 'disabled'}>
        </div>`;
    })
    .join('');

  actualizarResto();
}

/**
 * Actualiza el indicador "sin imputar". Todo se compara en la moneda del pago: cada imputación
 * está en la moneda de su factura, así que se convierte de vuelta para poder sumarlas.
 */
function actualizarResto() {
  const monedaPago = monedaEfectiva();
  const montoPago = montoEfectivo();
  const cotizacion = parsearMonto(document.getElementById('pago-cotizacion').value);
  const salida = document.getElementById('imputaciones-resto');

  if (!Number.isFinite(montoPago) || montoPago <= 0) {
    salida.textContent = '';
    return;
  }

  // Se arma un pago tentativo con lo que hay escrito ahora y se reusa el cálculo del store.
  const usado = getImputadoEnMonedaDelPago({
    moneda: monedaPago,
    cotizacion,
    imputaciones: imputacionesDesdeUI(),
  });

  if (!Number.isFinite(usado)) {
    salida.textContent = 'Falta la cotización';
    salida.className = 'imputaciones__resto imputaciones__resto--alerta';
    return;
  }

  const resto = montoPago - usado;
  const excedido = resto < -0.01;

  salida.textContent = excedido
    ? `Excede el pago en ${formatearMonto(Math.abs(resto), monedaPago)}`
    : `Sin imputar: ${formatearMonto(resto, monedaPago)} de ${formatearMonto(montoPago, monedaPago)}`;
  salida.className = `imputaciones__resto${excedido ? ' imputaciones__resto--alerta' : ''}`;
}

/** Propone cuánto de este pago cubrir con una factura recién tildada. */
function proponerMonto(facturaId) {
  const factura = getFacturaPorId(facturaId);
  const input = listaImputaciones.querySelector(`input[data-monto-de="${facturaId}"]`);
  if (!factura || !input) return;

  const idPagoEditado = document.getElementById('pago-id').value || null;
  const fila = getFacturasConSaldo(factura.proveedorId, idPagoEditado).find(
    (f) => f.factura.id === facturaId
  );
  const saldo = fila ? fila.saldo : Number(factura.montoTotal) || 0;

  // Cuánto queda del pago, expresado en la moneda de esta factura.
  const pagoSimulado = {
    monto: montoEfectivo(),
    moneda: monedaEfectiva(),
    cotizacion: parsearMonto(document.getElementById('pago-cotizacion').value),
  };
  const disponible = convertirAMonedaFactura(pagoSimulado, factura.moneda);

  const propuesto = Number.isFinite(disponible) ? Math.min(saldo, Math.max(disponible, 0)) : saldo;
  input.value = propuesto > 0 ? String(Math.round(propuesto * 100) / 100) : '';
}

/** Lee las imputaciones del modal. Devuelve { imputaciones, error }. */
function leerImputaciones() {
  const monedaPago = monedaEfectiva();
  const montoPago = montoEfectivo();
  const cotizacion = parsearMonto(document.getElementById('pago-cotizacion').value);
  const idPagoEditado = document.getElementById('pago-id').value || null;

  const imputaciones = {};

  for (const facturaId of facturasTildadas()) {
    const factura = getFacturaPorId(facturaId);
    if (!factura) continue;

    const monto = montoImputadoEnUI(facturaId);
    if (!Number.isFinite(monto) || monto <= 0) {
      return { error: `Ingresá cuánto de este pago cubre la factura ${factura.numero}.` };
    }

    // No se puede imputar más de lo que esa factura debe.
    const fila = getFacturasConSaldo(factura.proveedorId, idPagoEditado).find(
      (f) => f.factura.id === facturaId
    );
    const saldo = fila ? fila.saldo : 0;
    if (monto > saldo + 0.01) {
      return {
        error: `La factura ${factura.numero} debe ${formatearMonto(
          saldo,
          factura.moneda
        )}; no se le puede imputar ${formatearMonto(monto, factura.moneda)}.`,
      };
    }

    if (factura.moneda !== monedaPago && (!Number.isFinite(cotizacion) || cotizacion <= 0)) {
      return { error: 'Ingresá la cotización para convertir el pago a la moneda de la factura.' };
    }

    imputaciones[facturaId] = monto;
  }

  // Cuánto se repartió en total, medido en la moneda del pago.
  const usado = getImputadoEnMonedaDelPago({ moneda: monedaPago, cotizacion, imputaciones });

  // El pago no puede repartir más plata de la que tiene.
  if (usado > montoPago + 0.01) {
    return {
      error: `Estás imputando ${formatearMonto(usado, monedaPago)} pero el pago es de ${formatearMonto(
        montoPago,
        monedaPago
      )}.`,
    };
  }

  return { imputaciones };
}

function abrirModal(pago = null) {
  form.reset();
  limpiarErrores(form);
  renderSelectsProveedores();

  document.getElementById('titulo-modal-pago').textContent = pago ? 'Editar pago' : 'Nuevo pago';
  document.getElementById('pago-id').value = pago?.id || '';
  document.getElementById('pago-fecha').value = pago?.fecha || hoyISO();
  document.getElementById('pago-metodo').value = pago?.metodoPago || 'efectivo';
  document.getElementById('pago-moneda').value = pago?.moneda || 'ARS';
  document.getElementById('pago-monto').value = pago ? String(pago.monto) : '';
  document.getElementById('pago-concepto').value = pago?.concepto || '';

  if (pago) {
    // Al editar hay que poder elegir un proveedor dado de baja si el pago era suyo.
    const select = document.getElementById('pago-proveedor');
    if (!select.querySelector(`option[value="${pago.proveedorId}"]`)) {
      const proveedor = getProveedorPorId(pago.proveedorId);
      if (proveedor) {
        const option = new Option(`${proveedor.nombre} (baja)`, proveedor.id);
        select.add(option);
      }
    }
    select.value = pago.proveedorId;
  }

  // Al editar se muestra la cotización que tuvo el pago. En un pago nuevo el campo
  // arranca vacío con el oficial en vivo como placeholder: es una sugerencia, la
  // cotización sigue siendo de carga manual.
  const cotizInput = document.getElementById('pago-cotizacion');
  if (pago?.cotizacion) {
    cotizInput.value = String(pago.cotizacion);
  } else {
    cotizInput.value = '';
    const { oficial } = getDolar();
    cotizInput.placeholder = oficial ? Math.round(oficial).toLocaleString('es-AR') : '0,00';
  }

  document.getElementById('imputaciones-error').textContent = '';
  renderListaImputaciones(pago);
  actualizarCamposMoneda();

  modal.showModal();
  document.getElementById('pago-proveedor').focus();
}

/** Valida y devuelve los datos del pago listos para guardar, o null si hay errores. */
function validarFormulario() {
  limpiarErrores(form);
  let valido = true;

  const proveedorInput = document.getElementById('pago-proveedor');
  const fechaInput = document.getElementById('pago-fecha');
  const montoInput = document.getElementById('pago-monto');
  const cotizacionInput = document.getElementById('pago-cotizacion');

  const proveedorId = proveedorInput.value;
  const fecha = fechaInput.value;
  const modo = modoMoneda();
  // En modo Pesos/USD lo tipeado son pesos; en el resto, el importe en la moneda del pago.
  const monto = parsearMonto(montoInput.value);
  const cotizacion = parsearMonto(cotizacionInput.value);

  if (!proveedorId) {
    marcarError(proveedorInput, 'Elegí un proveedor.');
    valido = false;
  }

  if (!fecha) {
    marcarError(fechaInput, 'La fecha es obligatoria.');
    valido = false;
  } else if (fecha > hoyISO()) {
    marcarError(fechaInput, 'La fecha no puede ser futura.');
    valido = false;
  }

  if (!Number.isFinite(monto) || monto <= 0) {
    marcarError(montoInput, 'Ingresá un monto numérico mayor a cero.');
    valido = false;
  }

  const cotizacionRequerida = necesitaCotizacion();
  if (cotizacionRequerida && (!Number.isFinite(cotizacion) || cotizacion <= 0)) {
    marcarError(
      cotizacionInput,
      modo === 'USD'
        ? 'Ingresá la cotización usada en este pago.'
        : modo === 'ARS_USD'
          ? 'Ingresá la cotización para convertir los pesos a dólares.'
          : 'Ingresá la cotización para convertir el pago a la moneda de la factura.'
    );
    valido = false;
  }

  const errorImputacion = document.getElementById('imputaciones-error');
  errorImputacion.textContent = '';

  if (!valido) return null;

  const { imputaciones, error } = leerImputaciones();
  if (error) {
    errorImputacion.textContent = error;
    return null;
  }

  // 'ARS_USD' es un modo de carga, no una moneda: el pago se guarda como USD. El monto en dólares
  // sale de dividir los pesos por la cotización, y montoARS conserva los pesos tal cual se pagaron.
  const esPesosUSD = modo === 'ARS_USD';
  const moneda = esPesosUSD ? 'USD' : modo;
  const montoGuardado = esPesosUSD ? Math.round((monto / cotizacion) * 100) / 100 : monto;

  // montoARS se congela con la cotización del pago: es el valor histórico real,
  // no se recalcula nunca contra el dólar de hoy.
  return {
    proveedorId,
    fecha,
    moneda,
    monto: montoGuardado,
    cotizacion: cotizacionRequerida ? cotizacion : null,
    montoARS: esPesosUSD ? monto : moneda === 'USD' ? montoGuardado * cotizacion : montoGuardado,
    concepto: document.getElementById('pago-concepto').value.trim(),
    metodoPago: document.getElementById('pago-metodo').value,
    // null borra el nodo en Realtime Database: un pago sin imputar no guarda la clave.
    imputaciones: Object.keys(imputaciones).length > 0 ? imputaciones : null,
  };
}

async function guardar(event) {
  event.preventDefault();

  const datos = validarFormulario();
  if (!datos) return;

  const boton = document.getElementById('btn-guardar-pago');
  const id = document.getElementById('pago-id').value;

  boton.disabled = true;
  boton.textContent = 'Guardando…';

  try {
    if (id) {
      await actualizarPago(id, datos);
      mostrarToast('Pago actualizado.', 'exito');
    } else {
      await crearPago(datos);
      mostrarToast('Pago registrado.', 'exito');
    }
    modal.close();
  } catch (error) {
    mostrarToast(error.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar pago';
  }
}

async function pedirEliminar(id) {
  const pago = getState().pagos.find((p) => p.id === id);
  if (!pago) return;

  const proveedor = getProveedorPorId(pago.proveedorId);

  const ok = await confirmar({
    titulo: 'Eliminar pago',
    mensaje: `Se va a eliminar el pago de ${formatearMonto(pago.monto, pago.moneda)} a "${
      proveedor?.nombre || 'proveedor eliminado'
    }" del ${formatearFecha(pago.fecha)}. Esta acción no se puede deshacer.`,
    textoAceptar: 'Eliminar',
  });
  if (!ok) return;

  try {
    await eliminarPago(id);
    mostrarToast('Pago eliminado.', 'exito');
  } catch (error) {
    mostrarToast(error.message, 'error');
  }
}

/* ────────────────────────────── Inicialización ────────────────────────────── */

export function initPagos() {
  document.getElementById('btn-nuevo-pago').addEventListener('click', () => {
    if (getProveedoresActivos().length === 0) {
      mostrarToast('Primero cargá al menos un proveedor.', 'info');
      return;
    }
    abrirModal();
  });

  form.addEventListener('submit', guardar);

  modal.querySelectorAll('[data-cerrar]').forEach((btn) =>
    btn.addEventListener('click', () => modal.close())
  );

  // Cambiar de proveedor cambia por completo qué facturas se pueden imputar.
  document.getElementById('pago-proveedor').addEventListener('change', () => {
    renderListaImputaciones();
    actualizarCamposMoneda();
  });

  document.getElementById('pago-moneda').addEventListener('change', () => {
    actualizarCamposMoneda();
    actualizarResto();
  });

  document.getElementById('pago-monto').addEventListener('input', () => {
    actualizarEquivalente();
    actualizarResto();
  });

  document.getElementById('pago-cotizacion').addEventListener('input', () => {
    actualizarEquivalente();
    actualizarResto();
  });

  // Delegación: las filas de imputación se redibujan con cada cambio de proveedor.
  listaImputaciones.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;

    const facturaId = checkbox.dataset.facturaId;
    const montoInput = listaImputaciones.querySelector(`input[data-monto-de="${facturaId}"]`);

    montoInput.disabled = !checkbox.checked;
    if (checkbox.checked) proponerMonto(facturaId);
    else montoInput.value = '';

    // Tildar una factura de otra moneda puede volver obligatoria la cotización.
    actualizarCamposMoneda();
    actualizarResto();
  });

  listaImputaciones.addEventListener('input', (event) => {
    if (event.target.matches('.imputacion__monto')) actualizarResto();
  });

  tbody.addEventListener('click', (event) => {
    const boton = event.target.closest('button');
    if (!boton) return;

    if (boton.dataset.editar) {
      abrirModal(getState().pagos.find((p) => p.id === boton.dataset.editar));
    } else if (boton.dataset.eliminar) {
      pedirEliminar(boton.dataset.eliminar);
    }
  });

  // Filtros
  document.getElementById('filtro-proveedor').addEventListener('change', (e) =>
    setFiltros({ proveedorId: e.target.value })
  );
  document.getElementById('filtro-moneda').addEventListener('change', (e) =>
    setFiltros({ moneda: e.target.value })
  );
  document.getElementById('filtro-desde').addEventListener('change', (e) =>
    setFiltros({ desde: e.target.value })
  );
  document.getElementById('filtro-hasta').addEventListener('change', (e) =>
    setFiltros({ hasta: e.target.value })
  );

  document.getElementById('btn-limpiar-filtros').addEventListener('click', () => {
    ['filtro-proveedor', 'filtro-moneda', 'filtro-desde', 'filtro-hasta'].forEach(
      (id) => (document.getElementById(id).value = '')
    );
    limpiarFiltros();
  });
}
