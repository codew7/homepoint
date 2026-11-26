'use strict';
// ---------------------------------------------------------------------
// Mudanza UNICA de los datos de WhatsApp al formato de lineas.
//
// Antes todo estaba en la raiz de la base (chats/, imgs/, imgsIdx/,
// asigManual/, envios/). Ahora cada linea va en su nodo: lineas/<nodo>/...
// Esto pasa lo de la raiz a lineas/envios/ (envios/ -> despachos/).
//
//   node migrar-a-lineas.js            -> solo mide y muestra que haria
//   node migrar-a-lineas.js --mudar    -> muda de verdad
//
// - Mueve por partes (un chat o un grupo de fotos por vez: copia y despues
//   borra el original), asi no se duplica el espacio de la base.
// - No pisa nada: si la version nueva de WhatsAppSync ya escribio algo en
//   lineas/envios, eso se respeta (mensajes por id, meta/ultimo el mayor, los
//   campos que ya esten no se cambian).
// - Se puede cortar y volver a correr: sigue con lo que quede en la raiz.
// - "actualizacion" se queda en la raiz (lo usan todas las PCs).
//
// Clave: %APPDATA%\WhatsAppSync\firebase\clave.json (la de la app) o
// clave-firebase.json junto a este archivo.
// ---------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const AJUSTES = require('./ajustes');

const MUDAR = process.argv.includes('--mudar');
const DESTINO = 'lineas/' + (AJUSTES.NODO_POR_DEFECTO || 'envios');
const TANDA = 400;   // rutas por escritura

const CLAVES = [
  path.join(process.env.APPDATA || '', 'WhatsAppSync', 'firebase', 'clave.json'),
  path.join(__dirname, 'clave-firebase.json'),
  path.join(process.env.APPDATA || '', 'WhatsAppSync', 'lineas', 'principal', 'clave-firebase.json')
];
const archivoClave = CLAVES.find(c => fs.existsSync(c));
if (!archivoClave) {
  console.log('No encontré la clave de Firebase. Se buscó en:\n  ' + CLAVES.join('\n  '));
  process.exit(2);
}
const db = getDatabase(initializeApp({
  credential: cert(JSON.parse(fs.readFileSync(archivoClave, 'utf8'))),
  databaseURL: AJUSTES.DATABASE_URL
}));

function log(...a) { console.log('[' + new Date().toLocaleTimeString('es-AR', { hour12: false }) + ']', ...a); }
function mb(bytes) { return (bytes / 1048576).toFixed(1) + ' MB'; }

async function leer(ruta) { return (await db.ref(ruta).once('value')).val(); }

// Claves de primer nivel de un nodo, sin bajar su contenido (REST shallow)
async function clavesDe(ruta) {
  const token = await db.app.options.credential.getAccessToken();
  const url = AJUSTES.DATABASE_URL.replace(/\/+$/, '') + '/' + ruta + '.json?shallow=true&access_token=' + encodeURIComponent(token.access_token);
  const r = await fetch(url);
  if (!r.ok) throw new Error('no se pudo listar ' + ruta + ' (' + r.status + ')');
  const j = await r.json();
  return j && typeof j === 'object' ? Object.keys(j) : [];
}

async function escribir(rutas) {
  const claves = Object.keys(rutas);
  for (let i = 0; i < claves.length; i += TANDA) {
    const parte = {};
    for (const k of claves.slice(i, i + TANDA)) parte[k] = rutas[k];
    await db.ref().update(parte);
  }
}

// Agrega a "rutas" lo de "viejo" que no este en "nuevo", hoja por hoja
// (los objetos se recorren; un valor que ya esta en el destino no se toca).
function completar(rutas, base, viejo, nuevo) {
  if (viejo === null || viejo === undefined) return;
  if (typeof viejo !== 'object' || Array.isArray(viejo)) {
    if (nuevo === null || nuevo === undefined) rutas[base] = viejo;
    return;
  }
  if (nuevo === null || nuevo === undefined || typeof nuevo !== 'object') {
    if (nuevo === null || nuevo === undefined) { rutas[base] = viejo; return; }
    return;   // en el destino hay un valor simple: se respeta
  }
  for (const [k, v] of Object.entries(viejo)) completar(rutas, base + '/' + k, v, nuevo[k]);
}

// Mueve un elemento (copia lo que falta, despues borra el original)
async function mover(origen, destino, especial) {
  const viejo = await leer(origen);
  if (viejo === null) return 0;
  const nuevo = await leer(destino);
  const rutas = {};
  completar(rutas, destino, viejo, nuevo);
  if (especial) especial(rutas, viejo, nuevo);
  if (Object.keys(rutas).length) await escribir(rutas);
  await db.ref(origen).remove();
  return Buffer.byteLength(JSON.stringify(viejo));
}

