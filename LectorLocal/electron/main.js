// =============================================================================
//  main.js - Lector HomePoint (Reposición 2) como aplicación de Windows
// =============================================================================
//  La PC del depósito tiene la pistola conectada (modo teclado). Este programa:
//    - muestra la pantalla del Lector (reposicion2/lector.html, publicada en
//      el sitio: se actualiza sola igual que los celulares);
//    - SOLO toma lecturas si Caja HomePoint no está abierta en esta PC: la
//      pistola escribe en la ventana que está adelante, y así nunca se mezclan
//      lecturas entre la Caja y el Lector. Se revisa al abrir y cada 5 s;
//    - recupera el foco solo cuando nadie usa la PC (para que la pistola
//      escriba acá);
//    - se abre sola al prender la PC y se actualiza sola (actualizador.js).
//
//  Registro técnico: %APPDATA%\Lector HomePoint\logs\main.log
//
//  Para probar sin instalar:  npm start
//    $env:LECTOR_URL = 'http://localhost:8080/reposicion2/lector.html'  (página local)
//    $env:LECTOR_PROCESO_CAJA = 'electron.exe'  (si la Caja se prueba con npm start)
// =============================================================================

const { app, BrowserWindow, Menu, shell, ipcMain, net, powerMonitor } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const log = require('electron-log/main');
const { iniciarActualizador } = require('./actualizador');

log.initialize();
log.transports.file.maxSize = 2 * 1024 * 1024;
log.errorHandler.startCatching({ showDialog: false });

const URL_LECTOR = process.env.LECTOR_URL || 'https://homepoint-admin.dev.ar/reposicion2/lector.html';
const ORIGEN = new URL(URL_LECTOR).origin;
const PROCESO_CAJA = (process.env.LECTOR_PROCESO_CAJA || 'Caja HomePoint.exe').toLowerCase();
const ICONO = path.join(__dirname, 'icono.png');
const ESPERA = path.join(__dirname, 'espera.html');
const PRUEBA_CONEXION = 'https://www.gstatic.com/generate_204';

const REVISION_CAJA_MS = 5000;
const REVISION_FOCO_MS = 3000;
const INACTIVIDAD_FOCO_S = 20;

let ventana = null;
// Qué muestra la ventana: 'caja' (esperando que cierren la Caja),
// 'red' (sin internet), 'lector' (la pantalla del Lector).
let modo = '';
let cajaAbierta = false;
let revisando = false;

// Una sola copia: si alguien vuelve a hacer doble clic, se trae la ventana adelante.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => traerAdelante());
  app.whenReady().then(arrancar);
}
app.setAppUserModelId('com.homepoint.lector');

// ------------------------------------------------------------- la Caja ---
// tasklist viene con Windows. Se busca el ejecutable de Caja HomePoint.
function revisarCaja() {
  return new Promise((resolver) => {
    execFile('tasklist', ['/FI', `IMAGENAME eq ${PROCESO_CAJA}`, '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 8000 }, (error, salida) => {
      if (error) { log.warn('tasklist:', error.message); resolver(cajaAbierta); return; }
      resolver(String(salida).toLowerCase().includes(`"${PROCESO_CAJA}"`));
    });
  });
}

