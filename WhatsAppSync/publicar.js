'use strict';
// =====================================================================
// Publicar una actualizacion de WhatsAppSync (lo usa publicar-actualizacion.bat)
//
//   1. Sube un numero la version (1.7.0 -> 1.7.1).
//   2. Arma el instalador (npm run instalador).
//   3. Lo sube al release fijo "whatsappsync" de codew7/homepoint (es un
//      pre-release: asi la app Android de pedidos, que busca el "ultimo
//      release", nunca lo toma).
//   4. Avisa por Firebase (actualizacion/ en la base de Envios) para que
//      todas las PCs se actualicen al instante. Las que no reciban el aviso
//      lo encuentran solas en 10 minutos como mucho.
//
// Las PCs se actualizan solas, sin preguntar: bajan la version, se cierran
// y se vuelven a abrir.
//
// Necesita un token de GitHub (se pide la primera vez y queda en
// .token-github, que no se sube a git).
//
//   node publicar.js                     pregunta que cambio
//   node publicar.js "texto de cambios"  sin preguntas
//   node publicar.js --solo-subir "..."  no arma nada: sube el instalador ya
//                                        armado de la version actual (si la
//                                        subida fallo la vez anterior)
// =====================================================================

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');

const REPO = 'codew7/homepoint';
const ETIQUETA = 'whatsappsync';
const DIR = __dirname;
const ARCHIVO_TOKEN = path.join(DIR, '.token-github');
const ARCHIVO_PAQUETE = path.join(DIR, 'package.json');
const API = 'https://api.github.com/repos/' + REPO;

function preguntar(texto) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(texto, (resp) => { rl.close(); r(String(resp || '').trim()); }));
}
function paso(texto) { console.log('\n== ' + texto); }
function fallar(texto) {
  console.log('\nNO SE PUBLICÓ: ' + texto);
  process.exit(1);
}

// ---------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------
let TOKEN = '';
async function gh(metodo, url, cuerpo, extra = {}) {
  const r = await fetch(url.startsWith('http') ? url : API + url, {
    method: metodo,
    headers: Object.assign({
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'publicar-whatsappsync'
    }, cuerpo && !Buffer.isBuffer(cuerpo) ? { 'Content-Type': 'application/json' } : {}, extra.headers || {}),
    body: cuerpo ? (Buffer.isBuffer(cuerpo) ? cuerpo : JSON.stringify(cuerpo)) : undefined
  });
  const texto = await r.text();
  let datos = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch (_) { datos = texto; }
  return { ok: r.ok, status: r.status, datos };
}

async function conseguirToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  try { const t = fs.readFileSync(ARCHIVO_TOKEN, 'utf8').trim(); if (t) return t; } catch (_) { /* primera vez */ }
  console.log(`
Falta el token de GitHub (se pide una sola vez en esta PC).
Cómo sacarlo:
  1. Entrá a https://github.com/settings/personal-access-tokens/new
  2. Nombre: "Publicar WhatsAppSync". Vencimiento: el más largo que te deje.
  3. Repository access: "Only select repositories" -> homepoint.
  4. Permissions -> Repository permissions -> Contents: "Read and write".
  5. Generate token, copialo y pegalo acá abajo (clic derecho pega en esta ventana).
`);
  const t = await preguntar('Token: ');
  if (!t) fallar('no se cargó el token.');
  return t;
}

async function subirArchivo(release, archivo, nombre, tipo) {
  // Si ya hay uno con ese nombre (por ejemplo latest.yml), se reemplaza
  const viejo = (release.assets || []).find(a => a.name === nombre);
  const datos = fs.readFileSync(archivo);
  const url = release.upload_url.replace(/\{.*\}$/, '') + '?name=' + encodeURIComponent(nombre);
  for (let intento = 1; intento <= 3; intento++) {
    if (viejo && intento === 1) {
      const b = await gh('DELETE', '/releases/assets/' + viejo.id);
      if (!b.ok && b.status !== 404) fallar('no se pudo reemplazar ' + nombre + ' (HTTP ' + b.status + ').');
    }
    try {
      const r = await gh('POST', url, datos, { headers: { 'Content-Type': tipo } });
      if (r.ok) return r.datos;
      if (r.status === 422) {   // quedo uno a medias con ese nombre: se borra y se reintenta
        const lista = await gh('GET', '/releases/' + release.id + '/assets?per_page=100');
        const resto = (lista.datos || []).find(a => a.name === nombre);
        if (resto) await gh('DELETE', '/releases/assets/' + resto.id);
      }
      console.log('   reintentando ' + nombre + ' (HTTP ' + r.status + ')...');
    } catch (e) {
      console.log('   reintentando ' + nombre + ' (' + e.message + ')...');
    }
  }
  fallar('no se pudo subir ' + nombre + '. Revisá la conexión y volvé a correr el publicador.');
}

