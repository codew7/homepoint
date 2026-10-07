// =============================================================================
//  actualizador.js - Actualización automática desde GitHub Releases
// =============================================================================
//  Cómo se comporta, pensado para que nadie en el local tenga que hacer nada:
//
//  1. Al abrir (10 s después) y cada 2 horas pregunta a GitHub si hay versión
//     nueva. Si la hay, la baja en segundo plano (solo lo que cambió).
//  2. Con la descarga lista, las ventanas muestran un aviso discreto. La
//     versión nueva se instala sola, en silencio, al cerrar la caja.
//  3. "Reiniciar ahora" instala en el momento, pero solo si ninguna ventana
//     tiene un pedido a medio cargar o guardándose.
//  4. Para la PC que nunca se apaga: si la actualización espera hace más de
//     24 h, entre las 3 y las 5 de la mañana, sin uso por 30 minutos y sin
//     pedidos en curso, se instala sola y la caja vuelve a abrir.
//
//  Cualquier error (sin internet, GitHub caído) queda en el registro y nunca
//  le aparece a quien está cobrando.
// =============================================================================

const { app, BrowserWindow, ipcMain, powerMonitor } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHEQUEO_INICIAL_MS = 10 * 1000;
const CHEQUEO_PERIODICO_MS = 2 * 60 * 60 * 1000;
const REVISION_NOCTURNA_MS = 5 * 60 * 1000;
const ESPERA_MAXIMA_MS = 24 * 60 * 60 * 1000;
const INACTIVIDAD_NOCTURNA_S = 30 * 60;

// Estado que ven las ventanas. "estado": inactivo | descargando | lista
const estado = {
  version: app.getVersion(),
  estado: 'inactivo',
  nueva: null,
  notas: null,
  progreso: 0,
  bloqueado: false
};
let listaDesde = null;

// Qué ventanas tienen un pedido en curso (id de webContents -> true).
const pedidosEnCurso = new Map();

function hayPedidoEnCurso() {
  for (const valor of pedidosEnCurso.values()) if (valor) return true;
  return false;
}

function avisarVentanas() {
  estado.bloqueado = hayPedidoEnCurso();
  for (const ventana of BrowserWindow.getAllWindows()) {
    // Al cerrar, la ventana puede seguir viva con su contenido ya destruido.
    if (!ventana.isDestroyed() && !ventana.webContents.isDestroyed()) ventana.webContents.send('actualizacion:estado', { ...estado });
  }
}

function notasComoTexto(notas) {
  if (!notas) return null;
  if (Array.isArray(notas)) notas = notas.map((n) => n.note || '').join('\n');
  // GitHub devuelve las notas en HTML: al aviso le alcanza el texto.
  const texto = String(notas).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return texto || null;
}

function instalarAhora(log, motivo) {
  log.info(`Instalando la versión ${estado.nueva} (${motivo})`);
  // Silenciosa y con reapertura automática de la caja.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
}

function iniciarActualizador(log) {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    log.info(`Hay versión nueva: ${info.version}. Descargando en segundo plano.`);
    estado.estado = 'descargando';
    estado.nueva = info.version;
    estado.progreso = 0;
    avisarVentanas();
  });

  autoUpdater.on('download-progress', (p) => {
    estado.progreso = Math.round(p.percent || 0);
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Versión ${info.version} descargada: se instala al cerrar la caja.`);
    estado.estado = 'lista';
    estado.nueva = info.version;
    estado.notas = notasComoTexto(info.releaseNotes);
    estado.progreso = 100;
    if (!listaDesde) listaDesde = Date.now();
    avisarVentanas();
  });

  autoUpdater.on('error', (error) => {
    log.warn('Actualizador:', error && error.message ? error.message : error);
    if (estado.estado === 'descargando') {
      estado.estado = 'inactivo';
      avisarVentanas();
    }
  });

  ipcMain.handle('actualizacion:obtener', () => ({ ...estado, bloqueado: hayPedidoEnCurso() }));

  ipcMain.on('caja:pedido-en-curso', (evento, enCurso) => {
    const id = evento.sender.id;
    if (pedidosEnCurso.get(id) === !!enCurso) return;
    pedidosEnCurso.set(id, !!enCurso);
    if (!evento.sender.__cajaLimpieza) {
      evento.sender.__cajaLimpieza = true;
      evento.sender.once('destroyed', () => {
        pedidosEnCurso.delete(id);
        avisarVentanas();
      });
    }
    avisarVentanas();
  });

  ipcMain.handle('actualizacion:instalar', () => {
    if (estado.estado !== 'lista') return { ok: false, motivo: 'No hay una actualización lista.' };
    if (hayPedidoEnCurso()) return { ok: false, motivo: 'Hay un pedido en curso. Terminalo o vacialo para reiniciar.' };
    instalarAhora(log, 'pedido desde el aviso');
    return { ok: true };
  });

  // En desarrollo (npm start) no hay nada que actualizar. Para ver el aviso
  // sin publicar nada: $env:CAJA_SIMULAR_ACTUALIZACION=1; npm start
  if (!app.isPackaged) {
    log.info('Actualizador apagado: la app no está instalada (modo desarrollo).');
    if (process.env.CAJA_SIMULAR_ACTUALIZACION) {
      autoUpdater.quitAndInstall = () => log.info('Simulación: acá se instalaría la versión nueva.');
      setTimeout(() => autoUpdater.emit('update-downloaded', {
        version: '9.9.9',
        releaseNotes: 'Simulación del aviso de actualización.'
      }), 3000);
    }
    return;
  }

  const buscar = () => {
    if (estado.estado !== 'inactivo') return;
    autoUpdater.checkForUpdates().catch((error) => log.warn('No se pudo buscar actualizaciones:', error.message));
  };
  setTimeout(buscar, CHEQUEO_INICIAL_MS);
  setInterval(buscar, CHEQUEO_PERIODICO_MS);

  setInterval(() => {
    if (estado.estado !== 'lista' || !listaDesde) return;
    const hora = new Date().getHours();
    const esperaLarga = Date.now() - listaDesde > ESPERA_MAXIMA_MS;
    const deMadrugada = hora >= 3 && hora < 5;
    const sinUso = powerMonitor.getSystemIdleTime() >= INACTIVIDAD_NOCTURNA_S;
    if (esperaLarga && deMadrugada && sinUso && !hayPedidoEnCurso()) {
      instalarAhora(log, 'instalación nocturna');
    }
  }, REVISION_NOCTURNA_MS);
}

module.exports = { iniciarActualizador };
