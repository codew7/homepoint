# Admin · Artículos (HomePoint)

Módulo de administración de artículos del sistema HomePoint. Son páginas HTML estáticas autocontenidas (HTML + CSS + JS inline, sin build system, sin `package.json`, sin framework): se abren directamente en el navegador o se sirven como archivos estáticos desde cualquier servidor HTTP simple.

Todas las vistas comparten:
- **Firebase** (Auth + Realtime Database + Storage, proyecto `pedidos-87064`) como backend principal, configurado en `config.js`.
- **Google Sheets** (API REST, sin librería cliente) como fuente de stock en vivo.
- El mismo esqueleto visual (fuentes Plus Jakarta Sans / JetBrains Mono, paleta de variables CSS, topbar con indicador de conexión) copiado y adaptado en cada archivo.
- Pantalla de login (Firebase Auth email/password) que bloquea la app hasta autenticarse. No hay roles: cualquier usuario autenticado tiene acceso total a todas las vistas.

## Índice de archivos

| Archivo | Función |
|---|---|
| `config.js` | Credenciales compartidas (Firebase + Google Sheets) |
| `cors.json` | Configuración CORS del bucket de Storage (no se sirve; se aplica con `gcloud`) |
| `articulos.html` | Alta/edición de artículos (wizard) + tabla editable |
| `agregarImg.html` | Utilidad de backfill del campo `Img` |
| `asignarImagen.html` | Asignar foto (cámara) a artículos sin imagen |
| `imprimirEtiqueta.html` | Selección de artículos + generación de etiquetas PDF |
| `descripcion.html` | Generación de descripciones de producto con IA (Gemini) |

---

## `config.js`

Archivo de configuración compartido, incluido con `<script src="config.js">` en todos los HTML.

- `firebaseConfig`: credenciales del proyecto Firebase `pedidos-87064` (Realtime Database, Storage, Auth).
- `GOOGLE_SHEETS_CONFIG`: `API_KEY` + `SPREADSHEET_ID` + `RANGO` (`Lista!A2:Z`) usados para leer stock desde una Google Sheet vía la API REST de Sheets (`GET /v4/spreadsheets/{id}/values/{range}?key=...`), sin necesidad de OAuth porque la hoja es pública para lectura con esa key.

**Contiene credenciales reales.** El propio archivo trae un comentario de advertencia para agregarlo a `.gitignore` y no subirlo a repos públicos.

---

## `cors.json`

Configuración CORS del bucket de Storage `pedidos-87064.firebasestorage.app`. **No es un archivo que use la app**: no se sirve ni se referencia desde ningún HTML. Es la config que se aplica al bucket con `gcloud` para que el navegador pueda *leer los bytes* de las fotos por JS.

Hace falta solo para el botón "Usar la foto del artículo" de `descripcion.html`. Mostrar imágenes en un `<img>` (miniaturas de las tablas) nunca necesitó CORS; leerlas con `fetch`/canvas sí.

```bash
gcloud storage buckets update gs://pedidos-87064.firebasestorage.app --cors-file=cors.json
```

Aplicado el 16/07/2026 desde Cloud Shell (`gcloud` no está instalado localmente). Notas:

- La lista de `origin` **reemplaza** a la anterior por completo, no se acumula: al agregar un dominio nuevo hay que volver a listar todos.
- Origenes actuales: `https://homepoint-admin.dev.ar` (producción) y `localhost` en los puertos 8080/5000/8000 (desarrollo).
- Solo habilita `GET`. No expone nada nuevo: esas URLs de descarga ya son accesibles para cualquiera que tenga el token; el header solo autoriza a qué páginas pueden leerlas por JS.
- Verificar el estado actual: `gcloud storage buckets describe gs://pedidos-87064.firebasestorage.app --format="json(cors_config)"`.
- Chrome cachea las respuestas fallidas de CORS: después de aplicar cambios, recargar con Ctrl+Shift+R.

---

## `articulos.html`

Vista principal: menú de inicio + wizard de alta/edición de artículo + tabla de artículos existentes (editable inline).

### Menú de inicio
Cinco accesos: Registrar nuevo artículo, Ver artículos registrados, Imprimir etiquetas de precio, Asignar imagen a artículos, Generar descripciones (estas últimas tres navegan a los otros `.html` de este directorio).