// ---------------------------------------------------------------------
// Aviso por Firebase a todas las PCs
// ---------------------------------------------------------------------
async function avisarPorFirebase(version, notas) {
  // El aviso va siempre a la base fija de ajustes.js (DATABASE_URL), que es
  // la que escuchan todas las PCs, sea cual sea su linea principal. Se busca
  // en esta PC una clave de ese mismo proyecto.
  const ajustes = require('./ajustes');
  const dirLineas = path.join(process.env.APPDATA || '', 'WhatsAppSync', 'lineas');
  const claves = [path.join(DIR, 'clave-firebase.json'), path.join(process.env.APPDATA || '', 'WhatsAppSync', 'firebase', 'clave.json')];
  try { for (const id of fs.readdirSync(dirLineas)) claves.push(path.join(dirLineas, id, 'clave-firebase.json')); } catch (_) { /* sin app instalada */ }
  claves.push(path.join(process.env.APPDATA || '', 'WhatsAppSync', 'clave-firebase.json'));
  const host = String(ajustes.DATABASE_URL || '').replace(/^https:\/\//, '');
  const archivo = claves.find(c => {
    try {
      const proyecto = JSON.parse(fs.readFileSync(c, 'utf8')).project_id;
      return proyecto && (host.startsWith(proyecto + '-default-rtdb') || host.startsWith(proyecto + '.'));
    } catch (_) { return false; }
  });
  if (!archivo) {
    console.log('   No encontré en esta PC la clave del proyecto de ' + host + ': las PCs la van a encontrar solas en 10 minutos como mucho.');
    return;
  }
  const { initializeApp, cert } = require('firebase-admin/app');
  const { getDatabase } = require('firebase-admin/database');
  const appFb = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(archivo, 'utf8'))), databaseURL: ajustes.DATABASE_URL }, 'publicar');
  const db = getDatabase(appFb);
  await db.ref('actualizacion').set({ version, t: Date.now(), notas: notas || '' });
  await appFb.delete();
  console.log('   Listo: las PCs prendidas se actualizan en unos segundos.');
}

