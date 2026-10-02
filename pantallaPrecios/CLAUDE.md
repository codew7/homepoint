# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

Kiosco de autoconsulta de precios de "HomePoint" para clientes, pensado para **tablets Android en vertical**. El cliente teclea los últimos números del código de barras en un teclado numérico en pantalla y ve foto, nombre y precio del artículo. Dos piezas:

- `index.html` — la página (HTML + CSS + JS inline, sin build, igual que el resto del repo). Publicada en GitHub Pages: `https://homepoint-admin.dev.ar/pantallaPrecios/`.
- `android/` — app Android mínima (Java, sin dependencias externas) que abre esa URL a pantalla completa en un WebView y se autoactualiza. `app/` contiene el APK publicado y `version.json`.

No hay login ni Firebase: es una pantalla pública. Diseño "premium estilo Apple" (se usó el skill `apple-design`): tema oscuro, ficha clara, feedback en pointer-down, springs/transiciones suaves, `prefers-reduced-motion` respetado.

## index.html

### Datos (Google Sheets)
- Credenciales: `<script src="../config.js">` → `GOOGLE_SHEETS_CONFIG` de la raíz. **La API key tiene restricción por referer**: solo funciona servida desde `homepoint-admin.dev.ar` (desde `file://` o `localhost` Sheets responde 403). Para probar hay que publicar, o pedir datos con `curl -H "Referer: https://homepoint-admin.dev.ar/"`.
- Rango recortado a `:L` con `FORMATTED_VALUE`. Columnas de la hoja `Lista` (mismo mapeo que `Articulos/imprimirEtiqueta.html`):
  - B (`row[1]`): imágenes, lista por comas → se usan la 1ª y la 4ª como respaldo, luego placeholder SVG.
  - C (`row[2]`): código interno (identifica el artículo; **no se muestra**, el usuario pidió quitarlo).
  - D (`row[3]`): nombre.
  - G (`row[6]`): **precio** mostrado. Viene formateado en-US (`6,221`); `parsePrecio()` acepta también formato es-AR. Se muestra como `$ 6.221` sin decimales.
  - L (`row[11]`): códigos de barras, lista por comas (varios por artículo; algunos tienen letras, p. ej. `JUET14568`).
- Cache del catálogo en `localStorage` (`kioscoPrecios.catalogo.v1`) para arranque instantáneo y funcionamiento sin internet. Recarga cada 10 min (`REFRESH_MS`) y al volver a primer plano. El pie muestra la hora de la última actualización.

### Búsqueda y flujo
- `buscar(q)`: coincidencia por **sufijo** (`endsWith`) sobre todos los códigos de barras. `MIN_DIGITS = 5` (el texto en pantalla dice "últimos 6 números" por pedido del usuario; la lógica sigue aceptando 5 — no se cambió porque no se pidió). `MAX_DIGITS = 14`.
- 1 coincidencia → la ficha se abre sola tras `AUTO_OPEN_MS` (650 ms) sin teclear. Varias → lista de tarjetas (foto + nombre + precio) para elegir. 0 → estado "No encontramos ese código".
- Con 5 dígitos hay ~34 sufijos repetidos en el catálogo; con 6, ~25: por eso existe la lista de elección.
- Acepta teclado físico / lector USB (dígitos, Backspace, Enter, Escape).

### UI
- Hero (`#hero` > `#heroIn`): ilustración SVG de etiqueta con código de barras y los últimos 6 dígitos resaltados + línea de escaneo roja, título "¿Cuánto cuesta?", indicación, display de casillas y estado. Se quitó el subtítulo "Consulta de precios" (el CSS `.eyebrow` quedó sin uso).
- **Encaje vertical**: los tamaños usan `clamp(..vh..)`; además `ajustarHero()` escala `#heroIn` con `transform: scale()` si no entra en el alto disponible. Esto corrigió un bug real en el que el hero se superponía con el teclado en pantallas bajas (~860 px de alto). Al agregar elementos al hero, mantener esa protección.
- Ficha (`.sheet`): hoja que sube desde abajo con scrim borroso. **Sin botón de cierre (cruz)**, a pedido del usuario: se cierra con "Nueva consulta", arrastrando hacia abajo (1:1 + proyección de velocidad), tocando el scrim, o sola tras `SHEET_IDLE_MS` (25 s, barra de progreso en el botón).
- Ficha de producto: **sin código interno ni la palabra "Precio"** (pedido del usuario). La foto ocupa el espacio restante (`.photo` `flex: 1 1 0`, `img` con `position:absolute; object-fit: contain`) para verse **siempre completa, sin scroll y sin deformarse**. No volver a `aspect-ratio`/`display:grid` en `.photo`: la imagen agrandaba el recuadro y quedaba cortada.
- `cerrarPorToque` ignora clicks dentro de 500 ms de abrir la ficha (el mismo toque que la abre caería sobre el botón/scrim y la cerraría).
- Inactividad en la pantalla principal: el número tecleado se borra a los 30 s.

