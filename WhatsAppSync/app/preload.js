'use strict';
// Puente minimo entre la ventana y el proceso principal: la pagina no tiene
// acceso a Node, solo a estas acciones. Las de una linea reciben su id.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('was', {
  alCambiar: (cb) => ipcRenderer.on('estado', (_e, estado) => cb(estado)),
  alPedirAgregar: (cb) => ipcRenderer.on('abrir-agregar', () => cb()),
  estado: () => ipcRenderer.invoke('estado'),
  seleccionar: (id) => ipcRenderer.invoke('seleccionar', id),
  elegirClave: () => ipcRenderer.invoke('elegir-clave'),   // una sola clave para toda la PC
  reemplazarNodo: (id) => ipcRenderer.invoke('reemplazar-nodo', id),
  guardarLinea: (datos) => ipcRenderer.invoke('guardar-linea', datos),
  quitarLinea: (id) => ipcRenderer.invoke('quitar-linea', id),
  hacerPrincipal: (id) => ipcRenderer.invoke('hacer-principal', id),
  reiniciar: (id) => ipcRenderer.invoke('reiniciar', id),
  abrirCarpeta: (id) => ipcRenderer.invoke('abrir-carpeta', id),
  desvincular: (id) => ipcRenderer.invoke('desvincular', id),
  inicioWindows: (si) => ipcRenderer.invoke('inicio-windows', si)
});
