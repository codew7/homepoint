'use strict';
// =====================================================================
// WhatsAppSync - app de bandeja de Windows.
//
// Maneja una o varias LINEAS de WhatsApp (un numero cada una, con su propio
// proyecto de Firebase y su propia base de pedidos). Por cada linea lanza el
// sincronizador (../index.js) en un proceso aparte y lo reinicia si se cae:
// si una linea falla, las demas siguen. Vive en la bandeja del sistema (al
// lado del reloj) y arranca siempre escondido ahi. Cerrar o minimizar la
// ventana solo la esconde: para detenerlo hay que elegir "Salir" en el menu
// del icono y confirmar.
//
// Datos en %APPDATA%\WhatsAppSync (la carpeta de instalacion no se puede
// escribir):
//   lineas\<id>\linea.json        { nombre, numero, databaseUrl, pedidosUrl, modo, principal, avisosDespacho, creada }
//   lineas\<id>\clave-firebase.json, sesion\, logs\ ...   (lo de cada linea)
//   ocr\                          idioma del lector de texto (compartido)
//   app.json                      preferencias de la app
// Las versiones anteriores (una sola linea) guardaban todo en la raiz: al
// primer arranque se pasa a lineas\principal sin volver a escanear el QR.
//
// Tipo de cada linea (se elige al agregarla y se puede cambiar):
//   Envios: cotizaciones, comprobantes, remitos y avisos de despacho.
//   Cobros: solo comprobantes de pago de los clientes; lo unico propio que
//     se guarda es el mensaje con la palabra "alias" (datos para transferir).
// Aparte, una linea de la PC es la PRINCIPAL (se elige en la ventana): va
// primera y es la que usan "Descargar comprobantes" y el Verificador. Puede
// ser de cualquier tipo. (La carpeta "principal" es solo el nombre que tomo
// la instalacion vieja; no define nada.)
// =====================================================================

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, utilityProcess, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const AJUSTES = require('../ajustes');
const { iniciarActualizador } = require('./actualizador');

// Una sola copia por PC: esa copia maneja todas las lineas de la PC.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const DATOS = path.join(app.getPath('appData'), 'WhatsAppSync');
const DIR_LINEAS = path.join(DATOS, 'lineas');
const DIR_OCR = path.join(DATOS, 'ocr');
const ARCHIVO_PREFS = path.join(DATOS, 'app.json');
const MOTOR = path.join(__dirname, '..', 'index.js');
const MAX_LINEAS = 3;
fs.mkdirSync(DIR_LINEAS, { recursive: true });

app.setAppUserModelId('com.homepoint.whatsappsync');

let ventana = null;
let bandeja = null;
let saliendo = false;
const lineas = new Map();     // id -> linea (ver crearLinea)
let seleccionada = '';
let inicioConWindows = false;
const avisosMigracion = [];   // se muestran en la Actividad de la principal

function hoy() { return new Date().toDateString(); }

function leerPrefs() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO_PREFS, 'utf8')); } catch (_) { return {}; }
}
function guardarPrefs(p) {
  try { fs.writeFileSync(ARCHIVO_PREFS, JSON.stringify(p, null, 2)); } catch (_) { /* no es critico */ }
}

// ---------------------------------------------------------------------
// Numeros y direcciones
// ---------------------------------------------------------------------
// Acepta el numero como venga (11 7646-0030, 011 15 7646 0030, +54 9 11...)
// y lo deja como 549 + 10 digitos, que es como lo informa WhatsApp.
function normalizarNumero(texto) {
  let d = String(texto || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('54') && d.length >= 12) {
    d = d.slice(2);
    if (d.startsWith('9')) d = d.slice(1);
  }
  if (d.startsWith('0')) d = d.slice(1);
  // "15" de celular despues del codigo de area (2, 3 o 4 digitos)
  if (d.length === 12) {
    for (const n of [2, 3, 4]) {
      if (d.slice(n, n + 2) === '15') { d = d.slice(0, n) + d.slice(n + 2); break; }
    }
  }
  return d.length === 10 ? '549' + d : '';
}

function numeroVisible(numero) {
  const d = String(numero || '').replace(/^549/, '');
  if (d.length !== 10) return numero || '';
  const area = d.startsWith('11') ? 2 : d.length - 8 > 2 ? d.length - 8 : 3;
  const resto = d.slice(area);
  return d.slice(0, area) + ' ' + resto.slice(0, resto.length - 4) + '-' + resto.slice(-4);
}

const RE_URL_BASE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/i;
function limpiarUrl(u) { return String(u || '').trim().replace(/\/+$/, ''); }

// Carpeta de la instalacion vieja (una sola linea, la de envios)
const ID_VIEJA = 'principal';
const NOMBRE_ENVIOS = 'Envíos';
function modoDe(L) { return L && L.cfg && L.cfg.modo === 'cobros' ? 'cobros' : 'envios'; }

