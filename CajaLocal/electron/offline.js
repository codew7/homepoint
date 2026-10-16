// =============================================================================
//  offline.js - Modo de emergencia "Offline"
// =============================================================================
//  Si se corta internet, la caja de escritorio puede seguir vendiendo con el usuario
//  "Offline". Cada venta se guarda primero en un archivo en el disco y se sube
//  a Firebase sola, en el mismo orden, cuando vuelve la conexión
//  (modoOffline.js, en la página).
//
//  Este archivo hace la parte del programa:
//   1. Está disponible en todas las PCs con el programa: el usuario "Offline"
//      aparece solo cuando no hay internet. Que venda un solo equipo a la vez
//      lo advierte la caja al elegirlo (usuarioActivo.js).
//   2. La bandeja de pedidos, en %APPDATA%\Caja HomePoint\pedidos:
//        pendientes\  los que todavía no se subieron (NUNCA se borran solos);
//        subidos\     los ya confirmados en Firebase, como respaldo 30 días.
//      Cada pedido es un archivo "<orden>_<id>.json". El orden es un número
//      correlativo que no se repite: es el orden en que se suben.
//   3. El estado de internet, que se avisa a las ventanas.
//   4. Copias del catálogo y la cotización (copias-offline\), para poder
//      cobrar sin internet.
//
//  La bandeja vive acá y no en el navegador a propósito: no depende del puerto
//  (8123/8124/8125 son "sitios" distintos para el navegador) ni de que alguien
//  borre los datos de navegación.
// =============================================================================

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const CHEQUEO_INTERNET_MS = 10 * 1000;
// Cuántas pruebas seguidas tienen que fallar para dar internet por caído:
// un corte de un par de segundos no tiene que ofrecer el modo Offline.
const FALLOS_PARA_SIN_INTERNET = 2;
const RESPALDO_DIAS = 30;

// Un id de Firebase (push key): 20 caracteres de este alfabeto.
const ID_VALIDO = /^[A-Za-z0-9_-]{20}$/;
// Nombre de una copia (catálogo, cotización): también es el nombre del archivo.
const CLAVE_COPIA = /^[a-z0-9-]{1,40}$/;

let carpetas = null;
let log = console;
let probarInternet = async () => true;

// `habilitada` queda siempre en true: la página (modoOffline.js) lo sigue
// leyendo para saber que está en el programa de escritorio.
const estado = {
  habilitada: true,
  internet: true
};

// ----------------------------------------------------------------- disco ---
function rutas() {
  if (carpetas) return carpetas;
  const base = app.getPath('userData');
  carpetas = {
    pedidos: path.join(base, 'pedidos'),
    pendientes: path.join(base, 'pedidos', 'pendientes'),
    subidos: path.join(base, 'pedidos', 'subidos'),
    secuencia: path.join(base, 'pedidos', 'secuencia.txt'),
    copias: path.join(base, 'copias-offline')
  };
  fs.mkdirSync(carpetas.pendientes, { recursive: true });
  fs.mkdirSync(carpetas.subidos, { recursive: true });
  fs.mkdirSync(carpetas.copias, { recursive: true });
  return carpetas;
}

// Escritura que nunca deja un archivo a medias: se escribe aparte, se fuerza
// al disco y recién ahí toma el nombre final (renombrar es todo o nada).
function escribirSeguro(destino, texto) {
  const temporal = destino + '.tmp';
  const fd = fs.openSync(temporal, 'w');
  try {
    fs.writeSync(fd, texto);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporal, destino);
}

function leerJson(archivo) {
  return JSON.parse(fs.readFileSync(archivo, 'utf8'));
}

function archivosDe(carpeta) {
  return fs.readdirSync(carpeta).filter((n) => /^\d{8}_[A-Za-z0-9_-]{20}\.json$/.test(n)).sort();
}

function archivoDe(carpeta, id) {
  return archivosDe(carpeta).find((n) => n.endsWith('_' + id + '.json')) || null;
}

function siguienteOrden() {
  const r = rutas();
  let ultimo = 0;
  try { ultimo = parseInt(fs.readFileSync(r.secuencia, 'utf8'), 10) || 0; } catch {}
  // Por si el contador se perdió: nunca por debajo de lo que ya hay en disco.
  for (const carpeta of [r.pendientes, r.subidos]) {
    for (const nombre of archivosDe(carpeta)) ultimo = Math.max(ultimo, parseInt(nombre, 10) || 0);
  }
  const orden = ultimo + 1;
  escribirSeguro(r.secuencia, String(orden));
  return orden;
}

// ------------------------------------------------------------- bandeja ---
// Todo es sincrónico a propósito: el proceso principal atiende un pedido por
// vez, así dos ventanas nunca reciben el mismo número de orden.
function guardarPedido(entrada) {
  if (!entrada || typeof entrada !== 'object') throw new Error('Pedido vacío');
  if (!ID_VALIDO.test(entrada.id || '')) throw new Error('Id de pedido inválido');
  if (!entrada.actualizaciones || typeof entrada.actualizaciones !== 'object') throw new Error('Pedido sin datos');
  const r = rutas();
  // El mismo pedido dos veces (doble clic, reintento): se devuelve el que ya está.
  const existente = archivoDe(r.pendientes, entrada.id) || archivoDe(r.subidos, entrada.id);
  if (existente) return { orden: parseInt(existente, 10) };

  const orden = siguienteOrden();
  const registro = {
    ...entrada,
    orden,
    guardadoEn: Date.now(),
    intentos: 0,
    ultimoError: null
  };
  const nombre = String(orden).padStart(8, '0') + '_' + entrada.id + '.json';
  escribirSeguro(path.join(r.pendientes, nombre), JSON.stringify(registro));
  log.info(`Offline: pedido ${entrada.id} guardado en la bandeja (orden ${orden})`);
  return { orden };
}

