# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Order management system for "HomePoint" distributor. Static HTML webapp (no build tools, no bundler) that connects to Firebase Realtime Database and Google Sheets as a product catalog.

## Architecture

- **pedidos.html** — Main order management app (admin + customer facing). ~3300 lines, single-file with inline CSS/JS. Handles order creation, editing, payments, dispatch, printing, and WhatsApp messaging.
- **despachos.html** — Dispatch/packing assistant app (tablet-optimized). Single-file with inline CSS/JS. Features: Firebase authentication (requires login), QR scanning, item packing checklist with localStorage, real-time Firebase listener for order updates, quantity controls with arrow buttons, "Listo" toggle indicator (localStorage), PWA installation support. Modern Clean Industrial UI design with Plus Jakarta Sans typography, progress bar, and glassmorphism effects.
- **manifest.json** — Web App Manifest for PWA installation (Android/iOS/Windows).
- **sw.js** — Service worker for PWA (caches app shell, network-first strategy for performance).
- **config.js** — Shared configuration: Firebase credentials (`firebaseConfig`) and Google Sheets API config (`GOOGLE_SHEETS_CONFIG` with `API_KEY`, `SPREADSHEET_ID`, `RANGO`).

## Data Layer

**Firebase Realtime Database** — `pedidos/{id}` nodes contain: `cliente` (nombre, telefono, localidad, provincia, direccion, dni, email), `items[]` (codigo, nombre, cantidad, valorU, valorC, listo='y'|'n'), `status`, `locked`, `pagos`, `timestamp`, `enPreparacion` ('si' | 'listo'), `nota`, `notaFecha`. Order statuses: ABIERTO → CERRADO → DESPACHADO/ENTREGADO | CANCELADO. `movimientos/{id}` tracks inventory movements (SALIDA).

**Google Sheets** (read-only catalog via Sheets API v4) — Sheet "Lista", row 2 onwards. Key columns: A=Categoria, B=Imagen URL, C=Codigo, D=Nombre, G=valorU (sale price), H=valorC (cost), K=Stock, L=Codigo de barras.

## Development

No build step. Open HTML files directly in browser or serve with any static server. Firebase and html5-qrcode are loaded via CDN. Both HTML files import `config.js` via `<script src="config.js">`.

**Firebase SDK**: v10.12.0 compat mode (`firebase-app-compat.js`, `firebase-database-compat.js`, `firebase-auth-compat.js`).

## Despachos.html Features

### Authentication
- **Firebase Auth required**: Uses `firebase.auth().onAuthStateChanged(user => {...})` to gate access. Unauthenticated users are redirected to `../Admin/login.html?redirect=<URL>` with return link.
- **Loading overlay**: Fixed position div with spinner (`z-index: 99999`) blocks UI interaction while Firebase verifies auth state. Fade-out transition (`.3s ease-out`) when auth resolves.
- **Reuses existing login page**: Auth flows through `../Admin/login.html` (email/password login with support for `?redirect=` parameter). No separate auth UI in despachos.html.

### Core Features
- **Real-time updates**: Firebase `on('value', ...)` listener detects changes from other users/pedidos.html and re-renders. Stops listening when order is CANCELADO or DESPACHADO/ENTREGADO.
- **localStorage storage**:
  - `despachos_{pedidoId}.comentario` — dispatch comments (not saved to Firebase)
  - `despachos_{pedidoId}.tamano` — package size (not saved to Firebase)
  - `despachos_{pedidoId}.peso` — package weight (not saved to Firebase)
