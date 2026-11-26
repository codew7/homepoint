// =============================================================================
//  main.js - Caja HomePoint como aplicación de Windows
// =============================================================================
//  Reemplaza a iniciar.vbs + servidor.ps1 + Chrome en modo --app:
//    - enciende el servidor local que publica la carpeta "app";
//    - abre la caja en una ventana propia, maximizada y sin barras;
//    - si se vuelve a abrir el programa, abre otra ventana de caja (no otro
//      servidor), igual que antes;
//    - se actualiza sola desde GitHub (ver actualizador.js);
//    - permite vender sin internet con el usuario Offline (ver offline.js).
//
//  Registro técnico: %APPDATA%\Caja HomePoint\logs\main.log
//  Registro diario de lo que se hace en la caja: %APPDATA%\Caja HomePoint\registro\
//  (ver registro.js; Ctrl+Shift+L abre la carpeta). Se sube a Firebase al abrir
//  y al cerrar la caja (ver registroNube.js).
// =============================================================================

const { app, BrowserWindow, Menu, shell, ipcMain, net, dialog, session } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile } = require('child_process');
const log = require('electron-log/main');

const { iniciarServidor, PAGINA_INICIAL, RUTA_VIVO } = require('./servidor');
const { iniciarActualizador } = require('./actualizador');
const { iniciarOffline } = require('./offline');
const { iniciarRegistro, anotarSistema, ventanaDe, carpetaRegistro } = require('./registro');
const { iniciarRegistroNube, subirAlCerrar } = require('./registroNube');
const LIBRERIAS = require('./librerias');

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
// Cerrando: se está subiendo el registro antes de salir (ver before-quit).
let cerrando = false;
let cierreListo = false;
let reabrirAlCerrar = false;

// Topes de tiempo para que la caja nunca quede trabada a medio cerrar.
const TOPE_SALIDA_MS = 20000;        // desde que empieza a cerrarse hasta salir sí o sí
const TOPE_CIERRE_VENTANA_MS = 6000; // una ventana colgada que no contesta al cerrarla
const TOPE_MOSTRAR_VENTANA_MS = 15000;

// ------------------------------------------------- copia anterior colgada ---
// Antes, si la copia que ya estaba abierta quedaba colgada (o trabada a medio
// cerrar, invisible), el doble clic no hacía nada: la copia nueva veía que ya
// había una y se cerraba. Había que reiniciar la PC.
// Ahora la copia nueva le pregunta a la vieja si responde (servidor local,
// RUTA_VIVO). Si no contesta, la cierra a la fuerza y abre la caja de nuevo.
const archivoInstancia = () => path.join(app.getPath('userData'), 'instancia.json');
const archivoRescate = () => path.join(app.getPath('userData'), 'rescate.lock');
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function anotarInstancia(puerto) {
  try {
    fs.writeFileSync(archivoInstancia(), JSON.stringify({ pid: process.pid, puerto, desde: Date.now() }), 'utf8');
  } catch (error) {
    log.warn('No se pudo anotar la instancia:', error.message);
  }
}

function respondeLaOtra(puerto) {
  return new Promise((resolve) => {
    const pedido = http.get({ host: '127.0.0.1', port: puerto, path: RUTA_VIVO, timeout: 2500 }, (respuesta) => {
      respuesta.resume();
      resolve(respuesta.statusCode === 200);
    });
    pedido.on('timeout', () => { pedido.destroy(); resolve(false); });
    pedido.on('error', () => resolve(false));
  });
}

