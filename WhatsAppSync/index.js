'use strict';
// =====================================================================
// Sincronizador de WhatsApp -> Firebase (proyecto aparte, solo lectura
// desde pedidosv2).
//
// Usa Baileys: se conecta directo a WhatsApp como "dispositivo vinculado",
// sin navegador. Sirve para emparejar cotizaciones con comprobantes de pago,
// asi que de los chats individuales SOLO guarda:
//
//   - mis mensajes (los del celular vinculado) que contienen "Subtotal $":
//     las cotizaciones, con fecha y hora (cot: true)
//   - los comprobantes de pago que manda el cliente (foto, captura o PDF
//     pasado a imagen). Para saber si una imagen es un comprobante se lee su
//     texto en esta PC (OCR con tesseract.js) y se buscan palabras de pago.
//     Lo que no parece comprobante (productos, lugares...) no se guarda.
//     Se marcan cat:'pago'.
//   - mis fotos o documentos que son remitos o comprobantes de envio (Via
//     Cargo, Andreani, encomiendas...). Se marcan cat:'remito' y NO cuentan
//     como comprobante de pago.
//
//   chats/{tel}/meta            { nombre, jid, ultimo }
//   chats/{tel}/msgs/{idMsg}    { t, yo, tipo, tx, cot?, img?, cat?, comp?, borrado?, editado? }
//
// {tel} = ultimos 10 digitos del numero (ej. 1176460030). pedidosv2 arma la
// misma clave desde el telefono del cliente, asi que da igual si en el pedido
// se cargo con 0, con +54 o con 549.
//
// Solo lee: nunca envia mensajes ni marca como leido. Grupos, estados y
// canales se ignoran. Los demas textos, audios, stickers, etc. no se guardan.
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
const ARCHIVO_DESCARTADOS = path.join(DIR, 'descartados.json');
const ARCHIVO_LIMPIEZA = path.join(DIR, 'limpieza-cotizaciones.json');
const DIR_OCR = path.join(DIR, 'ocr');
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
// Cotizaciones y comprobantes
// ---------------------------------------------------------------------
// Mis mensajes con esto en el texto son cotizaciones y se guardan
const ES_COTIZACION = /subtotal\s*\$/i;

function esCotizacion(v) {
  return !!(v && (v.cot || (v.yo && ES_COTIZACION.test(String(v.tx || '')))));
}

// "375.320" | "1.275.598,00" | "213000" -> numero (formato argentino)
function numeroAR(s) {
  const x = String(s || '').replace(/\s/g, '');
  if (!x) return 0;
  const partes = x.split(',');
  const n = Number(partes[0].replace(/\./g, '') + (partes[1] ? '.' + partes[1] : ''));
  return Number.isFinite(n) ? n : 0;
}

// De mi cotizacion: el total ("- Total $ 375.320", o el subtotal si no hay
// total) y el codigo de pedido que agrega pedidosv2 ("- Pedido: VTeQd1").
const RE_TOTAL_COT = /(?:^|[^a-z])total\s*\$\s*([\d.]+(?:,\d{1,2})?)/i;
const RE_SUBTOTAL_COT = /subtotal\s*\$\s*([\d.]+(?:,\d{1,2})?)/i;
const RE_PEDIDO_COT = /pedido\s*(?:n[°º.o]?\s*)?:\s*#?\s*([A-Za-z0-9_-]{6})(?![A-Za-z0-9_-])/i;
function datosCotizacion(tx) {
  const d = {};
  const total = RE_TOTAL_COT.exec(tx) || RE_SUBTOTAL_COT.exec(tx);
  if (total && numeroAR(total[1])) d.cotTotal = Math.round(numeroAR(total[1]));
  const pedido = RE_PEDIDO_COT.exec(tx);
  if (pedido) d.cotPedido = pedido[1];
  return d;
}

// Importe de un comprobante leido con OCR: el mayor monto con "$" (o con
// "s", que es como a veces se lee el "$"). 0 si no se encuentra.
function montoDeComprobante(texto) {
  const tx = String(texto || '');
  const leer = (re) => {
    let max = 0;
    for (const m of tx.matchAll(re)) {
      const n = Math.round(numeroAR(m[1]));
      if (n >= 100 && n < 100000000 && n > max) max = n;
    }
    return max;
  };
  return leer(/(?:\$|\bars\b)\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d{3,9}(?:,\d{1,2})?)/gi) ||
    leer(/(?:^|\s)s\s?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?)/gim);
}

