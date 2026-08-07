# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**SoundBoard Showroom** — Web app de avisos de audio programados para showrooms. Stack obligatorio: HTML + CSS + JavaScript vanilla (ES Modules nativos), Firebase Realtime Database + Storage vía CDN compat SDK, Web Audio API nativa. **Sin npm, sin Node, sin bundlers, sin frameworks.** Compatible con cualquier hosting estático.

## Comandos

No hay build, lint, ni test suite. El proyecto se sirve como archivos estáticos:

```powershell
# Servidor local (cualquiera funciona, sólo no abrir con file:// porque rompe ES Modules)
python -m http.server 5500
# o
npx serve .
```

Deploy a Firebase Hosting:

```powershell
firebase deploy --only hosting
```

## Arquitectura

Dos páginas (`index.html` dashboard, `upload.html` subida) que comparten los mismos módulos JS bajo `js/`. Cada módulo se carga como `<script type="module">` y Firebase compat SDK se carga **antes** vía CDN para que `window.firebase` esté disponible cuando los módulos se inicialicen.

### Flujo de datos

```
Firebase Realtime DB  ──on('value')──►  realtime-db.js  ──►  app.js (state.audios)
                                                              │
                                                              ├──►  scheduler.syncAudios()  ──tick 1s──►  audioPlayer.play()
                                                              │                                                │
                                                              └──►  ui.renderAudioGrid() / refreshAllCardStates()
                                                                                                              │
Firebase Storage  ──fetch(storageUrl)──►  audioPlayer.bufferCache  ◄──────────────────────────────────────────┘
```

- **`realtime-db.js`** es la única capa que toca DB. Cualquier nuevo acceso debe ir acá. `listenAudios` ordena por `createdAt`.
- **`play-log.js`** historial reciente **sólo en memoria** (no se persiste): `logPlay` agrega al frente y poda a 10 entradas; `listenPlayLog` notifica a los suscriptores. Se reinicia al recargar la página — a propósito, no requiere Firebase.
- **`audio-player.js`** mantiene una sola `AudioContext` y un `masterGain`. Cada audio se reproduce vía `BufferSource → GainNode(volume audio) → masterGain → destination`. Si hay algo sonando, los siguientes `play()` van a `this.queue` y se reproducen secuencialmente (no concurrentemente). El cache (`bufferCache`) se llena en la primera descarga y se invalida en delete.
- **`scheduler.js`** corre un `setInterval` de 1s. Para **horarios fijos** usa `lastFixedFire` map con clave `"YYYY-M-D HH:MM"` para evitar disparos duplicados dentro del mismo minuto. Para **cíclico** mantiene `cyclicNextRun` map con timestamp absoluto del próximo disparo, recalculado cada vez que cambian los schedules de un audio (`_schedulesChanged` compara via `JSON.stringify`). `getNextRun(id)` calcula la próxima reproducción combinando ambos modos — se llama cada segundo desde `app.js` para refrescar el label "próx. ..." en cada card.
- **`ui.js`** hace render **diferencial** (no `innerHTML` global): mantiene cards existentes y sólo crea/actualiza/elimina las que cambiaron por id. `refreshCardState` actualiza sólo estado visual (playing indicator, status badge, next run) sin tocar el DOM estructural — se invoca cada segundo y en cada evento del player.
- **`app.js`** orquesta todo: instala listeners de DB → scheduler.syncAudios → render. También maneja el modal de scheduler (estado local en `state.fixedTimes`, `state.daysOfWeek`, etc.) y el **gate de activación de audio** (`#audio-gate`): overlay visible al cargar que desbloquea el `AudioContext` con `audioPlayer.unlock()` en el click del operador. Es un requisito inviolable del navegador (autoplay policy): sin un gesto previo, Web Audio no emite sonido. Si una reproducción programada no puede arrancar, `audio-player.js` emite un evento `locked` y `app.js` vuelve a mostrar el gate.

### Modelo en Realtime Database

```
audios/{audioId}: { name, description, storageUrl, fileName, storagePath, duration,
                    isActive, volume (0-1), color, schedules[], createdAt }
```

El historial de reproducción **no se almacena** en la DB; vive en memoria (`play-log.js`).

`schedules` es un array que puede contener uno o ambos:
- `{ type: 'fixed', times: ['HH:MM',...], daysOfWeek: [0..6] }` (0 = domingo)
- `{ type: 'cyclic', intervalMinutes: N }`

`storagePath` es crítico: se usa para borrar el blob de Storage cuando se elimina un audio (sin él, sólo se borra el nodo de DB y queda el archivo huérfano).

### Diseño visual

Variables CSS en `:root` (en `main.css`) definen toda la paleta. Dark mode único. No cambiar colores con valores hardcoded — usar las variables `--color-*`. Las cards usan `--audio-color` setteado inline por card a partir de `audio.color`, lo que pinta la barra superior y el botón de play sin CSS adicional.

## Restricciones inviolables

- **Nada de npm/Node/React/bundlers.** Todo debe funcionar abriendo los archivos desde un hosting estático.
- **Realtime Database, no Firestore.**
- **Sólo Web Audio API nativa** — no librerías de audio de terceros (Howler, Tone.js, etc.).
- **CDN únicamente para librerías externas** (Firebase compat SDK, Google Fonts).
- Bundle propio (HTML + CSS + JS escritos por nosotros) debe quedarse `< 150KB`.
- Las credenciales de Firebase están embebidas a propósito en `js/firebase-init.js` — el showroom funciona sin auth.

## Decisiones no obvias

- **Compat SDK** (`firebase-app-compat.js` etc.) en lugar del modular: permite cargar Firebase vía `<script>` tag sin import maps, manteniendo los módulos JS propios como ES Modules.
- **No se usa Firestore** explícitamente; las queries de tipo "ordenar por fecha" se hacen en cliente tras leer el snapshot completo. El volumen de datos esperado (decenas de audios, 10 logs) lo justifica.
- **Cola secuencial** en lugar de mezcla: dos audios programados a la misma hora suenan uno tras otro, no superpuestos. Cambiar esto requiere que `audioPlayer.play()` no pushee a `queue` cuando hay algo sonando.
- **`lastFixedFire`** evita que un horario `18:00` dispare 60 veces durante el minuto en que `currentTime === '18:00'`. La clave incluye fecha para permitir disparos en días siguientes.
