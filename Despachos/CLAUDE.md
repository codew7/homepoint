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

**Firebase Realtime Database** — `pedidos/{id}` nodes contain: `cliente` (nombre, telefono, localidad, provincia, direccion, dni, email), `items[]` (codigo, nombre, cantidad, valorU, valorC), `status`, `locked`, `pagos`, `timestamp`. Order statuses: ABIERTO → CERRADO → DESPACHADO/ENTREGADO | CANCELADO. `movimientos/{id}` tracks inventory movements (SALIDA).

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
  - `despachos_{pedidoId}.checkedItems` — packed items checkbox states (persists across sessions)
  - `despachos_{pedidoId}.comentario` — dispatch comments (not saved to Firebase)
  - `despachos_{pedidoId}.listo` — "Listo" button toggle state (true/false indicator)
- **Nota field**: Saved to Firebase as `nota` + `notaFecha` (timestamp). Same field as pedidos.html for sync, but date not displayed in despachos.
- **Quantity controls**: Custom arrow buttons (▼/▲) in pill-shaped container. Updates counter in real-time via `cambiarQty(idx, delta)`.
- **Status badges**: Color-coded by status — ABIERTO (blue) | CERRADO (amber) | CANCELADO (red) | DESPACHADO/ENTREGADO (green).
- **Progress bar**: Visual indicator at top showing % of items packed (changes to green at 100%).
- **Layout**: Cliente info split into 2 rows — (1) Nombre+Teléfono | (2) Pago+Entrega+Estado. Each card uses flexbox with hover shadows.
- **PWA Installation**: `manifest.json` + `sw.js` enable "Add to Home Screen" on Android/iOS. Custom install button (📲) appears in header when `beforeinstallprompt` event fires.
- **Listo button**: Acts as a true/false toggle (inactive/active states). Stored in localStorage only, not Firebase.
- **Editable when locked**: `isBlocked` only checks status (CANCELADO/DESPACHADO/ENTREGADO), not `locked` field. Allows internal team to edit locked orders.
- **Checkbox animation**: Bouncing effect (`scale(.7)` → `1.15` → `1`) when item is marked as packed.
- **Staggered item load**: Items fade in with 30ms delay between each for visual flow.

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
- Action buttons with hover transitions

**Item Cards**:
- Left border accent (transparent → green when checked)
- Image thumbnail with hover zoom and lightbox support
- Monospace code display with subtle styling
- Checkbox with spring bounce animation on check
- Quantity controls in bordered pill shape
- Delete button with danger color on hover

## Conventions

- All UI text in Spanish. Respond always in Spanish.
- Single-file approach: each HTML page contains all its CSS and JS inline.
- Vanilla JS only — no frameworks, no npm dependencies.
- Firebase writes use batched updates where possible (`ref.update()` with object).
- Google Sheets data is fetched once and cached in memory (maps keyed by product codigo).
- localStorage is used for client-side state that shouldn't persist to Firebase (packing checkboxes, comments, toggle states, auth overlays).
- WhatsApp links use `https://api.whatsapp.com/send/?phone=` format with Argentine phone formatting (prefix 54, strip leading 0).
- Emoji maps use lowercase string matching (e.g., `includes('correo')` matches "Correo Argentino").
- CSS animations use CSS custom properties for timing (`--ease-out`, `--ease-spring`) for consistency.
- z-index scale: auth overlay (99999) > modals (800-900) > header/footer (10) > content (default).