### Integración con la app
- Si el user-agent contiene `HomePointKiosco` (lo agrega la app), se oculta el botón de pantalla completa.
- `chequearPagina()`: cada 5 min hace `HEAD` con `no-store` y compara `ETag`/`Last-Modified`; si cambió y nadie está usando la pantalla (`!sheetAbierta && !entrada`), recarga. Así los cambios publicados llegan solos a las tablets (GitHub Pages cachea 10 min).

## android/ (APK)

- Paquete `ar.dev.homepoint.precios`, `minSdk 24`, `targetSdk/compileSdk 34`, AGP 8.5.2, Gradle 8.7, JDK 17. Sin AndroidX.
- `MainActivity`: WebView a `BuildConfig.KIOSK_URL`; inmersivo, pantalla siempre encendida, `textZoom 100`, Atrás deshabilitado, no navega fuera de `/pantallaPrecios/`. Sin internet: primero intenta la copia en cache (`LOAD_CACHE_ELSE_NETWORK`), si no hay, pantalla "Sin conexión" con reintento cada 15 s; vuelve a modo online cada 60 s si detecta red.
- Puede elegirse como **app de inicio (HOME)** de la tablet: es el modo kiosco recomendado, porque así arranca al encender y se reabre sola después de una autoactualización (Android no permite relanzarla desde segundo plano).
- `Updater`: cada 6 h (primer chequeo a los 20 s) lee `BuildConfig.VERSION_URL` (`pantallaPrecios/app/version.json`); si `versionCode` remoto > instalado, descarga el APK y lo instala con `PackageInstaller` (`InstallReceiver` abre la confirmación si Android la pide). Primera vez: permiso "instalar apps desconocidas" + confirmación; en Android 12+ las siguientes pueden ser silenciosas (`USER_ACTION_NOT_REQUIRED` + `UPDATE_PACKAGES_WITHOUT_USER_ACTION`).
- Ícono: vector propio (`res/drawable/ic_glifo.xml`, etiqueta con código de barras), adaptativo en 26+.

### Compilar / publicar una versión nueva del APK
1. Subir `versionCode` (y `versionName`) en `android/app/build.gradle`.
2. Ejecutar `android/compilar.ps1` (PowerShell). Deja `app/HomePointPrecios.apk` y regenera `app/version.json` (UTF-8 sin BOM).
3. Commit + push (solo cuando el usuario lo pida).

Solo hace falta un APK nuevo si cambia la app nativa; los cambios de `index.html` llegan solos.

### Herramientas y firma (fuera del repo)
- Todo en `C:\Users\alero\android-tools\`: `jdk-17.*`, `gradle-8.7`, `sdk` (platform 34, build-tools 34.0.0, platform-tools). `compilar.ps1` las localiza solo. Para instalar paquetes del SDK, aceptar licencias con `yes | sdkmanager.bat --licenses` desde Bash (el pipe desde PowerShell no funciona).
- **Firma**: `android-tools\firma\homepoint-precios.jks` + `firma.properties` (contraseñas), leídos por `app/build.gradle` (ruta alternativa con la variable `HOMEPOINT_FIRMA`). **Si se pierde la clave, las tablets no pueden actualizarse** (hay que desinstalar y reinstalar). Nunca moverla al repo; `android/.gitignore` excluye `*.jks`, `firma.properties`, `local.properties` y `build/`.