function listarPendientes() {
  const r = rutas();
  const lista = [];
  for (const nombre of archivosDe(r.pendientes)) {
    try {
      lista.push(leerJson(path.join(r.pendientes, nombre)));
    } catch (error) {
      // Un archivo ilegible no se borra ni se saltea en silencio: frena la
      // subida (los que siguen esperan) y queda a la vista para soporte.
      log.error(`Offline: no se pudo leer ${nombre}:`, error.message);
      lista.push({ id: nombre.slice(9, 29), orden: parseInt(nombre, 10), ilegible: true, ultimoError: 'Archivo ilegible: ' + nombre });
    }
  }
  return lista.sort((a, b) => a.orden - b.orden);
}

function marcarSubido(id) {
  const r = rutas();
  const nombre = archivoDe(r.pendientes, id);
  if (!nombre) return { ok: true };
  const origen = path.join(r.pendientes, nombre);
  const registro = leerJson(origen);
  registro.subidoEn = Date.now();
  // Primero la copia en "subidos", después se quita de "pendientes": si se
  // corta la luz en el medio queda en las dos, y la página lo vuelve a
  // reconocer como ya subido.
  escribirSeguro(path.join(r.subidos, nombre), JSON.stringify(registro));
  fs.unlinkSync(origen);
  log.info(`Offline: pedido ${id} confirmado en Firebase`);
  return { ok: true };
}

function marcarError(id, mensaje) {
  const r = rutas();
  const nombre = archivoDe(r.pendientes, id);
  if (!nombre) return { ok: false };
  const archivo = path.join(r.pendientes, nombre);
  const registro = leerJson(archivo);
  registro.intentos = (registro.intentos || 0) + 1;
  registro.ultimoError = String(mensaje || 'Error desconocido').slice(0, 500);
  registro.ultimoIntento = Date.now();
  escribirSeguro(archivo, JSON.stringify(registro));
  log.warn(`Offline: el pedido ${id} no se pudo subir (intento ${registro.intentos}): ${registro.ultimoError}`);
  return { ok: true };
}

function limpiarRespaldo() {
  const r = rutas();
  const limite = Date.now() - RESPALDO_DIAS * 24 * 60 * 60 * 1000;
  for (const nombre of archivosDe(r.subidos)) {
    const archivo = path.join(r.subidos, nombre);
    try {
      if (fs.statSync(archivo).mtimeMs < limite) fs.unlinkSync(archivo);
    } catch {}
  }
}

// --------------------------------------------------------------- internet ---
function avisar() {
  for (const ventana of BrowserWindow.getAllWindows()) {
    if (!ventana.isDestroyed() && !ventana.webContents.isDestroyed()) {
      ventana.webContents.send('offline:estado', { ...estado });
    }
  }
}

let vigilando = false;
let fallos = 0;

function vigilarInternet() {
  if (vigilando) return;
  vigilando = true;
  const revisar = async () => {
    const hay = await probarInternet();
    fallos = hay ? 0 : fallos + 1;
    const nuevo = hay ? true : (fallos >= FALLOS_PARA_SIN_INTERNET ? false : estado.internet);
    if (nuevo !== estado.internet) {
      estado.internet = nuevo;
      log.info(`Offline: ${nuevo ? 'volvió internet' : 'sin internet'}`);
      avisar();
    }
  };
  revisar();
  setInterval(revisar, CHEQUEO_INTERNET_MS);
}

// ------------------------------------------------------------------ inicio ---
function esPantallaDeCaja(evento) {
  try {
    const u = new URL(evento.senderFrame ? evento.senderFrame.url : evento.sender.getURL());
    return u.protocol === 'http:' && u.hostname === 'localhost';
  } catch {
    return false;
  }
}

// Cada pedido de la página pasa por acá: si algo falla, la página recibe el
// error (y no limpia el formulario).
function atender(canal, fn) {
  ipcMain.handle(canal, (evento, ...args) => {
    if (!esPantallaDeCaja(evento)) throw new Error('Solo disponible en la caja');
    return fn(...args);
  });
}

function iniciarOffline(opciones) {
  log = opciones.log || console;
  probarInternet = opciones.hayInternet || probarInternet;
  rutas();
  vigilarInternet();
  try { limpiarRespaldo(); } catch (error) { log.warn('Offline: no se pudo limpiar el respaldo:', error.message); }

  ipcMain.handle('offline:obtener', () => ({ ...estado }));

  atender('offline:cola-guardar', (entrada) => guardarPedido(entrada));
  atender('offline:cola-listar', () => listarPendientes());
  atender('offline:cola-subido', (id) => marcarSubido(id));
  atender('offline:cola-error', (id, mensaje) => marcarError(id, mensaje));

  // Copias de lo que la caja necesita para vender sin internet: el catálogo y
  // la cotización. Se guardan cada vez que llegan de internet.
  atender('offline:copia-guardar', (clave, datos) => {
    if (!CLAVE_COPIA.test(clave || '')) throw new Error('Clave inválida');
    escribirSeguro(path.join(rutas().copias, clave + '.json'), JSON.stringify({ fecha: Date.now(), datos }));
    return { ok: true };
  });
  atender('offline:copia-leer', (clave) => {
    if (!CLAVE_COPIA.test(clave || '')) throw new Error('Clave inválida');
    try {
      return leerJson(path.join(rutas().copias, clave + '.json'));
    } catch {
      return null;
    }
  });
}

function hayPendientes() {
  try { return archivosDe(rutas().pendientes).length > 0; } catch { return false; }
}

module.exports = {
  iniciarOffline,
  estadoOffline: () => ({ ...estado }),
  hayPendientes
};
