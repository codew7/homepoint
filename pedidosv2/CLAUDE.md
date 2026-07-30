# CLAUDE.md

Guidance para Claude Code en este repositorio.

## Proyecto

Sistema de gestión de pedidos para distribuidor "HomePoint". App web HTML estática (sin bundler) que conecta a Firebase Realtime Database y Google Sheets como catálogo de productos.

## Arquitectura

- **pedidosv2.html** — Unified order management + dispatch/packing app (tablet-optimized). Single-file con CSS/JS inline. Features: Firebase Auth, QR scanning, unified view con item packing checklist + controles financieros, Firebase realtime listener, quantity controls, progress bar, PWA installable.
- **manifest.json** — Web App Manifest para PWA (Android/iOS/Windows).
- **sw.js** — Service Worker (caches app shell, network-first strategy).
- **config.js** — Shared config: Firebase credentials + Google Sheets API (API_KEY, SPREADSHEET_ID, RANGO).

## Data Layer

**Firebase Realtime Database** — `pedidos/{id}` nodes contienen: `cliente` (nombre, telefono, localidad, provincia, direccion, dni, email), `items[]` (codigo, nombre, cantidad, valorU, valorC, listo='y'|'n'), `status`, `locked`, `pagos`, `timestamp`, `enPreparacion` ('si'|'listo'), `nota`, `notaFecha`. Statuses: ABIERTO → CERRADO → DESPACHADO/ENTREGADO | CANCELADO.

**Google Sheets** (read-only) — Sheet "Lista", row 2+. Columnas: A=Categoria, B=Imagen URL, C=Codigo, D=Nombre, G=valorU, H=valorC, K=Stock, L=Codigo de barras.

## Tech Stack

- Vanilla JS (sin frameworks)
- Firebase SDK v10.12.0 (compat mode)
- Google Sheets API v4
- Sin build step — open HTML directly en browser o serve con static server

## Características Principales

### Authentication
- Firebase Auth required. `firebase.auth().onAuthStateChanged()` gates access.
- Unauthenticated users → redirect a `../Admin/login.html?redirect=<URL>`.
- Loading overlay full-screen (z-index 99999) con spinner durante auth verification.

### Real-time + Packing
- **Firebase listener**: `on('value', ...)` detects cambios de otros users y re-renders.
- **Item packing**: Cada item tiene `listo` field ('y'|'n') en Firebase. Checkbox state sincroniza multi-device.
- **Item grouping**: Pendientes (listo ≠ 'y') | Listos (listo === 'y'). Auto-reorganiza al checkear.
- **Cerrar Pedido**: Button deshabilitado (50% opacity) hasta que todos items tengan `listo === 'y'`. On click: `status: 'CERRADO'`, `locked: true`, `enPreparacion: 'listo'`. Reabrir: `status: 'ABIERTO'`, `locked: false`, `enPreparacion: 'si'`.

### Financial
- Subtotal, descuento (%), recargo (%), envío, TOTAL FINAL.
- TOTAL FINAL clickeable → copia cotización a clipboard (subtotal, descuentos, recargos, total, medio de pago, alias si Transferencia).
- Auto-save via `programarActualizacion()` (2s debounce).

### Pago + Entrega
- Radio buttons: Efectivo | Transferencia
- Radio buttons: Motomensajeria | Correo | Via Cargo
- Motomensajeria muestra campo Envío (como Correo Argentino).

### Impresión
- **Rótulos**: Destinatario (nombre, dirección, localidad, provincia, teléfono, DNI, entrega) + Remitente (nombre, teléfono) + QR. Checkboxes PS/PAGO/LISTO para tildar a mano.
  - CSS: `@page { margin: 0; }`. Minimized padding. Texto hace wrap completo (sin ellipsis).
- **Facturas**: Compact layout con márgenes mínimos.

### PWA
- `manifest.json` + `sw.js` → "Add to Home Screen" en Android/iOS.
- Custom install button (📲) en header cuando `beforeinstallprompt` event fires.

### UI
- **Design**: Clean Industrial — premium warehouse tool.
- **Typography**: Plus Jakarta Sans (UI) | JetBrains Mono (codes/numbers).
- **Color**: `--accent` #e67e22 (amber), `--success` #2d9f6f (green), `--danger` #d94f4f (red).
- **Header**: Gradient #0f172a → #1e293b. Glassmorphic search. Action buttons.
- **Progress bar**: Single-line "PROGRESO [====---] 100%". Colored fill (amber → green at 100%).
- **localStorage**: Cliente info editable, comentarios despacho, tamaño paquete, peso (local only, no Firebase).

