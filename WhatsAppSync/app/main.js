'use strict';
// =====================================================================
// WhatsAppSync - app de bandeja de Windows.
//
// Lanza el sincronizador (../index.js) en un proceso aparte, lo reinicia si
// se cae, y vive en la bandeja del sistema (al lado del reloj). Arranca
// siempre escondido ahi. Cerrar o minimizar la ventana solo la esconde: para
// detenerlo hay que elegir "Salir" en el menu del icono y confirmar.
//
// Los datos (clave, sesion de WhatsApp, logs) van a %APPDATA%\WhatsAppSync,
// porque la carpeta de instalacion no se puede escribir.
// =====================================================================

const { app, BrowserWindow, Tray, Menu, dialog, ipcMain, utilityProcess, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Una sola copia: dos conectadas al mismo WhatsApp se pisan entre si
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const DATOS = path.join(app.getPath('appData'), 'WhatsAppSync');
const ARCHIVO_CLAVE = path.join(DATOS, 'clave-firebase.json');
const ARCHIVO_PREFS = path.join(DATOS, 'app.json');
const MOTOR = path.join(__dirname, '..', 'index.js');
fs.mkdirSync(DATOS, { recursive: true });

app.setAppUserModelId('com.homepoint.whatsappsync');

let ventana = null;
let bandeja = null;
let motor = null;
let saliendo = false;
let reinicio = null;

function hoy() { return new Date().toDateString(); }

const estado = {
  conexion: 'iniciando',   // iniciando | qr | conectado | reconectando | reiniciando | falta-clave | duplicado
  numero: '',
  qr: '',
  dia: hoy(),
  mensajesHoy: 0,
  adjuntosHoy: 0,
  logs: [],
  inicioConWindows: false,
  version: app.getVersion()
};

function leerPrefs() {
  try { return JSON.parse(fs.readFileSync(ARCHIVO_PREFS, 'utf8')); } catch (_) { return {}; }
}
function guardarPrefs(p) {
  try { fs.writeFileSync(ARCHIVO_PREFS, JSON.stringify(p, null, 2)); } catch (_) { /* no es critico */ }
}

// ---------------------------------------------------------------------
// Sincronizador
// ---------------------------------------------------------------------
function iniciarMotor() {
  clearTimeout(reinicio);
  if (motor) return;
  if (!fs.existsSync(ARCHIVO_CLAVE)) {
    estado.conexion = 'falta-clave';
    actualizar();
    mostrarVentana();
    return;
  }
  estado.conexion = 'iniciando';
  actualizar();
  motor = utilityProcess.fork(MOTOR, [], {
    env: { ...process.env, WAS_DATOS: DATOS },
    stdio: 'ignore',
    serviceName: 'WhatsAppSync'
  });
  motor.on('message', recibir);
  motor.on('exit', (codigo) => {
    motor = null;
    if (saliendo) return;
    if (codigo === 2) {               // falta configurar algo
      estado.conexion = fs.existsSync(ARCHIVO_CLAVE) ? 'reiniciando' : 'falta-clave';
      actualizar();
      mostrarVentana();
      if (estado.conexion === 'falta-clave') return;
    } else if (codigo === 3) {        // otra copia tomo la conexion
      estado.conexion = 'duplicado';
      actualizar();
      mostrarVentana();
      return;
    }
    estado.conexion = 'reiniciando';
    actualizar();
    reinicio = setTimeout(iniciarMotor, 15000);
  });
}

function detenerMotor() {
  clearTimeout(reinicio);
  if (!motor) return Promise.resolve();
  return new Promise(resolver => {
    const m = motor;
    m.once('exit', () => resolver());
    m.kill();
    setTimeout(resolver, 4000);
  });
}

async function reiniciarMotor() {
  await detenerMotor();
  motor = null;
  iniciarMotor();
}

function recibir(e) {
  if (!e || !e.tipo) return;
  if (estado.dia !== hoy()) { estado.dia = hoy(); estado.mensajesHoy = 0; estado.adjuntosHoy = 0; }
  switch (e.tipo) {
    case 'log':
      estado.logs.push(e.linea);
      if (estado.logs.length > 150) estado.logs.splice(0, estado.logs.length - 150);
      break;
    case 'qr':
      estado.conexion = 'qr';
      estado.qr = e.qr;
      mostrarVentana();
      break;
    case 'conectado':
      estado.conexion = 'conectado';
      estado.numero = e.numero || '';
      estado.qr = '';
      break;
    case 'desconectado':
      if (estado.conexion !== 'qr') estado.conexion = 'reconectando';
      break;
    case 'mensajes':
      estado.mensajesHoy += e.n || 0;
      break;
    case 'adjunto':
      estado.adjuntosHoy++;
      break;
    case 'falta-clave':
      estado.conexion = 'falta-clave';
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
  qr: 'Esperando que escanees el QR',
  conectado: 'Conectado y guardando mensajes',
  reconectando: 'Reconectando...',
  reiniciando: 'Reiniciando en unos segundos...',
  'falta-clave': 'Falta la clave de Firebase',
  duplicado: 'Hay otra copia conectada'
};

function actualizar() {
  if (bandeja) {
    const c = estado.conexion;
    bandeja.setImage(c === 'conectado' ? ICONOS.ok : (c === 'falta-clave' || c === 'duplicado') ? ICONOS.error : ICONOS.espera);
    bandeja.setToolTip('WhatsAppSync · ' + TEXTOS[c] + (c === 'conectado' ? '\n' + estado.mensajesHoy + ' mensajes hoy' : ''));
  }
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send('estado', estado);
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 460,
    height: 760,
    minWidth: 380,
    minHeight: 480,
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

function menuBandeja() {
  return Menu.buildFromTemplate([
    { label: 'Abrir WhatsAppSync', click: mostrarVentana },
    { type: 'separator' },
    { label: 'Reiniciar conexión', click: reiniciarMotor },
    { label: 'Abrir carpeta de datos', click: () => shell.openPath(DATOS) },
    {
      label: 'Iniciar con Windows',
      type: 'checkbox',
      checked: estado.inicioConWindows,
      click: (item) => configurarInicio(item.checked)
    },
    { type: 'separator' },
    { label: 'Salir...', click: confirmarSalida }
  ]);
}

async function confirmarSalida() {
  const r = await dialog.showMessageBox(ventana && ventana.isVisible() ? ventana : null, {
    type: 'warning',
    buttons: ['Seguir funcionando', 'Salir igual'],
    defaultId: 0,
    cancelId: 0,
    title: 'WhatsAppSync',
    message: '¿Salir de WhatsAppSync?',
    detail: 'Mientras esté cerrado no se guardan los mensajes ni los comprobantes. ' +
      'Al volver a abrirlo recupera lo que haya entrado.'
  });
  if (r.response !== 1) return;
  saliendo = true;
  await detenerMotor();
  app.quit();
}

function configurarInicio(si) {
  app.setLoginItemSettings({ openAtLogin: !!si, args: ['--oculto'] });
  estado.inicioConWindows = !!si;
  if (bandeja) bandeja.setContextMenu(menuBandeja());
  actualizar();
}

// ---------------------------------------------------------------------
// Acciones desde la ventana
// ---------------------------------------------------------------------
ipcMain.handle('elegir-clave', async () => {
  const r = await dialog.showOpenDialog(ventana, {
    title: 'Elegí el archivo de clave de Firebase (.json)',
    filters: [{ name: 'Clave de Firebase', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const clave = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (clave.type !== 'service_account' || !clave.private_key) {
      return { ok: false, error: 'Ese archivo no es una clave de cuenta de servicio de Firebase.' };
    }
    fs.writeFileSync(ARCHIVO_CLAVE, JSON.stringify(clave, null, 2));
    await reiniciarMotor();
    return { ok: true, proyecto: clave.project_id };
  } catch (e) {
    return { ok: false, error: 'No se pudo leer el archivo: ' + e.message };
  }
});

ipcMain.handle('reiniciar', () => reiniciarMotor());
ipcMain.handle('abrir-carpeta', () => shell.openPath(DATOS));
ipcMain.handle('estado', () => estado);
ipcMain.handle('inicio-windows', (_e, si) => configurarInicio(si));

ipcMain.handle('desvincular', async () => {
  const r = await dialog.showMessageBox(ventana, {
    type: 'warning',
    buttons: ['Cancelar', 'Desvincular'],
    defaultId: 0,
    cancelId: 0,
    title: 'WhatsAppSync',
    message: '¿Desvincular este WhatsApp?',
    detail: 'Se borra la sesión guardada en esta PC y aparece un QR nuevo para vincular. ' +
      'Los mensajes ya guardados en Firebase no se tocan.'
  });
  if (r.response !== 1) return false;
  await detenerMotor();
  motor = null;
  fs.rmSync(path.join(DATOS, 'sesion'), { recursive: true, force: true });
  estado.numero = '';
  iniciarMotor();
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
  estado.inicioConWindows = app.getLoginItemSettings({ args: ['--oculto'] }).openAtLogin;

  bandeja = new Tray(ICONOS.espera);
  bandeja.setToolTip('WhatsAppSync');
  bandeja.setContextMenu(menuBandeja());
  bandeja.on('click', mostrarVentana);

  crearVentana();
  // Siempre arranca escondido en la bandeja (con Windows o abierto a mano):
  // la ventana se abre solo con clic en el icono, o sola si hace falta algo
  // (escanear el QR, cargar la clave, otra copia conectada).
  avisoPrimeraVez();

  iniciarMotor();
});

app.on('before-quit', () => { saliendo = true; if (motor) motor.kill(); });
