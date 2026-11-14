# Gestión de tiendas

Administración del catálogo marca blanca: creación de tiendas y usuarios, permisos, pausas y solicitudes de acceso. Está pensada para un **repositorio privado**, separado del catálogo público.

## Los dos repositorios

| Repositorio | Contenido | Quién lo usa |
|---|---|---|
| **Catálogo público** (`catalogo-publico/`) | Catálogo, panel de cada tienda, `404.html` | Vendedores y sus clientes |
| **Gestión de tiendas** (esta carpeta) | `gestion-tiendas.html` y reglas de la base | Sólo vos |

```
https://catalog.dev.ar/lucia          → catálogo de la tienda "lucia" (para sus clientes)
https://catalog.dev.ar/lucia/admin    → panel de "lucia" (para el vendedor)
gestion-tiendas.html                  → gestión de tiendas (sólo vos, desde este repositorio)
```

Los dos repositorios usan el **mismo proyecto de Firebase**. Los clientes **no escriben en ninguna base**: el pedido se arma como mensaje y se manda por WhatsApp al número del vendedor.

### Archivos de esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `gestion-tiendas.html` / `gestion-tiendas.js` | Gestión de tiendas, usuarios y solicitudes. |
| `index.html` | Redirige a `gestion-tiendas.html`. |
| `config.js` | `SITIO_PUBLICO` (dirección del catálogo público) y `firebaseConfig`. |
| `database.rules.json` | Reglas de la Realtime Database. Hay que publicarlas en la consola de Firebase. |
| `tienda-core.js`, `admin-auth.js`, `panel.css` | **Copias** de los mismos archivos del catálogo público. |

> ⚠️ **Archivos compartidos:** `tienda-core.js`, `admin-auth.js` y `panel.css` existen en los dos repositorios y tienen que ser idénticos. Si cambiás uno, copialo al otro.

## Puesta en marcha (una sola vez)

1. **Catálogo público**: subir el contenido de `catalogo-publico/` a la raíz de un repositorio público (por ejemplo `codew7/catalog`) y activar *Settings → Pages* (rama `main`, carpeta raíz).
   - Para usar `catalog.dev.ar`: en *Settings → Pages → Custom domain*, escribir `catalog.dev.ar`. En el DNS del dominio, crear un `CNAME catalog → codew7.github.io`. Después, tildar *Enforce HTTPS*.
2. **Gestión de tiendas**: en `config.js`, poner en `SITIO_PUBLICO` la dirección del catálogo (`https://catalog.dev.ar/` o `https://codew7.github.io/catalog/`). Después, subir esta carpeta a un repositorio **privado**. Para usarla:
   - **En tu computadora** (lo más simple): `npx http-server -p 8090` dentro de la carpeta y abrir `http://localhost:8090`.
   - **Publicada**: GitHub Pages desde un repositorio privado requiere un plan pago. Netlify y Cloudflare Pages publican repositorios privados gratis. Cualquiera sirve: el acceso igual está protegido por login y por las reglas.
3. **Firebase**: publicar `database.rules.json` en *Realtime Database → Reglas* y activar *Authentication → Correo electrónico/contraseña*.
4. **Tu usuario de administrador global**: ya está cargado (`admins/<tu UID>: true`). Es lo único que se hace a mano en la consola.
5. **API key de Google Sheets**: en *Google Cloud Console → Credenciales → la API key → Restricciones de sitios web*, sumar `https://catalog.dev.ar/*` y/o `https://codew7.github.io/*`. La gestión de tiendas no usa la hoja.
6. **Firebase Authentication → Configuración → Dominios autorizados**: sumar los dominios del catálogo y de la gestión. Sólo hace falta para ingresar con Google; `localhost` ya viene autorizado.

## Crear la tienda de un vendedor

1. En la gestión de tiendas, **Nueva tienda**: nombre y ID. El ID se sugiere solo y es la parte final del enlace. En el mismo paso se crea el usuario del vendedor (nombre y email); la contraseña temporal se genera sola.
2. Copiar el mensaje con las credenciales y mandarlo por WhatsApp o email. Incluye el enlace del catálogo y el del panel. **La contraseña no se puede volver a ver.**
3. Listo: la tienda ya está publicada en su enlace. **No hay que subir nada.** El vendedor entra a `…/su-tienda/admin`, elige su contraseña definitiva y arma su tienda.

> Palabras reservadas que no se pueden usar como ID: `admin`, `principal`, `index`, `api`, `img`, `assets`, `www`, `catalogo`, `tienda`.