// Siempre hay exactamente una principal (si hay lineas)
function ordenarLineas() {
  const lista = listaLineas();
  const elegida = lista.filter(L => L.cfg.principal);
  if (elegida.length !== 1) {
    const una = elegida[0] || lista.find(L => L.id === ID_VIEJA) || lista[0];
    for (const L of lista) {
      const debe = L === una;
      if (!!L.cfg.principal !== debe) { L.cfg.principal = debe; if (!L.respaldo) guardarCfg(L); }
    }
  }
  lista.sort((a, b) => (a.cfg.principal ? -1 : b.cfg.principal ? 1 : (a.cfg.creada || 0) - (b.cfg.creada || 0)));
  lineas.clear();
  for (const L of lista) lineas.set(L.id, L);
}

function slug(nombre) {
  const s = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  return s || 'linea';
}

// ---------------------------------------------------------------------
// Lineas
// ---------------------------------------------------------------------
function crearLinea(id, cfg) {
  return {
    id,
    dir: path.join(DIR_LINEAS, id),
    cfg,
    motor: null,
    reinicio: null,
    estado: {
      conexion: 'iniciando',   // iniciando | qr | conectado | reconectando | reiniciando | falta-clave | duplicado | detenida
      numero: '',
      qr: '',
      dia: hoy(),
      mensajesHoy: 0,
      adjuntosHoy: 0,
      logs: []
    }
  };
}

function archivoLinea(L) { return path.join(L.dir, 'linea.json'); }
function archivoClave(L) { return path.join(L.dir, 'clave-firebase.json'); }

function guardarCfg(L) {
  fs.mkdirSync(L.dir, { recursive: true });
  fs.writeFileSync(archivoLinea(L), JSON.stringify(L.cfg, null, 2));
}

function proyectoDeClave(L) {
  try { return JSON.parse(fs.readFileSync(archivoClave(L), 'utf8')).project_id || ''; } catch (_) { return ''; }
}

function leerLineas() {
  let carpetas = [];
  try { carpetas = fs.readdirSync(DIR_LINEAS, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch (_) { /* vacia */ }
  const lista = [];
  for (const id of carpetas) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(DIR_LINEAS, id, 'linea.json'), 'utf8'));
      const L = crearLinea(id, cfg);
      let cambio = false;
      // Versiones anteriores: el tipo salia de la carpeta
      if (cfg.modo !== 'envios' && cfg.modo !== 'cobros') { cfg.modo = id === ID_VIEJA ? 'envios' : 'cobros'; cambio = true; }
      if ((cfg.avisosDespacho !== false) !== (cfg.modo === 'envios')) { cfg.avisosDespacho = cfg.modo === 'envios'; cambio = true; }
      // Versiones anteriores: alias cargados a mano (ya no se usan)
      if ('alias' in cfg) { delete cfg.alias; cambio = true; }
      if (id === ID_VIEJA && cfg.nombre === 'Principal') { cfg.nombre = NOMBRE_ENVIOS; cambio = true; }
      if (cambio) guardarCfg(L);
      lista.push(L);
    } catch (_) { /* carpeta sin linea.json: se ignora */ }
  }
  for (const L of lista) lineas.set(L.id, L);
  ordenarLineas();
}

function listaLineas() { return [...lineas.values()]; }

// Version anterior: todo en la raiz de la carpeta de datos. Se mueve a
// lineas\principal (mismo disco: es un renombre, no se copia nada). Si algo
// falla, se devuelve todo a su lugar y sigue funcionando como antes.
const ARCHIVOS_DE_LINEA = ['clave-firebase.json', 'sesion', 'lids.json', 'clientes-tel.json',
  'descartados.json', 'limpieza-cotizaciones.json', 'logs', 'qr.html'];

function migrarInstalacionVieja() {
  const destino = path.join(DIR_LINEAS, 'principal');
  if (!fs.existsSync(path.join(DATOS, 'clave-firebase.json')) || fs.existsSync(destino)) return;
  const movidos = [];
  try {
    fs.mkdirSync(destino, { recursive: true });
    for (const nombre of ARCHIVOS_DE_LINEA) {
      const de = path.join(DATOS, nombre);
      if (!fs.existsSync(de)) continue;
      fs.renameSync(de, path.join(destino, nombre));
      movidos.push(nombre);
    }
    const cfg = {
      nombre: NOMBRE_ENVIOS,
      modo: 'envios',
      principal: true,
      numero: AJUSTES.NUMERO_ESPERADO,
      databaseUrl: AJUSTES.DATABASE_URL,
      pedidosUrl: AJUSTES.PEDIDOS_DATABASE_URL || '',
      avisosDespacho: true,
      creada: Date.now()
    };
    fs.writeFileSync(path.join(destino, 'linea.json'), JSON.stringify(cfg, null, 2));
    avisosMigracion.push('Se pasó la instalación anterior a la línea "' + NOMBRE_ENVIOS + '" (no hace falta volver a escanear el QR).');
  } catch (e) {
    for (const nombre of movidos) {
      try { fs.renameSync(path.join(destino, nombre), path.join(DATOS, nombre)); } catch (_) { /* se intenta el resto */ }
    }
    try { fs.rmSync(destino, { recursive: true, force: true }); } catch (_) { /* nada */ }
    avisosMigracion.push('No se pudo pasar la instalación anterior a "lineas" (' + e.message + '). Se reintenta en el próximo arranque.');
  }
}