## Convenciones

- All UI text: Spanish.
- Single-file approach — CSS/JS inline.
- Vanilla JS only, sin frameworks.
- Firebase: batched updates donde posible (`ref.update()`).
- Google Sheets: fetched once, cached en memory (maps by codigo).
- WhatsApp: `https://api.whatsapp.com/send/?phone=` + formato argentino (54 prefix, sin 0 leading).
- z-index: auth (99999) > modals (800-900) > header/footer (10) > content (default).

## Recent Changes (2026-03-28)

- **Merged Despacho + Pedido** → single unified view (`renderUnificado()`).
- **Items editable prices** + item total en cada línea.
- **enPreparacion sync**: Cerrar Pedido setea `'listo'`, Reabrir setea `'si'`.
- **Firebase packing checkbox**: `listo` field multi-device sync.
- **Button state**: Cerrar Pedido disabled hasta todos items checked.

## Recent Changes (2026-04-09)

- **Rótulos checkboxes**: Added 3 hand-checkable boxes (PS, PAGO, LISTO) al pie.
- **Rótulos text wrapping**: Eliminado `white-space: nowrap; text-overflow: ellipsis`. Texto ahora hace wrap completo sin truncado.

## Recent Changes (2026-06-01)

- **Transferencia sin recargo automático**: Eliminada la lógica que auto-cargaba 3% al seleccionar Transferencia (cambio de radio ya no setea `porcentajeRecargo`). Label del radio actualizado a "Transferencia" (sin "+3%").
- **Voucher en cotización copiada**: `pvBuildCotizacionTexto()` agrega al final (separado por renglón en blanco) "VOUCHER DESCUENTO - $<15% del Total Final, redondeado> (valido hasta <hoy + 31 días, formato d/m/aaaa>)".
- **Descuento/Recargo $ manual**: Los inputs `$` de descuento y recargo aceptan ingreso manual cuando el campo `%` adjunto está en 0. Los handlers de `pvDescuentoInput`/`pvRecargoInput` ya no back-calculan el porcentaje (eso pisaba el valor tipeado al re-aplicar el % redondeado). Si `%` > 0, el `$` sigue siendo autocalculado.

## Recent Changes (2026-07-27)

### Escáner de códigos de barras de artículos (`articuloIniciarScanner`/`articuloOnScan`)

El escaneo por cámara tardaba mucho y a veces daba "Codigo no encontrado" con códigos válidos, mientras que `Articulos/articulos.html` (misma librería `html5-qrcode@2.3.8`) leía perfecto. Se replicó su criterio:

- **Sin `qrbox`** — era la causa principal. La librería recorta el frame a esa caja y crea un canvas de ese tamaño; con la caja anterior (280×140) las barras finas llegaban al decoder sin densidad de píxeles suficiente. Omitir `qrbox` deja `isShadedBoxEnabled()` en `false` y se escanea el viewfinder completo a resolución nativa. **No volver a agregarlo.** (`articulos.html` consigue lo mismo por accidente: su `scanQrbox(vw)` lee `vw.width` sobre un argumento que la librería pasa como número, devuelve `NaN` y la condición `qrDimensions.height <= viewfinderHeight` falla.)
- **`formatsToSupport`** en el constructor con los 9 formatos usados (`SCAN_FORMATS()`), en vez de dejar que ZXing pruebe todos en cada frame.
- **Constraints de iOS** — alta resolución + `focusMode: 'continuous'`, con reintento automático a config básica si el navegador los rechaza (`OverconstrainedError`). Safari entrega un stream de baja resolución que no decodifica 1D.
- **Validación + consenso** — `gtinCheckOk()` y `codigoEscaneadoValido(code, fmt)` descartan lecturas parciales por longitud y dígito verificador según formato (el ITF truncado era el que producía el falso "no encontrado"), y se exigen 2 lecturas idénticas consecutivas (`ARTICULO_SCAN_CONSENSO`). **El dedupe de 2500 ms va DESPUÉS del consenso**: si filtrara antes, bloquearía la segunda lectura idéntica y el consenso nunca se alcanzaría.

El escáner de QR de pedidos (`#qr-reader-container`, lee QR no 1D) quedó sin cambios.

