'use strict';
// =====================================================================
// Sincronizador de WhatsApp -> Firebase (proyecto aparte, solo lectura
// desde pedidosv2).
//
// Usa Baileys: se conecta directo a WhatsApp como "dispositivo vinculado",
// sin navegador. Copia cada mensaje de los chats individuales a:
//
//   chats/{tel}/meta            { nombre, jid, ultimo }
//   chats/{tel}/msgs/{idMsg}    { t, yo, tipo, tx, borrado?, editado? }
//
// {tel} = ultimos 10 digitos del numero (ej. 1176460030). pedidosv2 arma la
// misma clave desde el telefono del cliente, asi que da igual si en el pedido
// se cargo con 0, con +54 o con 549.
//
// Solo lee: nunca envia mensajes ni marca como leido. Grupos, estados y
// canales se ignoran. Fotos, audios y documentos se guardan como texto
// ("Foto", "Audio"...), sin el archivo.
// =====================================================================

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const qrTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const pino = require('pino');
const sharp = require('sharp');
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const CFG = require('./ajustes');

// Instalado, la app de bandeja (app/main.js) lo lanza con WAS_DATOS apuntando
// a %APPDATA%\WhatsAppSync, porque la carpeta de instalacion no se puede
// escribir. Suelto (node index.js), todo queda junto a este archivo.
const DIR = process.env.WAS_DATOS || __dirname;
fs.mkdirSync(DIR, { recursive: true });
const ARCHIVO_CLAVE = path.join(DIR, 'clave-firebase.json');
const DIR_SESION = path.join(DIR, 'sesion');
const ARCHIVO_LIDS = path.join(DIR, 'lids.json');
const ARCHIVO_CLIENTES = path.join(DIR, 'clientes-tel.json');
const ARCHIVO_QR = path.join(DIR, 'qr.html');
let qrAbierto = false;
const DIR_LOGS = path.join(DIR, 'logs');

// Avisos a la ventana de la app de bandeja (si corre dentro de ella)
const padre = process.parentPort || null;
function avisar(evento) {
  if (padre) { try { padre.postMessage(evento); } catch (_) { /* ventana cerrandose */ } }
}

// ---------------------------------------------------------------------
// Log a consola y a archivo (uno por dia)
// ---------------------------------------------------------------------
fs.mkdirSync(DIR_LOGS, { recursive: true });
function log(...partes) {
  const ahora = new Date();
  const linea = '[' + ahora.toLocaleString('es-AR', { hour12: false }) + '] ' + partes.join(' ');
  console.log(linea);
  avisar({ tipo: 'log', linea });
  try {
    const dia = ahora.toISOString().slice(0, 10);
    fs.appendFileSync(path.join(DIR_LOGS, dia + '.log'), linea + '\n');
  } catch (_) { /* el log nunca debe tirar abajo el programa */ }
}

// ---------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------
if (!fs.existsSync(ARCHIVO_CLAVE)) {
  log('FALTA la clave de Firebase: guardala como', ARCHIVO_CLAVE);
  log('Ver LEEME.md, paso 5.');
  avisar({ tipo: 'falta-clave' });
  setTimeout(() => process.exit(2), 300);
  return;
}
if (!CFG.DATABASE_URL || CFG.DATABASE_URL.includes('PEGAR-ACA')) {
  log('FALTA la URL de la base: completá DATABASE_URL en ajustes.js (LEEME.md, paso 6).');
  process.exit(2);
}
const db = getDatabase(initializeApp({
  credential: cert(require(ARCHIVO_CLAVE)),
  databaseURL: CFG.DATABASE_URL
}));