// Palabras que aparecen en los comprobantes de pago o transferencia.
// Se comparan en minusculas y sin tildes. Para sumar un banco o billetera,
// agregarlo a BANCOS.
// Propias de una transferencia: sin al menos una de estas (o un banco), no
// es un comprobante de pago.
const PALABRAS_PAGO = [
  'transferencia', 'transferiste', 'transferido', 'transferir', 'enviaste',
  'pagaste', 'cbu', 'cvu', 'alias', 'operacion', 'transaccion',
  'cuenta destino', 'cuenta origen', 'codigo de identificacion', 'acreditado', 'acreditada',
  'comprobante de pago', 'n° de control', 'id de la operacion'
];
// Aparecen en comprobantes, pero tambien en remitos, facturas, etc.: solo suman
const PALABRAS_APOYO = [
  'comprobante', 'destinatario', 'destino', 'origen', 'titular', 'importe',
  'monto', 'motivo', 'concepto', 'cuit', 'cuil', 'referencia', 'debito'
];
// Remitos de envio, guias, facturas: no son pagos
const PALABRAS_NO_PAGO = [
  'remito', 'guia', 'encomienda', 'remitente', 'flete', 'via cargo', 'viacargo',
  'andreani', 'correo argentino', 'oca', 'credifin', 'cruz del sur', 'factura',
  'flecha carga', 'flechabus', 'despacho', 'comprobante de envio',
  'sub total neto', 'iva insc', 'condiciones de venta', 'presupuesto'
];
const BANCOS = [
  'mercado pago', 'mercadopago', 'galicia', 'santander', 'bbva', 'frances',
  'macro', 'banco nacion', 'bna', 'banco provincia', 'cuenta dni', 'brubank',
  'uala', 'naranja x', 'personal pay', 'lemon', 'hsbc', 'icbc',
  'credicoop', 'supervielle', 'patagonia', 'banco ciudad', 'hipotecario',
  'comafi', 'itau', 'prex', 'openbank', 'reba', 'bancor', 'banco del sol'
];
const ALIAS_PROPIO = /trade\s*\.?\s*king/;   // ALIAS: TRADE.KING.PESOS
const HAY_MONTO = /(\$|ars)\s?\d/;

function normalizar(texto) {
  return String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function contiene(texto, palabra) {
  const p = palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z0-9])' + p + '(?![a-z])', 'i').test(texto);
}

// Remitos y comprobantes de envio (los que mando yo): empresas de transporte
// y palabras de un remito.
const EMPRESAS_ENVIO = [
  'via cargo', 'viacargo', 'flecha carga', 'flechacarga', 'flecha bus', 'flechabus',
  'andreani', 'correo argentino', 'oca', 'credifin', 'cruz del sur', 'integral pack',
  'expreso', 'mercado envios', 'e-pick', 'urbano express', 'el practico'
];
const PALABRAS_REMITO = [
  'remito', 'guia', 'encomienda', 'despacho', 'despachado', 'comprobante de envio',
  'numero de envio', 'nro de envio', 'seguimiento', 'remitente', 'destinatario',
  'bultos', 'bulto', 'flete', 'contrareembolso', 'reembolso', 'sucursal destino',
  'sucursal origen', 'domicilio', 'localidad', 'peso', 'kg'
];

// Imagen mia: ¿es un remito o comprobante de envio?
function esRemito(textoCrudo) {
  const tx = normalizar(textoCrudo);
  if (tx.replace(/\s/g, '').length < 8) return false;
  const empresa = EMPRESAS_ENVIO.some(e => contiene(tx, e));
  const palabras = PALABRAS_REMITO.filter(p => contiene(tx, p)).length;
  return (empresa && palabras >= 1) || palabras >= 3;
}

// Si cambian las reglas de abajo, subir este numero: la limpieza vuelve a
// revisar las imagenes guardadas con las reglas nuevas.
const VERSION_REGLAS = 4;   // 4: ademas se guarda el importe (monto) de cada comprobante

// 'si' | 'duda' | 'no'. Ante la duda se guarda: mejor una imagen de mas que
// perder un comprobante.
function clasificarComprobante(textoCrudo) {
  const tx = normalizar(textoCrudo);
  if (tx.replace(/\s/g, '').length < 8) return 'no';
  if (ALIAS_PROPIO.test(tx)) return 'si';
  let pago = PALABRAS_PAGO.filter(p => contiene(tx, p)).length;
  if (BANCOS.some(b => contiene(tx, b))) pago++;
  const apoyo = PALABRAS_APOYO.filter(p => contiene(tx, p)).length;
  const noPago = PALABRAS_NO_PAGO.some(p => contiene(tx, p));
  const monto = HAY_MONTO.test(tx);
  if (pago >= 2 && (!noPago || pago >= 3)) return 'si';
  if (noPago) return 'no';
  // Una sola señal de pago: tiene que haber un monto ($ 123) para tenerla en cuenta
  if (pago >= 1 && monto) return apoyo >= 1 ? 'si' : 'duda';
  return 'no';
}

