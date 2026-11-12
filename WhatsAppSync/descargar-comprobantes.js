// ---------------------------------------------------------------------
// Descarga de comprobantes de pago
//
// Baja de Firebase los comprobantes de pago que guarda WhatsAppSync a la
// carpeta "comprobantes" (junto a este archivo). Es incremental: solo baja
// los que todavia no tiene, asi que se puede correr las veces que haga falta.
//
//   node descargar-comprobantes.js            -> una pasada y termina
//   node descargar-comprobantes.js --seguir   -> queda abierto y revisa cada
//                                                MINUTOS_ENTRE_REVISIONES
//   --json   ademas de los mensajes, escribe una linea "@@{...}" por cada
//            evento (la usa el Verificador de comprobantes para mostrar el estado)
//
// Nombre de cada archivo:
//   <cliente> - <codigo de pedido> - <fecha>.jpg
//   ej.  Pablo Ariel Saez - 3FQ7ZK2A - 2026-11-12.jpg
// El codigo es el mismo que muestra pedidosv2 (ultimos 8 caracteres del
// pedido, en mayusculas). Si el comprobante todavia no tiene pedido asignado
// se guarda como "<nombre de WhatsApp o telefono> - SIN PEDIDO - <fecha>" y,
// cuando se le asigna uno (solo o a mano en pedidosv2), el archivo se renombra.
// Si hay dos del mismo cliente, pedido y dia, el segundo lleva " (2)".
// Si el sistema no esta seguro de que sea un comprobante, se agrega
// " (dudoso)" al final del nombre.
// Si se cambia el formato, subir FORMATO: los ya bajados se renombran.
//
// Marcas del Verificador de comprobantes: el verificador deja su resultado en
// comprobantes/verificacion.json ({ id: { s, n, m, t } }) y este script es el
// unico que renombra: agrega " [ALTERADO]", " [REVISAR]" o " [RECHAZADO]" al
// nombre y sube el resultado a Firebase (imgsIdx/{id}/verif) para que
// pedidosv2 lo muestre en el pedido. Lo revisa cada SEGUNDOS_MARCAS.
//
// Los archivos bajados no se borran nunca, aunque Firebase borre la foto a
// los DIAS_FOTOS dias. Lo que ya se bajo se anota en comprobantes/registro.json
// (si se borra ese archivo, la proxima pasada vuelve a bajar todo).
// Mientras corre deja comprobantes/.descargando.lock: no puede haber dos a la vez.
//
// Las imagenes son las que guarda WhatsAppSync: achicadas, y de los PDF
// solo la primera pagina.
// ---------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const CFG = require('./ajustes');

const MINUTOS_ENTRE_REVISIONES = 5;
const SEGUNDOS_MARCAS = 15;
const FORMATO = 2;   // 2: cliente - pedido - fecha (sin hora)
const CARPETA = path.join(__dirname, 'comprobantes');
const ARCHIVO_REGISTRO = path.join(CARPETA, 'registro.json');
const ARCHIVO_VERIFICACION = path.join(CARPETA, 'verificacion.json');
const ARCHIVO_CANDADO = path.join(CARPETA, '.descargando.lock');
const JSON_EVENTOS = process.argv.includes('--json');

// Sufijo del nombre segun el resultado del verificador
const MARCAS = { rojo: ' [ALTERADO]', amarillo: ' [REVISAR]', rechazado: ' [RECHAZADO]' };

function log(...a) {
  const h = new Date().toLocaleTimeString('es-AR', { hour12: false });
  console.log('[' + h + ']', ...a);
}
function evento(ev, datos) {
  if (JSON_EVENTOS) console.log('@@' + JSON.stringify(Object.assign({ ev, t: Date.now() }, datos)));
}

// La clave esta junto a este archivo, o en la carpeta de datos de la app
// instalada (%APPDATA%\WhatsAppSync).
const CLAVES = [
  path.join(__dirname, 'clave-firebase.json'),
  path.join(process.env.APPDATA || '', 'WhatsAppSync', 'clave-firebase.json')
];
const archivoClave = CLAVES.find(c => fs.existsSync(c));
if (!archivoClave) {
  console.log('No se encontró clave-firebase.json (se buscó en: ' + CLAVES.join(' y ') + ').');
  evento('error', { codigo: 'clave', msg: 'Falta clave-firebase.json' });
  process.exit(2);
}