// ---------------------------------------------------------------------
// Programa
// ---------------------------------------------------------------------
(async () => {
  console.log('Publicar una actualización de WhatsAppSync');
  console.log('------------------------------------------');

  TOKEN = await conseguirToken();
  const prueba = await gh('GET', '');
  if (!prueba.ok) {
    try { fs.unlinkSync(ARCHIVO_TOKEN); } catch (_) { /* no estaba */ }
    fallar('el token no sirve (HTTP ' + prueba.status + '). Volvé a correr el publicador y pegá uno nuevo.');
  }
  if (!process.env.GH_TOKEN) fs.writeFileSync(ARCHIVO_TOKEN, TOKEN);

  const SOLO_SUBIR = process.argv.includes('--solo-subir');
  const notas = process.argv.slice(2).filter(a => a !== '--solo-subir').join(' ').trim() || await preguntar('\n¿Qué cambió en esta versión? (opcional, Enter para seguir): ');

  // 1. Version nueva
  const crudo = fs.readFileSync(ARCHIVO_PAQUETE, 'utf8');
  const paquete = JSON.parse(crudo);
  let anterior = paquete.version;
  let version;
  if (SOLO_SUBIR) {
    version = paquete.version;
    anterior = '';   // no se borran instaladores viejos del release
    paso('Solo subir la versión ' + version + ' (ya armada)');
  } else {
    const p = anterior.split('.').map(n => parseInt(n, 10) || 0);
    version = p[0] + '.' + p[1] + '.' + ((p[2] || 0) + 1);
    paquete.version = version;
    fs.writeFileSync(ARCHIVO_PAQUETE, JSON.stringify(paquete, null, 2) + '\n');
    paso('Versión ' + anterior + ' -> ' + version);
  }

  // 2. Instalador
  const exe = path.join(DIR, 'dist', 'WhatsAppSync-Setup-' + version + '.exe');
  const mapa = exe + '.blockmap';
  const yml = path.join(DIR, 'dist', 'latest.yml');
  let armado = { status: 0 };
  if (!SOLO_SUBIR) {
    paso('Armando el instalador (tarda un par de minutos)...');
    armado = spawnSync('npm', ['run', 'instalador'], { cwd: DIR, stdio: 'inherit', shell: true });
  }
  if (armado.status !== 0 || !fs.existsSync(exe) || !fs.existsSync(yml)) {
    if (SOLO_SUBIR) fallar('no está armado el instalador de la versión ' + version + ' (dist). Corré el publicador sin --solo-subir.');
    fs.writeFileSync(ARCHIVO_PAQUETE, crudo);   // se vuelve a la version anterior
    fallar('falló el armado del instalador (mirá los mensajes de arriba). La versión quedó en ' + anterior + '.');
  }
  if (!fs.readFileSync(yml, 'utf8').includes(version)) {
    fs.writeFileSync(ARCHIVO_PAQUETE, crudo);
    fallar('latest.yml no corresponde a la versión ' + version + '.');
  }

  // 3. Subir a GitHub
  paso('Subiendo a GitHub (puede tardar unos minutos)...');
  let r = await gh('GET', '/releases/tags/' + ETIQUETA);
  let release = r.datos;
  const titulo = 'WhatsAppSync ' + version + ' (actualizaciones automáticas)';
  const cuerpo = 'Versión ' + version + '.' + (notas ? '\n\n' + notas : '') +
    '\n\nLas PCs con WhatsAppSync instalado la descargan solas. No hace falta bajar nada a mano.';
  if (r.status === 404) {
    r = await gh('POST', '/releases', {
      tag_name: ETIQUETA, target_commitish: 'main', name: titulo, body: cuerpo,
      prerelease: true, make_latest: 'false'
    });
    if (!r.ok) fallar('no se pudo crear el release (HTTP ' + r.status + ': ' + JSON.stringify(r.datos).slice(0, 200) + ').');
    release = r.datos;
  } else if (!r.ok) {
    fallar('no se pudo leer el release (HTTP ' + r.status + ').');
  }
  // El instalador primero y latest.yml al final: asi ninguna PC ve la
  // version nueva antes de que su instalador este completo.
  await subirArchivo(release, exe, path.basename(exe), 'application/octet-stream');
  if (fs.existsSync(mapa)) await subirArchivo(release, mapa, path.basename(mapa), 'application/octet-stream');
  await subirArchivo(release, yml, 'latest.yml', 'text/yaml');
  await gh('PATCH', '/releases/' + release.id, { name: titulo, body: cuerpo, prerelease: true, make_latest: 'false' });
  console.log('   Subido.');

  // Se borran los instaladores viejos (queda el anterior, por si alguna PC lo esta bajando)
  const lista = await gh('GET', '/releases/' + release.id + '/assets?per_page=100');
  for (const a of lista.datos || []) {
    const m = /^WhatsAppSync-Setup-(\d+\.\d+\.\d+)\.exe(\.blockmap)?$/.exec(a.name);
    if (anterior && m && m[1] !== version && m[1] !== anterior) await gh('DELETE', '/releases/assets/' + a.id);
  }

  // 4. Aviso
  paso('Avisando a las PCs...');
  try { await avisarPorFirebase(version, notas); } catch (e) {
    console.log('   No se pudo avisar por Firebase (' + e.message + '). Las PCs la van a encontrar solas en 10 minutos como mucho.');
  }

  console.log('\nLISTO: versión ' + version + ' publicada.');
  console.log('Cada PC con WhatsAppSync la descarga, se cierra y se vuelve a abrir sola.');
  process.exit(0);
})().catch(e => {
  // "fetch failed" no dice nada: la causa real (DNS, conexion cortada...) va en e.cause
  const causa = e && e.cause ? ' (' + (e.cause.code || '') + ' ' + (e.cause.message || '') + ')' : '';
  fallar((e && e.message ? e.message : String(e)) + causa +
    '. Si el instalador ya se armó, para no armarlo de nuevo: node publicar.js --solo-subir');
});
