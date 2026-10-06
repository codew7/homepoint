// =============================================================================
//  preload.js - Lo que la app de escritorio agrega a las pantallas de la caja
// =============================================================================
//  Corre aislado de la página: comparte el DOM pero no las variables de la
//  caja, y la página no puede ver nada de acá salvo window.cajaApp.
//
//  Hace dos cosas:
//   1. Le cuenta a la app si hay un pedido en curso, para que una
//      actualización nunca reinicie la caja en medio de una venta.
//   2. Muestra el aviso "Nueva versión lista" cuando ya se descargó una.
//
//  Ninguna de las dos necesita tocar los archivos de "app": así siguen siendo
//  copias exactas de la versión web.
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron');

// Solo lo usa la pantalla "Sin conexión" (botón Reintentar ahora).
contextBridge.exposeInMainWorld('cajaApp', {
  escritorio: true,
  reintentarConexion: () => ipcRenderer.send('conexion:reintentar')
});

const esPantallaDeCaja = location.protocol === 'http:' && location.hostname === 'localhost';

// --- 1. pedido en curso ------------------------------------------------------
// En ingresoPedidoV2 cada artículo cargado es una fila con data-idx, y mientras
// se guarda en Firebase aparece el cartel #overlayBloqueo. Con cualquiera de
// las dos cosas presentes, no se reinicia.
function hayPedidoEnCurso() {
  if (document.querySelector('#itemsBody tr[data-idx]')) return true;
  const guardando = document.getElementById('overlayBloqueo');
  return !!guardando && guardando.style.display !== 'none';
}

let ultimoEnCurso = null;
function revisarPedido() {
  const enCurso = hayPedidoEnCurso();
  if (enCurso !== ultimoEnCurso) {
    ultimoEnCurso = enCurso;
    ipcRenderer.send('caja:pedido-en-curso', enCurso);
  }
}

// --- 2. aviso de actualización -----------------------------------------------
const CSS = `
  .hp-act { position: fixed; left: 20px; bottom: 20px; z-index: 2147483000;
    font-family: "Instrument Sans", "Segoe UI", system-ui, sans-serif; color: #fff;
    -webkit-font-smoothing: antialiased; }
  .hp-act * { box-sizing: border-box; margin: 0; }
  .hp-act-tarjeta { width: 340px; background: #17181C; border-radius: 14px; padding: 16px 16px 14px;
    box-shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 18px 40px -12px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.18);
    transform-origin: bottom left; animation: hp-act-entrar 280ms cubic-bezier(.22,1,.36,1) both; }
  .hp-act-cabecera { display: flex; align-items: center; gap: 10px; }
  .hp-act-punto { width: 8px; height: 8px; border-radius: 50%; background: #8f74d9; flex: none;
    box-shadow: 0 0 0 4px rgba(108,78,182,.22); }
  .hp-act-titulo { font-size: 14px; font-weight: 600; letter-spacing: -.005em; flex: 1; }
  .hp-act-version { font-size: 12px; color: rgba(255,255,255,.5); font-variant-numeric: tabular-nums; }
  .hp-act-texto { margin: 8px 0 0 18px; font-size: 13px; line-height: 1.5; color: rgba(255,255,255,.72); }
  .hp-act-notas { margin: 6px 0 0 18px; font-size: 12.5px; line-height: 1.45; color: rgba(255,255,255,.55);
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .hp-act-acciones { display: flex; gap: 8px; margin: 14px 0 0 18px; }
  .hp-act button { font: inherit; font-size: 13px; font-weight: 600; height: 34px; padding: 0 14px;
    border-radius: 9px; border: 0; cursor: pointer;
    transition: background-color 150ms ease, opacity 150ms ease, transform 120ms ease; }
  .hp-act button:active:not(:disabled) { transform: scale(.97); }
  .hp-act button:focus-visible { outline: 3px solid rgba(143,116,217,.55); outline-offset: 2px; }
  .hp-act-primario { background: #6c4eb6; color: #fff; }
  .hp-act-primario:hover:not(:disabled) { background: #7a5cc6; }
  .hp-act-primario:disabled { opacity: .4; cursor: not-allowed; }
  .hp-act-secundario { background: rgba(255,255,255,.08); color: rgba(255,255,255,.85); }
  .hp-act-secundario:hover { background: rgba(255,255,255,.14); }
  .hp-act-ayuda { margin: 10px 0 0 18px; font-size: 12px; line-height: 1.4; color: rgba(255,255,255,.5); }
  .hp-act-ayuda:empty { display: none; }
  .hp-act-pildora { display: inline-flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px 0 12px;
    border-radius: 999px; background: #17181C; color: #fff; font: inherit; font-size: 12.5px; font-weight: 600;
    border: 0; cursor: pointer; box-shadow: 0 10px 24px -10px rgba(0,0,0,.5);
    animation: hp-act-entrar 220ms cubic-bezier(.22,1,.36,1) both; }
  .hp-act-pildora:hover { background: #22242A; }
  @keyframes hp-act-entrar { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .hp-act-tarjeta, .hp-act-pildora { animation: none; } }
  @media print { .hp-act { display: none !important; } }
`;