// Si la migracion fallo, la instalacion vieja sigue andando desde la raiz.
function lineaDeRespaldo() {
  if (lineas.size || !fs.existsSync(path.join(DATOS, 'clave-firebase.json'))) return;
  const L = crearLinea(ID_VIEJA, {
    nombre: NOMBRE_ENVIOS, modo: 'envios', principal: true, numero: AJUSTES.NUMERO_ESPERADO, databaseUrl: AJUSTES.DATABASE_URL,
    pedidosUrl: AJUSTES.PEDIDOS_DATABASE_URL || '', avisosDespacho: true
  });
  L.dir = DATOS;
  L.respaldo = true;
  lineas.set(L.id, L);
}

// ---------------------------------------------------------------------
// Sincronizador (uno por linea)
// ---------------------------------------------------------------------
function anotar(L, linea) {
  L.estado.logs.push(linea);
  if (L.estado.logs.length > 150) L.estado.logs.splice(0, L.estado.logs.length - 150);
}

function iniciarMotor(L) {
  clearTimeout(L.reinicio);
  if (L.motor || saliendo || !lineas.has(L.id)) return;
  if (!fs.existsSync(archivoClave(L))) {
    L.estado.conexion = 'falta-clave';
    actualizar();
    pedirAtencion(L, 'Falta la clave de Firebase');
    return;
  }
  L.estado.conexion = 'iniciando';
  actualizar();
  const m = utilityProcess.fork(MOTOR, [], {
    env: { ...process.env, WAS_DATOS: L.dir, WAS_OCR: DIR_OCR },
    stdio: 'ignore',
    serviceName: 'WhatsAppSync ' + (L.cfg.nombre || L.id)
  });
  L.motor = m;
  m.on('message', (e) => recibir(L, e));
  m.on('exit', (codigo) => {
    if (L.motor === m) L.motor = null;
    if (saliendo || m.detenido || !lineas.has(L.id)) return;   // se detuvo a proposito
    if (codigo === 2 && L.estado.conexion === 'clave-mala') {   // clave invalida: no tiene sentido reintentar
      actualizar();
      pedirAtencion(L, 'La clave de Firebase no sirve');
      return;
    }
    if (codigo === 2) {               // falta configurar algo
      L.estado.conexion = fs.existsSync(archivoClave(L)) ? 'reiniciando' : 'falta-clave';
      actualizar();
      if (L.estado.conexion === 'falta-clave') { pedirAtencion(L, 'Falta la clave de Firebase'); return; }
    } else if (codigo === 3) {        // otra copia tomo la conexion
      L.estado.conexion = 'duplicado';
      actualizar();
      pedirAtencion(L, 'Hay otra copia conectada');
      return;
    }
    L.estado.conexion = 'reiniciando';
    actualizar();
    L.reinicio = setTimeout(() => iniciarMotor(L), 15000);
  });
}

function detenerMotor(L) {
  clearTimeout(L.reinicio);
  if (!L.motor) return Promise.resolve();
  const m = L.motor;
  m.detenido = true;
  return new Promise(resolver => {
    let hecho = false;
    const listo = () => {
      if (hecho) return;
      hecho = true;
      if (L.motor === m) L.motor = null;
      resolver();
    };
    m.once('exit', listo);
    m.kill();
    setTimeout(listo, 4000);
  });
}

async function reiniciarMotor(L) {
  await detenerMotor(L);
  iniciarMotor(L);
}

// Desvincula de verdad (tambien del lado del celular): se lo pide al motor,
// que cierra la sesion de WhatsApp. Si no responde, se borra la sesion local.
function desvincularMotor(L) {
  clearTimeout(L.reinicio);
  return new Promise(resolver => {
    const m = L.motor;
    let espera = null;
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      clearTimeout(espera);
      if (L.motor === m) L.motor = null;
      try { fs.rmSync(path.join(L.dir, 'sesion'), { recursive: true, force: true }); } catch (_) { /* nada */ }
      resolver();
    };
    if (!m) return fin();
    m.detenido = true;
    espera = setTimeout(() => { try { m.kill(); } catch (_) { /* ya termino */ } fin(); }, 9000);
    m.once('exit', fin);
    try { m.postMessage({ tipo: 'desvincular' }); } catch (_) { m.kill(); }
  });
}