// Una sola descarga a la vez (por ejemplo, el .bat y el verificador)
function tomarCandado() {
  fs.mkdirSync(CARPETA, { recursive: true });
  for (let intento = 0; intento < 2; intento++) {
    try {
      fs.writeFileSync(ARCHIVO_CANDADO, String(process.pid), { flag: 'wx' });
      process.on('exit', () => { try { fs.unlinkSync(ARCHIVO_CANDADO); } catch (_) { /* nada */ } });
      for (const s of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) process.on(s, () => process.exit(0));
      return true;
    } catch (_) {
      let pid = 0;
      try { pid = Number(fs.readFileSync(ARCHIVO_CANDADO, 'utf8')); } catch (_) { continue; }   // se libero recien
      let vivo = false;
      try { process.kill(pid, 0); vivo = pid > 0 && pid !== process.pid; } catch (e) { vivo = e.code === 'EPERM'; }
      if (vivo) return false;
      try { fs.unlinkSync(ARCHIVO_CANDADO); } catch (_) { /* lo borro otro */ }   // quedo de una corrida cortada
    }
  }
  return false;
}
if (!tomarCandado()) {
  console.log('Ya hay otra descarga de comprobantes corriendo (otra ventana o el Verificador de comprobantes).');
  evento('error', { codigo: 'ocupado', msg: 'Ya hay otra descarga corriendo' });
  process.exit(3);
}

const db = getDatabase(initializeApp({
  credential: cert(JSON.parse(fs.readFileSync(archivoClave, 'utf8'))),
  databaseURL: CFG.DATABASE_URL
}));

// registro: { idComprobante: { archivo, pedido, comp, fmt, t, tel, doc, marca, verif } }
function leerJson(archivo) {
  try { return JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (_) { return {}; }
}
function guardarRegistro(reg) {
  const tmp = ARCHIVO_REGISTRO + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 1));
  fs.renameSync(tmp, ARCHIVO_REGISTRO);
}

// Saca lo que Windows no acepta en un nombre de archivo
function limpiarNombre(s) {
  return String(s || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60);
}

function fecha(t) {
  const d = new Date(t);
  const dos = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate());
}

function codigoPedido(id) {
  return String(id || '').slice(-8).toUpperCase();
}

// Nombre del cliente del pedido (base de pedidosv2, lectura publica)
const nombresPedido = new Map();
async function nombreDelPedido(id) {
  if (nombresPedido.has(id)) return nombresPedido.get(id);
  let nombre = '';
  try {
    const r = await fetch(CFG.PEDIDOS_DATABASE_URL + '/pedidos/' + encodeURIComponent(id) + '/cliente/nombre.json',
      { signal: AbortSignal.timeout(30000) });
    if (r.ok) nombre = String((await r.json()) || '').trim();
  } catch (_) { /* sin conexion: se usa el nombre de WhatsApp */ }
  nombresPedido.set(id, nombre);
  return nombre;
}

// Nombre de WhatsApp del chat
const nombresChat = new Map();
async function nombreDelChat(tel) {
  if (nombresChat.has(tel)) return nombresChat.get(tel);
  const n = String((await db.ref('chats/' + tel + '/meta/nombre').once('value')).val() || '').trim();
  nombresChat.set(tel, n);
  return n;
}

// Nombre de archivo que no choque con otro ya usado
function nombreLibre(base, usados, propio) {
  let nombre = base + '.jpg';
  for (let i = 2; usados.has(nombre.toLowerCase()) && nombre !== propio; i++) nombre = base + ' (' + i + ').jpg';
  return nombre;
}

async function nombreArchivo(v, marca) {
  let cliente = '';
  if (v.pedido) cliente = await nombreDelPedido(v.pedido);
  if (!cliente) cliente = await nombreDelChat(v.tel);
  if (!cliente) cliente = v.tel;
  const partes = [limpiarNombre(cliente) || v.tel, v.pedido ? codigoPedido(v.pedido) : 'SIN PEDIDO', fecha(v.t)];
  return partes.join(' - ') + (v.comp === 'duda' ? ' (dudoso)' : '') + (MARCAS[marca] ? MARCAS[marca] : '');
}

// Resultado del verificador para un comprobante: { s, n, m, t } o null
function resultado(ver, id) {
  const r = ver[id];
  return r && typeof r.s === 'string' ? r : null;
}

// Sube (o quita) el resultado del verificador en imgsIdx/{id}/verif.
// Solo si la entrada sigue en Firebase: si no, se crearia un nodo suelto.
async function subirResultado(id, r, ent) {
  const firma = r ? r.s + '|' + (r.n || '') : '';
  if ((ent.verif || '') === firma) return false;
  const ref = db.ref('imgsIdx/' + id);
  if ((await ref.child('t').once('value')).exists()) {
    if (r) await ref.child('verif').set({ s: r.s, n: Number(r.n) || 0, m: String(r.m || '').slice(0, 160), t: Number(r.t) || Date.now() });
    else await ref.child('verif').remove();
  }
  ent.verif = firma;
  return true;
}

let corriendo = false;
let marcasVistas = 0;   // mtime de verificacion.json ya procesado