// Que el número de proceso sea de verdad el programa principal de la caja (y
// no otro programa que heredó el número, ni una pantalla de la caja).
function esLaCajaPrincipal(pid) {
  return new Promise((resolve) => {
    const comando = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if ($p) { $p.ExecutablePath + '|' + $p.CommandLine }`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', comando],
      { windowsHide: true, timeout: 15000 }, (error, salida) => {
        if (error || !salida) return resolve(false);
        const [ejecutable, ...resto] = String(salida).trim().split('|');
        const lineaDeComando = resto.join('|');
        // Sólo el nombre del programa: la ruta puede traer acentos (usuario de
        // Windows) que PowerShell no devuelve en UTF-8.
        resolve(path.basename(ejecutable || '').toLowerCase() === path.basename(process.execPath).toLowerCase() &&
          !/--type=/.test(lineaDeComando));
      });
  });
}

function cerrarALaFuerza(pid) {
  return new Promise((resolve) => {
    execFile('taskkill.exe', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 15000 }, () => resolve());
  });
}

// Devuelve true si cerró una copia colgada (entonces hay que volver a abrir).
async function rescatarInstancia() {
  let datos = null;
  try { datos = JSON.parse(fs.readFileSync(archivoInstancia(), 'utf8')); } catch {}
  if (!datos || !Number.isInteger(datos.pid) || !Number.isInteger(datos.puerto) || datos.pid === process.pid) return false;

  // Varios dobles clics seguidos: rescata uno solo.
  try {
    const rescate = archivoRescate();
    if (fs.existsSync(rescate) && Date.now() - fs.statSync(rescate).mtimeMs < 30000) return false;
    fs.writeFileSync(rescate, String(process.pid), 'utf8');
  } catch {}

  try {
    // Se le da tiempo: puede estar ocupada un momento o terminando de cerrarse.
    for (let intento = 0; intento < 3; intento++) {
      if (await respondeLaOtra(datos.puerto)) return false;
      await esperar(1500);
    }
    if (!(await esLaCajaPrincipal(datos.pid))) return false;
    log.warn(`La caja abierta (proceso ${datos.pid}) no responde: se cierra a la fuerza y se vuelve a abrir`);
    anotarSistema(`La caja anterior quedó colgada (proceso ${datos.pid}): se cerró a la fuerza al volver a abrirla`);
    await cerrarALaFuerza(datos.pid);
    await esperar(1000);
    return true;
  } finally {
    try { fs.unlinkSync(archivoRescate()); } catch {}
  }
}

// Una sola copia del programa: si alguien vuelve a hacer doble clic, la copia
// que ya está corriendo abre otra ventana de caja.
if (!app.requestSingleInstanceLock()) {
  rescatarInstancia()
    .then((rescatada) => { if (rescatada) app.relaunch(); })
    .catch((error) => log.warn('No se pudo revisar la caja abierta:', error.message))
    .finally(() => app.exit(0));
} else {
  app.on('second-instance', () => {
    // Si justo se está cerrando (subiendo el registro), se vuelve a abrir al terminar.
    if (cerrando) { reabrirAlCerrar = true; return; }
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
// El aviso ofrece además entrar igual, en modo Offline.
function esperarConexion(ventana) {
  let reintentando = false;
  let terminado = false;
  const terminar = () => {
    terminado = true;
    clearInterval(temporizador);
    ipcMain.removeListener('conexion:reintentar', manual);
    ipcMain.removeListener('offline:entrar', entrarOffline);
  };
  const intentar = async () => {
    if (reintentando || terminado || ventana.isDestroyed()) return;
    reintentando = true;
    const hay = await hayInternet();
    // Pudo haberse elegido "Entrar en modo Offline" mientras se probaba.
    if (hay && !terminado && !ventana.isDestroyed()) {
      terminar();
      log.info('Volvió la conexión: se abre la caja');
      anotarSistema('Volvió la conexión: se abre la caja');
      ventana.loadURL(urlCaja);
    }
    reintentando = false;
  };
  const manual = (evento) => {
    if (evento.sender === ventana.webContents) intentar();
  };
  const entrarOffline = (evento) => {
    if (evento.sender !== ventana.webContents || terminado) return;
    terminar();
    log.info('Sin conexión: se abre la caja en modo Offline');
    anotarSistema('Sin conexión: se entró a la caja en modo Offline');
    ventana.loadURL(urlCaja);
  };
  const temporizador = setInterval(intentar, 5000);
  ipcMain.on('conexion:reintentar', manual);
  ipcMain.on('offline:entrar', entrarOffline);
  ventana.once('closed', terminar);
}

// ------------------------------------------------- librerías sin internet ---
// Las librerías del CDN se sirven desde app/vendor/ (copias idénticas, de
// versión fija), así la caja abre aunque no haya internet.
let libreriasLocales = false;

function usarLibreriasLocales() {
  if (libreriasLocales || !servidor) return;
  const mapa = new Map();
  for (const { url, archivo } of LIBRERIAS) {
    if (fs.existsSync(path.join(RAIZ_APP, 'vendor', archivo))) {
      mapa.set(url, `http://localhost:${servidor.puerto}/vendor/${archivo}`);
    } else {
      log.warn(`Falta la copia local de ${url}: se usa la de internet`);
    }
  }
  if (!mapa.size) return;
  libreriasLocales = true;
  session.defaultSession.webRequest.onBeforeRequest({ urls: [...mapa.keys()] }, (detalle, responder) => {
    const local = mapa.get(detalle.url);
    responder(local ? { redirectURL: local } : {});
  });
  log.info(`Offline: ${mapa.size} librerías se sirven desde la PC`);
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

  // Cierre de la ventana. Si la pantalla está colgada nunca contesta al
  // pedido de cierre y la ventana quedaba abierta (o el programa trabado a
  // medio cerrar). Pasado el tope, se cierra igual.
  let cerrandoVentana = false;
  let topeCierre = null;
  ventana.on('close', () => {
    cerrandoVentana = true;
    clearTimeout(topeCierre);
    topeCierre = setTimeout(() => {
      if (ventana.isDestroyed()) return;
      log.warn('La ventana no contestó al cerrarla: se cierra a la fuerza');
      anotarSistema(`${ventanaDe(contenido)}: la pantalla no contestó al cerrarla, se cerró a la fuerza`);
      ventana.destroy();
    }, TOPE_CIERRE_VENTANA_MS);
  });
  ventana.on('closed', () => clearTimeout(topeCierre));

  // La caja bloquea el cierre mientras guarda un pedido en Firebase
  // (beforeunload en ingresoPedidoV2.js). En una app ese bloqueo es mudo, así
  // que se pregunta, como haría un navegador.
  // El aviso NO es sincrónico a propósito: showMessageBoxSync congelaba todo el
  // programa (las otras ventanas y el paso entre pantallas) mientras estaba a
  // la vista. Sin preventDefault la salida queda cancelada; si se elige
  // "Cerrar igual", se cierra la ventana sin volver a preguntar.
  let avisoGuardando = false;
  contenido.on('will-prevent-unload', () => {
    const eraCierre = cerrandoVentana;
    cerrandoVentana = false;
    clearTimeout(topeCierre);
    if (avisoGuardando || ventana.isDestroyed()) return;
    avisoGuardando = true;
    const opciones = eraCierre
      ? {
          detail: 'Si cerrás ahora, el pedido puede quedar sin guardar. Conviene esperar unos segundos.',
          buttons: ['Esperar', 'Cerrar igual']
        }
      : {
          detail: 'Esperá unos segundos a que termine y volvé a intentarlo.',
          buttons: ['Entendido']
        };
    dialog.showMessageBox(ventana, {
      type: 'warning',
      title: 'Caja HomePoint',
      message: 'Se está guardando un pedido',
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      ...opciones
    }).then(({ response }) => {
      if (eraCierre && response === 1 && !ventana.isDestroyed()) {
        anotarSistema(`${ventanaDe(contenido)}: se cerró igual mientras se guardaba un pedido`);
        ventana.destroy();
      }
    }).catch(() => {}).finally(() => { avisoGuardando = false; });
  });

  // Atajos de soporte: F5 recarga, Ctrl+Shift+I abre las herramientas,
  // Ctrl+Shift+L abre la carpeta del registro diario.
  contenido.on('before-input-event', (evento, tecla) => {
    if (tecla.type !== 'keyDown') return;
    if (tecla.key === 'F5' || (tecla.control && tecla.key.toLowerCase() === 'r')) {
      anotarSistema(`${ventanaDe(contenido)}: se recargó la pantalla (${tecla.key === 'F5' ? 'F5' : 'Ctrl+R'})`);
      contenido.reload();
      evento.preventDefault();
    } else if (tecla.control && tecla.shift && tecla.key.toLowerCase() === 'i') {
      contenido.toggleDevTools();
      evento.preventDefault();
    } else if (tecla.control && tecla.shift && tecla.key.toLowerCase() === 'l') {
      try { shell.openPath(carpetaRegistro()); } catch (error) { log.warn('No se pudo abrir el registro:', error.message); }
      evento.preventDefault();
    }
  });

  contenido.on('render-process-gone', (_evento, detalle) => {
    log.error('La pantalla se cerró inesperadamente:', detalle.reason);
    anotarSistema(`${ventanaDe(contenido)}: la pantalla se cerró inesperadamente (${detalle.reason})`);
    if (detalle.reason !== 'clean-exit' && !ventana.isDestroyed()) contenido.reload();
  });
  // Pantalla colgada: antes sólo quedaba anotado y había que cerrar el
  // programa. Ahora se ofrece recargarla (Chromium avisa recién después de
  // varios segundos sin respuesta). Si vuelve sola, el aviso se va solo.
  let colgada = false;
  let avisoColgada = null;
  const ofrecerRecarga = () => {
    if (!colgada || avisoColgada || ventana.isDestroyed()) return;
    avisoColgada = new AbortController();
    dialog.showMessageBox(ventana, {
      type: 'warning',
      title: 'Caja HomePoint',
      message: 'La pantalla no responde',
      detail: 'Podés esperar unos segundos más o recargarla. Si había un pedido a medio cargar, se pierde.',
      buttons: ['Esperar', 'Recargar'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      signal: avisoColgada.signal
    }).then(({ response }) => {
      avisoColgada = null;
      if (ventana.isDestroyed() || !colgada) return;
      if (response === 1) {
        anotarSistema(`${ventanaDe(contenido)}: la pantalla no respondía, se recargó`);
        // Se termina la pantalla trabada; render-process-gone la vuelve a cargar.
        contenido.forcefullyCrashRenderer();
      } else {
        setTimeout(ofrecerRecarga, 10000);
      }
    }).catch(() => { avisoColgada = null; });
  };
  ventana.on('unresponsive', () => {
    colgada = true;
    log.warn('La ventana dejó de responder');
    anotarSistema(`${ventanaDe(contenido)}: la pantalla dejó de responder`);
    // Al cerrar se ocupa el tope de cierre: no hace falta preguntar.
    if (!cerrandoVentana) ofrecerRecarga();
  });
  ventana.on('responsive', () => {
    colgada = false;
    if (avisoColgada) { avisoColgada.abort(); avisoColgada = null; }
    log.info('La ventana volvió a responder');
    anotarSistema(`${ventanaDe(contenido)}: la pantalla volvió a responder`);
  });
}

async function crearVentanaCaja() {
  const ventana = new BrowserWindow(opcionesVentana({ show: false, minWidth: 900, minHeight: 600 }));
  prepararContenido(ventana);
  const nombreVentana = ventanaDe(ventana.webContents);
  anotarSistema(`Se abrió la ventana de caja ${nombreVentana}`);
  ventana.on('closed', () => anotarSistema(`Se cerró la ventana de caja ${nombreVentana}`));

  const mostrar = () => {
    if (ventana.isDestroyed() || ventana.isVisible()) return;
    ventana.maximize();
    ventana.show();
    ventana.focus();
    cerrarSplash();
  };
  ventana.once('ready-to-show', mostrar);
  // Si la página tarda en pintarse (internet lento, una fuente que no llega),
  // la ventana no puede quedar invisible: se muestra igual.
  setTimeout(mostrar, TOPE_MOSTRAR_VENTANA_MS);

  if (await hayInternet()) {
    ventana.loadURL(urlCaja);
  } else {
    log.warn('Sin conexión a internet al abrir la caja');
    anotarSistema(`${nombreVentana}: sin conexión a internet al abrir la caja`);
    ventana.loadFile(path.join(__dirname, 'sin-conexion.html'), { query: { offline: '1' } });
    esperarConexion(ventana);
  }
  return ventana;
}

// ---------------------------------------------------------------- arranque ---
async function arrancar() {
  log.info(`Caja HomePoint ${app.getVersion()} arrancando`);
  iniciarRegistro({ log });
  iniciarRegistroNube({ log, carpetaRegistro });
  anotarSistema(`Caja HomePoint ${app.getVersion()} arrancó`);
  Menu.setApplicationMenu(null);
  mostrarSplash();

  try {
    servidor = await iniciarServidor(RAIZ_APP, log);
  } catch (error) {
    log.error('No se pudo encender el servidor local:', error.message);
    anotarSistema('No se pudo encender el servidor local: ' + error.message);
    cerrarSplash();
    dialog.showErrorBox(
      'Caja HomePoint',
      'No se pudo encender la caja porque otro programa está usando los puertos 8123, 8124 y 8125.\n\nReiniciá la PC y volvé a abrirla.'
    );
    app.quit();
    return;
  }

  urlCaja = `http://localhost:${servidor.puerto}/${PAGINA_INICIAL}`;
  anotarInstancia(servidor.puerto);
  // Versión instalada: la muestra el selector de usuario (preload.js).
  ipcMain.on('caja:version', (evento) => { evento.returnValue = app.getVersion(); });
  iniciarActualizador(log, anotarSistema, prepararSalida);
  iniciarOffline({ log, hayInternet, anotar: anotarSistema });
  usarLibreriasLocales();

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

// Antes de salir se sube el registro del día (con tope de tiempo, ver
// registroNube.js). La salida se frena una sola vez y después sigue sola.
// La actualización usa lo mismo antes de instalar (actualizador.js).
let salida = null;
function prepararSalida() {
  if (!salida) {
    cerrando = true;
    anotarSistema('Caja HomePoint se cerró');
    salida = subirAlCerrar().finally(() => { cierreListo = true; });
    // Red de seguridad: si algo traba la salida (una ventana colgada que no
    // deja cerrar, una subida que no termina), el programa sale igual. Antes
    // quedaba vivo e invisible y la caja no volvía a abrir hasta reiniciar.
    setTimeout(() => {
      log.warn('La caja no terminó de cerrarse a tiempo: se fuerza la salida');
      anotarSistema('La caja no terminó de cerrarse a tiempo: se forzó la salida');
      if (reabrirAlCerrar) app.relaunch();
      app.exit(0);
    }, TOPE_SALIDA_MS);
  }
  return salida;
}

app.on('before-quit', (evento) => {
  if (cierreListo) return;
  evento.preventDefault();
  prepararSalida().then(() => {
    if (reabrirAlCerrar) app.relaunch();
    app.quit();
  });
});

app.on('will-quit', () => {
  if (servidor) servidor.detener().catch(() => {});
  log.info('Caja HomePoint cerrada');
});
