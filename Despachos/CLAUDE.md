# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Order management system for "HomePoint" distributor. Static HTML webapp (no build tools, no bundler) that connects to Firebase Realtime Database and Google Sheets as a product catalog.

## Architecture

- **pedidos.html** — Main order management app (admin + customer facing). ~3300 lines, single-file with inline CSS/JS. Handles order creation, editing, payments, dispatch, printing, and WhatsApp messaging.
- **despachos.html** — Dispatch/packing assistant app (tablet-optimized). Single-file with inline CSS/JS. Features: QR scanning, item packing checklist with localStorage, real-time Firebase listener for order updates, quantity controls with arrow buttons, "Listo" toggle indicator (localStorage), PWA installation support.
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

- **Real-time updates**: Firebase `on('value', ...)` listener detects changes from other users/pedidos.html and re-renders. Stops listening when order is CANCELADO or DESPACHADO/ENTREGADO.
- **localStorage storage**:
  - `despachos_{pedidoId}.checkedItems` — packed items checkbox states (persists across sessions)
  - `despachos_{pedidoId}.comentario` — dispatch comments (not saved to Firebase)
  - `despachos_{pedidoId}.listo` — "Listo" button toggle state (true/false indicator)
- **Nota field**: Saved to Firebase as `nota` + `notaFecha` (timestamp). Same field as pedidos.html for sync, but date not displayed in despachos.
- **Quantity controls**: Custom arrow buttons (▲/▼) instead of HTML number input. Updates counter in real-time via `cambiarQty(idx, delta)`.
- **Status emoji display**: ABIERTO 📝 | CERRADO 🔒 | CANCELADO ❌ | DESPACHADO/ENTREGADO 📦.
- **Layout**: Cliente info split into 2 rows — (1) Nombre+Teléfono | (2) Pago+Entrega+Estado. Each card uses flexbox, nombre takes 2x space.
- **PWA Installation**: `manifest.json` + `sw.js` enable "Add to Home Screen" on Android/iOS. Custom install button (📲) appears in header when `beforeinstallprompt` event fires.
- **Listo button**: Acts as a true/false toggle (inactive/active states). Stored in localStorage only, not Firebase. Replaces old "Guardar Despacho" button.
- **Editable when locked**: `isBlocked` only checks status (CANCELADO/DESPACHADO/ENTREGADO), not `locked` field. Allows internal team to edit locked orders.

## Conventions

- All UI text in Spanish. Respond always in Spanish.
- Single-file approach: each HTML page contains all its CSS and JS inline.
- Vanilla JS only — no frameworks, no npm dependencies.
- Firebase writes use batched updates where possible (`ref.update()` with object).
- Google Sheets data is fetched once and cached in memory (maps keyed by product codigo).
- localStorage is used for client-side state that shouldn't persist to Firebase (packing checkboxes, comments, toggle states, alias history).
- WhatsApp links use `https://api.whatsapp.com/send/?phone=` format with Argentine phone formatting (prefix 54, strip leading 0).
- Emoji maps use lowercase string matching (e.g., `includes('correo')` matches "Correo Argentino").
