r"""
Compartir comprobantes desde el verificador (solo Windows, sin dependencias extra).

    mostrar(rutas)   abre el Explorador con los archivos seleccionados (una ventana por carpeta)
    copiar(rutas)    copia los archivos al portapapeles, igual que Ctrl+C en el Explorador:
                     despues se pegan con Ctrl+V en un chat de WhatsApp y se mandan juntos,
                     sin comprimirlos en un ZIP.
"""

import ctypes
import os
import struct
import subprocess
import time
from ctypes import wintypes
from pathlib import Path

ES_WINDOWS = os.name == "nt"

if ES_WINDOWS:
    _user32 = ctypes.WinDLL("user32", use_last_error=True)
    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _shell32 = ctypes.WinDLL("shell32")
    _ole32 = ctypes.WinDLL("ole32")

    _kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
    _kernel32.GlobalAlloc.restype = ctypes.c_void_p
    _kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
    _kernel32.GlobalLock.restype = ctypes.c_void_p
    _kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]
    _kernel32.GlobalFree.argtypes = [ctypes.c_void_p]
    _user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_int,
                                        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p,
                                        ctypes.c_void_p, ctypes.c_void_p]
    _user32.CreateWindowExW.restype = ctypes.c_void_p
    _user32.DestroyWindow.argtypes = [ctypes.c_void_p]
    _user32.OpenClipboard.argtypes = [ctypes.c_void_p]
    _user32.SetClipboardData.argtypes = [wintypes.UINT, ctypes.c_void_p]
    _user32.SetClipboardData.restype = ctypes.c_void_p
    _user32.RegisterClipboardFormatW.argtypes = [wintypes.LPCWSTR]
    _user32.RegisterClipboardFormatW.restype = wintypes.UINT
    _shell32.ILCreateFromPathW.argtypes = [wintypes.LPCWSTR]
    _shell32.ILCreateFromPathW.restype = ctypes.c_void_p
    _shell32.ILFree.argtypes = [ctypes.c_void_p]
    _shell32.SHOpenFolderAndSelectItems.argtypes = [ctypes.c_void_p, wintypes.UINT, ctypes.POINTER(ctypes.c_void_p), wintypes.DWORD]
    _shell32.SHOpenFolderAndSelectItems.restype = ctypes.c_long
    _ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]

CF_HDROP = 15
GMEM_MOVEABLE = 0x0002
DROPEFFECT_COPY = 1


def _exigir_windows():
    if not ES_WINDOWS:
        raise RuntimeError("Esta función sólo está disponible en Windows.")


# ------------------------------------------------------------------ explorador --

def _seleccionar_en_carpeta(carpeta, archivos):
    """Abre la carpeta en el Explorador con esos archivos seleccionados."""
    pidl_carpeta = _shell32.ILCreateFromPathW(str(carpeta))
    pidls = [p for p in (_shell32.ILCreateFromPathW(str(a)) for a in archivos) if p]
    try:
        if not pidl_carpeta or not pidls:
            raise OSError("ruta inválida")
        arreglo = (ctypes.c_void_p * len(pidls))(*pidls)
        if _shell32.SHOpenFolderAndSelectItems(pidl_carpeta, len(pidls), arreglo, 0) < 0:
            raise OSError("SHOpenFolderAndSelectItems")
    finally:
        for p in pidls + [pidl_carpeta]:
            if p:
                _shell32.ILFree(p)


def mostrar(rutas):
    _exigir_windows()
    por_carpeta = {}
    for r in rutas:
        por_carpeta.setdefault(Path(r).parent, []).append(Path(r))
    _ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED (cada pedido llega en su propio hilo)
    try:
        for carpeta, archivos in por_carpeta.items():
            try:
                _seleccionar_en_carpeta(carpeta, archivos)
            except OSError:
                subprocess.Popen(["explorer", f"/select,{archivos[0]}"])  # plan B: al menos el primero
    finally:
        _ole32.CoUninitialize()


# ---------------------------------------------------------------- portapapeles --

def _memoria(datos):
    h = _kernel32.GlobalAlloc(GMEM_MOVEABLE, len(datos))
    if not h:
        raise MemoryError("No se pudo reservar memoria para el portapapeles.")
    p = _kernel32.GlobalLock(h)
    ctypes.memmove(p, datos, len(datos))
    _kernel32.GlobalUnlock(h)
    return h


def copiar(rutas):
    _exigir_windows()
    # DROPFILES: offset de la lista, punto (x, y), fNC, fWide; despues las rutas UTF-16 con doble cero al final
    lista = "".join(str(Path(r).resolve()) + "\0" for r in rutas) + "\0"
    hdrop = struct.pack("<IiiII", 20, 0, 0, 0, 1) + lista.encode("utf-16-le")
    efecto = struct.pack("<I", DROPEFFECT_COPY)  # que pegar en el Explorador copie, no mueva

    # Una ventana propia como duena del portapapeles (con NULL, SetClipboardData puede fallar)
    ventana = _user32.CreateWindowExW(0, "STATIC", None, 0, 0, 0, 0, 0, None, None, None, None)
    try:
        for _ in range(20):  # otra app puede tenerlo abierto un instante
            if _user32.OpenClipboard(ventana):
                break
            time.sleep(0.05)
        else:
            raise RuntimeError("El portapapeles está ocupado por otro programa. Probá de nuevo.")
        try:
            _user32.EmptyClipboard()
            for formato, datos in ((CF_HDROP, hdrop), (_user32.RegisterClipboardFormatW("Preferred DropEffect"), efecto)):
                h = _memoria(datos)
                if not _user32.SetClipboardData(formato, h):
                    _kernel32.GlobalFree(h)
                    raise RuntimeError("No se pudieron copiar los archivos al portapapeles.")
        finally:
            _user32.CloseClipboard()
    finally:
        if ventana:
            _user32.DestroyWindow(ventana)