// Imagenes del cliente que no eran comprobantes: se anotan para no volver a
// bajarlas si WhatsApp reenvia el historial. { id: t }
let descartados = {};
try { descartados = JSON.parse(fs.readFileSync(ARCHIVO_DESCARTADOS, 'utf8')); } catch (_) { descartados = {}; }
let descartadosPendientes = false;
function anotarDescartado(id, t) {
  descartados[id] = t;
  descartadosPendientes = true;
}
setInterval(() => {
  if (!descartadosPendientes) return;
  descartadosPendientes = false;
  const corte = Date.now() - CFG.DIAS_FOTOS * 86400000;
  for (const id of Object.keys(descartados)) if (descartados[id] < corte) delete descartados[id];
  try { fs.writeFileSync(ARCHIVO_DESCARTADOS, JSON.stringify(descartados)); } catch (e) { log('No se pudo guardar descartados.json:', e.message); }
}, 15000);

// Lector de texto de imagenes (OCR). Un solo lector, que se crea la primera
// vez que hace falta. El idioma (español) se baja una vez y queda en DIR/ocr.
let lectorOcr = null;
function obtenerLector() {
  if (!lectorOcr) {
    lectorOcr = (async () => {
      const { createWorker } = require('tesseract.js');
      fs.mkdirSync(DIR_OCR, { recursive: true });
      return createWorker('spa', 1, { cachePath: DIR_OCR, logger: () => {}, errorHandler: () => {} });
    })().catch(e => { lectorOcr = null; throw e; });
  }
  return lectorOcr;
}

// Texto de una imagen, o null si no se pudo leer (en ese caso se guarda
// como dudosa). Se pasa a gris y se agranda para leer mejor; las capturas
// en modo oscuro (letras claras sobre fondo negro) se invierten.
let avisoOcr = false;
async function textoDeImagen(buffer) {
  try {
    let gris = await sharp(buffer).rotate().flatten({ background: '#ffffff' })
      .resize({ width: 1400, height: 2600, fit: 'inside' }).grayscale().normalise().png().toBuffer();
    const { channels } = await sharp(gris).stats();
    if (channels[0] && channels[0].mean < 110) gris = await sharp(gris).negate({ alpha: false }).png().toBuffer();
    const lector = await obtenerLector();
    const { data } = await lector.recognize(gris);
    return String((data && data.text) || '');
  } catch (e) {
    if (!avisoOcr) { avisoOcr = true; log('No se pudo leer el texto de una imagen (se guarda como dudosa):', e && e.message ? e.message : e); }
    return null;
  }
}

