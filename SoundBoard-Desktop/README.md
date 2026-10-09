# SoundBoard Showroom — app de escritorio

Programa de Windows (Electron) que abre la app web publicada en
`https://homepoint-admin.dev.ar/SoundBoard/` en su propia ventana.

La app web vive en `homepoint/SoundBoard` y **no usa npm**. Este proyecto es
una capa aparte: lo único que agrega es lo que la web no puede hacer sola.

- Los avisos suenan sin el cartel "Activá el sonido".
- Puede iniciarse con Windows (interruptor en la app o en el ícono junto al reloj).
- Al cerrar la ventana sigue sonando en segundo plano; para salir del todo:
  clic derecho en el ícono junto al reloj → **Salir**.
- Evita que la PC se suspenda mientras está abierta.
- Sin internet muestra un aviso y reintenta cada 10 segundos.

## Actualizar la app

- **Cambios en la app web** (diseño, funciones): se suben al hosting como
  siempre. El programa instalado los toma solo, sin reinstalar.
- **Cambios en este programa** (`main.js`, `preload.js`, íconos): subir el
  número de `"version"` en `package.json` y generar un instalador nuevo.

## Generar el instalador

Requiere Node.js (sólo en la PC donde se arma, no en las del showroom).

```powershell
npm install        # la primera vez
npm run dist       # crea dist\SoundBoard-Showroom-Setup-<versión>.exe
```

Para probar sin instalar: `npm start`.
Para probar contra un servidor local:

```powershell
$env:SOUNDBOARD_URL = "http://localhost:5500/index.html"; npm start
```

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `main.js` | Ventana, ícono junto al reloj, arranque con Windows, reintento sin conexión |
| `preload.js` | Expone `window.soundboardDesktop` a la app web (versión y arranque automático) |
| `offline.html` | Pantalla "Sin conexión a internet" |
| `build/icon.ico` | Ícono del programa y del instalador |
| `build/installer.nsh` | Al desinstalar, borra el arranque automático |

El instalador no está firmado digitalmente: la primera vez Windows muestra
"Windows protegió su PC" → **Más información** → **Ejecutar de todos modos**.
