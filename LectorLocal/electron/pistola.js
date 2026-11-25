// =============================================================================
//  pistola.js - Lecturas de la pistola aunque el Lector no esté adelante
// =============================================================================
//  La pistola es un teclado más: Windows manda lo que escribe a la ventana que
//  está adelante. Para no depender de eso se usa "Raw Input" de Windows, que
//  avisa al Lector de CADA tecla de CADA teclado (diciendo de qué aparato vino)
//  aunque la ventana esté atrás o minimizada.
//
//    - Un aparato que escribe una tira de 6 o más letras rapidísimo (como
//      ninguna persona puede) y termina con Enter es una pistola: se anota en
//      pistolas.json (carpeta de datos del Lector) y desde ahí todo lo que
//      escriba es una lectura. Lo que se escribe con el teclado normal no se
//      mira nunca.
//    - Si en ese momento otro programa está adelante, el código TAMBIÉN se
//      escribe ahí (Windows no deja frenar sólo a la pistola: se probó, una
//      tecla frenada ya no avisa de qué aparato vino). Por eso main.js igual
//      trae el Lector adelante cuando nadie usa la PC.
//
//  Con la pausa puesta (Caja HomePoint abierta) no se lee nada: la pistola es
//  de la Caja, como antes.
//  Si algo de esto falla, iniciar() devuelve false y el Lector sigue como
//  siempre (tomando lo que la pistola escribe en su ventana).
// =============================================================================

const fs = require('fs');
const path = require('path');

const WM_INPUT = 0x00FF;
const RIM_TYPEKEYBOARD = 1;
const RID_INPUT = 0x10000003;
const RIDI_DEVICENAME = 0x20000007;
const RIDEV_INPUTSINK = 0x00000100;
const RI_KEY_BREAK = 1;
const VK = { TAB: 0x09, ENTER: 0x0D, SHIFT: 0x10, CONTROL: 0x11, MENU: 0x12, CAPITAL: 0x14, LSHIFT: 0xA0, RSHIFT: 0xA1 };

// Cómo escribe una pistola: entre tecla y tecla, a lo sumo 40 ms (una persona
// rápida anda por 100 ms), y al menos 6 letras para reconocerla.
const PISTOLA_GAP_MS = 40;
const PISTOLA_MIN = 6;
// Más de 120 ms entre dos teclas: empieza otra lectura.
const CORTE_GAP_MS = 120;
// Una vez reconocida: si pasan 250 ms sin Enter, lo escrito igual es una lectura.
const CORTE_SIN_FIN_MS = 250;
const LECTURA_MIN = 3;


let k = null, W = null;
let activo = false, log = console, alLeer = () => {};
let archivo = '';
const pistolas = new Set();     // nombres de aparato reconocidos como pistola
const aparatos = new Map();     // hDevice -> { nombre, buf, ult, maxGap, shift, corte }
let rawBuf = null;

function cargarWin32() {
  k = require('koffi');
  const user32 = k.load('user32.dll');
  k.struct('RAWINPUTDEVICE', { usUsagePage: 'uint16', usUsage: 'uint16', dwFlags: 'uint32', hwndTarget: 'void *' });
  W = {
    RegisterRawInputDevices: user32.func('int __stdcall RegisterRawInputDevices(RAWINPUTDEVICE *pRawInputDevices, uint32 uiNumDevices, uint32 cbSize)'),
    GetRawInputData: user32.func('uint32 __stdcall GetRawInputData(void *hRawInput, uint32 uiCommand, _Out_ uint8 *pData, _Inout_ uint32 *pcbSize, uint32 cbSizeHeader)'),
    GetRawInputDeviceInfoW: user32.func('uint32 __stdcall GetRawInputDeviceInfoW(void *hDevice, uint32 uiCommand, _Out_ uint16 *pData, _Inout_ uint32 *pcbSize)'),
    GetMessageTime: user32.func('int32 __stdcall GetMessageTime()'),
    GetKeyState: user32.func('int16 __stdcall GetKeyState(int nVirtKey)'),
    GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
    GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, void *lpdwProcessId)'),
    GetKeyboardLayout: user32.func('void * __stdcall GetKeyboardLayout(uint32 idThread)'),
    ToUnicodeEx: user32.func('int __stdcall ToUnicodeEx(uint32 wVirtKey, uint32 wScanCode, uint8 *lpKeyState, _Out_ uint16 *pwszBuff, int cchBuff, uint32 wFlags, void *dwhkl)')
  };
  rawBuf = Buffer.alloc(64);       // RAWINPUT de teclado: 24 de encabezado + 16
}

