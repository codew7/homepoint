// =============================================================================
//  registroNube.js - Sube el registro diario de la caja a Firebase
// =============================================================================
//  Los .txt del registro (registro.js) se suben a la Realtime Database del
//  punto de venta, para verlos todos juntos en el panel web "Actividad de las
//  cajas" (actividadCajas.html) sin ir equipo por equipo.
//
//  Cuándo se sube (nada más que esto, a propósito):
//    · al abrir la caja, apenas hay una sesión iniciada;
//    · al cerrar la caja (se espera hasta TOPE_AL_CERRAR y se cierra igual);
//    · un día que ya terminó y nunca se subió (la caja que queda prendida
//      varios días seguidos), revisado cada media hora sin gastar nada si no
//      hay nada nuevo.
//  Sólo se manda un día si su archivo cambió desde la última subida, entero y
//  comprimido (gzip + base64): un día común pesa entre 2 y 40 KB.
//
//  Dónde (en la base del punto de venta del equipo):
//    registroCaja/archivos/<día>/<equipo>  { z: texto comprimido, b: bytes, t }
//    registroCaja/resumen/<día>/<equipo>   { b, n: eventos, u: usuarios, t }
//    registroCaja/equipos/<equipo>         { host, ver, pv, visto, nombre }
//  "nombre" lo pone el administrador desde el panel; la caja sólo lo lee para
//  mostrarlo en el selector de usuario.
//
//  Sesión: la caja no guarda contraseñas. La página (registroCaja.js) le pasa
//  al programa el token de Firebase del usuario con sesión iniciada, y con
//  él se escribe por la API REST. Sin sesión (o en modo Offline) no se sube
//  nada: queda para la próxima vez.
//
//  Que la subida falle nunca frena ni rompe la caja.
// =============================================================================

const { app, ipcMain, net } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const DIAS_GUARDADOS = 90;          // igual que el registro local
const ARCHIVO_DEL_DIA = /^\d{4}-\d{2}-\d{2}\.txt$/;
const TOPE_AL_CERRAR = 8000;        // ms que se espera la subida al cerrar
const TOPE_PEDIDO = 15000;          // ms por cada pedido a Firebase
const TOPE_COMPRIMIDO = 1900000;    // caracteres; las reglas aceptan hasta 2.000.000
const REVISION_DIAS_CERRADOS = 30 * 60 * 1000;

let log = console;
let carpetaRegistro = null;

let equipo = null;        // { id, nombre }
let credencial = null;    // { token, expira, db, pv, pvNombre }
let subiendo = null;      // promesa de la subida en curso
let subidoAlAbrir = false;
let equipoAnunciado = false;

// ---------------------------------------------------------------- archivos ---
function rutaDatos(nombre) { return path.join(app.getPath('userData'), nombre); }

function leerJson(nombre, defecto) {
  try { return JSON.parse(fs.readFileSync(rutaDatos(nombre), 'utf8')); } catch { return defecto; }
}

function guardarJson(nombre, datos) {
  try {
    const destino = rutaDatos(nombre);
    fs.writeFileSync(destino + '.tmp', JSON.stringify(datos), 'utf8');
    fs.renameSync(destino + '.tmp', destino);
  } catch (error) {
    log.warn(`Registro nube: no se pudo guardar ${nombre}:`, error.message);
  }
}

// Identidad del equipo: se crea una sola vez y queda en %APPDATA% (sobrevive a
// las actualizaciones y a reinstalar, porque el desinstalador no borra AppData).
function cargarEquipo() {
  const guardado = leerJson('equipo.json', null);
  if (guardado && /^[a-z0-9]{10,32}$/.test(guardado.id || '')) {
    equipo = { id: guardado.id, nombre: typeof guardado.nombre === 'string' ? guardado.nombre : '' };
  } else {
    equipo = { id: crypto.randomBytes(8).toString('hex'), nombre: '' };
    guardarJson('equipo.json', equipo);
  }
}

// Qué se subió de cada día, por base (si el equipo cambia de punto de venta,
// en la otra base no hay nada subido todavía).
function leerEstado(db) {
  const todo = leerJson('registro-nube.json', {});
  return (todo[db] && todo[db].dias) || {};
}

function guardarEstado(db, dias) {
  const todo = leerJson('registro-nube.json', {});
  todo[db] = { dias };
  guardarJson('registro-nube.json', todo);
}

