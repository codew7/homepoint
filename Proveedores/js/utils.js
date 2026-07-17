/** Helpers de formato, validación y feedback visual. */

const formatoARS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
});

const formatoUSD = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});

/**
 * @param {number} monto
 * @param {'ARS'|'USD'} moneda
 */
export function formatearMonto(monto, moneda = 'ARS') {
  const valor = Number(monto) || 0;
  return moneda === 'USD' ? formatoUSD.format(valor) : formatoARS.format(valor);
}

/** Convierte 'YYYY-MM-DD' (valor de un <input type="date">) a 'DD/MM/AAAA'. */
export function formatearFecha(fechaISO) {
  if (!fechaISO) return '—';
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
}

/** Fecha de hoy en formato 'YYYY-MM-DD' según la zona horaria local. */
export function hoyISO() {
  const ahora = new Date();
  const offsetMs = ahora.getTimezoneOffset() * 60 * 1000;
  return new Date(ahora.getTime() - offsetMs).toISOString().slice(0, 10);
}

/** Timestamp (ms) a texto legible corto. */
export function formatearTimestamp(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Interpreta montos escritos en formato local ("1.234,56", "100.000") o plano ("1234.56").
 *
 * El punto es ambiguo: en es-AR "100.000" es cien mil, pero JavaScript lo leería como 100.
 * Reglas, en orden:
 *   - Con coma  → la coma es el decimal y los puntos son miles: "1.234,56" → 1234.56
 *   - Varios puntos → todos son miles: "1.234.567" → 1234567
 *   - Un punto con exactamente 3 dígitos detrás → miles: "100.000" → 100000
 *   - Un punto con otra cantidad de dígitos → decimal: "1234.56" → 1234.56
 *
 * @returns {number} NaN si no es interpretable.
 */
export function parsearMonto(texto) {
  if (typeof texto === 'number') return texto;
  if (!texto) return NaN;

  let limpio = String(texto).trim().replace(/\s/g, '');
  if (!/^-?[\d.,]+$/.test(limpio)) return NaN;

  if (limpio.includes(',')) {
    limpio = limpio.replace(/\./g, '').replace(',', '.');
  } else {
    const puntos = limpio.split('.').length - 1;
    const ultimoTramo = limpio.slice(limpio.lastIndexOf('.') + 1);

    // "100.000" y "1.234.567" son miles; "1234.56" es decimal.
    if (puntos > 1 || (puntos === 1 && ultimoTramo.length === 3)) {
      limpio = limpio.replace(/\./g, '');
    }
  }

  return Number(limpio);
}

/** Escapa texto que se inyecta como HTML. */
export function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

/**
 * HTML de una tarjeta de totales. La usan las vistas de pagos, facturas y resumen.
 * @param {{label:string, valor:string, detalle?:string, clase?:string}} opciones
 */
export function tarjetaTotal({ label, valor, detalle, clase = 'general' }) {
  return `
    <div class="total-card total-card--${clase}">
      <div class="total-card__label">${label}</div>
      <div class="total-card__valor">${valor}</div>
      ${detalle ? `<div class="total-card__detalle">${detalle}</div>` : ''}
    </div>`;
}

/* ─────────────────────────────── Feedback ─────────────────────────────── */

let toastTimeout = null;

/**
 * Muestra un mensaje flotante.
 * @param {string} mensaje
 * @param {'exito'|'error'|'info'} tipo
 */
export function mostrarToast(mensaje, tipo = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = mensaje;
  toast.className = `toast toast--${tipo} toast--visible`;
  toast.setAttribute('role', tipo === 'error' ? 'alert' : 'status');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('toast--visible');
  }, tipo === 'error' ? 5000 : 3000);
}

/** Marca un campo con error y muestra el mensaje debajo. */
export function marcarError(input, mensaje) {
  input.classList.add('input--error');
  const contenedor = input.closest('.campo');
  const ayuda = contenedor?.querySelector('.campo__error');
  if (ayuda) ayuda.textContent = mensaje;
}

/** Limpia los errores de todos los campos de un formulario. */
export function limpiarErrores(form) {
  form.querySelectorAll('.input--error').forEach((el) => el.classList.remove('input--error'));
  form.querySelectorAll('.campo__error').forEach((el) => (el.textContent = ''));
}
