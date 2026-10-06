// =============================================================================
//  main.js - Caja HomePoint como aplicación de Windows
// =============================================================================
//  Reemplaza a iniciar.vbs + servidor.ps1 + Chrome en modo --app:
//    - enciende el servidor local que publica la carpeta "app";
//    - abre la caja en una ventana propia, maximizada y sin barras;
//    - si se vuelve a abrir el programa, abre otra ventana de caja (no otro
//      servidor), igual que antes;
//    - se actualiza sola desde GitHub (ver actualizador.js).
//
//  Registro: %APPDATA%\Caja HomePoint\logs\main.log
// =============================================================================

const { app, BrowserWindow, Menu, shell, ipcMain, net, dialog } = require('electron');
const path = require('path');
const log = require('electron-log/main');

const { iniciarServidor, PAGINA_INICIAL } = require('./servidor');
const { iniciarActualizador } = require('./actualizador');

log.initialize();
log.transports.file.maxSize = 2 * 1024 * 1024;
log.errorHandler.startCatching({ showDialog: false });

const RAIZ_APP = path.join(__dirname, '..', 'app');
const ICONO = path.join(__dirname, 'icono.ico');
const PRELOAD = path.join(__dirname, 'preload.js');
const COLOR_FONDO = '#17181C';
const PRUEBA_CONEXION = 'https://www.gstatic.com/generate_204';

let servidor = null;
let urlCaja = null;
let splash = null;

// Una sola copia del programa: si alguien vuelve a hacer doble clic, la copia
// que ya está corriendo abre otra ventana de caja.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (urlCaja) crearVentanaCaja();
  });
  app.whenReady().then(arrancar);
}

app.setAppUserModelId('com.homepoint.caja');

// ------------------------------------------------------------------ splash ---
function mostrarSplash() {
  splash = new BrowserWindow({
    width: 440,
    height: 280,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    center: true,
    skipTaskbar: false,
    backgroundColor: COLOR_FONDO,
    icon: ICONO,
    title: 'Caja HomePoint',
    webPreferences: { sandbox: true, contextIsolation: true }
  });
  splash.loadFile(path.join(__dirname, 'splash.html'), { query: { v: app.getVersion() } });
  splash.once('ready-to-show', () => splash && splash.show());
  splash.on('closed', () => { splash = null; });
}

function cerrarSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
}

// --------------------------------------------------------------- conexión ---
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

// Sin internet la caja no puede funcionar (Firebase, la planilla, las fotos).
// En vez de una pantalla rota se muestra un aviso que reintenta solo.
function esperarConexion(ventana) {
  let reintentando = false;
  const intentar = async () => {
    if (reintentando || ventana.isDestroyed()) return;
    reintentando = true;
    if (await hayInternet()) {
      clearInterval(temporizador);
      ipcMain.removeListener('conexion:reintentar', manual);
      log.info('Volvió la conexión: se abre la caja');
      ventana.loadURL(urlCaja);
    }
    reintentando = false;
  };
  const manual = (evento) => {
    if (evento.sender === ventana.webContents) intentar();
  };
  const temporizador = setInterval(intentar, 5000);
  ipcMain.on('conexion:reintentar', manual);
  ventana.once('closed', () => {
    clearInterval(temporizador);
    ipcMain.removeListener('conexion:reintentar', manual);
  });
}

// ---------------------------------------------------------- ventana caja ---
function esDeLaCaja(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && u.hostname === 'localhost' && Number(u.port) === servidor.puerto;
  } catch {
    return false;
  }
}

function abrirAfuera(url) {
  if (/^(https?:|mailto:|tel:|whatsapp:)/i.test(url)) shell.openExternal(url);
}

function opcionesVentana(extra) {
  return {
    backgroundColor: '#FFFFFF',
    icon: ICONO,
    title: 'Caja HomePoint',
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    },
    ...extra
  };
}