function recibir(L, e) {
  if (!e || !e.tipo) return;
  const s = L.estado;
  if (s.dia !== hoy()) { s.dia = hoy(); s.mensajesHoy = 0; s.adjuntosHoy = 0; }
  switch (e.tipo) {
    case 'log':
      anotar(L, e.linea);
      break;
    case 'qr': {
      const primera = s.conexion !== 'qr';
      s.conexion = 'qr';
      s.qr = e.qr;
      if (primera) pedirAtencion(L, 'Hay que escanear el QR');
      break;
    }
    case 'conectado':
      s.conexion = 'conectado';
      s.numero = e.numero || '';
      s.qr = '';
      break;
    case 'desconectado':
      if (s.conexion !== 'qr') s.conexion = 'reconectando';
      break;
    case 'mensajes':
      s.mensajesHoy += e.n || 0;
      break;
    case 'adjunto':
      s.adjuntosHoy++;
      break;
    case 'falta-clave':
      s.conexion = 'falta-clave';
      break;
    case 'clave-mala':
      s.conexion = 'clave-mala';
      s.motivo = e.motivo || '';
      break;
  }
  actualizar();
}

// ---------------------------------------------------------------------
// Ventana y bandeja
// ---------------------------------------------------------------------
const ICONOS = {
  ok: nativeImage.createFromPath(path.join(__dirname, 'bandeja-ok.png')),
  espera: nativeImage.createFromPath(path.join(__dirname, 'bandeja-espera.png')),
  error: nativeImage.createFromPath(path.join(__dirname, 'bandeja-error.png'))
};

const TEXTOS = {
  iniciando: 'Iniciando...',
  qr: 'Esperando el QR',
  conectado: 'Conectado',
  reconectando: 'Reconectando...',
  reiniciando: 'Reiniciando...',
  'falta-clave': 'Falta la clave',
  'clave-mala': 'La clave no sirve',
  duplicado: 'Otra copia conectada',
  detenida: 'Detenida'
};
const ERRORES = ['falta-clave', 'clave-mala', 'duplicado'];

function datosLinea(L) {
  return {
    id: L.id,
    nombre: L.cfg.nombre || L.id,
    numero: L.cfg.numero || '',
    numeroVisible: numeroVisible(L.cfg.numero),
    databaseUrl: L.cfg.databaseUrl || '',
    pedidosUrl: L.cfg.pedidosUrl || '',
    avisosDespacho: L.cfg.avisosDespacho !== false,
    modo: modoDe(L),
    principal: !!L.cfg.principal,
    proyecto: proyectoDeClave(L),
    respaldo: !!L.respaldo,
    ...L.estado
  };
}

function estadoVentana() {
  return {
    lineas: listaLineas().map(datosLinea),
    seleccionada,
    maxLineas: MAX_LINEAS,
    inicioConWindows,
    version: app.getVersion(),
    actualizacion: estadoActualizacion
  };
}

// ---------------------------------------------------------------------
// Actualizacion automatica (ver actualizador.js)
// ---------------------------------------------------------------------
let estadoActualizacion = '';

// Lo de la actualizacion va a la Actividad de todas las lineas y a
// actualizaciones.log en la carpeta de datos.
function logGeneral(texto) {
  const linea = '[' + new Date().toLocaleString('es-AR', { hour12: false }) + '] ' + texto;
  for (const L of lineas.values()) anotar(L, linea);
  try { fs.appendFileSync(path.join(DATOS, 'actualizaciones.log'), linea + '\r\n'); } catch (_) { /* no es critico */ }
  actualizar();
}

let pendienteVentana = null;
function actualizar() {
  if (bandeja) {
    const ls = listaLineas();
    const estados = ls.map(L => L.estado.conexion);
    const icono = !ls.length || estados.some(c => ERRORES.includes(c)) ? ICONOS.error
      : estados.every(c => c === 'conectado') ? ICONOS.ok : ICONOS.espera;
    bandeja.setImage(icono);
    const filas = ls.length
      ? ls.map(L => L.cfg.nombre + ': ' + TEXTOS[L.estado.conexion] +
          (L.estado.conexion === 'conectado' ? ' (' + L.estado.mensajesHoy + ' msj hoy)' : ''))
      : ['Sin líneas configuradas'];
    // Windows corta el tooltip en 127 caracteres
    bandeja.setToolTip(['WhatsAppSync', ...filas].join('\n').slice(0, 127));
  }
  // Los logs llegan seguido: a la ventana se le manda como mucho cada 150 ms
  if (!pendienteVentana) {
    pendienteVentana = setTimeout(() => {
      pendienteVentana = null;
      if (ventana && !ventana.isDestroyed()) ventana.webContents.send('estado', estadoVentana());
    }, 150);
  }
}

