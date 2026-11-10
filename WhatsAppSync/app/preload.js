'use strict';
// Puente minimo entre la ventana y el proceso principal: la pagina no tiene
// acceso a Node, solo a estas acciones.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('was', {
  alCambiar: (cb) => ipcRenderer.on('estado', (_e, estado) => cb(estado)),
  estado: () => ipcRenderer.invoke('estado'),
  elegirClave: () => ipcRenderer.invoke('elegir-clave'),
  reiniciar: () => ipcRenderer.invoke('reiniciar'),
  abrirCarpeta: () => ipcRenderer.invoke('abrir-carpeta'),
  desvincular: () => ipcRenderer.invoke('desvincular'),
  inicioWindows: (si) => ipcRenderer.invoke('inicio-windows', si)
});