function prepararContenido(ventana) {
  const contenido = ventana.webContents;

  // Ventanas que abre la caja:
  //  - en blanco (los tickets que se imprimen con window.print) o de la propia
  //    caja: ventana hija;
  //  - cualquier otra dirección (WhatsApp, Maps...): navegador de Windows.
  contenido.setWindowOpenHandler(({ url }) => {
    if (!url || url === 'about:blank' || esDeLaCaja(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: opcionesVentana({ parent: ventana }) };
    }
    abrirAfuera(url);
    return { action: 'deny' };
  });
  contenido.on('did-create-window', (hija) => prepararContenido(hija));

  contenido.on('will-navigate', (evento, url) => {
    if (esDeLaCaja(url) || url.startsWith('file:')) return;
    evento.preventDefault();
    abrirAfuera(url);
  });

  // El título de la ventana es siempre el del programa.
  ventana.on('page-title-updated', (evento) => evento.preventDefault());

  // La caja bloquea el cierre mientras guarda un pedido en Firebase
  // (beforeunload en ingresoPedidoV2.js). En una app ese bloqueo es mudo, así
  // que se pregunta, como haría un navegador.
  contenido.on('will-prevent-unload', (evento) => {
    const eleccion = dialog.showMessageBoxSync(ventana, {
      type: 'warning',
      title: 'Caja HomePoint',
      message: 'Se está guardando un pedido',
      detail: 'Si cerrás ahora, el pedido puede quedar sin guardar. Conviene esperar unos segundos.',
      buttons: ['Esperar', 'Cerrar igual'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (eleccion === 1) evento.preventDefault();
  });

  // Atajos de soporte: F5 recarga, Ctrl+Shift+I abre las herramientas.
  contenido.on('before-input-event', (evento, tecla) => {
    if (tecla.type !== 'keyDown') return;
    if (tecla.key === 'F5' || (tecla.control && tecla.key.toLowerCase() === 'r')) {
      contenido.reload();
      evento.preventDefault();
    } else if (tecla.control && tecla.shift && tecla.key.toLowerCase() === 'i') {
      contenido.toggleDevTools();
      evento.preventDefault();
    }
  });

  contenido.on('render-process-gone', (_evento, detalle) => {
    log.error('La pantalla se cerró inesperadamente:', detalle.reason);
    if (detalle.reason !== 'clean-exit' && !ventana.isDestroyed()) contenido.reload();
  });
  ventana.on('unresponsive', () => log.warn('La ventana dejó de responder'));
  ventana.on('responsive', () => log.info('La ventana volvió a responder'));
}

async function crearVentanaCaja() {
  const ventana = new BrowserWindow(opcionesVentana({ show: false, minWidth: 900, minHeight: 600 }));
  prepararContenido(ventana);

  ventana.once('ready-to-show', () => {
    ventana.maximize();
    ventana.show();
    ventana.focus();
    cerrarSplash();
  });

  if (await hayInternet()) {
    ventana.loadURL(urlCaja);
  } else {
    log.warn('Sin conexión a internet al abrir la caja');
    ventana.loadFile(path.join(__dirname, 'sin-conexion.html'));
    esperarConexion(ventana);
  }
  return ventana;
}

// ---------------------------------------------------------------- arranque ---
async function arrancar() {
  log.info(`Caja HomePoint ${app.getVersion()} arrancando`);
  Menu.setApplicationMenu(null);
  mostrarSplash();

  try {
    servidor = await iniciarServidor(RAIZ_APP, log);
  } catch (error) {
    log.error('No se pudo encender el servidor local:', error.message);
    cerrarSplash();
    dialog.showErrorBox(
      'Caja HomePoint',
      'No se pudo encender la caja porque otro programa está usando los puertos 8123, 8124 y 8125.\n\nReiniciá la PC y volvé a abrirla.'
    );
    app.quit();
    return;
  }

  urlCaja = `http://localhost:${servidor.puerto}/${PAGINA_INICIAL}`;
  iniciarActualizador(log);

  // La caja se abre sola al prender la PC (reemplaza INICIO AUTOMATICO.bat).
  // Si alguien la desactiva desde el Administrador de tareas, Windows respeta
  // esa decisión aunque esto se vuelva a ejecutar.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });

  await crearVentanaCaja();
}

// QZ Tray (impresión de tickets) usa un certificado propio en localhost.
// Se acepta solamente para localhost; cualquier otro sitio sigue la regla normal.
app.on('certificate-error', (evento, _contenido, url, _error, _certificado, responder) => {
  try {
    const host = new URL(url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      evento.preventDefault();
      responder(true);
      return;
    }
  } catch {}
  responder(false);
});

app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  if (servidor) servidor.detener().catch(() => {});
  log.info('Caja HomePoint cerrada');
});
