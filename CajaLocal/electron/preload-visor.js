// =============================================================================
//  preload-visor.js - Lo único que puede hacer el visor del registro
// =============================================================================
//  Leer: la lista de días guardados y el texto de un día. Nada para escribir,
//  borrar ni cambiar (registro.js).
// =============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('visorRegistro', {
  dias: () => ipcRenderer.invoke('visor:dias'),
  leer: (dia) => ipcRenderer.invoke('visor:leer', dia),
  hoy: () => ipcRenderer.invoke('visor:hoy')
});
