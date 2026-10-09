// SoundBoard Showroom — app de escritorio.
// Es una ventana que carga la app web publicada: cualquier cambio que se suba
// al hosting aparece acá sin reinstalar. Esta capa sólo agrega lo que la web
// no puede hacer sola: sonido sin click, arranque con Windows, seguir sonando
// en segundo plano (ícono junto al reloj) y un instalador común.

const { app, BrowserWindow, Tray, Menu, ipcMain, shell, powerSaveBlocker, nativeImage } = require('electron');
const path = require('path');

// Para probar contra un servidor local: set SOUNDBOARD_URL=http://localhost:5500/index.html
const APP_URL = process.env.SOUNDBOARD_URL || 'https://homepoint-admin.dev.ar/SoundBoard/index.html';
const APP_ORIGIN = new URL(APP_URL).origin;
const ICON = path.join(__dirname, 'build', 'icon.ico');
const RETRY_MS = 10000;

// Los avisos programados suenan sin que nadie toque la PC: sin esto el
// navegador exige un click antes de emitir audio.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Una sola instancia: si ya está abierta, se trae al frente en vez de duplicar
// el scheduler (dos instancias = cada aviso sonaría dos veces).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start);
}

let win = null;
let tray = null;
let quitting = false;
let retryTimer = null;
let trayHintShown = false;

function start() {
  app.setAppUserModelId('ar.dev.homepoint.soundboard');

  // Evita que la PC se suspenda mientras la app está abierta: suspendida no
  // suenan los avisos. No impide que se apague la pantalla.
  powerSaveBlocker.start('prevent-app-suspension');

  createWindow();
  createTray();

  ipcMain.handle('autostart:get', () => getAutoStart());
  ipcMain.handle('autostart:set', (_e, enabled) => setAutoStart(!!enabled));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'SoundBoard Showroom',
    icon: ICON,
    backgroundColor: '#0A0A0B',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // El scheduler corre con setInterval de 1s: si la ventana está oculta o
      // minimizada, Chromium lo frenaría y los avisos saldrían tarde.
      backgroundThrottling: false,
      additionalArguments: [`--sb-version=${app.getVersion()}`]
    }
  });
  win.setMenu(null);

  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });

  // Cerrar la ventana la esconde: la app sigue sonando junto al reloj.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!trayHintShown && tray) {
      trayHintShown = true;
      tray.displayBalloon({
        icon: nativeImage.createFromPath(ICON),
        title: 'SoundBoard sigue funcionando',
        content: 'Los avisos van a seguir sonando. Para salir: clic derecho en este ícono → Salir.'
      });
    }
  });

  // Links a otros sitios se abren en el navegador, no dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:')) return; // pantalla "sin conexión"
    if (new URL(url).origin !== APP_ORIGIN) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // La app no usa cámara, micrófono, ubicación, etc.
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  // F5 / Ctrl+R recargan (el menú está oculto, así que se manejan a mano).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const reload = input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r');
    if (reload) { e.preventDefault(); loadApp(); }
  });

  // Sin internet: pantalla propia y reintento automático.
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = navegación cancelada, no es error
    if (url.startsWith('file:')) return;
    win.loadFile(path.join(__dirname, 'offline.html'));
    clearTimeout(retryTimer);
    retryTimer = setTimeout(loadApp, RETRY_MS);
  });

  loadApp();
}

function loadApp() {
  clearTimeout(retryTimer);
  win.loadURL(APP_URL);
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('SoundBoard Showroom');
  tray.on('click', showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir SoundBoard', click: showWindow },
    { type: 'separator' },
    {
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: getAutoStart(),
      click: (item) => setAutoStart(item.checked)
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => { quitting = true; app.quit(); }
    }
  ]));
}

/* ---- Arranque automático ---- */

function getAutoStart() {
  return app.getLoginItemSettings().openAtLogin;
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
  refreshTrayMenu();
  return getAutoStart();
}

app.on('before-quit', () => { quitting = true; });
// En Windows la app vive en la bandeja: no se cierra cuando no hay ventanas.
app.on('window-all-closed', () => {});