- **Nota field**: Saved to Firebase as `nota` + `notaFecha` (timestamp). Same field as pedidos.html for sync, but date not displayed in despachos.
- **Quantity controls**: Custom arrow buttons (▼/▲) in pill-shaped container. Updates counter in real-time via `cambiarQty(idx, delta)`.
- **Status badges**: Color-coded by status — ABIERTO (blue) | CERRADO (amber) | CANCELADO (red) | DESPACHADO/ENTREGADO (green).
- **Progress bar**: Single-line layout showing "PROGRESO [====---] 100%" at top. Visual indicator with colored fill (amber → green at 100%). Updates in real-time as items are checked.
- **Layout**: Cliente info split into 2 rows — (1) Nombre+Teléfono | (2) Pago+Entrega+Estado. Each card uses flexbox with hover shadows.
- **PWA Installation**: `manifest.json` + `sw.js` enable "Add to Home Screen" on Android/iOS. Custom install button (📲) appears in header when `beforeinstallprompt` event fires.
- **Item packing states**: Each item has a `listo` field in Firebase ('y' = packed, 'n' = pending). Checkbox state is read/written in real-time from Firebase, not localStorage. Allows multi-device sync.
- **Item grouping**: Items are grouped into two sections: "Pendientes" (listo ≠ 'y') displayed first, "Listos" (listo === 'y') displayed below. Reorganizes automatically when checkbox state changes.
- **Listo button**: Acts as a true/false toggle (inactive/active states) for `enPreparacion` field. Controls packing workflow (si/listo).
- **Editable when locked**: `isBlocked` only checks status (CANCELADO/DESPACHADO/ENTREGADO), not `locked` field. Allows internal team to edit locked orders.
- **Checkbox animation**: Bouncing effect (`scale(.7)` → `1.15` → `1`) when item is marked as packed.
- **Staggered item load**: Items fade in with 30ms delay between each for visual flow.
- **enPreparacion field**: Written to Firebase the first time any item checkbox is checked (`enPreparacion: 'si'`). Toggled to `'listo'` via the "Terminar" button in the footer. The realtime listener detects external changes to this field and updates the button accordingly.
- **Pedidos panel badge**: Orders with `enPreparacion === 'si'` show an "⚙️ En prep." amber badge in the pedidos list panel.
- **Terminar button**: Third footer action button (alongside "+ Agregar" and "Impresion"). Default state: neutral border/grey text labeled "Terminar". When `enPreparacion === 'listo'`: green background, white text, labeled "Listo". Clicking toggles between `'listo'` and `'si'` in Firebase. All three footer buttons use `flex: 1` for equal symmetric widths.

## Design System (Despachos.html)

**Aesthetic**: Clean Industrial — premium warehouse management tool with modern, functional design.

**Typography**:
- UI: `Plus Jakarta Sans` (geometric, distinctive, readable)
- Codes/numbers: `JetBrains Mono` (monospace, high legibility)

**Color Palette** (CSS custom properties):
- Background: `#f0f0ee` (warm white)
- Surface: `#ffffff` (cards/modals)
- Text primary: `#1a1a1a`, secondary: `#6b6b6b`, muted: `#9e9e9e`
- Accent: `#e67e22` (ámbar, primary action)
- Success: `#2d9f6f` (green, packed items)
- Danger: `#d94f4f` (red, delete)
- Header gradient: `#0f172a` → `#1e293b` (dark blue)

**Visual Details**:
- Border radius: `var(--radius-sm)` 8px | `--radius-md` 14px | `--radius-lg` 20px | `--radius-xl` 28px
- Shadows: subtle (`--shadow-sm`) to dramatic (`--shadow-lg`), with glow effects on accent elements
- Animations: `var(--ease-out)` cubic-bezier(.22, 1, .36, 1) for snappy transitions
- Glassmorphism: Footer with `backdrop-filter: blur(16px)` for frosted glass effect
- Loading overlay: Full-screen spinner with `z-index: 99999` during auth verification

**Header**:
- Gradient background with subtle vertical line texture pattern
- Brand mark (orange box with "D" logo)
- Glassmorphic search input with focus states
- Search displays client name (not order ID) for easy recognition. Recent orders dropdown shows client name + ID.
- Action buttons with hover transitions

**Item Cards**:
- Left border accent (transparent → green when checked)
- Image thumbnail with hover zoom and lightbox support
- Monospace code display with subtle styling
- Checkbox with spring bounce animation on check
- Quantity controls in bordered pill shape
- Delete button with danger color on hover