// Texto de la primera pagina de un PDF ('' si no tiene, ej. un escaneo)
let pdfjs = null;
async function textoDePdf(buffer) {
  try {
    if (!pdfjs) pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
    try {
      const pagina = await doc.getPage(1);
      const contenido = await pagina.getTextContent();
      return contenido.items.map(i => i.str || '').join(' ');
    } finally { try { await doc.destroy(); } catch (_) { /* nada */ } }
  } catch (_) { return ''; }
}

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
      if (!existe) {
        // Edite un mensaje mio que no estaba guardado y ahora es una cotizacion
        if (key.fromMe && prot.type === TIPO_EDITAR && prot.editedMessage) {
          const nuevo = textoDe(normalizeMessageContent(prot.editedMessage));
          if (nuevo.tx && ES_COTIZACION.test(nuevo.tx)) {
            const t = (aNumero(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;
            rutas[rutaMsg] = Object.assign({ t, yo: true, tipo: nuevo.tipo || 'texto', tx: nuevo.tx, cot: true, editado: true },
              datosCotizacion(nuevo.tx));
            const meta = metas[tel] || (metas[tel] = { jid: key.remoteJid, ultimo: 0 });
            if (t > meta.ultimo) meta.ultimo = t;
          }
        }
        return;
      }
      if (rutas[rutaMsg]) {
        if (prot.type === TIPO_REVOCAR) rutas[rutaMsg].borrado = true;
        else if (prot.type === TIPO_EDITAR && prot.editedMessage) {
          const nuevo = textoDe(normalizeMessageContent(prot.editedMessage));
          if (nuevo.tx) {
            rutas[rutaMsg].tx = nuevo.tx;
            rutas[rutaMsg].editado = true;
            if (ES_COTIZACION.test(nuevo.tx)) Object.assign(rutas[rutaMsg], datosCotizacion(nuevo.tx));
          }
        }
        return;
      }
      if (prot.type === TIPO_REVOCAR) {
        rutas[rutaMsg + '/borrado'] = true;
      } else if (prot.type === TIPO_EDITAR && prot.editedMessage) {
        const nuevo = textoDe(normalizeMessageContent(prot.editedMessage));
        if (nuevo.tx) {
          rutas[rutaMsg + '/tx'] = nuevo.tx;
          rutas[rutaMsg + '/editado'] = true;
          if (ES_COTIZACION.test(nuevo.tx)) {
            const d = datosCotizacion(nuevo.tx);
            rutas[rutaMsg + '/cotTotal'] = d.cotTotal || null;
            rutas[rutaMsg + '/cotPedido'] = d.cotPedido || null;
          }
        }
      }
      return;
    }

    const { tipo, tx } = textoDe(contenido);
    if (!tx) return;
    const t = (aNumero(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000;
    const id = claveSegura(key.id);

    // Mios con "Subtotal $": cotizaciones
    if (key.fromMe && ES_COTIZACION.test(tx)) {
      rutas[base + '/msgs/' + id] = Object.assign({ t, yo: true, tipo, tx, cot: true }, datosCotizacion(tx));
      const meta = metas[tel] || (metas[tel] = { jid: key.remoteJid, ultimo: 0 });
      if (t > meta.ultimo) meta.ultimo = t;
      return;
    }

    // Fotos y documentos PDF o de imagen. No se escriben aca: van a la cola,
    // donde se bajan, se lee su texto y se guardan solo si son:
    //   - del cliente: un comprobante de pago (cat:'pago')
    //   - mios: un remito o comprobante de envio (cat:'remito')
    // (img:true = el visor busca la imagen en imgs/)
    const clase = claseAdjunto(contenido);
    if (!clase || t < Date.now() - CFG.DIAS_FOTOS * 86400000) return;
    const doc = contenido.documentMessage;
    encolarFoto({
      msg, tel, id, t, clase, jid: key.remoteJid, yo: !!key.fromMe,
      nombre: key.fromMe ? '' : (msg.pushName || ''),
      tipo: clase === 'foto' ? 'foto' : 'documento',
      // Sin el texto del pie de foto
      tx: clase === 'foto' ? '📷 Foto' : '📄 Documento' + (doc && doc.fileName ? ' (' + doc.fileName + ')' : '')
    });
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
  // Imagenes: cada foto o documento se baja de a uno, se lee su texto y se
  // guarda solo si es un comprobante de pago del cliente o un remito mio:
  //   chats/{tel}/msgs/{id} { t, yo, tipo, tx, img:true, cat, comp? }
  //   imgs/{tel}/{id}       { t, d }   (d = JPEG en base64)
  //   imgsIdx/{id}          { tel, t, doc, cat, comp?, yo?, rv } (indice
  //                         liviano: borrar las viejas y el aviso de
  //                         comprobante en pendientes, que ignora los remitos)
  // cat = 'pago' (del cliente; comp = 'si' | 'duda') | 'remito' (mio).
  // Las imagenes van separadas de los mensajes para que abrir un chat no las
  // descargue: el visor pide cada una cuando la muestra.
  // -------------------------------------------------------------------
  const colaFotos = [];
  let bajandoFotos = false;
  const cuentaFotos = { si: 0, duda: 0, remito: 0, no: 0, error: 0 };

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

  function encolarFoto(adjunto) {
    if (descartados[adjunto.id]) return;
    colaFotos.push(adjunto);
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

  // 'si' | 'duda' | 'no' | 'ya' (ya estaba guardado) | 'error' (no se pudo bajar)
  async function revisarAdjunto(a) {
    if (descartados[a.id]) return 'ya';
    if ((await db.ref('imgsIdx/' + a.id).once('value')).exists()) return 'ya';
    let original;
    try {
      original = await downloadMediaMessage(a.msg, 'buffer', {}, {
        logger: pino({ level: 'silent' }),
        reuploadRequest: sock.updateMediaMessage
      });
    } catch (_) {
      // El celular ya no la tiene: no se puede saber si era un comprobante
      return 'error';
    }

    let fuente = original;
    let paginas = 0;
    let texto;
    if (a.clase === 'pdf') {
      texto = await textoDePdf(original);
      const r = await primeraPaginaPdf(original);
      fuente = r.imagen;
      paginas = r.paginas;
      if (!texto.trim()) texto = await textoDeImagen(fuente);   // PDF escaneado
    } else {
      texto = await textoDeImagen(original);
    }
    // Mias: remito o nada (si no se pudo leer, no se guarda).
    // Del cliente: comprobante de pago 'si' | 'duda', o nada.
    let cat, comp = null;
    if (a.yo) {
      if (texto === null || !esRemito(texto)) {
        if (texto !== null) anotarDescartado(a.id, a.t);
        return 'no';
      }
      cat = 'remito';
    } else {
      comp = texto === null ? 'duda' : clasificarComprobante(texto);
      if (comp === 'no') { anotarDescartado(a.id, a.t); return 'no'; }
      cat = 'pago';
    }

    const chica = await comprimir(fuente, a.clase !== 'foto');
    const base = 'chats/' + a.tel;
    const reg = { t: a.t, yo: a.yo, tipo: a.tipo, tx: a.tx, img: true, cat };
    const indice = { tel: a.tel, t: a.t, doc: a.clase !== 'foto', cat, rv: VERSION_REGLAS };
    if (comp) { reg.comp = comp; indice.comp = comp; }
    if (a.yo) indice.yo = true;
    if (cat === 'pago') {
      const monto = montoDeComprobante(texto);
      if (monto) { reg.monto = monto; indice.monto = monto; }
    }
    if (paginas > 1) reg.paginas = paginas;
    const upd = {
      [base + '/msgs/' + a.id]: reg,
      [base + '/meta/jid']: a.jid,
      ['imgs/' + a.tel + '/' + a.id]: { t: a.t, d: chica.toString('base64') },
      ['imgsIdx/' + a.id]: indice
    };
    if (a.nombre) upd[base + '/meta/nombre'] = a.nombre;
    await db.ref().update(upd);
    // "ultimo" solo avanza (puede haber una cotizacion mas nueva)
    await db.ref(base + '/meta/ultimo').transaction(v => ((v || 0) < a.t ? a.t : undefined));
    if (cat === 'pago') {
      try { await asignarComprobante(a.id); } catch (e) { log('No se pudo asignar el comprobante a un pedido:', e.message); }
    }
    return cat === 'remito' ? 'remito' : comp;
  }

  async function procesarFotos() {
    bajandoFotos = true;
    let revisadas = 0;
    while (colaFotos.length) {
      const a = colaFotos.shift();
      let r;
      try { r = await revisarAdjunto(a); } catch (e) { r = 'error'; }
      if (r === 'ya') continue;
      cuentaFotos[r]++;
      revisadas++;
      if (r === 'si' || r === 'duda' || r === 'remito') avisar({ tipo: 'adjunto' });
      if (revisadas % 50 === 0 || (!colaFotos.length && revisadas < 50)) {
        log('Imágenes: comprobantes de pago', cuentaFotos.si, '- pagos dudosos', cuentaFotos.duda,
          '- remitos míos', cuentaFotos.remito, '- descartadas', cuentaFotos.no, '- no disponibles', cuentaFotos.error);
      }
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
      const corteCot = Date.now() - CFG.DIAS_FOTOS * 86400000;   // cotizaciones: como los comprobantes
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
          if (v.img || (v.t || 0) >= corte || (esCotizacion(v) && (v.t || 0) >= corteCot)) quedan++;
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

  // -------------------------------------------------------------------
  // Asignacion de comprobantes de pago a su pedido
  //
  // Para cada comprobante del cliente se elige el pedido en este orden:
  //   1. Candidatos: pedidos del mismo telefono, creados ANTES del comprobante
  //      y no mas de DIAS_ASIGNAR dias antes, que no esten cancelados.
  //   2. Mi ultima cotizacion en ese chat antes del comprobante:
  //      - si trae el codigo de pedido ("- Pedido: xxxxxx") -> ese pedido
  //      - si no, el candidato cuyo total es igual al "Total $" cotizado
  //   3. Si hay un solo candidato -> ese.
  //   4. Si el importe del comprobante coincide con el total de un solo
  //      candidato -> ese (un pago puede venir en varias partes, por eso el
  //      importe es solo una ayuda y no una condicion).
  //   5. Si no, el pedido mas reciente, marcado para revisar.
  // Resultado en imgsIdx/{id}: pedido, conf ('alta'|'media'|'revisar'|
  // 'sin-pedido'|'manual'), metodo, asigEn. Una correccion hecha a mano en
  // pedidosv2 (asigManual/{id} = { pedido, t, por }) siempre manda.
  //
  // Los pedidos se leen de la base de pedidosv2 (lectura publica): los de
  // los ultimos DIAS_FOTOS + DIAS_ASIGNAR dias, completos cada 12 h y los
  // nuevos cada pocos minutos. Antes de decidir se vuelven a leer los
  // candidatos uno por uno (estado y total al dia).
  // -------------------------------------------------------------------
  const DIA = 86400000;
  const pedidosPorTel = new Map();   // tel -> Map(id -> { id, tel, ts, total, status })
  let pedidosHasta = 0;
  let pedidosCompletoEn = 0;
  let pedidosListos = false;
  let pedidosActualizando = null;

  function resumenPedido(id, p) {
    return {
      id,
      tel: claveTelefono((p.cliente || {}).telefono),
      ts: p.timestamp || 0,
      total: Math.round(Number(p.pagos && p.pagos.totalFinal) || 0),
      status: p.status || ''
    };
  }

  function anotarPedidos(objeto) {
    for (const [id, p] of Object.entries(objeto || {})) {
      if (!p || typeof p.timestamp !== 'number') continue;
      if (p.timestamp > pedidosHasta) pedidosHasta = p.timestamp;
      const r = resumenPedido(id, p);
      if (!r.tel) continue;
      if (!pedidosPorTel.has(r.tel)) pedidosPorTel.set(r.tel, new Map());
      pedidosPorTel.get(r.tel).set(id, r);
    }
  }

  async function actualizarPedidos() {
    const base = CFG.PEDIDOS_DATABASE_URL + '/pedidos.json?orderBy=%22timestamp%22&startAt=';
    if (!pedidosCompletoEn || Date.now() - pedidosCompletoEn > 12 * 3600000) {
      const desde = Date.now() - (CFG.DIAS_FOTOS + CFG.DIAS_ASIGNAR) * DIA;
      const datos = await leerJson(base + desde);
      pedidosPorTel.clear();
      pedidosHasta = 0;
      anotarPedidos(datos);
      pedidosCompletoEn = Date.now();
    } else {
      anotarPedidos(await leerJson(base + Math.max(0, pedidosHasta - 600000)));
    }
    pedidosListos = true;
  }

  // Una sola lectura a la vez; si falla, se sigue con lo que habia
  function pedidosAlDia() {
    if (!pedidosActualizando) {
      pedidosActualizando = actualizarPedidos()
        .catch(e => log('Asignación: no se pudieron leer los pedidos (' + e.message + ').'))
        .finally(() => { pedidosActualizando = null; });
    }
    return pedidosActualizando;
  }

  async function refrescarPedido(c) {
    try {
      const p = await leerJson(CFG.PEDIDOS_DATABASE_URL + '/pedidos/' + encodeURIComponent(c.id) + '.json');
      if (!p) return null;   // borrado
      const r = resumenPedido(c.id, p);
      const mapa = pedidosPorTel.get(c.tel);
      if (mapa) {
        if (r.tel === c.tel) mapa.set(c.id, r);
        else mapa.delete(c.id);   // le cambiaron el telefono
      }
      return r;
    } catch (_) {
      return c;   // sin conexion con la base de pedidos: se usa lo que habia
    }
  }

  async function elegirPedido(tel, t, monto) {
    const mapa = pedidosPorTel.get(tel);
    let cand = mapa ? [...mapa.values()].filter(p => p.ts <= t && p.ts >= t - CFG.DIAS_ASIGNAR * DIA) : [];
    cand = (await Promise.all(cand.map(refrescarPedido)))
      .filter(p => p && p.tel === tel && p.ts <= t && p.status !== 'CANCELADO');
    if (!cand.length) return { pedido: null, conf: 'sin-pedido', metodo: 'ninguno' };
    cand.sort((a, b) => b.ts - a.ts);

    // Mi ultima cotizacion antes del comprobante
    const snap = await db.ref('chats/' + tel + '/msgs').orderByChild('t').endAt(t).limitToLast(80).once('value');
    let cot = null;
    snap.forEach(m => {
      const x = m.val() || {};
      if (esCotizacion(x) && (x.t || 0) >= t - CFG.DIAS_ASIGNAR * DIA && (!cot || x.t > cot.t)) cot = x;
    });
    const d = cot ? ((cot.cotTotal || cot.cotPedido) ? cot : datosCotizacion(cot.tx)) : {};
    if (d.cotPedido) {
      const p = cand.find(c => c.id.endsWith(d.cotPedido));
      if (p) return { pedido: p.id, conf: 'alta', metodo: 'codigo' };
    }
    // Importe igual al total de un solo pedido: es ese, aunque la ultima
    // cotizacion sea de otro (paso con clientes que pagan un pedido anterior)
    if (monto) {
      const exactos = cand.filter(c => c.total && Math.abs(c.total - monto) <= 1);
      if (exactos.length === 1) return { pedido: exactos[0].id, conf: 'alta', metodo: 'monto' };
    }
    // Pago mayor al total del pedido: se asigna, pero como probable
    const confSegun = (p) => (monto && p.total && monto > p.total * 1.01 ? 'media' : 'alta');
    if (d.cotTotal) {
      const iguales = cand.filter(c => Math.abs(c.total - d.cotTotal) <= 1);
      if (iguales.length) return { pedido: iguales[0].id, conf: iguales.length === 1 ? confSegun(iguales[0]) : 'media', metodo: 'cotizacion' };
    }
    if (cand.length === 1) return { pedido: cand[0].id, conf: confSegun(cand[0]), metodo: 'unico' };
    if (monto) {
      const iguales = cand.filter(c => c.total && Math.abs(c.total - monto) <= Math.max(1, c.total * 0.01));
      if (iguales.length === 1) return { pedido: iguales[0].id, conf: 'media', metodo: 'monto' };
    }
    return { pedido: cand[0].id, conf: 'revisar', metodo: 'reciente' };
  }

  async function asignarComprobante(id) {
    const v = (await db.ref('imgsIdx/' + id).once('value')).val();
    if (!v || v.yo || v.cat === 'remito' || !v.tel || !v.t) return;
    const manual = (await db.ref('asigManual/' + id).once('value')).val();
    let r;
    if (manual) {
      r = { pedido: manual.pedido || null, conf: 'manual', metodo: 'manual' };
    } else {
      await pedidosAlDia();
      if (!pedidosListos) return;   // sin la lista de pedidos no se decide nada
      r = await elegirPedido(v.tel, v.t, v.monto || 0);
    }
    if (v.asigEn && v.pedido === (r.pedido || undefined) && v.conf === r.conf) return;   // sin cambios
    await db.ref('imgsIdx/' + id).update({ pedido: r.pedido, conf: r.conf, metodo: r.metodo, asigEn: Date.now() });
  }

  // Comprobantes todavia sin asignar (los de antes de esta funcion, o los que
  // llegaron sin pedido en los ultimos 2 dias, por si el pedido aparece tarde)
  let asignandoPendientes = false;
  async function asignarPendientes() {
    if (asignandoPendientes) return;
    asignandoPendientes = true;
    try {
      const snap = await db.ref('imgsIdx').once('value');
      const ids = [];
      snap.forEach(x => {
        const v = x.val() || {};
        if (v.yo || v.cat === 'remito') return;
        if (!v.asigEn || (v.conf === 'sin-pedido' && (v.t || 0) > Date.now() - 2 * DIA)) ids.push(x.key);
      });
      if (!ids.length) return;
      const antes = { alta: 0, media: 0, revisar: 0, 'sin-pedido': 0, manual: 0 };
      for (const id of ids) {
        try {
          await asignarComprobante(id);
          const c = (await db.ref('imgsIdx/' + id + '/conf').once('value')).val();
          if (c in antes) antes[c]++;
        } catch (e) { log('Asignación: comprobante salteado:', e.message); }
      }
      log('Asignación de comprobantes a pedidos: ' + ids.length + ' revisados. Seguros ' + antes.alta +
        ', probables ' + antes.media + ', a revisar ' + antes.revisar + ', sin pedido ' + antes['sin-pedido'] +
        ', corregidos a mano ' + antes.manual + '.');
    } catch (e) {
      log('Asignación: error revisando pendientes:', e.message);
    } finally {
      asignandoPendientes = false;
    }
  }
  setTimeout(asignarPendientes, 5 * 60000);
  setInterval(asignarPendientes, 15 * 60000);
  setInterval(pedidosAlDia, 5 * 60000);

  // Correcciones a mano desde pedidosv2: se aplican apenas llegan
  for (const evento of ['child_added', 'child_changed', 'child_removed']) {
    db.ref('asigManual').on(evento, s => {
      asignarComprobante(s.key).catch(e => log('Asignación manual no aplicada:', e.message));
    });
  }

  // -------------------------------------------------------------------
  // Limpieza unica de lo que se guardaba antes (todos los textos y todas
  // las fotos). Corre una sola vez; el avance queda en
  // limpieza-cotizaciones.json para seguir donde quedo si se corta.
  //   1. Textos: se borra todo lo que no sea una cotizacion mia o una imagen
  //      guardada del cliente. A las imagenes se les saca el pie de foto.
  //   2. Imagenes ya guardadas: se lee su texto y se borran las que no son
  //      comprobantes (imagen, indice y mensaje).
  // -------------------------------------------------------------------
  function leerLimpieza() {
    try { return JSON.parse(fs.readFileSync(ARCHIVO_LIMPIEZA, 'utf8')); } catch (_) { return {}; }
  }
  function guardarLimpieza(estado) {
    try { fs.writeFileSync(ARCHIVO_LIMPIEZA, JSON.stringify(estado)); } catch (e) { log('No se pudo guardar el avance de la limpieza:', e.message); }
  }

  async function limpiarTextos(estado) {
    const snapChats = await db.ref('chats').once('value');
    // El indice se lee despues de los chats: lo que llego mientras tanto ya figura
    const idx = (await db.ref('imgsIdx').once('value')).val() || {};
    const upd = {};
    let borrados = 0;
    let chatsBorrados = 0;
    snapChats.forEach(chat => {
      let quedan = 0;
      const borrar = [];
      chat.child('msgs').forEach(m => {
        const v = m.val() || {};
        if (esCotizacion(v)) {
          quedan++;
          if (!v.cot) upd['chats/' + chat.key + '/msgs/' + m.key + '/cot'] = true;
        } else if (v.img && idx[m.key]) {
          quedan++;
          const tx = String(v.tx || '');
          const corte = tx.indexOf(' · ');
          if (corte > 0) upd['chats/' + chat.key + '/msgs/' + m.key + '/tx'] = tx.slice(0, corte);
        } else {
          borrar.push(m.key);
        }
      });
      borrados += borrar.length;
      // De a un mensaje (no el chat entero), para no pisar uno que llegue justo ahora
      borrar.forEach(k => { upd['chats/' + chat.key + '/msgs/' + k] = null; });
      if (!quedan) { upd['chats/' + chat.key + '/meta'] = null; chatsBorrados++; }
    });
    if (Object.keys(upd).length) await escribir(upd);
    log('Limpieza: borrados ' + borrados + ' mensajes que no eran cotizaciones ni comprobantes (' + chatsBorrados + ' chats quedaron vacíos y se borraron).');
    estado.textos = true;
    guardarLimpieza(estado);
  }

  async function borrarImagenGuardada(id, tel) {
    await db.ref().update({
      ['imgsIdx/' + id]: null,
      ['imgs/' + tel + '/' + id]: null,
      ['chats/' + tel + '/msgs/' + id]: null
    });
    const queda = await db.ref('chats/' + tel + '/msgs').limitToFirst(1).once('value');
    if (!queda.exists()) await db.ref('chats/' + tel).remove();
  }

  async function revisarImagenesGuardadas(estado) {
    const cuenta = { si: 0, duda: 0, remito: 0, no: 0 };
    log('Limpieza: revisando las imágenes ya guardadas para quedarse solo con comprobantes de pago y remitos (puede tardar)...');
    for (;;) {
      let q = db.ref('imgsIdx').orderByKey();
      if (estado.ultimaImg) q = q.startAfter(estado.ultimaImg);
      const snap = await q.limitToFirst(50).once('value');
      const lote = [];
      snap.forEach(x => { lote.push([x.key, x.val() || {}]); });
      if (!lote.length) break;
      for (const [id, v] of lote) {
        // Se revisan las que nunca se revisaron o se revisaron con reglas viejas
        if (v.rv !== VERSION_REGLAS && v.tel) {
          const img = (await db.ref('imgs/' + v.tel + '/' + id + '/d').once('value')).val();
          if (!img) {
            await borrarImagenGuardada(id, v.tel);
          } else {
            const texto = await textoDeImagen(Buffer.from(img, 'base64'));
            let comp, cat;
            if (v.yo) {
              // Remito mio: si no se pudo leer, se deja como estaba
              comp = texto === null || esRemito(texto) ? 'remito' : 'no';
              cat = 'remito';
            } else {
              comp = texto === null ? 'duda' : clasificarComprobante(texto);
              cat = 'pago';
            }
            cuenta[comp]++;
            if (comp === 'no') await borrarImagenGuardada(id, v.tel);
            else {
              const upd = { ['imgsIdx/' + id + '/cat']: cat, ['imgsIdx/' + id + '/rv']: VERSION_REGLAS };
              const monto = cat === 'pago' ? montoDeComprobante(texto) : 0;
              if (cat === 'pago') upd['imgsIdx/' + id + '/comp'] = comp;
              if (monto) upd['imgsIdx/' + id + '/monto'] = monto;
              const hayMsg = (await db.ref('chats/' + v.tel + '/msgs/' + id + '/t').once('value')).exists();
              if (hayMsg) {
                upd['chats/' + v.tel + '/msgs/' + id + '/cat'] = cat;
                if (cat === 'pago') upd['chats/' + v.tel + '/msgs/' + id + '/comp'] = comp;
                if (monto) upd['chats/' + v.tel + '/msgs/' + id + '/monto'] = monto;
              }
              await db.ref().update(upd);
            }
          }
        }
        estado.ultimaImg = id;
        guardarLimpieza(estado);
      }
    }
    log('Limpieza: imágenes revisadas. Comprobantes de pago ' + cuenta.si + ', pagos dudosos ' + cuenta.duda +
      ', remitos ' + cuenta.remito + ', borradas ' + cuenta.no + '.');
    estado.imagenes = true;
    guardarLimpieza(estado);
  }

  async function limpiezaUnica() {
    const estado = leerLimpieza();
    // Reglas nuevas: se vuelven a revisar las imagenes desde el principio
    if (estado.reglas !== VERSION_REGLAS) {
      estado.reglas = VERSION_REGLAS;
      estado.imagenes = false;
      delete estado.ultimaImg;
      guardarLimpieza(estado);
    }
    if (estado.textos && estado.imagenes) return;
    try {
      if (!estado.textos) await limpiarTextos(estado);
      if (!estado.imagenes) await revisarImagenesGuardadas(estado);
      log('Limpieza única terminada.');
    } catch (e) {
      log('Limpieza: se cortó (' + e.message + '). Sigue en el próximo arranque.');
    }
  }
  setTimeout(limpiezaUnica, 90000);

  log('Iniciando WhatsApp...');
  await conectar();
})().catch(e => {
  log('Error al iniciar:', e && e.message ? e.message : e);
  process.exit(1);
});

process.on('unhandledRejection', (e) => log('Error no controlado:', e && e.message ? e.message : e));
