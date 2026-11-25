// =============================================================================
//  actualizador.js - Actualización automática del Lector
// =============================================================================
//  Las versiones están en UN release fijo de GitHub, "lector-win", marcado como
//  pre-release (lo sube scripts\subir.ps1). Así nunca figura como "latest" y
//  no confunde al actualizador de Caja HomePoint, que mira releases/latest.
//
//  1. Al abrir (15 s después) y cada 2 horas pregunta si hay versión nueva y
//     la baja en segundo plano.
//  2. Con la descarga lista, se instala sola cuando hace 10 minutos que nadie
//     usa la PC (el Lector vuelve a abrir solo), o al cerrar el programa.
//
//  La pantalla (lector.html) no depende de esto: se actualiza sola desde el
//  sitio. Esto sólo actualiza el programa de Windows.
// =============================================================================

const { app, powerMonitor } = require('electron');
const { autoUpdater } = require('electron-updater');

const CHEQUEO_INICIAL_MS = 15 * 1000;
const CHEQUEO_PERIODICO_MS = 2 * 60 * 60 * 1000;
const REVISION_INSTALAR_MS = 60 * 1000;
const INACTIVIDAD_INSTALAR_S = 10 * 60;

function iniciarActualizador(log) {
  if (!app.isPackaged) {
    log.info('Actualizador apagado: el Lector no está instalado (modo desarrollo).');
    return;
  }
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let lista = null;
  let buscando = false;

  autoUpdater.on('update-available', (info) => log.info(`Hay versión nueva: ${info.version}. Descargando.`));
  autoUpdater.on('update-downloaded', (info) => {
    lista = info.version;
    log.info(`Versión ${info.version} descargada: se instala cuando la PC esté sin uso.`);
  });
  autoUpdater.on('error', (error) => log.warn('Actualizador:', error && error.message ? error.message : error));

  const buscar = () => {
    if (lista || buscando) return;
    buscando = true;
    autoUpdater.checkForUpdates()
      .catch((error) => log.warn('No se pudo buscar actualizaciones:', error.message))
      .finally(() => { buscando = false; });
  };
  setTimeout(buscar, CHEQUEO_INICIAL_MS);
  setInterval(buscar, CHEQUEO_PERIODICO_MS);

  setInterval(() => {
    if (!lista) return;
    if (powerMonitor.getSystemIdleTime() < INACTIVIDAD_INSTALAR_S) return;
    log.info(`Instalando la versión ${lista} (PC sin uso)`);
    // Silenciosa y con reapertura automática del Lector.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    lista = null;
  }, REVISION_INSTALAR_MS);
}

module.exports = { iniciarActualizador };
