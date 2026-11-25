# Panel de Catálogos

Administra la interfaz de `CatalogoWeb/catalogo.html` (Mayorista) y `CatalogoWeb/catalogoInterior.html` (Interior) sin tocar su código. Desde acá se manejan anuncios, pop-ups, banners, textos, FAQ, contacto, mínimos y descuento, pausa de pedidos, color de acento, decoración de temporada e insignias. Incluye borrador con autoguardado, vista previa en vivo, historial y plantillas.

No toca el registro de pedidos ni de clientes: la pausa sólo impide *enviar* desde la web.

## Cómo funciona

```
homepoint/catalogos (solo root)
  ├─ borrador  → catalogoCMS/borrador/{mayorista|interior}   (autosave)
  ├─ publicar  → catalogoCMS/publicado/{cat} + historial/{cat}/{id}
  └─ preview   → iframe del catálogo con ?cmsPreview=1 + postMessage
CatalogoWeb/cms/catalogo-cms.js
  lee publicado/{cat} en vivo, guarda copia en localStorage y la aplica.
  Sin configuración o ante cualquier error, el catálogo queda como siempre.
```

## Puesta en marcha (una sola vez)

1. **Reglas de Realtime Database** del proyecto `pedidos-87064`: publicar `homepoint/database.rules.munro.json`, que ya incluye el nodo `catalogoCMS`.
2. **Reglas de Storage**, sólo si la subida de imágenes da error de permisos. Agregar:
   ```
   match /catalogo-cms/{cat}/{archivo} {
     allow read: if true;
     allow write: if request.auth != null
                  && request.resource.size < 5 * 1024 * 1024
                  && request.resource.contentType.matches('image/.*');
   }
   ```
3. **Publicar `CatalogoWeb`** (push a GitHub Pages). Sube la carpeta `cms/`, los HTML con los atributos `data-cms` y el `catalogo.js` regenerado.
4. **Publicar `homepoint`**. El panel queda en **Administración → Catálogos Web**.

## Mantenimiento

- **`catalogo.js` está ofuscado.** Se edita `catalogoRAW.js` y después se corre `node scripts/ofuscar.mjs` (en CatalogoWeb).
- **`catalogoInterior.js` es legible** y se edita directo. Mantener `catalogoInteriorRAW.js` en paralelo.
- **Sumar un texto editable:**
  1. En el HTML del catálogo, ponerle `data-cms="clave"` al nodo.
  2. Agregar `{ clave, etiqueta, original }` en `CATALOGOS[cat].textos`, en `js/schema.js`.
- **Probar la vista previa contra un servidor local:** en la consola del panel, correr `localStorage.setItem('hpcms:urlBase', 'http://127.0.0.1:8000/')`. Se vuelve a producción con `localStorage.removeItem('hpcms:urlBase')`.

## Atajos

| Atajo | Acción |
|---|---|
| Ctrl/⌘ K | Buscar secciones y acciones |
| Ctrl/⌘ S | Guardar el borrador ya |
| Ctrl/⌘ Enter | Publicar |
| Ctrl/⌘ Z / Shift Z | Deshacer / rehacer |
| Ctrl/⌘ . | Mostrar u ocultar la vista previa |