// Una linea necesita algo (QR, clave...): se abre la ventana en esa linea y,
// si hay varias, un globo dice cual.
function pedirAtencion(L, motivo) {
  // No le saca la pantalla a otra linea que tambien esta esperando algo
  const actual = lineas.get(seleccionada);
  const visible = ventana && !ventana.isDestroyed() && ventana.isVisible();
  const ocupada = actual && actual !== L && visible && (actual.estado.conexion === 'qr' || ERRORES.includes(actual.estado.conexion));
  if (!ocupada) seleccionada = L.id;
  mostrarVentana();
  if (lineas.size > 1 && bandeja && bandeja.displayBalloon) {
    bandeja.displayBalloon({ iconType: 'warning', title: 'WhatsAppSync · ' + L.cfg.nombre, content: motivo + '.' });
  }
  actualizar();
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 480,
    height: 800,
    minWidth: 400,
    minHeight: 520,
    show: false,
    title: 'WhatsAppSync',
    icon: path.join(__dirname, 'icono.png'),
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  ventana.removeMenu();
  ventana.loadFile(path.join(__dirname, 'ventana.html'));
  ventana.webContents.on('did-finish-load', actualizar);

  // Cerrar o minimizar = esconder en la bandeja. No se detiene nada.
  ventana.on('close', (e) => {
    if (saliendo) return;
    e.preventDefault();
    ventana.hide();
    avisoPrimeraVez();
  });
  ventana.on('minimize', (e) => {
    e.preventDefault();
    ventana.hide();
    avisoPrimeraVez();
  });
}

function avisoPrimeraVez() {
  const p = leerPrefs();
  if (p.avisoBandeja) return;
  p.avisoBandeja = true;
  guardarPrefs(p);
  if (bandeja && bandeja.displayBalloon) {
    bandeja.displayBalloon({
      iconType: 'info',
      title: 'WhatsAppSync sigue funcionando',
      content: 'Quedó en la bandeja, al lado del reloj. Para abrirlo, hacé clic en su ícono.'
    });
  }
}

function mostrarVentana() {
  if (!ventana || ventana.isDestroyed()) crearVentana();
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
}

function abrirAgregar() {
  mostrarVentana();
  const enviar = () => ventana.webContents.send('abrir-agregar');
  if (ventana.webContents.isLoading()) ventana.webContents.once('did-finish-load', enviar); else enviar();
}

function menuBandeja() {
  const ls = listaLineas();
  const reiniciar = ls.length > 1
    ? { label: 'Reiniciar conexión', submenu: ls.map(L => ({ label: L.cfg.nombre, click: () => reiniciarMotor(L) })) }
    : { label: 'Reiniciar conexión', enabled: ls.length === 1, click: () => ls[0] && reiniciarMotor(ls[0]) };
  return Menu.buildFromTemplate([
    { label: 'Abrir WhatsAppSync', click: mostrarVentana },
    { label: 'Agregar línea...', enabled: ls.length < MAX_LINEAS, click: abrirAgregar },
    { type: 'separator' },
    reiniciar,
    { label: 'Abrir carpeta de datos', click: () => shell.openPath(DATOS) },
    {
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: inicioConWindows,
      click: (item) => configurarInicio(item.checked)
    },
    { type: 'separator' },
    { label: 'Salir...', click: confirmarSalida }
  ]);
}
function refrescarMenu() { if (bandeja) bandeja.setContextMenu(menuBandeja()); }

async function confirmarSalida() {
  const r = await dialog.showMessageBox(ventana && ventana.isVisible() ? ventana : null, {
    type: 'warning',
    buttons: ['Seguir funcionando', 'Salir igual'],
    defaultId: 0,
    cancelId: 0,
    title: 'WhatsAppSync',
    message: '¿Salir de WhatsAppSync?',
    detail: 'Mientras esté cerrado no se guardan los mensajes ni los comprobantes de ninguna línea. ' +
      'Al volver a abrirlo recupera lo que haya entrado.'
  });
  if (r.response !== 1) return;
  saliendo = true;
  await Promise.all(listaLineas().map(detenerMotor));
  app.quit();
}

function configurarInicio(si) {
  app.setLoginItemSettings({ openAtLogin: !!si, args: ['--oculto'] });
  inicioConWindows = !!si;
  refrescarMenu();
  actualizar();
}

