// =============================================================================
//  registro.js - Registro diario de todo lo que se hace en la caja
// =============================================================================
//  Un archivo de texto por día en %APPDATA%\Caja HomePoint\registro\
//  (por ejemplo 2026-11-13.txt), pensado para leerse con el Bloc de notas:
//
//    09:14:20  V1  Sofía        ARTÍCULO    + Agregó 2 × Taza 350ml [779...] ...
//
//  Columnas: hora · ventana (V1, V2... si hay varias abiertas) · usuario ·
//  categoría · detalle. La hora la pone el programa, no la página.
//
//  Lo que pasa en la página llega por 'registro:anotar' (registroCaja.js,
//  a través de preload.js). Lo del programa (arranque, internet, Offline,
//  actualizaciones) se anota con anotarSistema().
//
//  Los archivos de más de DIAS_GUARDADOS se borran solos al arrancar.
//  Ctrl+Shift+L en la caja abre la carpeta (main.js).
//
//  Visor (visor-registro.html): ventana aparte, sólo de lectura, que se abre
//  con 5 clics seguidos en la versión del selector de usuario. Sólo puede
//  pedir la lista de días y el texto de un día; no hay nada para escribir.
// =============================================================================

const { app, ipcMain, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIAS_GUARDADOS = 90;
const ARCHIVO_DEL_DIA = /^\d{4}-\d{2}-\d{2}\.txt$/;
const ANCHO_USUARIO = 12;
const ANCHO_CATEGORIA = 11;
// Sangría de las líneas de detalle: debajo de donde empieza el texto.
const SANGRIA = ' '.repeat(8 + 2 + 3 + 2 + ANCHO_USUARIO + 2 + ANCHO_CATEGORIA + 2 + 2);

let carpeta = null;
let log = console;
let fallosSeguidos = 0;

// Ventanas numeradas en el orden en que se abrieron: V1, V2...
const numeroDeVentana = new Map();
let ultimaVentana = 0;

function dos(n) { return String(n).padStart(2, '0'); }

function claveDelDia(fecha) {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

function hora(fecha) {
  return `${dos(fecha.getHours())}:${dos(fecha.getMinutes())}:${dos(fecha.getSeconds())}`;
}

function rutaCarpeta() {
  if (carpeta) return carpeta;
  carpeta = path.join(app.getPath('userData'), 'registro');
  fs.mkdirSync(carpeta, { recursive: true });
  return carpeta;
}

function encabezado(fecha) {
  let dia;
  try {
    dia = fecha.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    dia = claveDelDia(fecha);
  }
  const raya = '='.repeat(90);
  return `${raya}\r\n Caja HomePoint ${app.getVersion()} · Registro del ${dia} · PC: ${os.hostname()}\r\n${raya}\r\n`;
}

// Una sola línea, sin saltos ni caracteres de control, con largo máximo.
function limpio(valor, maximo) {
  return String(valor == null ? '' : valor)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maximo);
}

function columna(texto, ancho) {
  const t = texto.length > ancho ? texto.slice(0, ancho - 1) + '…' : texto;
  return t.padEnd(ancho, ' ');
}

function escribir(entrada) {
  const ahora = new Date();
  const categoria = limpio(entrada.categoria, 20).toUpperCase() || 'OTRO';
  const usuario = limpio(entrada.usuario, 40) || '—';
  const ventana = limpio(entrada.ventana, 4) || '--';
  let lineas = `${hora(ahora)}  ${columna(ventana, 3)}  ${columna(usuario, ANCHO_USUARIO)}  ${columna(categoria, ANCHO_CATEGORIA)}  ${limpio(entrada.texto, 2000)}\r\n`;
  if (Array.isArray(entrada.detalle)) {
    for (const renglon of entrada.detalle.slice(0, 200)) {
      const r = limpio(renglon, 500);
      if (r) lineas += `${SANGRIA}· ${r}\r\n`;
    }
  }

  try {
    const archivo = path.join(rutaCarpeta(), claveDelDia(ahora) + '.txt');
    // El encabezado va una sola vez, al empezar el archivo del día (el primer
    // renglón después de medianoche abre el archivo nuevo solo).
    const nuevo = !fs.existsSync(archivo);
    fs.appendFileSync(archivo, (nuevo ? encabezado(ahora) : '') + lineas, 'utf8');
    fallosSeguidos = 0;
  } catch (error) {
    // Que el registro falle nunca tiene que frenar la caja. Se avisa en el
    // log técnico, sin repetir el mismo aviso en cada renglón.
    if (fallosSeguidos++ < 3) log.warn('Registro: no se pudo escribir:', error.message);
  }
}

function anotarSistema(texto, detalle) {
  escribir({ categoria: 'SISTEMA', usuario: 'sistema', ventana: '--', texto, detalle });
}

function ventanaDe(contenido) {
  if (!contenido) return '--';
  let n = numeroDeVentana.get(contenido.id);
  if (!n) {
    n = ++ultimaVentana;
    numeroDeVentana.set(contenido.id, n);
    contenido.once('destroyed', () => numeroDeVentana.delete(contenido.id));
  }
  return 'V' + n;
}

function esPantallaDeCaja(evento) {
  try {
    const u = new URL(evento.senderFrame ? evento.senderFrame.url : evento.sender.getURL());
    return u.protocol === 'http:' && u.hostname === 'localhost';
  } catch {
    return false;
  }
}

function limpiarViejos() {
  const limite = new Date();
  limite.setHours(0, 0, 0, 0);
  limite.setDate(limite.getDate() - DIAS_GUARDADOS);
  const corte = claveDelDia(limite);
  let borrados = 0;
  for (const nombre of fs.readdirSync(rutaCarpeta())) {
    if (!ARCHIVO_DEL_DIA.test(nombre) || nombre.slice(0, 10) >= corte) continue;
    try { fs.unlinkSync(path.join(rutaCarpeta(), nombre)); borrados++; } catch {}
  }
  if (borrados) log.info(`Registro: se borraron ${borrados} archivos de más de ${DIAS_GUARDADOS} días`);
}

// ------------------------------------------------------------------ visor ---
let visor = null;

function abrirVisor() {
  if (visor && !visor.isDestroyed()) {
    if (visor.isMinimized()) visor.restore();
    visor.focus();
    return;
  }
  visor = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 820,
    minHeight: 500,
    show: false,
    backgroundColor: '#F6F5F1',
    icon: path.join(__dirname, 'icono.ico'),
    title: 'Registro de la caja',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-visor.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  const contenido = visor.webContents;
  // El visor no abre nada más: ni ventanas nuevas ni otras direcciones.
  contenido.setWindowOpenHandler(() => ({ action: 'deny' }));
  contenido.on('will-navigate', (evento) => evento.preventDefault());
  visor.on('page-title-updated', (evento) => evento.preventDefault());
  visor.once('ready-to-show', () => { visor.maximize(); visor.show(); });
  visor.on('closed', () => { visor = null; });
  visor.loadFile(path.join(__dirname, 'visor-registro.html'));
}

function esDelVisor(evento) {
  return !!visor && !visor.isDestroyed() && evento.sender === visor.webContents;
}

function listarDias() {
  const dias = [];
  for (const nombre of fs.readdirSync(rutaCarpeta())) {
    if (!ARCHIVO_DEL_DIA.test(nombre)) continue;
    try {
      const datos = fs.statSync(path.join(rutaCarpeta(), nombre));
      dias.push({ dia: nombre.slice(0, 10), bytes: datos.size });
    } catch {}
  }
  return dias.sort((a, b) => (a.dia < b.dia ? 1 : -1));
}

function leerDia(dia) {
  // Sólo un nombre de día válido: nunca otra ruta de la PC.
  if (typeof dia !== 'string' || !ARCHIVO_DEL_DIA.test(dia + '.txt')) return null;
  try {
    return fs.readFileSync(path.join(rutaCarpeta(), dia + '.txt'), 'utf8');
  } catch {
    return null;
  }
}

function iniciarRegistro(opciones) {
  log = (opciones && opciones.log) || console;
  try { rutaCarpeta(); limpiarViejos(); } catch (error) { log.warn('Registro: no se pudo preparar la carpeta:', error.message); }

  ipcMain.on('registro:anotar', (evento, entrada) => {
    if (!esPantallaDeCaja(evento) || !entrada || typeof entrada !== 'object') return;
    escribir({ ...entrada, ventana: ventanaDe(evento.sender) });
  });

  ipcMain.on('registro:visor', (evento) => {
    if (!esPantallaDeCaja(evento)) return;
    try { abrirVisor(); } catch (error) { log.warn('Registro: no se pudo abrir el visor:', error.message); }
  });
  ipcMain.handle('visor:dias', (evento) => (esDelVisor(evento) ? listarDias() : []));
  ipcMain.handle('visor:leer', (evento, dia) => (esDelVisor(evento) ? leerDia(dia) : null));
  ipcMain.handle('visor:hoy', (evento) => (esDelVisor(evento) ? claveDelDia(new Date()) : null));
}

module.exports = {
  iniciarRegistro,
  anotarSistema,
  ventanaDe,
  carpetaRegistro: () => rutaCarpeta()
};
