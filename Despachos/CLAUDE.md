# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Order management system for "HomePoint" distributor. Static HTML webapp (no build tools, no bundler) that connects to Firebase Realtime Database and Google Sheets as a product catalog.

## Architecture

- **pedidos.html** — Main order management app (admin + customer facing). ~3300 lines, single-file with inline CSS/JS. Handles order creation, editing, payments, dispatch, printing, and WhatsApp messaging.
- **despachos.html** — Dispatch/packing assistant app (tablet-optimized). Single-file with inline CSS/JS. QR scanning, item packing checklist with localStorage, simplified order editing.
- **config.js** — Shared configuration: Firebase credentials (`firebaseConfig`) and Google Sheets API config (`GOOGLE_SHEETS_CONFIG` with `API_KEY`, `SPREADSHEET_ID`, `RANGO`).

## Data Layer

**Firebase Realtime Database** — `pedidos/{id}` nodes contain: `cliente` (nombre, telefono, localidad, provincia, direccion, dni, email), `items[]` (codigo, nombre, cantidad, valorU, valorC), `status`, `locked`, `pagos`, `timestamp`. Order statuses: ABIERTO → CERRADO → DESPACHADO/ENTREGADO | CANCELADO. `movimientos/{id}` tracks inventory movements (SALIDA).

**Google Sheets** (read-only catalog via Sheets API v4) — Sheet "Lista", row 2 onwards. Key columns: A=Categoria, B=Imagen URL, C=Codigo, D=Nombre, G=valorU (sale price), H=valorC (cost), K=Stock, L=Codigo de barras.

## Development

No build step. Open HTML files directly in browser or serve with any static server. Firebase and html5-qrcode are loaded via CDN. Both HTML files import `config.js` via `<script src="config.js">`.

**Firebase SDK**: v10.12.0 compat mode (`firebase-app-compat.js`, `firebase-database-compat.js`, `firebase-auth-compat.js`).

## Conventions

- All UI text in Spanish. Respond always in Spanish.
- Single-file approach: each HTML page contains all its CSS and JS inline.
- Vanilla JS only — no frameworks, no npm dependencies.
- Firebase writes use batched updates where possible (`ref.update()` with object).
- Google Sheets data is fetched once and cached in memory (maps keyed by product codigo).
- localStorage is used for client-side state that shouldn't persist to Firebase (packing checkboxes, notes, alias history).
- WhatsApp links use `https://api.whatsapp.com/send/?phone=` format with Argentine phone formatting (prefix 54, strip leading 0).
