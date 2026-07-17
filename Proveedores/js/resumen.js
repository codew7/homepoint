/**
 * Vista de resumen: balance de la cuenta corriente con cada proveedor.
 *
 * Responde "¿cómo estoy con este proveedor?" cruzando lo facturado con lo pagado:
 *   balance = facturado − pagado   →  positivo: le debemos · negativo: tenemos saldo a favor
 */

import { getBalancePorProveedor, getTotalesBalance } from './store.js';
import { formatearMonto, escaparHtml, tarjetaTotal } from './utils.js';

const ETIQUETA_ESTADO = { deudor: 'Deudor', favor: 'A favor', saldada: 'Saldada' };
const NOMBRE_MONEDA = { ARS: 'Pesos', USD: 'Dólares' };

export function renderResumen() {
  const filas = getBalancePorProveedor();

  const vacio = document.getElementById('resumen-vacio');
  vacio.classList.toggle('vacio--oculto', filas.length > 0);

  document.getElementById('tbody-resumen').innerHTML = filas
    .map(({ proveedor, moneda, facturado, pagado, balance, estado }) => {
      // Al usuario le sirve más ver "$60.000 a favor" que un signo menos fácil de pasar por alto.
      const claseBalance = estado === 'deudor' ? 'balance--deudor' : estado === 'favor' ? 'balance--favor' : '';

      return `
        <tr>
          <td>
            ${escaparHtml(proveedor.nombre)}
            ${proveedor.activo === false ? '<span class="chip chip--baja">Baja</span>' : ''}
          </td>
          <td><span class="chip chip--${moneda === 'USD' ? 'usd' : 'ars'}">${moneda}</span></td>
          <td class="num">${formatearMonto(facturado, moneda)}</td>
          <td class="num">${formatearMonto(pagado, moneda)}</td>
          <td class="num">
            <strong class="${claseBalance}">${formatearMonto(Math.abs(balance), moneda)}</strong>
          </td>
          <td><span class="chip chip--${estado}">${ETIQUETA_ESTADO[estado]}</span></td>
        </tr>`;
    })
    .join('');

  renderTotalesBalance(filas);
}

/**
 * Tarjetas de deuda y saldo a favor, por moneda.
 * Deuda y saldo a favor van en tarjetas separadas: compensar lo que le debemos a un proveedor
 * con lo que otro nos debe daría un número que no significa nada.
 */
function renderTotalesBalance(filas) {
  const totales = getTotalesBalance(filas);
  const tarjetas = [];
  const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

  ['ARS', 'USD'].forEach((moneda) => {
    const { deuda, aFavor, deudores, aFavorCant } = totales[moneda];

    if (deuda > 0) {
      tarjetas.push(
        tarjetaTotal({
          clase: 'deuda',
          label: `Deuda total · ${NOMBRE_MONEDA[moneda]}`,
          valor: formatearMonto(deuda, moneda),
          detalle: plural(deudores, 'proveedor', 'proveedores'),
        })
      );
    }

    if (aFavor > 0) {
      tarjetas.push(
        tarjetaTotal({
          clase: 'favor',
          label: `Saldo a favor · ${NOMBRE_MONEDA[moneda]}`,
          valor: formatearMonto(aFavor, moneda),
          detalle: plural(aFavorCant, 'proveedor', 'proveedores'),
        })
      );
    }
  });

  if (tarjetas.length === 0) {
    tarjetas.push(
      tarjetaTotal({
        clase: 'general',
        label: 'Balance',
        valor: 'Sin movimientos',
        detalle: 'Cargá facturas y pagos para ver el balance',
      })
    );
  }

  document.getElementById('totales-generales').innerHTML = tarjetas.join('');
}