### Rediseño UX del modal Buscar artículo (`#articuloModal`)

Era un bottom-sheet de 72vh: el visor quedaba en la mitad baja de la pantalla (incómodo para apuntar en celular) y la cámara se apagaba y reencendía en cada artículo.

- **Estructura plana** — se eliminaron los contenedores `.articulo-paso`; header (paso 1 / paso 2), visor, listas y footer son hermanos directos de `.add-item-panel`. Así el visor sigue visible en ambos pasos. `articuloMostrarPaso(n)` conmuta headers y listas.
- **Pantalla completa** — `align-items: stretch` + panel `100dvh`, cámara arriba y acciones abajo (zona del pulgar). **Todo el CSS va scopeado a `#articuloModal`**: comparte `.add-item-modal`/`.add-item-panel`/`.add-item-header`/`.add-item-list` con `#addItemModal`, que debe seguir siendo un bottom-sheet de 72vh.
- **No fijar alto ni `object-fit` al `<video>`** — html5-qrcode calcula la región a decodificar con `videoWidth/clientWidth` y `videoHeight/clientHeight`; redimensionarlo por CSS desalinea lo que se ve de lo que se decodifica. El visor se acota con `max-height: 42dvh` + `overflow: hidden` en el wrap (recorta visualmente sin tocar el tamaño real del elemento) y `align-items: center` para que el centro siempre quede visible.
- **Cámara viva entre escaneos** — `articuloPausarScanner()`/`articuloReanudarScanner()` usan `pause(false)`/`resume()` en vez de `stop()`+`start()`, evitando el arranque de ~1s por artículo. Ambas van con guard `isScanning` + `try/catch` (la librería lanza si no está corriendo). `articuloCerrarModal()` sí hace `stop()` completo para liberar la cámara.
- **Atajos** — la cámara arranca sola al abrir el modal (sin `await`, en paralelo con `cargarSheets()`), y los pedidos pendientes llegan pre-tildados (`sel: item.listo !== 'y'`).
- Se eliminó `articuloUsoScanner`: con la cámara viva todo el ciclo, `articuloVolverAPaso1()` ya no recibe parámetro y siempre reanuda. Si el usuario apagó la cámara a mano, `articuloReanudarScanner()` no la reenciende (chequea `isScanning`).

### Protección contra toques accidentales en la lista de artículos

En tablet era fácil cambiar por error la cantidad o el check de "listo" al recorrer el pedido. Como `toggleCheck` escribe en Firebase al instante y `cambiarQty` dispara `programarActualizacion`, el error se sincronizaba a todos los dispositivos.

- **Guarda anti-scroll** — listener único en fase de captura sobre `#mainContent` (`listaItemsEl`), instalado una sola vez porque el contenedor sobrevive a los re-render. Descarta el click sobre `.item-check`, `.qty-btn` o `.item-delete` si el dedo se desplazó más de `TOQUE_SLOP` (12 px) entre `pointerdown` y `click`, o si la lista scrolleó en los últimos `TOQUE_POST_SCROLL` (300 ms) — el caso típico es el toque para frenar el scroll por inercia, que en Android igual dispara `click`. Hacen falta **`preventDefault()` y `stopPropagation()` juntos**: el checkbox usa `onchange` (cancelar la acción por defecto evita el toggle y con él el `change`), mientras que los `▼/▲` y la `×` usan `onclick` inline sobre el propio target y solo se frenan cortando la propagación desde la captura. El `e.detail === 0` inicial deja pasar el click sintetizado por teclado, que llega sin coordenadas. **No ampliar `GUARDA_SELECTOR` a todo `#mainContent`**: bloquear el tap sobre `.item-name` o `.item-img` haría sentir la pantalla muerta después de scrollear.
- **Stepper de cantidad bajo demanda** — `.qty-control` arranca colapsado (solo el número, con `box-shadow: inset` como pista de que es tocable) y un tap sobre `.qty-value` llama a `activarQty(idx)`, que le agrega `.qty-activo`. Se colapsa a los 5 s (`QTY_AUTO_COLAPSO`), al tocar fuera, al abrir el de otra card, al marcar el check (`toggleCheck` llama a `colapsarQty()` porque la card migra de grupo) y en cada `renderUnificado()`. `cambiarQty` reinicia el timer para que ajustes sucesivos no lo cierren. **Los `.qty-btn` se ocultan con `opacity` + `pointer-events`, nunca con `display:none`**: el control debe conservar su ancho al expandirse, si no el checkbox vecino se corre bajo el dedo justo al abrirlo.
- La rama `isBlocked` (`.qty-static`) quedó sin cambios, igual que los inputs financieros y los modales.

