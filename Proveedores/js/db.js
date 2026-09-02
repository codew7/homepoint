/**
 * Capa de acceso a Firebase Realtime Database.
 *
 * Estructura de datos:
 *   proveedores/{id} → { nombre, cuit, telefono, notas, activo, creadoEn, actualizadoEn }
 *   facturas/{id}    → { proveedorId, numero, fecha, moneda, montoTotal, creadoEn, actualizadoEn }
 *   pagos/{id}       → { proveedorId, fecha, moneda, monto, cotizacion, montoARS,
 *                        concepto, metodoPago, imputaciones, creadoEn }
 *                      imputaciones: { facturaId: monto } — monto en la moneda de la factura.
 *   config/cotizacion → { valor, fuente, actualizadoEn }
 *
 * Todas las funciones lanzan Error con mensaje legible si algo falla; quien llama
 * decide cómo mostrarlo.
 */

import {
  getDatabase,
  ref,
  push,
  set,
  update,
  get,
  child,
  onValue,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

import { getFirebaseApp } from './firebase-app.js';
import { DB_PATHS } from './firebase-config.js';

let db = null;

/**
 * Inicializa la base una sola vez, sobre la app compartida con Auth.
 * Se llama recién con sesión iniciada: las reglas de la base exigen usuario.
 */
export function initDb() {
  if (db) return db;
  db = getDatabase(getFirebaseApp());
  return db;
}

function requireDb() {
  if (!db) throw new Error('La base de datos no fue inicializada.');
  return db;
}

/**
 * Convierte el snapshot de un nodo (objeto de objetos) en un array con el id incluido.
 * Realtime Database devuelve null si el nodo no existe.
 */
function snapshotToArray(snapshot) {
  const value = snapshot.val();
  if (!value) return [];
  return Object.entries(value).map(([id, data]) => ({ id, ...data }));
}

/* ─────────────────────────── Suscripciones en vivo ─────────────────────────── */

/**
 * Escucha cambios en un nodo raíz. Devuelve la función para desuscribirse.
 * @param {string} path
 * @param {(items: object[]) => void} onData
 * @param {(error: Error) => void} onError
 */
function subscribeToCollection(path, onData, onError) {
  const nodeRef = ref(requireDb(), path);
  return onValue(
    nodeRef,
    (snapshot) => onData(snapshotToArray(snapshot)),
    (error) => onError(new Error(`No se pudo leer "${path}": ${error.message}`))
  );
}

export const subscribeProveedores = (onData, onError) =>
  subscribeToCollection(DB_PATHS.proveedores, onData, onError);

export const subscribePagos = (onData, onError) =>
  subscribeToCollection(DB_PATHS.pagos, onData, onError);

export const subscribeFacturas = (onData, onError) =>
  subscribeToCollection(DB_PATHS.facturas, onData, onError);

/* ─────────────────────────────── Proveedores ─────────────────────────────── */

export async function crearProveedor(datos) {
  try {
    const nodeRef = push(ref(requireDb(), DB_PATHS.proveedores));
    const ahora = Date.now();
    await set(nodeRef, { ...datos, activo: true, creadoEn: ahora, actualizadoEn: ahora });
    return nodeRef.key;
  } catch (error) {
    throw new Error(`No se pudo crear el proveedor: ${error.message}`);
  }
}

export async function actualizarProveedor(id, datos) {
  try {
    await update(ref(requireDb(), `${DB_PATHS.proveedores}/${id}`), {
      ...datos,
      actualizadoEn: Date.now(),
    });
  } catch (error) {
    throw new Error(`No se pudo actualizar el proveedor: ${error.message}`);
  }
}

/**
 * Baja lógica: marca activo=false. No se borra el registro para no romper el
 * historial de pagos, que referencia al proveedor por id.
 */
export async function darDeBajaProveedor(id) {
  try {
    await update(ref(requireDb(), `${DB_PATHS.proveedores}/${id}`), {
      activo: false,
      actualizadoEn: Date.now(),
    });
  } catch (error) {
    throw new Error(`No se pudo dar de baja el proveedor: ${error.message}`);
  }
}

export async function reactivarProveedor(id) {
  try {
    await update(ref(requireDb(), `${DB_PATHS.proveedores}/${id}`), {
      activo: true,
      actualizadoEn: Date.now(),
    });
  } catch (error) {
    throw new Error(`No se pudo reactivar el proveedor: ${error.message}`);
  }
}

/* ───────────────────────────────── Facturas ───────────────────────────────── */

export async function crearFactura(datos) {
  try {
    const nodeRef = push(ref(requireDb(), DB_PATHS.facturas));
    const ahora = Date.now();
    await set(nodeRef, { ...datos, creadoEn: ahora, actualizadoEn: ahora });
    return nodeRef.key;
  } catch (error) {
    throw new Error(`No se pudo crear la factura: ${error.message}`);
  }
}

export async function actualizarFactura(id, datos) {
  try {
    await update(ref(requireDb(), `${DB_PATHS.facturas}/${id}`), {
      ...datos,
      actualizadoEn: Date.now(),
    });
  } catch (error) {
    throw new Error(`No se pudo actualizar la factura: ${error.message}`);
  }
}

/**
 * Borrado real. Quien llama debe verificar antes que ningún pago la tenga imputada:
 * si no, esos pagos quedarían apuntando a una factura inexistente.
 */
export async function eliminarFactura(id) {
  try {
    await set(ref(requireDb(), `${DB_PATHS.facturas}/${id}`), null);
  } catch (error) {
    throw new Error(`No se pudo eliminar la factura: ${error.message}`);
  }
}

/* ────────────────────────────────── Pagos ────────────────────────────────── */

export async function crearPago(datos) {
  try {
    const nodeRef = push(ref(requireDb(), DB_PATHS.pagos));
    await set(nodeRef, { ...datos, creadoEn: Date.now() });
    return nodeRef.key;
  } catch (error) {
    throw new Error(`No se pudo registrar el pago: ${error.message}`);
  }
}

export async function actualizarPago(id, datos) {
  try {
    await update(ref(requireDb(), `${DB_PATHS.pagos}/${id}`), {
      ...datos,
      actualizadoEn: Date.now(),
    });
  } catch (error) {
    throw new Error(`No se pudo actualizar el pago: ${error.message}`);
  }
}

/** Los pagos sí se eliminan de verdad: son asientos puntuales, no entidades. */
export async function eliminarPago(id) {
  try {
    await set(ref(requireDb(), `${DB_PATHS.pagos}/${id}`), null);
  } catch (error) {
    throw new Error(`No se pudo eliminar el pago: ${error.message}`);
  }
}

/* ───────────────────────── Cotización persistida ───────────────────────── */

export async function guardarCotizacion({ valor, fuente }) {
  try {
    await set(ref(requireDb(), `${DB_PATHS.config}/cotizacion`), {
      valor,
      fuente,
      actualizadoEn: Date.now(),
    });
  } catch (error) {
    throw new Error(`No se pudo guardar la cotización: ${error.message}`);
  }
}

export async function leerCotizacion() {
  try {
    const snapshot = await get(child(ref(requireDb()), `${DB_PATHS.config}/cotizacion`));
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    throw new Error(`No se pudo leer la cotización: ${error.message}`);
  }
}