// ---------------------------------------------------------------------
// Alta y cambios de lineas
// ---------------------------------------------------------------------
// La clave elegida queda en memoria hasta que se guarda la linea.
let claveElegida = null;   // { contenido, proyecto }

async function elegirArchivoClave() {
  const r = await dialog.showOpenDialog(ventana, {
    title: 'Elegí el archivo de clave de Firebase (.json)',
    filters: [{ name: 'Clave de Firebase', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return null;
  let clave;
  try { clave = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (e) {
    return { error: 'No se pudo leer el archivo: ' + e.message };
  }
  if (clave.type !== 'service_account' || !clave.private_key || !clave.project_id) {
    return { error: 'Ese archivo no es una clave de cuenta de servicio de Firebase.' };
  }
  return { clave };
}

// La base de pedidos se lee sin clave (como pedidos-87064): tiene que
// permitir lectura y tener indice en "timestamp".
async function probarBasePedidos(url) {
  try {
    const r = await fetch(url + '/pedidos.json?orderBy=%22timestamp%22&limitToLast=1', { signal: AbortSignal.timeout(20000) });
    if (r.ok) return '';
    if (r.status === 401 || r.status === 403) return 'La base de pedidos no permite leer sin clave (reglas de esa base).';
    if (r.status === 400) return 'La base de pedidos no tiene índice en "timestamp" para "pedidos" (reglas de esa base: ".indexOn": ["timestamp"]).';
    if (r.status === 404) return 'No existe esa base de pedidos. Revisá la dirección.';
    return 'La base de pedidos respondió con error ' + r.status + '.';
  } catch (e) {
    return 'No se pudo conectar con la base de pedidos (' + (e && e.message ? e.message : e) + ').';
  }
}

async function guardarLinea(datos) {
  const editando = datos.id ? lineas.get(datos.id) : null;
  if (datos.id && !editando) return { ok: false, error: 'Esa línea ya no existe.' };
  if (!editando && lineas.size >= MAX_LINEAS) return { ok: false, error: 'Ya hay ' + MAX_LINEAS + ' líneas en esta PC.' };

  // Tipo: libre, al agregar o al editar
  const modo = datos.modo === 'cobros' ? 'cobros' : 'envios';
  const nombre = String(datos.nombre || '').trim().slice(0, 30);
  if (!nombre) return { ok: false, campo: 'nombre', error: 'Poné un nombre para la línea (por ejemplo, el del local).' };
  const numero = normalizarNumero(datos.numero);
  if (!numero) return { ok: false, campo: 'numero', error: 'El número tiene que tener código de área y número: 10 dígitos, como 11 7646-0030.' };

  const otras = listaLineas().filter(L => L !== editando);
  if (otras.some(L => (L.cfg.nombre || '').toLowerCase() === nombre.toLowerCase())) {
    return { ok: false, campo: 'nombre', error: 'Ya hay una línea con ese nombre.' };
  }
  if (otras.some(L => L.cfg.numero === numero)) {
    return { ok: false, campo: 'numero', error: 'Ese número ya está en otra línea de esta PC.' };
  }
  if (!editando && !claveElegida) return { ok: false, campo: 'clave', error: 'Elegí el archivo de clave de Firebase de esta línea.' };
  const proyecto = claveElegida ? claveElegida.proyecto : proyectoDeClave(editando);
  if (proyecto && otras.some(L => proyectoDeClave(L) === proyecto)) {
    return { ok: false, campo: 'clave', error: 'Esa clave es del proyecto "' + proyecto + '", que ya usa otra línea. Cada línea va en su propio proyecto de Firebase.' };
  }

  const databaseUrl = limpiarUrl(datos.databaseUrl);
  if (!RE_URL_BASE.test(databaseUrl)) {
    return { ok: false, campo: 'databaseUrl', error: 'La dirección de la base de WhatsApp no es válida (Firebase → Realtime Database, arriba de los datos).' };
  }
  if (otras.some(L => limpiarUrl(L.cfg.databaseUrl) === databaseUrl)) {
    return { ok: false, campo: 'databaseUrl', error: 'Esa base de WhatsApp ya la usa otra línea.' };
  }
  const pedidosUrl = limpiarUrl(datos.pedidosUrl);
  if (pedidosUrl) {
    if (!RE_URL_BASE.test(pedidosUrl)) return { ok: false, campo: 'pedidosUrl', error: 'La dirección de la base de pedidos no es válida.' };
    if (pedidosUrl === databaseUrl) return { ok: false, campo: 'pedidosUrl', error: 'La base de pedidos no puede ser la misma que la de WhatsApp.' };
    if (!editando || pedidosUrl !== limpiarUrl(editando.cfg.pedidosUrl)) {
      const problema = await probarBasePedidos(pedidosUrl);
      if (problema) return { ok: false, campo: 'pedidosUrl', error: problema };
    }
  }

  let L = editando;
  if (!L) {
    let id = slug(nombre);
    for (let i = 2; id === ID_VIEJA || lineas.has(id) || fs.existsSync(path.join(DIR_LINEAS, id)); i++) id = slug(nombre) + '-' + i;
    // La primera linea de la PC queda como principal
    L = crearLinea(id, { creada: Date.now(), principal: lineas.size === 0 });
  }
  const antes = { ...L.cfg };
  L.cfg = { ...L.cfg, nombre, numero, databaseUrl, pedidosUrl, modo, avisosDespacho: modo === 'envios' };
  delete L.cfg.alias;
  if (L.respaldo) {
    // Instalacion vieja que no se pudo migrar: sigue en la raiz
  } else {
    guardarCfg(L);
  }
  const claveNueva = !!claveElegida;
  if (claveElegida) {
    fs.mkdirSync(L.dir, { recursive: true });
    fs.writeFileSync(archivoClave(L), JSON.stringify(claveElegida.contenido, null, 2));
    claveElegida = null;
  }
  if (!editando) {
    lineas.set(L.id, L);
    ordenarLineas();
    seleccionada = L.id;
    refrescarMenu();
    iniciarMotor(L);
  } else if (antes.numero !== numero || antes.databaseUrl !== databaseUrl || antes.pedidosUrl !== pedidosUrl ||
             antes.modo !== modo || claveNueva || ERRORES.includes(L.estado.conexion)) {
    // Si cambio el numero, el motor ve que la sesion es de otro telefono,
    // la desvincula y muestra un QR nuevo.
    reiniciarMotor(L);
  }
  refrescarMenu();
  actualizar();
  return { ok: true, id: L.id };
}

async function quitarLinea(id) {
  const L = lineas.get(id);
  if (!L) return false;
  const r = await dialog.showMessageBox(ventana, {
    type: 'warning',
    buttons: ['Cancelar', 'Quitar línea'],
    defaultId: 0,
    cancelId: 0,
    title: 'WhatsAppSync',
    message: '¿Quitar la línea "' + L.cfg.nombre + '" de esta PC?',
    detail: 'Se desvincula el WhatsApp ' + numeroVisible(L.cfg.numero) + ' de esta PC y se borran su clave y su sesión acá. ' +
      'Lo guardado en su Firebase no se toca. Se puede volver a agregar cuando quieras (en esta PC o en otra).'
  });
  if (r.response !== 1) return false;
  await desvincularMotor(L);
  lineas.delete(id);
  if (L.respaldo) {
    for (const nombre of ARCHIVOS_DE_LINEA) {
      try { fs.rmSync(path.join(DATOS, nombre), { recursive: true, force: true }); } catch (_) { /* nada */ }
    }
  } else {
    try { fs.rmSync(L.dir, { recursive: true, force: true }); } catch (_) { /* nada */ }
  }
  ordenarLineas();   // si era la principal, la siguiente pasa a serlo
  if (seleccionada === id) seleccionada = (listaLineas()[0] || {}).id || '';
  refrescarMenu();
  actualizar();
  return true;
}

// Elegir otra linea como principal
function hacerPrincipal(id) {
  const elegida = lineas.get(id);
  if (!elegida || elegida.cfg.principal) return false;
  for (const L of lineas.values()) {
    const debe = L === elegida;
    if (!!L.cfg.principal !== debe) { L.cfg.principal = debe; if (!L.respaldo) guardarCfg(L); }
  }
  ordenarLineas();
  refrescarMenu();
  actualizar();
  return true;
}

// ---------------------------------------------------------------------
// Acciones desde la ventana
// ---------------------------------------------------------------------
function linea(id) { return lineas.get(id) || null; }

ipcMain.handle('estado', () => estadoVentana());
ipcMain.handle('seleccionar', (_e, id) => { if (lineas.has(id)) { seleccionada = id; actualizar(); } });

// Elegir clave para el formulario (alta o cambio de clave)
ipcMain.handle('elegir-clave-form', async () => {
  const r = await elegirArchivoClave();
  if (!r) return { ok: false };
  if (r.error) return { ok: false, error: r.error };
  claveElegida = { contenido: r.clave, proyecto: r.clave.project_id };
  return {
    ok: true,
    proyecto: r.clave.project_id,
    databaseUrl: 'https://' + r.clave.project_id + '-default-rtdb.firebaseio.com'
  };
});
ipcMain.handle('olvidar-clave-form', () => { claveElegida = null; });

// Linea existente sin clave: se elige y se arranca
ipcMain.handle('elegir-clave', async (_e, id) => {
  const L = linea(id);
  if (!L) return { ok: false };
  const r = await elegirArchivoClave();
  if (!r) return { ok: false };
  if (r.error) return { ok: false, error: r.error };
  if (listaLineas().some(o => o !== L && proyectoDeClave(o) === r.clave.project_id)) {
    return { ok: false, error: 'Esa clave es del proyecto "' + r.clave.project_id + '", que ya usa otra línea.' };
  }
  fs.mkdirSync(L.dir, { recursive: true });
  fs.writeFileSync(archivoClave(L), JSON.stringify(r.clave, null, 2));
  await reiniciarMotor(L);
  return { ok: true, proyecto: r.clave.project_id };
});

ipcMain.handle('guardar-linea', (_e, datos) => guardarLinea(datos || {}));
ipcMain.handle('quitar-linea', (_e, id) => quitarLinea(id));
ipcMain.handle('hacer-principal', (_e, id) => hacerPrincipal(id));
ipcMain.handle('reiniciar', (_e, id) => { const L = linea(id); return L ? reiniciarMotor(L) : null; });
ipcMain.handle('abrir-carpeta', (_e, id) => { const L = linea(id); return shell.openPath(L ? L.dir : DATOS); });
ipcMain.handle('inicio-windows', (_e, si) => configurarInicio(si));

ipcMain.handle('desvincular', async (_e, id) => {
  const L = linea(id);
  if (!L) return false;
  const r = await dialog.showMessageBox(ventana, {
    type: 'warning',
    buttons: ['Cancelar', 'Desvincular'],
    defaultId: 0,
    cancelId: 0,
    title: 'WhatsAppSync',
    message: '¿Desvincular el WhatsApp de "' + L.cfg.nombre + '"?',
    detail: 'Se cierra la sesión de ' + numeroVisible(L.cfg.numero) + ' en esta PC y aparece un QR nuevo para vincular. ' +
      'Los mensajes ya guardados en Firebase no se tocan.'
  });
  if (r.response !== 1) return false;
  await desvincularMotor(L);
  L.estado.numero = '';
  iniciarMotor(L);
  return true;
});

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
// Abrirlo de nuevo (ya estando abierto) no muestra la ventana: solo avisa
// que ya esta funcionando en la bandeja.
app.on('second-instance', () => {
  if (bandeja && bandeja.displayBalloon) {
    bandeja.displayBalloon({
      iconType: 'info',
      title: 'WhatsAppSync ya está funcionando',
      content: 'Está en la bandeja, al lado del reloj. Para ver la ventana, hacé clic en su ícono.'
    });
  }
});

// Sin ventanas visibles la app sigue viva en la bandeja
app.on('window-all-closed', (e) => { if (!saliendo) e.preventDefault(); });

app.whenReady().then(() => {
  // La primera vez queda configurado para arrancar solo con Windows
  const prefs = leerPrefs();
  if (!prefs.inicioConfigurado) {
    app.setLoginItemSettings({ openAtLogin: true, args: ['--oculto'] });
    prefs.inicioConfigurado = true;
    guardarPrefs(prefs);
  }
  inicioConWindows = app.getLoginItemSettings({ args: ['--oculto'] }).openAtLogin;

  migrarInstalacionVieja();
  leerLineas();
  lineaDeRespaldo();
  const ls = listaLineas();
  seleccionada = ls.length ? ls[0].id : '';
  if (ls.length) for (const a of avisosMigracion) anotar(ls[0], '[WhatsAppSync] ' + a);

  bandeja = new Tray(ICONOS.espera);
  bandeja.setToolTip('WhatsAppSync');
  refrescarMenu();
  bandeja.on('click', mostrarVentana);

  crearVentana();
  // Siempre arranca escondido en la bandeja (con Windows o abierto a mano):
  // la ventana se abre solo con clic en el icono, o sola si hace falta algo
  // (escanear el QR, cargar la clave, otra copia conectada, ninguna linea).
  avisoPrimeraVez();

  if (!ls.length) abrirAgregar();
  for (const L of ls) iniciarMotor(L);
  actualizar();

  iniciarActualizador({
    app,
    urlBase: AJUSTES.DATABASE_URL,   // base de Envios: ahi se publica el aviso de version nueva
    log: logGeneral,
    alCambiar: (texto) => { estadoActualizacion = texto; actualizar(); },
    // Antes de instalar se detienen las lineas con calma (la sesion de
    // WhatsApp queda bien guardada) y se marca la salida para que cerrar la
    // ventana no lo impida.
    antesDeInstalar: async () => {
      saliendo = true;
      await Promise.all(listaLineas().map(detenerMotor));
      if (bandeja) { bandeja.destroy(); bandeja = null; }
    }
  });
});

app.on('before-quit', () => {
  saliendo = true;
  for (const L of lineas.values()) if (L.motor) L.motor.kill();
});
