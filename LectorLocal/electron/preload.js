// =============================================================================
//  preload.js - Lo único que la página ve del programa: window.LectorApp
// =============================================================================
//  - version:          versión instalada del Lector.
//  - onBloqueo(cb):    cb(true) cuando se abre Caja HomePoint en esta PC (el
//                      Lector se pausa), cb(false) cuando se cierra.
//  - salir(), reintentar(): para la pantalla de espera (espera.html).
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron');

let version = '';
try { version = ipcRenderer.sendSync('lector:version'); } catch {}

contextBridge.exposeInMainWorld('LectorApp', {
  version,
  onBloqueo(cb) {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('lector:bloqueo', (_evento, bloqueado) => { try { cb(!!bloqueado); } catch {} });
    ipcRenderer.send('lector:listo');
  },
  salir() { ipcRenderer.send('lector:salir'); },
  reintentar() { ipcRenderer.send('lector:reintentar'); }
});