## Dominio propio (opcional)

Si una tienda quiere su dominio, por ejemplo `bazarlucia.com.ar`:

1. En el menú de la tienda, elegir **Página para dominio propio** → **Descargar index.html**. Es un único archivo.
2. Subirlo a la raíz del hosting de ese dominio. Sirve cualquiera, incluso uno gratuito: un repositorio nuevo de GitHub Pages con ese dominio, o Netlify Drop (arrastrar y soltar).
3. Sumar `https://bazarlucia.com.ar/*` a la API key de Google Sheets. Si falta, el catálogo muestra "No pudimos acceder a la lista de productos (403)".
4. En **Editar datos** de la tienda, cargar el dominio para que los enlaces de la gestión lo usen.

Esa página trae el catálogo del sitio público y lo muestra con la dirección del dominio propio. Por eso no hace falta volver a subirla cuando mejores el sistema. El panel del vendedor sigue en `catalog.dev.ar/su-tienda/admin`.

## Cómo se calcula el precio

```
precio = costo (columna H) × (1 + % de su escala) × (1 + ajuste global)
         → redondeado hacia arriba al múltiplo elegido
```

La escala se elige según el costo, y "Hasta $X" incluye X. Las escalas por defecto son las de la hoja *Grupos* (Hasta $2.500 → 75% … más de $100.000 → 10%). Cada vendedor las edita desde **Panel → Precios**, que incluye un simulador y una tabla con productos reales.

## Datos en la base

```
tiendas/<id>/
  config/            identidad, contacto, textos, bienvenida, apariencia, precios, pedido, catalogo, banners, actualizado
  assets/<id>/       { dataUrl, tipo, ancho, alto }   ← logos y banners, comprimidos en el navegador
  admins/<uid>: true ← responsables de la tienda
  meta/              { nombre, url, notas, creada } ← sólo admin global (url = dominio propio, si tiene)
  estado/            { activa, mensaje }            ← público: pausada = el catálogo muestra "no disponible"
usuarios/<uid>/      { email, nombre, activo, debeCambiarClave, creado, ultimoIngreso, tiendas{} }
solicitudes/<uid>/   { email, nombre, tienda, fecha } ← pedidos de acceso desde el login
admins/<uid>: true   ← admin global (vos)
```

- Si un enlace apunta a una tienda que no existe, el catálogo muestra "Catálogo no encontrado".
- **Imágenes**: el panel las comprime al subirlas (WEBP; logos de hasta ~320 KB y banners de hasta ~480 KB). Cada subida genera un id nuevo, así que el navegador del cliente las puede guardar en caché sin límite de tiempo. Al guardar se borran las que quedaron sin uso.
- **Caché del catálogo**: la última config de cada tienda queda guardada en el navegador del cliente. Así colores, logo y textos aparecen al instante y sin destello, y después se comparan con la base.

## Usuarios y permisos

- **Admin global** (`admins/<uid>`): entra a la gestión de tiendas y al panel de cualquier tienda.
- **Responsable de tienda** (`tiendas/<id>/admins/<uid>`): entra sólo al panel de sus tiendas, mientras su usuario no esté suspendido.

Desde la **gestión de tiendas** se puede:

- **Tiendas**: crear, editar el nombre interno, el dominio propio y las notas, asignar responsables, copiar los enlaces del catálogo y del panel, descargar la página para dominio propio, **pausar** (los clientes ven un aviso con tu mensaje) o eliminar.
- **Usuarios**: crear con contraseña temporal, asignar tiendas, mandar el email de restablecimiento, pedir contraseña nueva en el próximo ingreso, **suspender** (no puede guardar nada) y quitar del sistema.
- **Solicitudes**: si alguien entra a un panel sin permiso (por ejemplo, con Google), toca *Solicitar acceso* y aparece acá para aprobarlo con un clic.

Cada usuario cambia su contraseña desde **Mi cuenta** (su nombre, arriba a la derecha) o con "¿Olvidaste tu contraseña?" en el login.

**Limitaciones** (sin Cloud Functions, que requieren el plan Blaze):

- No se puede ver ni fijar la contraseña de otra persona: se le manda el email de restablecimiento.
- "Quitar del sistema" le saca todos los permisos, pero la cuenta sigue existiendo en *Authentication*. Para borrarla del todo, hay que hacerlo desde la consola.
- Si se suspende a un usuario con el panel abierto, puede seguir mirándolo, pero ya no puede guardar.