function dos(n) { return String(n).padStart(2, '0'); }
function claveDelDia(fecha) { return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`; }

function diaDeCorte() {
  const f = new Date();
  f.setHours(0, 0, 0, 0);
  f.setDate(f.getDate() - DIAS_GUARDADOS);
  return claveDelDia(f);
}

function diasLocales() {
  const corte = diaDeCorte();
  const dias = [];
  let nombres = [];
  try { nombres = fs.readdirSync(carpetaRegistro()); } catch { return dias; }
  for (const nombre of nombres) {
    if (!ARCHIVO_DEL_DIA.test(nombre) || nombre.slice(0, 10) < corte) continue;
    try {
      dias.push({ dia: nombre.slice(0, 10), bytes: fs.statSync(path.join(carpetaRegistro(), nombre)).size });
    } catch {}
  }
  // El día más reciente primero: si el tiempo no alcanza, lo de hoy ya subió.
  return dias.sort((a, b) => (a.dia < b.dia ? 1 : -1));
}

// Cantidad de eventos y quiénes trabajaron: lo que el panel muestra antes de
// bajar el día entero.
function resumirTexto(texto) {
  let eventos = 0;
  const usuarios = new Set();
  for (const linea of texto.split(/\r?\n/)) {
    if (!/^\d\d:\d\d:\d\d  /.test(linea)) continue;
    eventos++;
    const u = linea.slice(15, 27).trim();
    if (u && u !== 'sistema' && u !== '—') usuarios.add(u);
  }
  return { n: eventos, u: [...usuarios].join(', ').slice(0, 300) };
}

// -------------------------------------------------------------------- red ---
function tokenVigente() {
  return credencial && credencial.token && credencial.expira - Date.now() > 60 * 1000;
}

async function pedir(metodo, ruta, cuerpo) {
  const controlador = new AbortController();
  const corte = setTimeout(() => controlador.abort(), TOPE_PEDIDO);
  try {
    // print=silent: Firebase no devuelve lo escrito (no se descarga nada).
    const url = `${credencial.db}/${ruta}.json?auth=${encodeURIComponent(credencial.token)}` +
      (metodo === 'GET' ? '' : '&print=silent');
    const respuesta = await net.fetch(url, {
      method: metodo,
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: controlador.signal,
      cache: 'no-store'
    });
    if (!respuesta.ok && respuesta.status !== 204) {
      const detalle = (await respuesta.text().catch(() => '')).slice(0, 160);
      const error = new Error(`Firebase respondió ${respuesta.status} ${detalle}`);
      error.status = respuesta.status;
      throw error;
    }
    return metodo === 'GET' ? respuesta.json() : null;
  } finally {
    clearTimeout(corte);
  }
}

const SELLO = { '.sv': 'timestamp' };

async function anunciarEquipo() {
  await pedir('PATCH', `registroCaja/equipos/${equipo.id}`, {
    host: os.hostname().slice(0, 60),
    ver: app.getVersion(),
    pv: String(credencial.pvNombre || '').slice(0, 60),
    visto: SELLO
  });
  // El nombre que le puso el administrador, para mostrarlo en la caja.
  try {
    const nombre = await pedir('GET', `registroCaja/equipos/${equipo.id}/nombre`);
    const limpio = typeof nombre === 'string' ? nombre.slice(0, 40) : '';
    if (limpio !== equipo.nombre) {
      equipo.nombre = limpio;
      guardarJson('equipo.json', equipo);
    }
  } catch {}
}

async function subirDia(dia, bytes) {
  const texto = fs.readFileSync(path.join(carpetaRegistro(), dia + '.txt'), 'utf8');
  const z = zlib.gzipSync(Buffer.from(texto, 'utf8'), { level: 9 }).toString('base64');
  if (z.length > TOPE_COMPRIMIDO) {
    log.warn(`Registro nube: el día ${dia} es demasiado grande para subirlo (${z.length} caracteres)`);
    return false;
  }
  const { n, u } = resumirTexto(texto);
  // Archivo y resumen juntos: o se escriben los dos o ninguno.
  await pedir('PATCH', 'registroCaja', {
    [`archivos/${dia}/${equipo.id}`]: { z, b: bytes, t: SELLO },
    [`resumen/${dia}/${equipo.id}`]: { b: bytes, n, u, t: SELLO }
  });
  return true;
}

// Lo de más de DIAS_GUARDADOS días que subió este equipo se borra de la base.
async function borrarViejos(db, estado) {
  const corte = diaDeCorte();
  const viejos = Object.keys(estado).filter((d) => d < corte);
  if (!viejos.length) return;
  const cambios = {};
  for (const dia of viejos) {
    cambios[`archivos/${dia}/${equipo.id}`] = null;
    cambios[`resumen/${dia}/${equipo.id}`] = null;
  }
  try {
    await pedir('PATCH', 'registroCaja', cambios);
    viejos.forEach((d) => { delete estado[d]; });
    guardarEstado(db, estado);
  } catch (error) {
    log.warn('Registro nube: no se pudieron borrar los días viejos:', error.message);
  }
}

// `soloCerrados`: sólo los días que ya terminaron (la revisión de cada media hora).
async function subirPendientes(motivo, soloCerrados) {
  if (!tokenVigente()) return { subidos: 0, pendientes: null };
  const db = credencial.db;
  const estado = leerEstado(db);
  const hoy = claveDelDia(new Date());
  const pendientes = diasLocales().filter((d) => estado[d.dia] !== d.bytes && !(soloCerrados && d.dia === hoy));
  if (!pendientes.length && equipoAnunciado) return { subidos: 0, pendientes: 0 };

  let subidos = 0;
  try {
    if (!equipoAnunciado || motivo === 'cierre') {
      await anunciarEquipo();
      equipoAnunciado = true;
    }
    for (const { dia, bytes } of pendientes) {
      if (!tokenVigente() || credencial.db !== db) break;
      try {
        if (await subirDia(dia, bytes)) {
          estado[dia] = bytes;
          guardarEstado(db, estado);
          subidos++;
        }
      } catch (error) {
        // 401/403: sesión vencida o reglas sin publicar; se reintenta otra vez.
        log.warn(`Registro nube: no se pudo subir el día ${dia}:`, error.message);
        if (error.status === 401 || error.status === 403) break;
      }
    }
    await borrarViejos(db, estado);
  } catch (error) {
    log.warn('Registro nube: no se pudo subir el registro:', error.message);
  }
  if (subidos) log.info(`Registro nube (${motivo}): ${subidos} día${subidos === 1 ? '' : 's'} subido${subidos === 1 ? '' : 's'}`);
  return { subidos, pendientes: pendientes.length - subidos };
}

// Una sola subida a la vez: si se pide otra mientras corre, espera a esa.
function subir(motivo, soloCerrados) {
  if (subiendo) return subiendo.then(() => (soloCerrados ? null : subir(motivo, false)));
  subiendo = subirPendientes(motivo, soloCerrados)
    .catch((error) => { log.warn('Registro nube:', error.message); })
    .finally(() => { subiendo = null; });
  return subiendo;
}

// Al cerrar: se sube lo que haya, con tope de tiempo. Nunca rechaza.
function subirAlCerrar() {
  if (!tokenVigente()) return Promise.resolve();
  return Promise.race([
    subir('cierre', false),
    new Promise((resolve) => setTimeout(resolve, TOPE_AL_CERRAR))
  ]).catch(() => {});
}

// ---------------------------------------------------------------- arranque ---
function esPantallaDeCaja(evento) {
  try {
    const u = new URL(evento.senderFrame ? evento.senderFrame.url : evento.sender.getURL());
    return u.protocol === 'http:' && u.hostname === 'localhost';
  } catch {
    return false;
  }
}

// Sólo una base de Firebase de verdad: el token nunca viaja a otro lado.
const BASE_VALIDA = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/;

function recibirCredencial(datos) {
  if (!datos || typeof datos !== 'object') return;
  const db = String(datos.db || '').replace(/\/+$/, '');
  const token = String(datos.token || '');
  const expira = Number(datos.expira) || 0;
  if (!BASE_VALIDA.test(db) || token.length < 100 || token.length > 4096 || expira < Date.now()) return;
  const otraBase = credencial && credencial.db !== db;
  credencial = { token, expira, db, pv: String(datos.pv || ''), pvNombre: String(datos.pvNombre || '') };
  if (otraBase) { equipoAnunciado = false; subidoAlAbrir = false; }
  if (!subidoAlAbrir) {
    subidoAlAbrir = true;
    subir('apertura', false);
  }
}

function iniciarRegistroNube(opciones) {
  log = opciones.log || console;
  carpetaRegistro = opciones.carpetaRegistro;
  cargarEquipo();

  ipcMain.on('registro:credencial', (evento, datos) => {
    if (!esPantallaDeCaja(evento)) return;
    try { recibirCredencial(datos); } catch (error) { log.warn('Registro nube:', error.message); }
  });
  // Nombre del equipo para el selector de usuario (preload.js, síncrono).
  ipcMain.on('caja:equipo', (evento) => {
    evento.returnValue = { id: equipo.id, nombre: equipo.nombre, host: os.hostname() };
  });

  // Caja que queda prendida varios días: el día que terminó se sube igual.
  setInterval(() => { if (tokenVigente()) subir('día cerrado', true); }, REVISION_DIAS_CERRADOS).unref();
}

module.exports = { iniciarRegistroNube, subirAlCerrar };