// meta/ultimo: el mayor de los dos
function metaUltimo(destino) {
  return (rutas, viejo, nuevo) => {
    if (rutas[destino] !== undefined) return;   // se copia entero: ya lleva su meta
    const a = Number(viejo && viejo.meta && viejo.meta.ultimo) || 0;
    const b = Number(nuevo && nuevo.meta && nuevo.meta.ultimo) || 0;
    if (a > b) rutas[destino + '/meta/ultimo'] = a;
  };
}

const NODOS = [
  // [origen, destino, como se recorre]
  ['chats', DESTINO + '/chats', 'porHijo'],
  ['imgs', DESTINO + '/imgs', 'porHijo'],
  ['imgsIdx', DESTINO + '/imgsIdx', 'porTandas'],
  ['asigManual', DESTINO + '/asigManual', 'entero'],
  ['envios', DESTINO + '/despachos', 'entero']
];

(async () => {
  log('Base:', AJUSTES.DATABASE_URL);
  log('Destino:', DESTINO);
  log(MUDAR ? 'MODO MUDANZA: se mueven los datos.' : 'Modo medición (no se cambia nada). Para mudar: node migrar-a-lineas.js --mudar');

  // 1. Medir
  const resumen = {};
  for (const [origen] of NODOS) {
    const claves = await clavesDe(origen);
    resumen[origen] = claves;
    log('  ' + origen + ': ' + claves.length + ' elementos en la raíz');
  }
  if (!MUDAR) {
    let total = 0;
    for (const [origen] of NODOS) {
      if (origen === 'imgs' || origen === 'chats') continue;   // pesados: no se bajan para medir
      const v = await leer(origen);
      const t = v ? Buffer.byteLength(JSON.stringify(v)) : 0;
      total += t;
      log('  ' + origen + ' pesa ' + mb(t));
    }
    log('Listo (medición). chats e imgs se miden al mudar, de a uno.');
    process.exit(0);
  }

  // 2. Mudar
  let bytes = 0;
  for (const [origen, destino, modo] of NODOS) {
    const claves = resumen[origen];
    if (!claves.length) { log(origen + ': nada para mudar.'); continue; }
    log(origen + ' → ' + destino + ' (' + claves.length + ')...');
    if (modo === 'entero') {
      bytes += await mover(origen, destino);
    } else if (modo === 'porHijo') {
      let n = 0;
      for (const k of claves) {
        bytes += await mover(origen + '/' + k, destino + '/' + k, origen === 'chats' ? metaUltimo(destino + '/' + k) : null);
        if (++n % 25 === 0) log('  ' + origen + ': ' + n + ' de ' + claves.length + ' (' + mb(bytes) + ' movidos)');
      }
    } else {   // porTandas: imgsIdx, de a 300 entradas
      for (let i = 0; i < claves.length; i += 300) {
        const grupo = claves.slice(i, i + 300);
        const rutas = {};
        const borrar = {};
        for (const k of grupo) {
          const [viejo, nuevo] = await Promise.all([leer(origen + '/' + k), leer(destino + '/' + k)]);
          if (viejo === null) continue;
          completar(rutas, destino + '/' + k, viejo, nuevo);
          borrar[origen + '/' + k] = null;
          bytes += Buffer.byteLength(JSON.stringify(viejo));
        }
        if (Object.keys(rutas).length) await escribir(rutas);
        if (Object.keys(borrar).length) await escribir(borrar);
        log('  ' + origen + ': ' + Math.min(i + 300, claves.length) + ' de ' + claves.length);
      }
    }
  }

  // 3. Comprobar
  log('Comprobando...');
  let quedan = 0;
  for (const [origen, destino] of NODOS) {
    const enRaiz = (await clavesDe(origen)).length;
    const enDestino = (await clavesDe(destino)).length;
    quedan += enRaiz;
    log('  ' + destino + ': ' + enDestino + ' elementos' + (enRaiz ? ' — ATENCIÓN: quedan ' + enRaiz + ' en la raíz (volver a correr)' : ''));
  }
  log(quedan ? 'Terminó con pendientes: volvé a correrlo.' : 'Mudanza completa (' + mb(bytes) + ' movidos). En la raíz quedan solo "lineas" y "actualizacion".');
  process.exit(quedan ? 1 : 0);
})().catch(e => {
  log('Error:', e && e.message ? e.message : e);
  log('No se perdió nada: lo que no se movió sigue en la raíz. Volvé a correrlo.');
  process.exit(1);
});