### Wizard de alta/edición (4 pasos)
1. **Código de barras** — escaneo con cámara (`html5-qrcode`) o ingreso manual. Si el código ya existe se ofrece editar el artículo encontrado (o elegir entre varios si hay coincidencias); si no existe, se puede dar de alta sin código de barras o buscar por nombre.
2. **Foto** — captura cuadrada con la cámara del dispositivo (`getUserMedia`, con flip frontal/trasera) o selección de archivo; se recorta a cuadrado en un `<canvas>` antes de subir.
3. **Datos** — nombre, keywords, categoría (cargada desde una hoja de Google Sheets de categorías), costo en USD, % de ganancia, cantidad a ingresar (se registra como movimiento de stock tipo `ENTRADA`), disponibilidad. Muestra el precio ARS calculado en vivo (dólar oficial/blue vía `bluelytics.com.ar` + un valor "estático" editable guardado en Firebase) y el stock actual leído de Google Sheets.
4. **Revisión y guardado** — resumen de todos los campos antes de confirmar.

### Guardado (`guardarArticulo()`)
Escritura atómica con `db.ref().update({...})` sobre múltiples rutas a la vez:
- `articulos/{codigo}` — el registro completo del artículo.
- `movimientos/{pushKey}` — solo si se ingresó una cantidad > 0, con `tipo: 'ENTRADA'`.

Esto garantiza todo-o-nada: si falla la escritura no queda un artículo sin su movimiento de stock inicial (o viceversa). Después de escribir, se relee (`once('value')`) para verificar que quedó persistido antes de mostrar la pantalla de éxito.

Al editar, si el usuario no ingresa cantidad nueva se preserva la `Cantidad` previa (no se pisa con 0), y el campo `Img` (imagen alternativa gestionada desde `asignarImagen.html`) se preserva explícitamente porque el `update` reemplaza el nodo completo del artículo.

### Tabla de artículos
Lista paginada, con:
- Búsqueda por nombre/código, filtro de "artículos antiguos" (por `Timestamp`).
- Modo edición inline activable (`editFlag`) que habilita inputs por celda; guardado fila por fila (`saveRow`) o borrado (`deleteRow`, que también borra la foto en Storage).
- Toggle de disponibilidad por fila con guardado inmediato (`saveDisponible`).
- Columna de precio ARS y de stock (leído de Google Sheets) recalculadas en vivo.
- Botón de sincronización manual contra la hoja de Sheets (`syncSheet`).

### Modelo de datos — `articulos/{codigo}`

| Campo | Tipo | Notas |
|---|---|---|
| `Codigo` | string | clave del nodo, autogenerado en altas nuevas |
| `CodigoBarras` | string | uno o varios códigos separados por coma |
| `Foto` | string (URL) | `articulos/{codigo}.jpg` en Firebase Storage |
| `Img` | string (URL) | imagen alternativa, gestionada por `asignarImagen.html`; hay que preservarla al editar |
| `Nombre` | string | siempre en `UPPERCASE` |
| `Keywords` | string | |
| `Categoria` | string | |
| `CostoUSD` | number | redondeado a 2 decimales |
| `PrecioUSD` | number | calculado a partir de costo + % ganancia |
| `GananciaPorc` | number | entero |
| `Cantidad` | number | snapshot de stock al momento de alta/edición (no es la fuente de verdad de stock; eso es Sheets) |
| `Disponible` | boolean | |
| `Descripcion` | string | opcional, escrita por `descripcion.html` |
| `Timestamp` | number | `firebase.database.ServerValue.TIMESTAMP` |

### Otros nodos de Firebase usados
- `movimientos/{pushKey}` — historial de entradas/salidas de stock (`timestamp`, `codigo`, `nombre`, `cantidad`, `tipo`).
- `dolar/blue` — valor estático del dólar (editable desde la topbar) usado para calcular `PrecioARS` en toda la app.

---

## `agregarImg.html`

Utilidad puntual de mantenimiento de datos: recorre los artículos existentes en `articulos/{codigo}` y agrega/normaliza el campo `Img` donde falte. No usa Firebase Storage (solo Auth + Database). Pensada para ejecutarse una vez como backfill, no como parte del flujo normal de uso.

---

## `asignarImagen.html`

Flujo dedicado a fotografiar y asignar imágenes a artículos que no tienen foto (o que necesitan actualizarla), sin pasar por todo el wizard de alta. Usa Firebase Auth + Database + Storage.

- Toma la foto con la cámara del dispositivo, la sube a `articulos/{codigo}.jpg` en Storage.
- Actualiza el nodo del artículo con `ref.update({ Foto: fotoUrl, Timestamp: ... })` — a diferencia del guardado del wizard, acá es un `update` parcial (no reemplaza el nodo completo), por lo que no hace falta preservar otros campos manualmente.