// RTDB acepta updates con muchas rutas, pero conviene no mandar miles juntas
async function escribir(rutas) {
  const claves = Object.keys(rutas);
  for (let i = 0; i < claves.length; i += 400) {
    const parte = {};
    for (const k of claves.slice(i, i + 400)) parte[k] = rutas[k];
    await db.ref().update(parte);
  }
}

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function claveTelefono(numero) {
  let d = String(numero || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  return d.length >= 8 ? d.slice(-10) : '';
}

// RTDB no acepta . # $ [ ] / en las claves
function claveSegura(s) {
  return String(s).replace(/[.#$[\]/]/g, '_');
}

// "5491112345678:3@s.whatsapp.net" -> "5491112345678"
function usuarioDeJid(jid) {
  return String(jid || '').split('@')[0].split(':')[0];
}

function aNumero(ts) {
  if (ts == null) return 0;
  if (typeof ts === 'object' && typeof ts.toNumber === 'function') return ts.toNumber();
  return Number(ts) || 0;
}

// WhatsApp a veces identifica al contacto con un id interno (@lid) en vez del
// telefono. Las equivalencias que va mandando se guardan en lids.json para
// no perderlas entre reinicios.
let lids = {};
try { lids = JSON.parse(fs.readFileSync(ARCHIVO_LIDS, 'utf8')); } catch (_) { lids = {}; }
let lidsPendientes = false;
function anotarLid(lid, pn) {
  if (!lid || !pn) return;
  const l = usuarioDeJid(lid);
  const p = usuarioDeJid(pn);
  if (!l || !p || lids[l] === p) return;
  lids[l] = p;
  lidsPendientes = true;
}
setInterval(() => {
  if (!lidsPendientes) return;
  lidsPendientes = false;
  try { fs.writeFileSync(ARCHIVO_LIDS, JSON.stringify(lids)); } catch (e) { log('No se pudo guardar lids.json:', e.message); }
}, 15000);

// ---------------------------------------------------------------------
// Programa principal (Baileys se carga con import porque es un modulo ES)
// ---------------------------------------------------------------------
(async () => {
  const B = await import('baileys');
  const makeWASocket = B.default;
  const { useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason,
    normalizeMessageContent, getContentType, isLidUser, isPnUser, proto, downloadMediaMessage } = B;
  const TIPO_REVOCAR = proto.Message.ProtocolMessage.Type.REVOKE;
  const TIPO_EDITAR = proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;

  let sock = null;

  function esChatIndividual(jid) {
    return !!(isPnUser(jid) || isLidUser(jid));
  }

  async function telefonoDeChat(key) {
    const jid = key.remoteJid;
    if (isPnUser(jid)) return usuarioDeJid(jid);
    if (!isLidUser(jid)) return '';
    if (key.remoteJidAlt && isPnUser(key.remoteJidAlt)) {
      anotarLid(jid, key.remoteJidAlt);
      return usuarioDeJid(key.remoteJidAlt);
    }
    const guardado = lids[usuarioDeJid(jid)];
    if (guardado) return guardado;
    try {
      const pn = sock && sock.signalRepository && sock.signalRepository.lidMapping
        ? await sock.signalRepository.lidMapping.getPNForLID(jid) : null;
      if (pn) { anotarLid(jid, pn); return usuarioDeJid(pn); }
    } catch (_) { /* sin telefono: se descarta */ }
    return '';
  }

  // Texto legible de un mensaje, o '' si no es parte de la conversacion
  function textoDe(contenido) {
    const tipo = contenido ? getContentType(contenido) : '';
    if (!tipo) return { tipo: '', tx: '' };
    const m = contenido[tipo] || {};
    const pie = (etiqueta, texto) => (texto ? etiqueta + ' · ' + texto : etiqueta);
    switch (tipo) {
      case 'conversation': return { tipo: 'texto', tx: String(contenido.conversation || '') };
      case 'extendedTextMessage': return { tipo: 'texto', tx: String(m.text || '') };
      case 'imageMessage': return { tipo: 'foto', tx: pie('📷 Foto', m.caption) };
      case 'videoMessage': return { tipo: 'video', tx: pie(m.gifPlayback ? '🎞️ GIF' : '🎥 Video', m.caption) };
      case 'ptvMessage': return { tipo: 'video', tx: '🎥 Video' };
      case 'audioMessage': return { tipo: 'audio', tx: '🎤 Audio' };
      case 'documentMessage':
        return { tipo: 'documento', tx: pie('📄 Documento' + (m.fileName ? ' (' + m.fileName + ')' : ''), m.caption) };
      case 'stickerMessage': return { tipo: 'sticker', tx: '💟 Sticker' };
      case 'locationMessage':
      case 'liveLocationMessage': return { tipo: 'ubicacion', tx: pie('📍 Ubicación', m.name || m.address) };
      case 'contactMessage':
      case 'contactsArrayMessage': return { tipo: 'contacto', tx: pie('👤 Contacto', m.displayName) };
      case 'pollCreationMessage':
      case 'pollCreationMessageV2':
      case 'pollCreationMessageV3': return { tipo: 'encuesta', tx: pie('📊 Encuesta', m.name) };
      case 'orderMessage': return { tipo: 'pedido', tx: '🛒 Pedido del catálogo' };
      case 'productMessage': return { tipo: 'producto', tx: pie('🛍️ Producto', m.product && m.product.title) };
      case 'buttonsResponseMessage': return { tipo: 'texto', tx: String(m.selectedDisplayText || '') };
      case 'listResponseMessage': return { tipo: 'texto', tx: String(m.title || '') };
      case 'templateButtonReplyMessage': return { tipo: 'texto', tx: String(m.selectedDisplayText || '') };
      default: return { tipo: '', tx: '' };
    }
  }

  // Convierte un mensaje en las rutas a escribir. Tambien atiende los avisos
  // de edicion y de "eliminado para todos" (el texto original se conserva y
  // se marca como borrado; el visor lo muestra tachado).
  async function rutasDeMensaje(msg, rutas, metas) {
    const key = msg.key || {};
    if (!key.remoteJid || !esChatIndividual(key.remoteJid) || !msg.message) return;
    const contenido = normalizeMessageContent(msg.message);
    if (!contenido) return;

    const tel = claveTelefono(await telefonoDeChat(key));
    if (!tel) return;
    const base = 'chats/' + tel;

    const prot = contenido.protocolMessage;
    if (prot) {
      const id = prot.key && prot.key.id;
      if (!id) return;
      const rutaMsg = base + '/msgs/' + claveSegura(id);
      // Si el mensaje original no esta guardado (es anterior al historial),
      // no se crea un registro suelto sin fecha ni texto.
      const existe = rutas[rutaMsg] || (await db.ref(rutaMsg + '/t').once('value')).exists();
      if (!existe) return;
      if (rutas[rutaMsg]) {
        if (prot.type === TIPO_REVOCAR) rutas[rutaMsg].borrado = true;
        else if (prot.type === TIPO_EDITAR && prot.editedMessage) {
          const nuevo = textoDe(normalizeMessageContent(prot.editedMessage));
          if (nuevo.tx) { rutas[rutaMsg].tx = nuevo.tx; rutas[rutaMsg].editado = true; }
        }
        return;
      }
      if (prot.type === TIPO_REVOCAR) {
        rutas[rutaMsg + '/borrado'] = true;
      } else if (prot.type === TIPO_EDITAR && prot.editedMessage) {
        const nuevo = textoDe(normalizeMessageContent(prot.editedMessage));
        if (nuevo.tx) { rutas[rutaMsg + '/tx'] = nuevo.tx; rutas[rutaMsg + '/editado'] = true; }
      }
      return;
    }

    const { tipo, tx } = textoDe(contenido);
    if (!tx) return;
    const t = (aNumero(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;
    const id = claveSegura(key.id);
    const reg = { t, yo: !!key.fromMe, tipo, tx };
    // Solo se guardan los adjuntos que manda el cliente (los propios quedan
    // como texto): fotos, y documentos PDF o de imagen (comprobantes), estos
    // convertidos a imagen. img:true = el visor busca la imagen en imgs/.
    const clase = claseAdjunto(contenido);
    if (clase && !key.fromMe && t >= Date.now() - CFG.DIAS_FOTOS * 86400000) {
      reg.img = true;
      encolarFoto(msg, tel, id, t, clase);
    }
    rutas[base + '/msgs/' + id] = reg;

    const meta = metas[tel] || (metas[tel] = { jid: key.remoteJid, ultimo: 0 });
    if (t > meta.ultimo) meta.ultimo = t;
    if (!key.fromMe && msg.pushName) meta.nombre = msg.pushName;
  }

  function volcarMetas(rutas, metas) {
    for (const tel of Object.keys(metas)) {
      const m = metas[tel];
      const base = 'chats/' + tel + '/meta/';
      rutas[base + 'jid'] = m.jid;
      if (m.ultimo) rutas[base + 'ultimo'] = m.ultimo;
      if (m.nombre) rutas[base + 'nombre'] = m.nombre;
    }
  }

  async function guardarMensajes(mensajes, desde) {
    const rutas = {};
    const metas = {};
    let cuenta = 0;
    for (const msg of mensajes) {
      if (desde && aNumero(msg.messageTimestamp) * 1000 < desde) continue;
      const antes = Object.keys(rutas).length;
      try { await rutasDeMensaje(msg, rutas, metas); } catch (e) { log('Mensaje salteado:', e.message); }
      if (Object.keys(rutas).length > antes) cuenta++;
    }
    if (!cuenta) return 0;
    volcarMetas(rutas, metas);
    await escribir(rutas);
    avisar({ tipo: 'mensajes', n: cuenta });
    return cuenta;
  }

  async function conectar() {
    const { state, saveCreds } = await useMultiFileAuthState(DIR_SESION);
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch (_) { /* usa la de la libreria */ }

    sock = makeWASocket({
      version,
      auth: state,
      browser: Browsers.windows('WhatsAppSync'),
      logger: pino({ level: 'silent' }),
      markOnlineOnConnect: false,   // no aparecer "en linea" ni cortar las notificaciones del celular
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        avisar({ tipo: 'qr', qr: await QRCode.toDataURL(qr, { width: 420, margin: 2 }) });
        log('Escaneá el QR desde el celular del', CFG.NUMERO_ESPERADO,
          '> WhatsApp > Dispositivos vinculados > Vincular un dispositivo');
        if (!padre) qrTerminal.generate(qr, { small: true });
        // El QR cambia cada ~20 s: se abre una sola pagina que se refresca sola
        try {
          const img = await QRCode.toDataURL(qr, { width: 420, margin: 2 });
          fs.writeFileSync(ARCHIVO_QR, '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="4">' +
            '<title>Vincular WhatsApp</title><body style="font-family:sans-serif;text-align:center;padding:30px">' +
            '<h2>Escaneá con el celular del ' + CFG.NUMERO_ESPERADO + '</h2>' +
            '<p>WhatsApp → ⋮ → Dispositivos vinculados → Vincular un dispositivo</p>' +
            '<img src="' + img + '"><p style="color:#888">Se actualiza sola. Cerrala cuando el celular diga que se vinculó.</p>');
          if (!qrAbierto && !padre) { exec('start "" "' + ARCHIVO_QR + '"'); qrAbierto = true; }
        } catch (e) { log('No se pudo generar el QR:', e.message); }
      }

      if (connection === 'open') {
        try { fs.unlinkSync(ARCHIVO_QR); } catch (_) { /* no habia QR */ }
        const propio = usuarioDeJid(sock.user && sock.user.id);
        if (propio !== CFG.NUMERO_ESPERADO) {
          log('ATENCIÓN: se vinculó el número', propio, 'y se esperaba', CFG.NUMERO_ESPERADO + '. Se desvincula.');
          try { await sock.logout(); } catch (_) { /* igual se borra la sesion */ }
          fs.rmSync(DIR_SESION, { recursive: true, force: true });
          process.exit(1);
        }
        log('Conectado como', propio + '. Guardando mensajes...');
        avisar({ tipo: 'conectado', numero: propio });
      }

      if (connection === 'close') {
        avisar({ tipo: 'desconectado' });
        const codigo = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
          ? lastDisconnect.error.output.statusCode : 0;
        if (codigo === DisconnectReason.loggedOut) {
          log('Se desvinculó desde el celular. Hay que escanear el QR de nuevo.');
          fs.rmSync(DIR_SESION, { recursive: true, force: true });
          setTimeout(conectar, 2000);
        } else if (codigo === DisconnectReason.connectionReplaced) {
          log('Otra copia de este programa tomó la conexión. Esta se cierra.');
          process.exit(3);
        } else {
          // 515 (reinicio pedido) llega siempre justo despues de escanear el QR
          if (codigo !== DisconnectReason.restartRequired) log('Conexión cerrada (código', codigo + '). Reconectando...');
          setTimeout(conectar, codigo === DisconnectReason.restartRequired ? 500 : 5000);
        }
      }
    });

    // Equivalencias @lid -> telefono que manda WhatsApp
    sock.ev.on('lid-mapping.update', (m) => {
      const lista = Array.isArray(m) ? m : [m];
      for (const x of lista) if (x) anotarLid(x.lid, x.pn);
    });

    // Historial que manda el celular al vincular (y en tandas despues)
    sock.ev.on('messaging-history.set', async ({ messages, lidPnMappings }) => {
      try {
        for (const x of lidPnMappings || []) anotarLid(x.lid, x.pn);
        const desde = Date.now() - CFG.DIAS_HISTORIAL * 86400000;
        const n = await guardarMensajes(messages || [], desde);
        if (n) log('Historial: guardados', n, 'mensajes.');
      } catch (e) { log('Error guardando historial:', e.message); }
    });

    // Mensajes nuevos, enviados desde el celular, y lo que entro con la PC apagada
    sock.ev.on('messages.upsert', async ({ messages }) => {
      try { await guardarMensajes(messages || [], 0); } catch (e) { log('Error guardando mensajes:', e.message); }
    });
  }

  // -------------------------------------------------------------------
  // Fotos de clientes: se bajan de a una, se achican y se guardan en
  //   imgs/{tel}/{id}   { t, d }   (d = JPEG en base64)
  //   imgsIdx/{id}      { tel, t, doc } (indice liviano: borrar las viejas y
  //                     el aviso de comprobante en la lista de pendientes)
  // Van separadas de los mensajes para que abrir un chat no descargue fotos:
  // el visor pide cada una recien cuando la muestra.
  // -------------------------------------------------------------------
  const colaFotos = [];
  let bajandoFotos = false;
  let fotosOk = 0;
  let fotosError = 0;

  // 'foto' | 'pdf' | 'docimg' | '' (no se guarda)
  function claseAdjunto(contenido) {
    if (contenido.imageMessage) return 'foto';
    const doc = contenido.documentMessage;
    if (!doc) return '';
    const tipo = String(doc.mimetype || '').toLowerCase();
    const nombre = String(doc.fileName || '').toLowerCase();
    if (tipo === 'application/pdf' || nombre.endsWith('.pdf')) return 'pdf';
    if (tipo.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/.test(nombre)) return 'docimg';
    return '';
  }

  function encolarFoto(msg, tel, id, t, clase) {
    colaFotos.push({ msg, tel, id, t, clase });
    if (!bajandoFotos) procesarFotos();
  }

  // Fotos: mas compresion. Documentos: mas calidad, para que se lean los numeros.
  async function comprimir(buffer, esDocumento) {
    let ancho = CFG.FOTO_ANCHO_MAX;
    let calidad = esDocumento ? 80 : 70;
    const kbMax = esDocumento ? CFG.DOC_KB_MAX : CFG.FOTO_KB_MAX;
    let salida = null;
    for (let intento = 0; intento < 4; intento++) {
      salida = await sharp(buffer).rotate().flatten({ background: '#ffffff' })
        .resize({ width: ancho, height: esDocumento ? 2400 : ancho, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: calidad, mozjpeg: true }).toBuffer();
      if (salida.length <= kbMax * 1024) break;
      ancho = Math.round(ancho * 0.8);
      calidad = Math.max(55, calidad - 8);
    }
    return salida;
  }

  // PDF -> imagen de la primera pagina, sin los margenes en blanco
  let pdfAImagen = null;
  async function primeraPaginaPdf(buffer) {
    if (!pdfAImagen) pdfAImagen = (await import('pdf-to-img')).pdf;
    const doc = await pdfAImagen(buffer, { scale: 2.5 });
    const png = await doc.getPage(1);
    let img = sharp(png).flatten({ background: '#ffffff' });
    try {
      const recortada = await img.clone().trim({ background: '#ffffff', threshold: 12 }).toBuffer();
      img = sharp(recortada).extend({ top: 24, bottom: 24, left: 24, right: 24, background: '#ffffff' });
    } catch (_) { /* pagina en blanco: se deja como esta */ }
    return { imagen: await img.png().toBuffer(), paginas: doc.length };
  }

  async function procesarFotos() {
    bajandoFotos = true;
    while (colaFotos.length) {
      const { msg, tel, id, t, clase } = colaFotos.shift();
      try {
        if ((await db.ref('imgsIdx/' + id).once('value')).exists()) continue;
        const original = await downloadMediaMessage(msg, 'buffer', {}, {
          logger: pino({ level: 'silent' }),
          reuploadRequest: sock.updateMediaMessage
        });
        let fuente = original;
        const extra = {};
        if (clase === 'pdf') {
          const r = await primeraPaginaPdf(original);
          fuente = r.imagen;
          if (r.paginas > 1) extra['chats/' + tel + '/msgs/' + id + '/paginas'] = r.paginas;
        }
        const chica = await comprimir(fuente, clase !== 'foto');
        await db.ref().update({
          ...extra,
          ['imgs/' + tel + '/' + id]: { t, d: chica.toString('base64') },
          ['imgsIdx/' + id]: { tel, t, doc: clase !== 'foto' }
        });
        fotosOk++;
        avisar({ tipo: 'adjunto' });
      } catch (_) {
        // Fotos viejas que el celular ya no tiene: el visor muestra "no disponible"
        fotosError++;
      }
      if ((fotosOk + fotosError) % 50 === 0) log('Fotos: guardadas', fotosOk, '- no disponibles', fotosError);
    }
    bajandoFotos = false;
  }

  // Una vez por dia se borran las fotos de mas de DIAS_FOTOS dias
  async function borrarFotosViejas() {
    try {
      const corte = Date.now() - CFG.DIAS_FOTOS * 86400000;
      const snap = await db.ref('imgsIdx').orderByChild('t').endAt(corte).limitToFirst(500).once('value');
      const upd = {};
      snap.forEach(x => {
        const v = x.val() || {};
        upd['imgsIdx/' + x.key] = null;
        if (v.tel) upd['imgs/' + v.tel + '/' + x.key] = null;
      });
      const n = Object.keys(upd).length / 2;
      if (n) { await db.ref().update(upd); log('Fotos viejas borradas:', Math.round(n)); }
    } catch (e) { log('Error borrando fotos viejas:', e.message); }
  }
  setTimeout(borrarFotosViejas, 60000);
  setInterval(borrarFotosViejas, 24 * 3600000);

  // -------------------------------------------------------------------
  // Curiosos: numeros que nunca tuvieron un pedido. Sus mensajes de TEXTO
  // de mas de DIAS_CURIOSOS dias se borran. Nunca se toca:
  //   - ningun chat de alguien con pedido (vigente o cerrado)
  //   - ningun mensaje con foto o documento guardado (comprobantes), sea de
  //     quien sea: esos siguen su propia regla (DIAS_FOTOS)
  //
  // Quien es cliente sale de la base de pedidosv2 (lectura publica por REST,
  // sin clave): los telefonos de los pedidos y de la lista de clientes,
  // comparados por los ultimos 10 digitos. Leer los ~65.000 pedidos pesa
  // ~75 MB, asi que se hace completo una vez por mes y el resto de los dias
  // solo se piden los pedidos nuevos (por fecha). Queda en clientes-tel.json.
  //
  // Si no se pudo armar la lista, NO se borra nada.
  // -------------------------------------------------------------------
  async function leerJson(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' leyendo pedidos');
    return r.json();
  }

  function sumarTelefonos(destino, objeto, sacarTel) {
    for (const v of Object.values(objeto || {})) {
      const tel = claveTelefono(sacarTel(v || {}));
      if (tel) destino.add(tel);
    }
  }

  async function telefonosDeClientes() {
    const base = CFG.PEDIDOS_DATABASE_URL;
    let guardado = {};
    try { guardado = JSON.parse(fs.readFileSync(ARCHIVO_CLIENTES, 'utf8')); } catch (_) { guardado = {}; }
    const tels = new Set(guardado.tels || []);
    const ahora = Date.now();
    const completo = !guardado.completoEn || ahora - guardado.completoEn > 30 * 86400000 || tels.size < 100;

    let pedidos;
    if (completo) {
      log('Clientes: leyendo todos los pedidos (una vez por mes, tarda un poco)...');
      pedidos = await leerJson(base + '/pedidos.json');
      tels.clear();
    } else {
      const desde = Math.max(0, (guardado.ultimoTs || 0) - 86400000);   // 1 dia de margen
      pedidos = await leerJson(base + '/pedidos.json?orderBy=%22timestamp%22&startAt=' + desde);
    }
    sumarTelefonos(tels, pedidos, p => (p.cliente || {}).telefono);
    sumarTelefonos(tels, await leerJson(base + '/clientes.json'), c => c.telefono);

    let ultimoTs = guardado.ultimoTs || 0;
    for (const p of Object.values(pedidos || {})) {
      if (p && typeof p.timestamp === 'number' && p.timestamp > ultimoTs) ultimoTs = p.timestamp;
    }
    const nuevo = { completoEn: completo ? ahora : guardado.completoEn, ultimoTs, tels: [...tels] };
    fs.writeFileSync(ARCHIVO_CLIENTES, JSON.stringify(nuevo));
    if (completo) log('Clientes: ' + tels.size + ' teléfonos con pedido.');
    return tels;
  }

  async function borrarCuriosos() {
    let clientes;
    try {
      clientes = await telefonosDeClientes();
    } catch (e) {
      log('Curiosos: no se pudo leer la lista de clientes (' + e.message + '). Hoy no se borra nada.');
      return;
    }
    if (!clientes || clientes.size < 100) {
      log('Curiosos: la lista de clientes vino casi vacía. Por seguridad no se borra nada.');
      return;
    }
    try {
      const corte = Date.now() - CFG.DIAS_CURIOSOS * 86400000;
      const snap = await db.ref('chats').once('value');
      const upd = {};
      let mensajes = 0;
      let chatsBorrados = 0;
      snap.forEach(chat => {
        if (clientes.has(chat.key)) return;
        let quedan = 0;
        const borrar = [];
        chat.child('msgs').forEach(m => {
          const v = m.val() || {};
          if (v.img || (v.t || 0) >= corte) quedan++;
          else borrar.push(m.key);
        });
        if (!borrar.length) return;
        mensajes += borrar.length;
        if (!quedan) { upd['chats/' + chat.key] = null; chatsBorrados++; }
        else borrar.forEach(k => { upd['chats/' + chat.key + '/msgs/' + k] = null; });
      });
      if (mensajes) {
        await escribir(upd);
        log('Curiosos: borrados ' + mensajes + ' mensajes viejos de números sin pedido (' + chatsBorrados + ' chats completos).');
      }
    } catch (e) { log('Error borrando curiosos:', e.message); }
  }
  setTimeout(borrarCuriosos, 120000);
  setInterval(borrarCuriosos, 24 * 3600000);

  log('Iniciando WhatsApp...');
  await conectar();
})().catch(e => {
  log('Error al iniciar:', e && e.message ? e.message : e);
  process.exit(1);
});

process.on('unhandledRejection', (e) => log('Error no controlado:', e && e.message ? e.message : e));