async function hayInternet() {
  try {
    const controlador = new AbortController();
    const corte = setTimeout(() => controlador.abort(), 6000);
    const respuesta = await net.fetch(PRUEBA_CONEXION, { signal: controlador.signal, cache: 'no-store' });
    clearTimeout(corte);
    return respuesta.status === 204 || respuesta.ok;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ pantallas ---
function mostrarEspera(nuevo) {
  if (modo === nuevo || !ventana) return;
  modo = nuevo;
  log.info(nuevo === 'caja' ? 'Caja HomePoint abierta: el Lector espera' : 'Sin internet: el Lector espera');
  ventana.loadFile(ESPERA, { query: { modo: nuevo } });
}

async function mostrarLector() {
  if (modo === 'lector' || !ventana) return;
  if (!(await hayInternet())) { mostrarEspera('red'); return; }
  modo = 'lector';
  log.info('Se abre la pantalla del Lector');
  ventana.loadURL(URL_LECTOR);
}

function avisarBloqueo() {
  if (modo === 'lector' && ventana && !ventana.isDestroyed()) ventana.webContents.send('lector:bloqueo', cajaAbierta);
}

// Cada 5 s: ¿se abrió o se cerró la Caja? ¿volvió internet?
async function revisar() {
  if (revisando || !ventana) return;
  revisando = true;
  try {
    const abierta = await revisarCaja();
    if (abierta !== cajaAbierta) {
      cajaAbierta = abierta;
      log.info(abierta ? 'Se abrió Caja HomePoint: el Lector se pausa' : 'Se cerró Caja HomePoint: el Lector sigue');
      avisarBloqueo();
    }
    // Con la pantalla del Lector ya abierta, la Caja sólo la pausa (la página
    // sigue conectada y el depósito ve "en pausa"). Si todavía no estaba
    // abierta, se espera a que cierren la Caja.
    if (modo !== 'lector') {
      if (cajaAbierta) mostrarEspera('caja');
      else await mostrarLector();
    }
  } finally {
    revisando = false;
  }
}

// ----------------------------------------------------------------- foco ---
function traerAdelante() {
  if (!ventana || ventana.isDestroyed()) return;
  if (ventana.isMinimized()) ventana.restore();
  if (!ventana.isVisible()) ventana.show();
  // Windows no deja que un programa se ponga adelante así nomás: este truco
  // (siempre visible un instante) es el que funciona.
  ventana.setAlwaysOnTop(true);
  ventana.focus();
  ventana.setAlwaysOnTop(false);
}

// Si el Lector perdió el foco y hace 20 s que nadie toca la PC, lo recupera.
// Con la Caja abierta no: ahí la pistola es de la Caja.
function vigilarFoco() {
  setInterval(() => {
    if (!ventana || ventana.isDestroyed() || modo !== 'lector' || cajaAbierta) return;
    if (ventana.isFocused()) return;
    if (powerMonitor.getSystemIdleTime() < INACTIVIDAD_FOCO_S) return;
    log.info('El Lector recupera el foco (PC sin uso)');
    traerAdelante();
  }, REVISION_FOCO_MS);
}

// -------------------------------------------------------------- ventana ---
function esDelLector(url) {
  try { return new URL(url).origin === ORIGEN; } catch { return false; }
}

function crearVentana() {
  ventana = new BrowserWindow({
    show: false,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f1f2f4',
    icon: ICONO,
    title: 'Lector HomePoint',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      // Suena sin que nadie haga clic primero, y sigue conectado aunque se minimice.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false
    }
  });
  const contenido = ventana.webContents;

  ventana.once('ready-to-show', () => { ventana.maximize(); ventana.show(); ventana.focus(); });
  ventana.on('page-title-updated', (evento) => evento.preventDefault());
  ventana.on('closed', () => { ventana = null; });

  // Cualquier otra dirección se abre en el navegador de Windows.
  contenido.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contenido.on('will-navigate', (evento, url) => {
    if (esDelLector(url) || url.startsWith('file:')) return;
    evento.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // Si la página no carga (se cortó internet justo), se espera y se reintenta.
  contenido.on('did-fail-load', (_evento, codigo, descripcion, url, principal) => {
    if (!principal || codigo === -3) return; // -3: carga cancelada por otra
    log.warn(`No cargó ${url}: ${descripcion} (${codigo})`);
    if (modo === 'lector') { modo = ''; mostrarEspera('red'); }
  });
  contenido.on('render-process-gone', (_evento, detalle) => {
    log.error('La pantalla se cerró inesperadamente:', detalle.reason);
    if (detalle.reason !== 'clean-exit' && ventana && !ventana.isDestroyed()) contenido.reload();
  });

  // Soporte: F5 recarga, Ctrl+Shift+I abre las herramientas.
  contenido.on('before-input-event', (evento, tecla) => {
    if (tecla.type !== 'keyDown') return;
    if (tecla.key === 'F5') { contenido.reload(); evento.preventDefault(); }
    else if (tecla.control && tecla.shift && tecla.key.toLowerCase() === 'i') { contenido.toggleDevTools(); evento.preventDefault(); }
  });
}

// ------------------------------------------------------------- arranque ---
async function arrancar() {
  log.info(`Lector HomePoint ${app.getVersion()} arrancando (${URL_LECTOR})`);
  Menu.setApplicationMenu(null);

  ipcMain.on('lector:version', (evento) => { evento.returnValue = app.getVersion(); });
  // La página avisa que está lista: se le manda el estado de la Caja.
  ipcMain.on('lector:listo', (evento) => {
    if (ventana && evento.sender === ventana.webContents) evento.sender.send('lector:bloqueo', cajaAbierta);
  });
  ipcMain.on('lector:salir', () => app.quit());
  ipcMain.on('lector:reintentar', () => { revisar(); });

  // Se abre solo al prender la PC (Windows respeta si alguien lo desactiva
  // desde el Administrador de tareas).
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });

  crearVentana();
  cajaAbierta = await revisarCaja();
  if (cajaAbierta) mostrarEspera('caja');
  else await mostrarLector();

  setInterval(revisar, REVISION_CAJA_MS);
  vigilarFoco();
  iniciarActualizador(log);
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => log.info('Lector HomePoint cerrado'));