---

## `imprimirEtiqueta.html`

Generación de etiquetas de precio en PDF para imprimir.

- No usa Firebase: lee los datos de artículos (nombre, precio, código, etc.) directamente desde la Google Sheet configurada en `GOOGLE_SHEETS_CONFIG` vía `fetch` a la API REST de Sheets, ajustando el rango configurado a la columna `L` (`RANGO_OPT`).
- Permite escanear/buscar artículos y seleccionarlos para incluir en el PDF.
- Genera el PDF en el cliente con `jsPDF` (CDN `jspdf@2.5.2`).
- También incluye `html5-qrcode` para poder ubicar artículos escaneando su código de barras.

---

## `descripcion.html`

Genera la descripción de un producto a partir de una foto de su packaging, usando la API de **Google Gemini** (multimodal), y la guarda en el campo `Descripcion` del artículo.

- Usa Firebase Auth + Database. La foto que se manda a Gemini no se persiste en Firebase; Storage solo se lee (nunca se escribe) cuando se usa la foto ya existente del artículo — ver más abajo.
- **Fuentes de imagen** (las tres desembocan en `procesarYGenerar()`, que redimensiona a 1024px y llama a Gemini): cámara del dispositivo, archivo de la galería, o **"Usar la foto del artículo"** — botón opcional que aparece en el visor solo si el artículo tiene el campo `Foto` (el campo `Img` se ignora deliberadamente como fuente). Descarga la URL de Storage con `fetch` y la trata como una captura más. Requiere CORS habilitado en el bucket (ver `cors.json`).
- **API key de Gemini a cargo del usuario**: no hay ninguna key en el código. Se pide por modal (`#keyModal`) y se guarda en `localStorage` bajo `geminiApiKey`, es decir, por navegador — hay que cargarla una vez en cada dispositivo. El modal se abre solo al terminar `init()` si no hay key, y también cuando Gemini falla por key (`NO_KEY`/`BAD_KEY`/`NO_MODEL`), en cuyo caso al guardar una key nueva se reintenta automáticamente la generación pendiente. Se puede editar o borrar cuando sea desde el botón de la topbar (`#keyBtn`), que se pinta en lime (`.icon-btn.keyset`) cuando hay key cargada. A diferencia de `config.js`, esto mantiene la key fuera del archivo.
- Selector de modelo en la topbar (Auto o manual) entre varios candidatos de Gemini (`gemini-flash-lite-latest`, `gemini-flash-latest`, `gemini-2.0-flash-lite`, `gemini-2.0-flash`), con:
  - Reintento automático probando el siguiente candidato si uno devuelve 404 (modelo deprecado) o 429/503 (saturado/límite).
  - Cacheo en `localStorage` del modelo que funcionó, versionado con `MODEL_PREF_VER` para poder invalidar el caché si cambia el criterio de selección.
  - `thinkingConfig.thinkingBudget: 0` en los modelos que lo soportan, para evitar la latencia extra del "thinking" en una tarea simple de lectura de etiqueta.
- El prompt (`buildPrompt`) le pide a Gemini un texto en español con dos secciones fijas — `Descripción:` (párrafo comercial breve) e `Info:` (lista de datos visibles en el packaging: marca, contenido, modelo, ingredientes, etc.) — sin inventar datos que no estén en la imagen.
- Al guardar, hace `ref.update({ Descripcion: texto, Timestamp: ... })` sobre el nodo del artículo (update parcial, no reemplaza el resto de los campos).

---

## Patrones comunes a replicar al modificar cualquier vista

- **Chequeo de conexión antes de operaciones críticas**: `db.ref('.info/connected')` mantenido en una variable + `verificarConexionFirebase(timeoutMs)` antes de escribir.
- **Timeouts en promesas de Firebase**: `conTimeout(promise, ms, msg)` envuelve cualquier `once('value')` o `update()` para evitar cuelgues silenciosos si se corta la conexión a mitad de una operación.
- **Bloqueo de cierre accidental**: `beforeunload` con `preventDefault()` mientras `procesoCriticoEnEjecucion` es `true`, para avisar si el usuario intenta cerrar la pestaña durante un guardado.
- **`escapeHtml()`** antes de insertar cualquier dato de usuario/Firebase en el DOM vía `innerHTML`.
- **Sin build step**: los cambios se prueban recargando el HTML directamente en el navegador (o sirviéndolo con cualquier servidor estático). No hay transpilación, módulos ES ni linter configurado.
