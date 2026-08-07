# HP Imágenes — Procesador de Fotos de Productos (PWA)

Aplicación web progresiva (PWA) para procesar fotos de productos. Elimina fondos automáticamente, recorta y redimensiona a formato cuadrado 1080×1080px, todo procesado directamente en el navegador sin servidores externos.

---

## ✨ Funcionalidades

| Función | Descripción |
|---|---|
| 📸 **Captura de fotos** | Desde cámara del dispositivo o galería |
| 🎨 **Eliminación de fondo** | Automática con IA (100% client-side) |
| ✂️ **Recorte automático** | Centra el producto en cuadrado 1080×1080px |
| 🔧 **Recorte manual** | Ajuste de zoom, rotación y posición |
| 📝 **Nombres personalizados** | Asigna nombres a cada imagen |
| 📥 **Descarga directa** | Individual o en lote (ZIP) |
| 🌗 **Modo oscuro/claro** | Conmutación automática/manual |
| 📱 **PWA instalable** | Uso offline con Service Worker |
| 🔄 **Procesamiento batch** | Múltiples imágenes en cola |
| 👁️ **Antes/Después** | Comparación original vs procesada |

---

## 🛠️ Stack Técnico

- **HTML5 + CSS3 + JavaScript Vanilla** — Sin frameworks
- **[@imgly/background-removal](https://github.com/nicolo-ribaudo/background-removal-js)** — Eliminación de fondo con IA en el navegador (TensorFlow.js / ONNX)
- **[JSZip](https://stuk.github.io/jszip/)** — Generación de archivos ZIP en el navegador
- **Canvas API** — Procesamiento y manipulación de imágenes
- **Service Worker** — Caché offline y funcionalidad PWA
- **Procesamiento 100% client-side** — Sin APIs de pago ni servidores

---

## 📁 Estructura de Archivos

```
homepoint/
├── imagenes.html      # App principal (HTML + CSS + JS unificado)
├── manifest.json      # Manifiesto PWA
├── sw.js              # Service Worker para caché offline
└── README.md          # Esta documentación
```

---

## 🚀 Despliegue

### GitHub Pages (recomendado)
La app ya está lista para servirse desde GitHub Pages. Al estar en el repositorio `homepoint`, simplemente:

1. Ve a **Settings → Pages** en tu repositorio de GitHub
2. Selecciona la rama `main` y carpeta `/ (root)`
3. Accede a `https://codew7.github.io/homepoint/imagenes.html`

### Servidor local
```bash
# Cualquier servidor HTTP estático funciona:
npx serve .
# o
python -m http.server 8000
```

> ⚠️ **Importante**: El Service Worker requiere HTTPS o `localhost` para funcionar correctamente.

---

## 📱 Flujo de Uso

```
1. Abrir imagenes.html
2. Capturar foto (cámara) o subir imagen (galería)
3. Las imágenes se agregan a la cola
4. Click "Procesar todas" o procesar individualmente
5. La IA elimina el fondo automáticamente
6. Se recorta y centra a 1080×1080px
7. Asignar nombre personalizado al producto
8. Descargar individual, todas, o como ZIP
```

---

## ⚙️ Detalles Técnicos

### Eliminación de Fondo
- Utiliza `@imgly/background-removal` v1.5.5
- Modelo de IA se descarga (~40MB) la primera vez y se cachea
- Procesamiento totalmente en el navegador vía WebAssembly/ONNX
- Si falla, se aplica un recorte básico como fallback

### Redimensionamiento
- Detección automática de bounding box del contenido
- Centrado inteligente con padding del 5%
- Output final: 1080×1080px PNG con fondo transparente

### Recorte Manual
- Zoom con slider o rueda del mouse
- Rotación de -180° a +180°
- Drag/pan para posicionar la imagen
- Preview en tiempo real

### Rendimiento
- Lazy loading de la librería de IA
- Procesamiento secuencial para no saturar la memoria
- Compresión PNG optimizada (calidad 0.92)
- UI no se bloquea durante el procesamiento

---

## 🌐 Compatibilidad

| Navegador | Soporte |
|---|---|
| Chrome 90+ | ✅ Completo |
| Safari 15+ (iOS) | ✅ Completo |
| Firefox 90+ | ✅ Completo |
| Edge 90+ | ✅ Completo |
| Samsung Internet | ✅ Completo |

---

## 📄 Licencia

Uso interno para HomePoint. Librerías externas bajo sus respectivas licencias (MIT/Apache 2.0).