// soloMarcas: no consulta la lista de Firebase ni baja nada; solo aplica los
// resultados nuevos del verificador a los archivos ya bajados.
async function pasada(soloMarcas) {
  if (corriendo) return;
  corriendo = true;
  nombresPedido.clear();   // por si se corrigio el nombre en pedidosv2
  nombresChat.clear();
  try {
    fs.mkdirSync(CARPETA, { recursive: true });
    try { marcasVistas = fs.statSync(ARCHIVO_VERIFICACION).mtimeMs; } catch (_) { marcasVistas = 0; }
    const reg = leerJson(ARCHIVO_REGISTRO);
    const ver = leerJson(ARCHIVO_VERIFICACION);
    const usados = new Set(Object.values(reg).map(r => r.archivo.toLowerCase()));

    const pagos = [];
    if (soloMarcas) {
      for (const [id, r] of Object.entries(reg)) {
        if (r.tel && r.t) pagos.push([id, { tel: r.tel, t: r.t, pedido: r.pedido, comp: r.comp, doc: r.doc }]);
      }
    } else {
      // Comprobantes de pago de los clientes (los remitos propios no)
      const snap = await db.ref('imgsIdx').once('value');
      snap.forEach(x => {
        const v = x.val() || {};
        if (v.tel && v.t && !v.yo && v.cat !== 'remito') pagos.push([x.key, v]);
      });
    }
    pagos.sort((a, b) => a[1].t - b[1].t);

    let nuevos = 0, renombrados = 0, faltan = 0, subidos = 0;
    for (const [id, v] of pagos) {
      const ya = reg[id];
      const r = resultado(ver, id);
      const marca = r ? r.s : '';
      const datos = { pedido: v.pedido || null, comp: v.comp || '', fmt: FORMATO, t: v.t, tel: v.tel, doc: !!v.doc, marca };
      if (ya && fs.existsSync(path.join(CARPETA, ya.archivo))) {
        // Ya bajado: se renombra solo si cambio el pedido asignado, el formato o la marca
        const igual = (ya.pedido || null) === datos.pedido && (ya.comp || '') === datos.comp &&
          (ya.fmt || 1) === FORMATO && (ya.marca || '') === marca;
        let cambio = !ya.t || !ya.tel;   // entradas de versiones anteriores: se completan
        if (!igual) {
          const nuevo = nombreLibre(await nombreArchivo(v, marca), usados, ya.archivo);
          if (nuevo !== ya.archivo) {
            fs.renameSync(path.join(CARPETA, ya.archivo), path.join(CARPETA, nuevo));
            usados.delete(ya.archivo.toLowerCase());
            usados.add(nuevo.toLowerCase());
            renombrados++;
          }
          ya.archivo = nuevo;
          cambio = true;
        }
        Object.assign(ya, datos);
        if (await subirResultado(id, r, ya)) { subidos++; cambio = true; }
        if (cambio) guardarRegistro(reg);
        continue;
      }
      if (soloMarcas) continue;

      if (ya) usados.delete(ya.archivo.toLowerCase());   // lo borraron a mano: se vuelve a bajar
      const b64 = (await db.ref('imgs/' + v.tel + '/' + id + '/d').once('value')).val();
      if (!b64) { faltan++; continue; }   // Firebase ya la borro (mas de DIAS_FOTOS dias)
      const archivo = nombreLibre(await nombreArchivo(v, marca), usados);
      fs.writeFileSync(path.join(CARPETA, archivo), Buffer.from(b64, 'base64'));
      const cuando = new Date(v.t);
      try { fs.utimesSync(path.join(CARPETA, archivo), cuando, cuando); } catch (_) { /* nada */ }
      usados.add(archivo.toLowerCase());
      reg[id] = Object.assign({ archivo }, datos);
      await subirResultado(id, r, reg[id]);
      guardarRegistro(reg);
      nuevos++;
    }
    if (soloMarcas) {
      if (renombrados || subidos) log('Marcas del verificador: ' + renombrados + ' archivos renombrados.');
      evento('marcas', { renombrados, subidos });
    } else {
      log('Comprobantes: ' + nuevos + ' nuevos, ' + renombrados + ' renombrados' +
        (faltan ? ', ' + faltan + ' ya no estaban en Firebase' : '') +
        '. Total en la carpeta: ' + Object.keys(reg).length + '.');
      evento('pasada', { nuevos, renombrados, faltan, total: Object.keys(reg).length });
    }
  } catch (e) {
    log('Error descargando comprobantes:', e.message);
    evento('error', { codigo: 'pasada', msg: e.message });
  } finally {
    corriendo = false;
  }
}

// Revision liviana: si el verificador dejo resultados nuevos, se aplican ya
function revisarMarcas() {
  let mtime = 0;
  try { mtime = fs.statSync(ARCHIVO_VERIFICACION).mtimeMs; } catch (_) { /* todavia no hay */ }
  if (mtime && mtime !== marcasVistas) pasada(true);
}

(async () => {
  const seguir = process.argv.includes('--seguir');
  log('Carpeta de destino: ' + CARPETA);
  evento('inicio', { carpeta: CARPETA, minutos: MINUTOS_ENTRE_REVISIONES });
  await pasada(false);
  if (!seguir) process.exit(0);
  log('Revisando cada ' + MINUTOS_ENTRE_REVISIONES + ' minutos. Para cortar, cerrá esta ventana.');
  setInterval(() => pasada(false), MINUTOS_ENTRE_REVISIONES * 60000);
  setInterval(revisarMarcas, SEGUNDOS_MARCAS * 1000);
})();
