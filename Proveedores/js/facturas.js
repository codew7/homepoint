/** Vista de facturas: alta, edición, borrado y saldos pendientes. */

import { crearFactura, actualizarFactura, eliminarFactura } from './db.js';
import {
  getState,
  getProveedorPorId,
  getProveedoresActivos,
  getFacturaPorId,
  getFacturasFiltradas,
  getTotalesFacturas,
  getPagosDeFactura,
  calcularSaldoFactura,
  setFiltrosFacturas,
  limpiarFiltrosFacturas,
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

const modal = document.getElementById('modal-factura');
const form = document.getElementById('form-factura');
const tbody = document.getElementById('tbody-facturas');
const vacio = document.getElementById('facturas-vacio');

const ETIQUETA_ESTADO = { pendiente: 'Pendiente', parcial: 'Parcial', pagada: 'Pagada' };

/* ──────────────────────────────── Render ──────────────────────────────── */

export function renderFacturas() {
  const filas = getFacturasFiltradas();

  vacio.classList.toggle('vacio--oculto', filas.length > 0);
  vacio.textContent = getState().facturas.length
    ? 'No hay facturas que coincidan con los filtros.'
    : 'Todavía no cargaste facturas.';

  tbody.innerHTML = filas
    .map(({ factura, total, pagado, saldo, estado }) => {
      const proveedor = getProveedorPorId(factura.proveedorId);
      const m = factura.moneda;

      return `
        <tr>
          <td class="num" style="text-align:left">${formatearFecha(factura.fecha)}</td>
          <td>${escaparHtml(factura.numero)}</td>
          <td>${proveedor
            ? escaparHtml(proveedor.nombre)
            : '<span class="texto-suave">Proveedor eliminado</span>'}</td>
          <td class="num">
            <span class="chip chip--${m === 'USD' ? 'usd' : 'ars'}">${m}</span>
            ${formatearMonto(total, m)}
          </td>
          <td class="num">${formatearMonto(pagado, m)}</td>
          <td class="num"><strong>${formatearMonto(Math.max(saldo, 0), m)}</strong></td>
          <td><span class="chip chip--${estado}">${ETIQUETA_ESTADO[estado]}</span></td>
          <td>
            <div class="acciones">
              <button type="button" class="btn-icono" data-editar="${factura.id}">Editar</button>
              <button type="button" class="btn-icono btn-icono--peligro" data-eliminar="${factura.id}">Eliminar</button>
            </div>
          </td>
        </tr>`;
    })
    .join('');

  renderTotalesFacturas(filas);
}

function renderTotalesFacturas(filas) {
  const totales = getTotalesFacturas(filas);

  // Solo se muestra la moneda que tenga facturas; si no hay ninguna, se muestran los pesos
  // para que la fila no quede vacía.
  const monedas = ['ARS', 'USD'].filter((m) => totales[m].cantidad > 0);
  if (monedas.length === 0) monedas.push('ARS');

  document.getElementById('totales-facturas').innerHTML = monedas
    .map((m) => {
      const t = totales[m];

      return tarjetaTotal({
        clase: m === 'USD' ? 'usd' : 'ars',
        label: `Saldo a pagar · ${m === 'USD' ? 'Dólares' : 'Pesos'}`,
        valor: formatearMonto(t.saldo, m),
        detalle: `${t.cantidad} factura(s) · facturado ${formatearMonto(t.facturado, m)} ·
                  pagado ${formatearMonto(t.pagado, m)}`,
      });
    })
    .join('');
}

/** Rellena los <select> de proveedor de esta vista, conservando la selección. */
export function renderSelectsFacturas() {
  const filtro = document.getElementById('filtro-factura-proveedor');
  const selectModal = document.getElementById('factura-proveedor');

  const seleccionFiltro = filtro.value;
  const seleccionModal = selectModal.value;

  filtro.innerHTML =
    '<option value="">Todos</option>' +
    getState()
      .proveedores.map(
        (p) =>
          `<option value="${p.id}">${escaparHtml(p.nombre)}${p.activo === false ? ' (baja)' : ''}</option>`
      )
      .join('');
  filtro.value = seleccionFiltro;

  selectModal.innerHTML =
    '<option value="">Seleccioná un proveedor…</option>' +
    getProveedoresActivos()
      .map((p) => `<option value="${p.id}">${escaparHtml(p.nombre)}</option>`)
      .join('');
  selectModal.value = seleccionModal;
}

/* ──────────────────────────────── Modal ──────────────────────────────── */

function abrirModal(factura = null) {
  form.reset();
  limpiarErrores(form);
  renderSelectsFacturas();

  document.getElementById('titulo-modal-factura').textContent = factura
    ? 'Editar factura'
    : 'Nueva factura';
  document.getElementById('factura-id').value = factura?.id || '';
  document.getElementById('factura-numero').value = factura?.numero || '';
  document.getElementById('factura-fecha').value = factura?.fecha || hoyISO();
  document.getElementById('factura-moneda').value = factura?.moneda || 'ARS';
  document.getElementById('factura-monto').value = factura ? String(factura.montoTotal) : '';

  const ayuda = document.getElementById('factura-ayuda-imputado');
  ayuda.hidden = true;

  if (factura) {
    const select = document.getElementById('factura-proveedor');
    // Si el proveedor fue dado de baja no está en la lista de activos, pero la factura es suya.
    if (!select.querySelector(`option[value="${factura.proveedorId}"]`)) {
      const proveedor = getProveedorPorId(factura.proveedorId);
      if (proveedor) select.add(new Option(`${proveedor.nombre} (baja)`, proveedor.id));
    }
    select.value = factura.proveedorId;

    // Avisar si ya tiene pagos: cambiarle la moneda o bajarle el monto altera saldos existentes.
    const { pagado } = calcularSaldoFactura(factura);
    if (pagado > 0) {
      ayuda.hidden = false;
      ayuda.textContent = `Esta factura ya tiene ${formatearMonto(pagado, factura.moneda)} imputados en pagos. Si cambiás el monto o la moneda, el saldo se recalcula.`;
    }
  }

  modal.showModal();
  document.getElementById('factura-proveedor').focus();
}

/** Valida y devuelve los datos de la factura, o null si hay errores. */
function validarFormulario() {
  limpiarErrores(form);
  let valido = true;

  const proveedorInput = document.getElementById('factura-proveedor');
  const numeroInput = document.getElementById('factura-numero');
  const fechaInput = document.getElementById('factura-fecha');
  const montoInput = document.getElementById('factura-monto');

  const idActual = document.getElementById('factura-id').value;
  const proveedorId = proveedorInput.value;
  const numero = numeroInput.value.trim();
  const fecha = fechaInput.value;
  const moneda = document.getElementById('factura-moneda').value;
  const montoTotal = parsearMonto(montoInput.value);

  if (!proveedorId) {
    marcarError(proveedorInput, 'Elegí un proveedor.');
    valido = false;
  }

  if (!numero) {
    marcarError(numeroInput, 'El número de factura es obligatorio.');
    valido = false;
  } else if (proveedorId) {
    // El mismo número puede repetirse entre proveedores distintos, pero no dentro de uno.
    const normalizar = (v) => (v || '').replace(/\s/g, '').toLowerCase();
    const duplicada = getState().facturas.find(
      (f) =>
        f.id !== idActual &&
        f.proveedorId === proveedorId &&
        normalizar(f.numero) === normalizar(numero)
    );
    if (duplicada) {
      marcarError(numeroInput, 'Ese proveedor ya tiene una factura con ese número.');
      valido = false;
    }
  }

  if (!fecha) {
    marcarError(fechaInput, 'La fecha es obligatoria.');
    valido = false;
  }

  if (!Number.isFinite(montoTotal) || montoTotal <= 0) {
    marcarError(montoInput, 'Ingresá un monto numérico mayor a cero.');
    valido = false;
  }

  if (!valido) return null;

  return { proveedorId, numero, fecha, moneda, montoTotal };
}

async function guardar(event) {
  event.preventDefault();

  const datos = validarFormulario();
  if (!datos) return;

  const boton = document.getElementById('btn-guardar-factura');
  const id = document.getElementById('factura-id').value;

  boton.disabled = true;
  boton.textContent = 'Guardando…';

  try {
    if (id) {
      await actualizarFactura(id, datos);
      mostrarToast('Factura actualizada.', 'exito');
    } else {
      await crearFactura(datos);
      mostrarToast('Factura creada.', 'exito');
    }
    modal.close();
  } catch (error) {
    mostrarToast(error.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar factura';
  }
}

/* ─────────────────────────────── Acciones ─────────────────────────────── */

async function pedirEliminar(id) {
  const factura = getFacturaPorId(id);
  if (!factura) return;

  // Borrarla dejaría pagos apuntando a una factura inexistente: hay que desimputarlos primero.
  const pagosImputados = getPagosDeFactura(id);
  if (pagosImputados.length > 0) {
    const detalle = pagosImputados
      .map((p) => `${formatearFecha(p.fecha)} por ${formatearMonto(p.imputaciones[id], factura.moneda)}`)
      .join(', ');
    mostrarToast(
      `No se puede eliminar: tiene ${pagosImputados.length} pago(s) imputado(s) (${detalle}). Quitá la imputación desde cada pago.`,
      'error'
    );
    return;
  }

  const ok = await confirmar({
    titulo: 'Eliminar factura',
    mensaje: `Se va a eliminar la factura ${factura.numero} de ${formatearMonto(
      factura.montoTotal,
      factura.moneda
    )}. Esta acción no se puede deshacer.`,
    textoAceptar: 'Eliminar',
  });
  if (!ok) return;

  try {
    await eliminarFactura(id);
    mostrarToast('Factura eliminada.', 'exito');
  } catch (error) {
    mostrarToast(error.message, 'error');
  }
}

/* ────────────────────────────── Inicialización ────────────────────────────── */

export function initFacturas() {
  document.getElementById('btn-nueva-factura').addEventListener('click', () => {
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

  tbody.addEventListener('click', (event) => {
    const boton = event.target.closest('button');
    if (!boton) return;

    if (boton.dataset.editar) abrirModal(getFacturaPorId(boton.dataset.editar));
    else if (boton.dataset.eliminar) pedirEliminar(boton.dataset.eliminar);
  });

  document.getElementById('filtro-factura-proveedor').addEventListener('change', (e) =>
    setFiltrosFacturas({ proveedorId: e.target.value })
  );
  document.getElementById('filtro-factura-moneda').addEventListener('change', (e) =>
    setFiltrosFacturas({ moneda: e.target.value })
  );
  document.getElementById('filtro-factura-estado').addEventListener('change', (e) =>
    setFiltrosFacturas({ estado: e.target.value })
  );

  document.getElementById('btn-limpiar-filtros-facturas').addEventListener('click', () => {
    ['filtro-factura-proveedor', 'filtro-factura-moneda', 'filtro-factura-estado'].forEach(
      (id) => (document.getElementById(id).value = '')
    );
    limpiarFiltrosFacturas();
  });
}