// ------------------------------------------------------- lista de pistolas ---
function leerPistolas() {
  try { JSON.parse(fs.readFileSync(archivo, 'utf8')).forEach((n) => pistolas.add(n)); } catch {}
}
function guardarPistolas() {
  try { fs.writeFileSync(archivo, JSON.stringify([...pistolas], null, 2)); } catch (e) { log.warn('pistolas.json:', e.message); }
}

function nombreAparato(h) {
  try {
    const tam = [0];
    W.GetRawInputDeviceInfoW(h, RIDI_DEVICENAME, null, tam);
    if (!tam[0]) return '';
    const b = new Uint16Array(tam[0]);
    W.GetRawInputDeviceInfoW(h, RIDI_DEVICENAME, b, tam);
    return String.fromCharCode(...b).replace(/\0.*$/, '').toLowerCase();
  } catch { return ''; }
}

// ------------------------------------------------------- tecla -> letra ---
// Con la distribución de teclado de la ventana de adelante: es la que usa
// Windows para lo que escribe la pistola.
const estadoTeclas = Buffer.alloc(256);
const salida = new Uint16Array(8);
function letra(vk, scan, shift) {
  estadoTeclas.fill(0);
  if (shift) estadoTeclas[VK.SHIFT] = 0x80;
  if (W.GetKeyState(VK.CAPITAL) & 1) estadoTeclas[VK.CAPITAL] = 0x01;
  const hkl = W.GetKeyboardLayout(W.GetWindowThreadProcessId(W.GetForegroundWindow(), null));
  // Flag 4: no tocar el estado de las teclas "muertas" (acentos) de Windows.
  const n = W.ToUnicodeEx(vk, scan, estadoTeclas, salida, salida.length, 4, hkl);
  return n > 0 ? String.fromCharCode(...salida.subarray(0, n)) : '';
}

// ------------------------------------------------------------ Raw Input ---
function aparato(clave, h) {
  let a = aparatos.get(clave);
  if (!a) {
    a = { nombre: nombreAparato(h), buf: '', ult: 0, maxGap: 0, shift: false, corte: null };
    aparatos.set(clave, a);
  }
  return a;
}

function vaciar(a) { clearTimeout(a.corte); a.corte = null; a.buf = ''; a.maxGap = 0; }

function terminar(a, conEnter) {
  const t = a.buf.trim(), rapido = a.maxGap <= PISTOLA_GAP_MS, largo = a.buf.length;
  vaciar(a);
  if (!t) return;
  if (!pistolas.has(a.nombre)) {
    if (!rapido || !a.nombre || largo < PISTOLA_MIN) return;
    // Sin Enter se pide más: que no sea alguien con una tecla apretada.
    if (!conEnter && largo < PISTOLA_MIN + 2) return;
    pistolas.add(a.nombre); guardarPistolas();
    log.info('Pistola reconocida:', a.nombre);
  } else if (t.length < LECTURA_MIN) return;
  try { alLeer(t); } catch (e) { log.warn('Lectura:', e.message); }
}