## Recent Changes (2026-07-28)

### Desambiguación cuando un código de barras pertenece a varios artículos

La columna L del Sheet admite varios códigos por artículo, y nada impide que dos artículos compartan uno. `articuloOnScan` resolvía con el **primer** match y cortaba (`break` sobre `for...in sheetsData`), así que el operador podía marcar listo el artículo equivocado sin enterarse de que había otro candidato. Y cuál ganaba era arbitrario: `for...in` itera primero las claves tipo *array index* en orden numérico ascendente, no en el orden del Sheet. Se replicó el criterio de `Articulos/articulos.html` (`findByBarcode()` + `openSelector()`).

- **Índice inverso `articuloBarcodeIndex`** — `{ barcodeNormalizado: [codigos] }`, armado en `cargarSheets()` junto a `sheetsAllItems` y reseteado con él (si no, `force = true` acumularía entradas viejas). Reemplaza los dos barridos lineales sobre `sheetsData` que hacía cada escaneo. `actualizarStock()` no toca `codigoBarras`, así que no lo invalida.
- **`articuloBuscarCandidatos(texto)`** devuelve **todos** los códigos de producto que matchean, con el mismo criterio de antes (barras exacto y, si no hay, código de producto). La comparación pasó a ser case-insensitive vía `articuloNormBarcode()` (trim + uppercase) por CODE_39/CODABAR: solo puede sumar coincidencias, nunca perderlas.
- **UI en el propio paso 1**, sin overlay nuevo: `articuloRenderCandidatos()` pinta en `#articuloList` un aviso `.articulo-multi` (sticky, con el código leído y un botón Cancelar) seguido de las filas. Reutiliza `articuloOptionHtml()` —extraído del `.map` de `articuloRenderLista`— así que elegir un candidato entra por la delegación de click que ya existía. **El CSS del aviso va scopeado a `#articuloModal`** porque `.add-item-list` se comparte con `#addItemModal`.
- **Se pausa el escáner también en el caso múltiple.** Si el decoder siguiera activo, pasados los 2500 ms del dedupe volvería a repintar la lista justo cuando el dedo va a tocar un candidato. Sale del modo (y reanuda con `articuloReanudarScanner()`) el botón Cancelar y tipear en `#articuloSearch`; `articuloCandidatos` se limpia además al elegir, al volver del paso 2 y al abrir el modal.
- Los casos de 1 y 0 candidatos quedaron idénticos (paso 2 directo / toast "Codigo no encontrado"), igual que los pasos 1-3 de `articuloOnScan` y toda la config del escáner.

## Recent Changes (2026-07-30)

### Fallback de imagen: 1er link → 4to link

La columna B del Sheet trae hasta 4 URLs separadas por coma. `cargarSheets()` guarda `imagen` (`imgPartes[0]`) e `imagenAlt` (`imgPartes[3]`) en `sheetsData`/`sheetsAllItems`, y `mapImg[nombre]` conserva el array completo. Si el primer link falla (404, permiso, host caído), `imgFallback(el, alt, phClass)` reintenta con el cuarto y recién entonces reemplaza el `<img>` por el placeholder 📷; marca `el.dataset.imgAlt = '1'` para no entrar en bucle si el alternativo también falla. `openLightbox(url, alt)` hace lo mismo con un flag local.

- Cubre las 4 listas con miniatura: items del pedido (`renderUnificado`), Agregar artículo (`renderAddItemList`), catálogo/candidatos de Buscar artículo (`articuloOptionHtml`) y la cabecera del paso 2 (`articuloSeleccionar`).
- El paso 2 usa `imgFallbackOcultar()` en vez de `imgFallback()`: ahí la miniatura no reserva espacio, así que tras agotar los dos links se oculta en lugar de dejar un placeholder.
- El `alt` se pasa vacío cuando coincide con el `src` (artículo con un solo link, o con el primero vacío y solo el cuarto cargado), para no reintentar la misma URL.
- Las cards del pedido llaman `openLightbox(this.src)`: `this.src` ya es la URL que efectivamente cargó, con el fallback aplicado. `pvOpenLightbox(nombre)` sí resuelve contra `mapImg` y pasa ambos links.
