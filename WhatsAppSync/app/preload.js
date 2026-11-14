'use strict';
// Puente minimo entre la ventana y el proceso principal: la pagina no tiene
// acceso a Node, solo a estas acciones. Las de una linea reciben su id.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('was', {
  alCambiar: (cb) => ipcRenderer.on('estado', (_e, estado) => cb(estado)),
  alPedirAgregar: (cb) => ipcRenderer.on('abrir-agregar', () => cb()),
  estado: () => ipcRenderer.invoke('estado'),
  seleccionar: (id) => ipcRenderer.invoke('seleccionar', id),
  elegirClave: (id) => ipcRenderer.invoke('elegir-clave', id),
  elegirClaveForm: () => ipcRenderer.invoke('elegir-clave-form'),
  olvidarClaveForm: () => ipcRenderer.invoke('olvidar-clave-form'),
  guardarLinea: (datos) => ipcRenderer.invoke('guardar-linea', datos),
  quitarLinea: (id) => ipcRenderer.invoke('quitar-linea', id),
  reiniciar: (id) => ipcRenderer.invoke('reiniciar', id),
  abrirCarpeta: (id) => ipcRenderer.invoke('abrir-carpeta', id),
  desvincular: (id) => ipcRenderer.invoke('desvincular', id),
  inicioWindows: (si) => ipcRenderer.invoke('inicio-windows', si)
});
