/**
 * Vista de informes: estado de cuenta filtrable por proveedor y período,
 * con vista previa en pantalla y descarga en PDF.
 *
 * El cálculo vive en store.js (getEstadoDeCuenta) y la generación del PDF en pdf.js:
 * este módulo solo une los filtros con esas dos piezas.
 */

import { getState, getEstadoDeCuenta } from './store.js';
import { generarPdfEstadoDeCuenta } from './pdf.js';
import { formatearMonto, formatearFecha, escaparHtml, mostrarToast } from './utils.js';

const preview = document.getElementById('informe-preview');

const NOMBRE_MONEDA = { ARS: 'Pesos (ARS)', USD: 'Dólares (USD)' };

/** Filtros vigentes, leídos del DOM. */
function getFiltros() {
  return {
    proveedorId: document.getElementById('informe-proveedor').value,
    desde: document.getElementById('informe-desde').value,
    hasta: document.getElementById('informe-hasta').value,
  };
}

/** Texto del período para el encabezado del informe. */
function textoPeriodo({ desde, hasta }) {
  if (desde && hasta) return `${formatearFecha(desde)} al ${formatearFecha(hasta)}`;
  if (desde) return `desde el ${formatearFecha(desde)}`;
  if (hasta) return `hasta el ${formatearFecha(hasta)}`;
  return 'Todos los movimientos';
}

function nombreProveedor({ proveedorId }) {
  if (!proveedorId) return 'Todos los proveedores';
  return getState().proveedores.find((p) => p.id === proveedorId)?.nombre || 'Proveedor';
}

/* ──────────────────────────── Vista previa ──────────────────────────── */

export function renderInformes() {
  renderSelectInforme();

  const filtros = getFiltros();
  const secciones = getEstadoDeCuenta(filtros);

  document.getElementById('btn-descargar-pdf').disabled = secciones.length === 0;

  if (secciones.length === 0) {
    preview.innerHTML = `
      <p class="vacio">
        No hay movimientos para ${escaparHtml(nombreProveedor(filtros).toLowerCase())}
        en el período seleccionado.
      </p>`;
    return;
  }

  preview.innerHTML = `
    <div class="informe__header">
      <div>
        <h3 class="informe__titulo">Estado de cuenta</h3>
        <p class="informe__dato"><strong>Proveedor:</strong> ${escaparHtml(nombreProveedor(filtros))}</p>
        <p class="informe__dato"><strong>Período:</strong> ${escaparHtml(textoPeriodo(filtros))}</p>
      </div>
      <p class="informe__dato informe__dato--emision">Vista previa</p>
    </div>
    ${secciones.map(renderSeccion).join('')}`;
}

function renderSeccion(seccion) {
  const { proveedor, moneda, saldoAnterior, movimientos, totalDebe, totalHaber, saldoFinal, estado } =
    seccion;

  const filas = movimientos
    .map(
      (mov) => `
        <tr>
          <td class="num" style="text-align:left">${formatearFecha(mov.fecha)}</td>
          <td>${escaparHtml(mov.descripcion)}</td>
          <td class="num">${mov.debe ? formatearMonto(mov.debe, moneda) : ''}</td>
          <td class="num">${mov.haber ? formatearMonto(mov.haber, moneda) : ''}</td>
          <td class="num"><strong>${formatearMonto(mov.saldo, moneda)}</strong></td>
        </tr>`
    )
    .join('');

  return `
    <section class="informe__seccion">
      <h4 class="informe__seccion-titulo">
        ${escaparHtml(proveedor.nombre)}
        <span class="chip chip--${moneda === 'USD' ? 'usd' : 'ars'}">${moneda}</span>
      </h4>

      <div class="tabla-wrap">
        <table class="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Concepto</th>
              <th class="ta-right">Debe</th>
              <th class="ta-right">Haber</th>
              <th class="ta-right">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr class="informe__saldo-anterior">
              <td colspan="4"><em>Saldo anterior</em></td>
              <td class="num"><em>${formatearMonto(saldoAnterior, moneda)}</em></td>
            </tr>
            ${filas}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2">Totales del período</td>
              <td class="num">${formatearMonto(totalDebe, moneda)}</td>
              <td class="num">${formatearMonto(totalHaber, moneda)}</td>
              <td class="num">${formatearMonto(saldoFinal, moneda)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p class="informe__cierre">
        Saldo final ·
        <strong class="${estado === 'deudor' ? 'balance--deudor' : estado === 'favor' ? 'balance--favor' : ''}">
          ${formatearMonto(saldoFinal, moneda)}
        </strong>
      </p>
    </section>`;
}

/** Rellena el <select> de proveedor conservando la selección. */
function renderSelectInforme() {
  const select = document.getElementById('informe-proveedor');
  const seleccion = select.value;

  // Incluye los dados de baja: su historial se sigue pudiendo informar.
  select.innerHTML =
    '<option value="">Todos</option>' +
    getState()
      .proveedores.map(
        (p) =>
          `<option value="${p.id}">${escaparHtml(p.nombre)}${p.activo === false ? ' (baja)' : ''}</option>`
      )
      .join('');
  select.value = seleccion;
}

/* ──────────────────────────────── Descarga ──────────────────────────────── */

/** Nombre de archivo sin espacios ni caracteres problemáticos. */
function nombreArchivo(filtros) {
  const limpiar = (t) =>
    (t || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // saca los acentos que NFD dejó sueltos
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

  const partes = ['Estado_de_cuenta', limpiar(nombreProveedor(filtros))];
  if (filtros.desde) partes.push(limpiar(filtros.desde));
  if (filtros.hasta) partes.push(limpiar(filtros.hasta));

  return `${partes.join('_')}.pdf`;
}

async function descargar() {
  const boton = document.getElementById('btn-descargar-pdf');
  const filtros = getFiltros();
  const secciones = getEstadoDeCuenta(filtros);

  if (secciones.length === 0) {
    mostrarToast('No hay movimientos para informar en ese período.', 'info');
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Generando…';

  try {
    await generarPdfEstadoDeCuenta(secciones, {
      proveedor: nombreProveedor(filtros),
      periodo: textoPeriodo(filtros),
      archivo: nombreArchivo(filtros),
    });
    mostrarToast('Informe descargado.', 'exito');
  } catch (error) {
    mostrarToast(error.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Descargar PDF';
  }
}

/* ────────────────────────────── Inicialización ────────────────────────────── */

export function initInformes() {
  ['informe-proveedor', 'informe-desde', 'informe-hasta'].forEach((id) =>
    document.getElementById(id).addEventListener('change', renderInformes)
  );

  document.getElementById('btn-limpiar-informe').addEventListener('click', () => {
    ['informe-proveedor', 'informe-desde', 'informe-hasta'].forEach(
      (id) => (document.getElementById(id).value = '')
    );
    renderInformes();
  });

  document.getElementById('btn-descargar-pdf').addEventListener('click', descargar);
}
