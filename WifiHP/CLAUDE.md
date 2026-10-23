# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

"WiFi Clientes": app de Windows (Python + pywebview) que comparte el internet por cable de la PC del comercio mediante una red Wi-Fi temporal para clientes. Cada teléfono tiene un tiempo fijo (5 min por defecto), se conecta escaneando un QR y no puede llegar a la red interna ni a la PC. Quien la usa no es técnico, así que los textos de la interfaz y los errores van en español rioplatense simple, sin códigos.

## Comandos

```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requisitos-build.txt

.venv\Scripts\python.exe app.py              # pide administrador (UAC) para cargar los filtros
.venv\Scripts\python.exe app.py --sin-admin  # solo interfaz, modo básico sin filtros

.venv\Scripts\python.exe construir.py        # icono + PyInstaller (dist/) + Inno Setup (salida/)
```

No hay tests automatizados. Para verificar de punta a punta hace falta un proceso elevado y un teléfono real. Si se encienden `sesiones.Control().activar()` y `.filtro` desde un script elevado, `netsh wfp show filters` muestra los filtros con el prefijo "WiFi Clientes:".

En desarrollo se usa el Python de Microsoft Store. Windows redirige `%LOCALAPPDATA%\WiFi Clientes\` (config.json, registro.log) a `%LOCALAPPDATA%\Packages\PythonSoftwareFoundation.Python.3.13_*\LocalCache\Local\WiFi Clientes\`. El ejecutable compilado sí escribe en la ruta real.

## Arquitectura

- `hotspot.py`: envoltorio de la API WinRT `NetworkOperatorTetheringManager` (la "Zona con cobertura móvil" de Windows). No se usa `netsh wlan hostednetwork`, porque la placa no lo soporta. Las llamadas asíncronas corren en un loop de asyncio en un hilo propio. Límites de Windows: hasta 8 clientes y clave de 8 caracteres o más. La API no permite expulsar clientes ni limitar la velocidad.
- `trafico.py`: filtros de la Plataforma de Filtrado de Windows (WFP), con ctypes sobre `fwpuclnt.dll`. Las estructuras replican el layout x64 de fwpmtypes.h (FWPM_FILTER0 = 200 bytes). La sesión es **dinámica**: al cerrar el motor o caerse el proceso, Windows borra todos los filtros. Se filtra en dos capas, INBOUND_IPPACKET_V4 e IPFORWARD_V4, más ALE_AUTH_RECV_ACCEPT_V4 para proteger la PC (solo deja pasar DNS 53 y DHCP 67). Los pesos van dentro de una subcapa propia: cliente bloqueado 15 > permitir 10 > base 5. La subred sale del registro de ICS (`ScopeAddress`, por defecto 192.168.137.0/24).
- `sesiones.py` (`Control`): coordina todo. Un hilo revisa una vez por segundo:
  - Cada MAC nueva arranca su contador. Si se reconecta, el contador no se reinicia.
  - Al vencer o al cortarlo a mano, se bloquean sus IP.
  - Si la red quedó sin uso durante el tiempo configurado, se apaga sola.
  - Si se apagó desde Windows, se resincroniza el estado.

  Al apagar se borran los filtros y las sesiones, y la clave siguiente es nueva. Si WFP no está disponible (sin administrador), la red funciona en "modo limitado".
- `app.py`: ventana pywebview sin marco, con una barra de título propia (`pywebview-drag-region`), el ícono de bandeja (pystray) y la clase `Api`, que expone métodos a JS. Los atributos con `_` no se exponen. Al arrancar:
  1. Elevación: compilada, se relanza con `schtasks /run /tn "WiFi Clientes"`, sin aviso UAC. Si no existe la tarea, usa ShellExecute `runas`.
  2. Después controla que haya una sola instancia (mutex y, si ya hay una, la trae al frente).
- `ui/`: HTML, CSS y JS sin framework. `app.js` consulta `api.estado()` cada 1 s y anima los contadores con requestAnimationFrame, descontando el tiempo desde la última lectura. El tema claro u oscuro sale de `prefers-color-scheme`, con tokens en `:root`. Toda la lógica vive en Python: la interfaz solo pinta el estado.
- `instalador.iss`: instala con permisos de administrador y crea la tarea programada a partir de un XML. La tarea usa privilegios altos, `MultipleInstancesPolicy=Parallel` (para que la segunda instancia pueda traer al frente a la primera), no tiene corte a las 72 h y arranca aunque la PC esté a batería. Opcionalmente agrega un disparador al iniciar sesión. Por eso el exe **no** lleva `--uac-admin`. El archivo debe quedar en UTF-8 con BOM.

## Decisiones a respetar

- No usar WinDivert ni drivers de terceros: Windows Defender bloquea WinDivert como software no deseado. Por eso no hay límite de velocidad por cliente.
- El QR siempre va sobre fondo blanco, también en modo oscuro, para que las cámaras lo lean bien.