function procesarRaw(hRaw, tiempo) {
  const tam = [rawBuf.length];
  const n = W.GetRawInputData(hRaw, RID_INPUT, rawBuf, tam, 24);
  if (n === 0xFFFFFFFF || n < 40) return;
  if (rawBuf.readUInt32LE(0) !== RIM_TYPEKEYBOARD) return;
  const hDev = rawBuf.readBigUInt64LE(8);
  if (!hDev) return;                                  // tecla simulada por un programa
  const scan = rawBuf.readUInt16LE(24), flags = rawBuf.readUInt16LE(26), vk = rawBuf.readUInt16LE(30);
  const up = (flags & RI_KEY_BREAK) !== 0;
  tecla(aparato(String(hDev), k.decode(rawBuf, 8, 'void *')), vk, scan, up, tiempo);
}

function tecla(a, vk, scan, up, tiempo) {
  if (!activo) return;
  if (vk === VK.SHIFT || vk === VK.LSHIFT || vk === VK.RSHIFT) { a.shift = !up; return; }
  if (up) return;
  const gap = a.ult ? (tiempo - a.ult) >>> 0 : 0;
  a.ult = tiempo;
  if (a.buf && gap > CORTE_GAP_MS) vaciar(a);
  if (vk === VK.ENTER || vk === VK.TAB) {
    if (a.buf) a.maxGap = Math.max(a.maxGap, gap);
    terminar(a, true);
    return;
  }
  if (vk === VK.CONTROL || vk === VK.MENU) { vaciar(a); return; }
  const c = letra(vk, scan, a.shift);
  if (!c || c < ' ') { vaciar(a); return; }
  if (a.buf) a.maxGap = Math.max(a.maxGap, gap);
  a.buf += c;
  if (a.buf.length > 80) a.buf = a.buf.slice(-80);
  clearTimeout(a.corte);
  a.corte = setTimeout(() => terminar(a, false), CORTE_SIN_FIN_MS);
}

// ---------------------------------------------------------------- API ---
// ventana: la BrowserWindow del Lector (recibe los avisos de Raw Input).
function iniciar({ ventana, carpeta, registro, onLectura }) {
  log = registro || console;
  alLeer = onLectura || alLeer;
  archivo = path.join(carpeta, 'pistolas.json');
  try {
    cargarWin32();
    leerPistolas();
    const hwnd = k.decode(ventana.getNativeWindowHandle(), 'void *');
    ventana.hookWindowMessage(WM_INPUT, (_wParam, lParam) => {
      try { procesarRaw(k.decode(lParam, 'void *'), W.GetMessageTime() >>> 0); } catch (e) { log.warn('Raw Input:', e.message); }
    });
    // Teclados (página 1, uso 6), aunque la ventana no esté adelante.
    const ok = W.RegisterRawInputDevices([{ usUsagePage: 0x01, usUsage: 0x06, dwFlags: RIDEV_INPUTSINK, hwndTarget: hwnd }], 1, k.sizeof('RAWINPUTDEVICE'));
    if (!ok) throw new Error('RegisterRawInputDevices falló');
    log.info(`Pistola en segundo plano lista (${pistolas.size} pistola/s conocida/s)`);
    return true;
  } catch (e) {
    log.error('No se pudo leer la pistola en segundo plano:', e.message);
    return false;
  }
}

// true: lee la pistola. false: pausa (Caja abierta, pantalla de espera...).
function activar(si) {
  if (activo === !!si) return;
  activo = !!si;
  aparatos.forEach(vaciar);
}

// Sólo para probar la lógica sin pistola (prueba-pistola.js).
function _prueba(carpeta, onLectura) {
  cargarWin32(); archivo = path.join(carpeta, 'pistolas.json'); leerPistolas(); alLeer = onLectura;
  return (nombre, vk, scan, up, t) => {
    if (!aparatos.has(nombre)) aparatos.set(nombre, { nombre, buf: '', ult: 0, maxGap: 0, shift: false, corte: null });
    tecla(aparatos.get(nombre), vk, scan, up, t);
  };
}

module.exports = { iniciar, activar, _prueba };
