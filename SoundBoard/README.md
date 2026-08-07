# SoundBoard Showroom

Web app de avisos de audio programados para entornos de showroom. Sin npm, sin frameworks: HTML + CSS + JavaScript vanilla, con Firebase Realtime Database y Firebase Storage.

## Estructura del proyecto

```
/
├── index.html              Dashboard principal
├── upload.html             Subida de audios
├── css/
│   ├── main.css            Variables, layout y tipografía
│   └── components.css      AudioCard, modales, toasts, sliders
├── js/
│   ├── firebase-init.js    Inicialización de Firebase (compat SDK vía CDN)
│   ├── realtime-db.js      Lectura/escritura/escucha en Realtime Database
│   ├── audio-player.js     Web Audio API, caché en memoria, cola
│   ├── scheduler.js        Horarios fijos + modo cíclico
│   ├── ui.js               Render dinámico, AudioCards, toasts
│   ├── app.js              Bootstrap del dashboard
│   └── upload.js           Lógica de carga + preview
└── README.md
```

## Despliegue

Cualquier hosting estático funciona: Firebase Hosting, GitHub Pages, Netlify, Vercel, o un simple servidor HTTP.

### Opción A — Firebase Hosting

```bash
firebase login
firebase init hosting
# directorio público: . (raíz del proyecto)
# SPA: NO
firebase deploy --only hosting
```

### Opción B — Servidor HTTP local

```bash
# Python 3
python -m http.server 5500

# o con Node (sin instalar npm packages)
npx serve .
```

Luego abrir `http://localhost:5500`.

> No abrir `index.html` con `file://`: los ES Modules y Firebase Storage requieren protocolo `http(s)://`.

## Configuración de Firebase

Las credenciales ya están embebidas en `js/firebase-init.js`. En la consola de Firebase configurá:

### Realtime Database — reglas

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

### Storage — reglas

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /audios/{allPaths=**} {
      allow read: if true;
      allow write: if request.resource.size < 20 * 1024 * 1024
                   && request.resource.contentType.matches('audio/.*');
    }
  }
}
```

### CORS de Storage (si el navegador bloquea la descarga del audio)

Guardá esto como `cors.json`:

```json
[
  {
    "origin": ["*"],
    "method": ["GET"],
    "maxAgeSeconds": 3600
  }
]
```

Y aplicalo con gsutil:

```bash
gsutil cors set cors.json gs://sound-communicator.firebasestorage.app
```

## Uso

1. Abrí el dashboard (`index.html`).
2. Click en **Subir audio** → arrastrá un MP3/WAV/OGG/M4A (máx. 20MB).
3. Completá nombre, descripción, color y volumen inicial → **Subir**.
4. Volvés al dashboard y verás la card del nuevo audio.
5. Click en el icono de calendario para configurar:
   - **Horarios fijos:** una o varias horas del día (con días de la semana).
   - **Modo cíclico:** cada X minutos de forma continua.
6. El toggle a la derecha activa/desactiva la programación de ese audio.
7. La barra inferior muestra reloj, volumen general y cantidad de audios activos.

## Notas técnicas

- **AudioContext** se desbloquea con el primer click/tecla del usuario (requisito de los navegadores).
- Los **buffers de audio** se cachean en memoria tras la primera descarga: las siguientes reproducciones son instantáneas.
- Si dos audios coinciden en horario, se reproducen **en secuencia** (cola interna del player).
- El **volumen general** se persiste en `localStorage`; el volumen por audio en Realtime Database.
- El **historial** se limita a las últimas 10 reproducciones.
- El listado se sincroniza en tiempo real con `on('value', ...)`: si subís un audio desde otra pestaña aparece automáticamente.

## Restricciones

- Sin npm, sin Node, sin bundlers. Funciona abriendo los archivos desde un hosting estático.
- Probado en Chrome/Edge modernos. Safari debería funcionar pero no es objetivo prioritario.
- Las reglas abiertas de DB/Storage son adecuadas para showroom controlado. Para producción pública, agregar Firebase Auth.