**Print Documents**:
- **Factura (Invoice)**: Minimized margins (`@page { margin: 0; }`), compact padding (8px 6px). Displays order details, items, and totals.
- **Rótulo (Label)**: Minimized margins, all fields on single lines (white-space: nowrap). Displays recipient info, sender info, QR code, and delivery type. Fields use text-overflow: ellipsis if content exceeds width.

## Conventions

- All UI text in Spanish. Respond always in Spanish.
- Single-file approach: each HTML page contains all its CSS and JS inline.
- Vanilla JS only — no frameworks, no npm dependencies.
- Firebase writes use batched updates where possible (`ref.update()` with object).
- Google Sheets data is fetched once and cached in memory (maps keyed by product codigo).
- localStorage is used for client-side state that shouldn't persist to Firebase (dispatch comments, tamano, peso, faltantes list).
- WhatsApp links use `https://api.whatsapp.com/send/?phone=` format with Argentine phone formatting (prefix 54, strip leading 0).
- Emoji maps use lowercase string matching (e.g., `includes('correo')` matches "Correo Argentino").
- CSS animations use CSS custom properties for timing (`--ease-out`, `--ease-spring`) for consistency.
- z-index scale: auth overlay (99999) > modals (800-900) > header/footer (10) > content (default).

## Recent Changes (Session: 2026-03-12)

### Item Packing State Management
- **Migrated checkbox storage from localStorage to Firebase**: Each item now has a `listo` field ('y' = packed, 'n' = pending) stored in Firebase `items[]` array.
- **Real-time synchronization**: Checkbox states sync across devices via Firebase listener. Changes are written to `items` array and persisted immediately.
- **Implementation**:
  - `isItemChecked(codigo)` reads from `pedidoActual.items` (Firebase data)
  - `toggleCheck(idx, checked)` writes `listo: 'y'|'n'` to Firebase and calls `renderPedido()` immediately for UI reorganization

### Item Grouping
- **Two-section layout**: Items now grouped into "Pendientes" (listo ≠ 'y', displayed first) and "Listos" (listo === 'y', displayed below).
- **Dynamic reorganization**: When checkbox state changes, items automatically move between groups via `renderPedido()`.
- **Group headers**: Each section displays a count badge (e.g., "Pendientes (5)", "Listos (3)").

### User Interface Improvements
- **Search bar displays client name**: Search input now shows client name instead of order ID for better readability. Works for all selection methods (QR, dropdown, panel, URL parameter).
  - Implemented via `pedidoInput.value = nombreCliente` in `cargarPedido()`.
  - Recent orders dropdown includes `data-nombre` attribute for quick lookup.

- **Progress bar single-line layout**: Progress indicator now displays in one line: `PROGRESO [====---] 100%`
  - `.progress-section` uses `display: flex` with `align-items: center` and `gap: 12px`
  - `.progress-bar-track` uses `flex: 1` to fill available space
  - Bar height reduced to 3px for cleaner appearance

### Print Document Enhancements
- **Minimized print margins**: Both factura and rótulo now use `@page { margin: 0; }` for edge-to-edge printing.
  - Factura body padding: 4px | recibo-box padding: 8px 6px
  - Rótulo grid padding: 2mm | gap between rótulos: 2mm

- **Rótulo field line wrapping prevention**: All recipient/sender fields now stay on single lines using:
  - `.rotulo-field`: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`
  - `.rotulo-value`: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: inline-block; max-width: calc(100% - 110px);`
  - Long values are truncated with "..." rather than wrapping to new lines

### Technical Notes
- Checkbox animations and progress updates still work correctly with new Firebase-backed storage
- Real-time listener (`activarListenerTiempoReal`) automatically detects item changes and re-renders when external edits occur
- `actualizarProgreso()` continues to work unchanged, filtering `items` based on new Firebase `listo` field
