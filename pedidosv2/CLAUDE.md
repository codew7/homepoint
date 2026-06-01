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
