// Lo único que la app web ve de Electron. Con esto js/app.js detecta que corre
// como app de escritorio y muestra el interruptor "Iniciar con Windows".
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('soundboardDesktop', {
  // El preload corre en sandbox (sin require de archivos): main.js le pasa la versión por argv.
  version: (process.argv.find(a => a.startsWith('--sb-version=')) || '').split('=')[1] || '',
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled)
});
