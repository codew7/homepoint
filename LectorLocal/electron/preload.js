// =============================================================================
//  preload.js - Lo único que la página ve del programa: window.LectorApp
// =============================================================================
//  - version:          versión instalada del Lector.
//  - onBloqueo(cb):    cb(true) cuando se abre Caja HomePoint en esta PC (el
//                      Lector se pausa), cb(false) cuando se cierra.
//  - onLectura(cb, alSaber): cb(texto) con cada lectura de la pistola, aunque
//                      la ventana esté atrás. alSaber(true) si eso anda; con
//                      false la página sigue leyendo lo que se escribe en ella.
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
  onLectura(cb, alSaber) {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('lector:lectura', (_evento, texto) => { try { cb(String(texto)); } catch {} });
    ipcRenderer.on('lector:segundoPlano', (_evento, si) => { try { if (typeof alSaber === 'function') alSaber(!!si); } catch {} });
    ipcRenderer.send('lector:pistola');
  },
  salir() { ipcRenderer.send('lector:salir'); },
  reintentar() { ipcRenderer.send('lector:reintentar'); }
});
