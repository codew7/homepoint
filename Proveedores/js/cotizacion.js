/**
 * ════════════════════════════════════════════════════════════════════════════
 *  MÓDULO DE COTIZACIÓN DEL DÓLAR
 *  Punto único de integración con la API externa. Nada fuera de este archivo
 *  sabe de dónde sale el valor del dólar.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Fuente: bluelytics (https://api.bluelytics.com.ar/v2/latest). Se traen el
 * dólar Oficial y el Blue (valor de venta), solo para MOSTRARLOS en el header y
 * usar el oficial como placeholder del campo de cotización del modal de pago.
 *
 * Estos valores NO se persisten en Firebase ni se usan en cálculos: la cotización
 * de cada pago se sigue tipeando a mano y se congela con ese pago (ver invariantes
 * en CLAUDE.md). Por eso este módulo no toca db.js.
 */

const BLUELYTICS_URL = 'https://api.bluelytics.com.ar/v2/latest';

/** Milisegundos antes de abortar la llamada y conservar el último valor conocido. */
const TIMEOUT_MS = 5000;

/** Caché en memoria: el header y el placeholder lo leen sin volver a pegarle a la API. */
let dolar = { oficial: null, blue: null, actualizadoEn: null, error: null };

/** @returns {{oficial:number|null, blue:number|null, actualizadoEn:number|null, error:string|null}} */
export function getDolar() {
  return { ...dolar };
}

/**
 * Trae Oficial y Blue de bluelytics y actualiza el caché. Ante cualquier falla
 * (red, timeout, dato inválido) conserva el último valor conocido y marca `error`,
 * para que la app nunca se quede sin nada que mostrar.
 */
export async function refrescarDolar() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(BLUELYTICS_URL, { cache: 'no-store', signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const oficial = Number(data?.oficial?.value_sell);
    const blue = Number(data?.blue?.value_sell);

    if (!Number.isFinite(oficial) || oficial <= 0 || !Number.isFinite(blue) || blue <= 0) {
      throw new Error('La API devolvió una cotización inválida.');
    }

    dolar = { oficial, blue, actualizadoEn: Date.now(), error: null };
  } catch (error) {
    console.warn('No se pudo obtener la cotización de bluelytics:', error);
    dolar = { ...dolar, error: error.message || 'error' };
  }

  return getDolar();
}