const SS_PLEGADO = 'cajaActualizacionPlegada';
let raiz = null;
let estado = null;
let reiniciando = false;
let mensajeError = '';

function plegado() {
  try { return sessionStorage.getItem(SS_PLEGADO) === estado.nueva; } catch { return false; }
}

function plegar(valor) {
  try {
    if (valor) sessionStorage.setItem(SS_PLEGADO, estado.nueva);
    else sessionStorage.removeItem(SS_PLEGADO);
  } catch {}
  pintar();
}

function elemento(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto) el.textContent = texto;
  return el;
}

function crearRaiz() {
  if (raiz) return;
  const estilo = document.createElement('style');
  estilo.textContent = CSS;
  document.head.appendChild(estilo);
  raiz = elemento('div', 'hp-act');
  raiz.setAttribute('role', 'status');
  raiz.setAttribute('aria-live', 'polite');
  document.body.appendChild(raiz);
}

async function reiniciar() {
  reiniciando = true;
  mensajeError = '';
  pintar();
  try {
    const r = await ipcRenderer.invoke('actualizacion:instalar');
    if (r && r.ok) return;
    mensajeError = (r && r.motivo) || 'No se pudo reiniciar. Se instala al cerrar la caja.';
  } catch {
    mensajeError = 'No se pudo reiniciar. Se instala al cerrar la caja.';
  }
  reiniciando = false;
  pintar();
}

function pintar() {
  if (!estado || estado.estado !== 'lista') {
    if (raiz) raiz.replaceChildren();
    return;
  }
  crearRaiz();
  raiz.replaceChildren();

  if (plegado()) {
    const pildora = elemento('button', 'hp-act-pildora');
    pildora.type = 'button';
    pildora.append(elemento('span', 'hp-act-punto'), document.createTextNode('Actualización lista'));
    pildora.addEventListener('click', () => plegar(false));
    raiz.appendChild(pildora);
    return;
  }

  const tarjeta = elemento('div', 'hp-act-tarjeta');

  const cabecera = elemento('div', 'hp-act-cabecera');
  cabecera.append(
    elemento('span', 'hp-act-punto'),
    elemento('span', 'hp-act-titulo', 'Nueva versión lista'),
    elemento('span', 'hp-act-version', 'v' + estado.nueva)
  );
  tarjeta.appendChild(cabecera);
  tarjeta.appendChild(elemento('p', 'hp-act-texto', 'Se instala sola al cerrar la caja. No hace falta hacer nada.'));
  if (estado.notas) tarjeta.appendChild(elemento('p', 'hp-act-notas', estado.notas));

  const acciones = elemento('div', 'hp-act-acciones');
  const botonReiniciar = elemento('button', 'hp-act-primario', reiniciando ? 'Reiniciando…' : 'Reiniciar ahora');
  botonReiniciar.type = 'button';
  botonReiniciar.disabled = reiniciando || !!estado.bloqueado;
  botonReiniciar.addEventListener('click', reiniciar);
  const botonLuego = elemento('button', 'hp-act-secundario', 'Más tarde');
  botonLuego.type = 'button';
  botonLuego.addEventListener('click', () => plegar(true));
  acciones.append(botonReiniciar, botonLuego);
  tarjeta.appendChild(acciones);

  const ayuda = mensajeError ||
    (estado.bloqueado && !reiniciando ? 'Disponible cuando no haya un pedido en curso en ninguna ventana.' : '');
  tarjeta.appendChild(elemento('p', 'hp-act-ayuda', ayuda));

  raiz.appendChild(tarjeta);
}

function recibir(nuevo) {
  if (estado && estado.bloqueado && !nuevo.bloqueado) mensajeError = '';
  estado = nuevo;
  pintar();
}

if (esPantallaDeCaja) {
  window.addEventListener('DOMContentLoaded', () => {
    revisarPedido();
    setInterval(revisarPedido, 1000);
    ipcRenderer.on('actualizacion:estado', (_evento, nuevo) => recibir(nuevo));
    ipcRenderer.invoke('actualizacion:obtener').then(recibir).catch(() => {});
  });
}
