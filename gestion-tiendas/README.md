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

Los dos repositorios usan el **mismo proyecto de Firebase**. Lo único que escriben los clientes son sus **pedidos** (`tiendas/<id>/pedidos`): al confirmar, el pedido queda registrado con `status: "ABIERTO"` y el cliente le avisa al vendedor por WhatsApp con un mensaje corto que trae el número de pedido. Las reglas sólo les permiten **crear** pedidos, nunca leerlos ni modificarlos.

### Archivos de esta carpeta

| Archivo | Para qué sirve |
|---|---|
| `gestion-tiendas.html` / `gestion-tiendas.js` | Gestión de tiendas, usuarios y solicitudes. |
| `index.html` | Redirige a `gestion-tiendas.html`. |
| `config.js` | `SITIO_PUBLICO` (dirección del catálogo público) y `firebaseConfig`. |
| `database.rules.json` | Reglas de la Realtime Database. Hay que publicarlas en la consola de Firebase. |
| `tienda-core.js`, `admin-auth.js`, `panel.css` | **Copias** de los mismos archivos del catálogo público. |

> ⚠️ **Reglas:** cada vez que cambia `database.rules.json` hay que volver a publicarlo en *Realtime Database → Reglas*. Sin la versión con el nodo `pedidos`, los clientes no pueden confirmar pedidos.

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

> Palabras reservadas que no se pueden usar como ID: `admin`, `principal`, `index`, `api`, `img`, `assets`, `www`, `catalogo`, `tienda`, `registro`, `pedido`.

## Dominio propio (opcional)

Si una tienda quiere su dominio, por ejemplo `bazarlucia.com.ar`:

1. En el menú de la tienda, elegir **Página para dominio propio** → **Descargar index.html**. Es un único archivo.
2. Subirlo a la raíz del hosting de ese dominio. Sirve cualquiera, incluso uno gratuito: un repositorio nuevo de GitHub Pages con ese dominio, o Netlify Drop (arrastrar y soltar).
3. Sumar `https://bazarlucia.com.ar/*` a la API key de Google Sheets. Si falta, el catálogo muestra "No pudimos acceder a la lista de productos (403)".
4. En **Editar datos** de la tienda, cargar el dominio para que los enlaces de la gestión lo usen.

Esa página trae el catálogo del sitio público y lo muestra con la dirección del dominio propio. Por eso no hace falta volver a subirla cuando mejores el sistema. El panel del vendedor sigue en `catalog.dev.ar/su-tienda/admin`.

## Cómo se calcula el precio

```
precio = costo × (1 + % de su escala) × (1 + ajuste global)
         → redondeado hacia arriba al múltiplo elegido
```

**De dónde sale el costo** lo elegís vos para cada tienda en el menú **⋯ → Variable de costos** (el vendedor no lo puede cambiar). En pantalla las opciones se muestran sólo por su nombre; esta tabla dice de qué columna de la hoja sale cada una:

| Opción | Costo |
|---|---|
| **Descuento Interior** (por defecto) | columna E |
| **Valor Costo** | columna H |
| **Costo %** | columna H + el porcentaje que indiques (ej.: H $10.000 + 15% → $11.500) |

Las tiendas con una opción distinta de la de por defecto muestran una etiqueta (`Valor Costo` o `Costo % +15%`) en la lista. Los catálogos ya abiertos toman el cambio al recargar. Se guarda en `tiendas/<id>/costo`; si no existe, se usa la columna E.

La escala se elige según el costo, y "Hasta $X" incluye X. Las escalas por defecto son las de la hoja *Grupos* (Hasta $2.500 → 75% … más de $100.000 → 10%). Cada vendedor las edita desde **Panel → Precios**, que incluye un simulador y una tabla con productos reales.

## Datos en la base

```
tiendas/<id>/
  config/            identidad, contacto, textos, bienvenida, apariencia, precios, pedido, catalogo, banners, actualizado
  assets/<id>/       { dataUrl, tipo, ancho, alto }   ← logos y banners, comprimidos en el navegador
  admins/<uid>: true ← responsables de la tienda
  meta/              { nombre, url, notas, creada } ← sólo admin global (url = dominio propio, si tiene)
  estado/            { activa, mensaje, desde, pausadaPor } ← público: pausada = el catálogo muestra "no disponible".
                     pausadaPor 'tienda' = la pausó su responsable (Panel → Tienda → Estado) y la puede reactivar;
                     si la pausaste vos ('admin'), sólo vos la reactivás (lo exigen las reglas)
  baja/              { fecha, uid, email, borrarUsuario, motivo? } ← el responsable pide eliminar la tienda (y opcionalmente su usuario)
  costo/             { modo: 'costo' | 'costoPct', pct? } ← público, sólo lo escribe el admin global. Sin nodo = columna E
  pedidos/<clave>/   { numero, fecha, status, entregado?, total, cliente{nombre, telefono (sólo dígitos), email, provincia, localidad, dni? (7-8 dígitos), entrega?, direccion?, notas?},
                       items[{nombre, cantidad, precio, costo?, codigo?}] }
                     ← el cliente sólo puede crear (status ABIERTO); el responsable lee, marca ENTREGADO o borra.
                       Unidades, subtotal, descuento y costo total NO se guardan: el panel los calcula de los artículos.
  publicos/<clave>/  { numero, fecha, status, items[{nombre, cantidad, precio, codigo?}], subtotal?, descuento?, total, cliente{nombre, entrega, direccion, localidad, provincia}, vence }
                     ← copia de sólo lectura de un pedido para el comprador (Panel → pedido → Enviar al cliente).
                       Se lee sólo conociendo la clave (número + 10 caracteres al azar); nadie puede listarlas.
                       Vence a los 30 días; el panel borra las vencidas al abrirse. El pedido guarda la clave en "enlace".
  compras/<email>/<clave>/ { numero, fecha, status, items[{nombre, cantidad, precio}], total }
                     ← copia mínima de cada pedido, agrupada por el email del comprador (minúsculas, "." → ","),
                       para la opción "Ingresar" del catálogo. Se lee conociendo el email exacto; nadie puede listar
                       los emails. La crea el checkout junto con el pedido y la mantiene al día el panel
                       (ediciones, entregas, pedidos borrados o vencidos). Sin costos, teléfono, DNI ni notas.
  ultimoPedido       ← hora del último pedido: las reglas piden 3 segundos entre pedidos de una tienda (freno contra pedidos falsos en masa)
usuarios/<uid>/      { email, nombre, activo, debeCambiarClave, creado, ultimoIngreso, tiendas{} }
bajas/<uid>/         { email, fecha }             ← usuario quitado: su cuenta se borra de Authentication cuando vuelve a entrar
solicitudes/<uid>/   { email, nombre, tienda, fecha } ← pedidos de acceso desde el login
registros/<uid>/     { tiendaNombre, tienda, url?, nombre, email, comentario?, fecha } ← tiendas pedidas desde registro.html (la persona sólo puede crearla o cancelarla)
admins/<uid>: true   ← admin global (vos)
```

- Si un enlace apunta a una tienda que no existe, el catálogo muestra "Catálogo no encontrado".
- **Imágenes**: el panel las comprime al subirlas (WEBP; logos de hasta ~320 KB y banners de hasta ~480 KB). Cada subida genera un id nuevo, así que el navegador del cliente las puede guardar en caché sin límite de tiempo. Al guardar se borran las que quedaron sin uso.
- **Pedidos**: el panel de cada tienda tiene **Ventas → Pedidos** (en vivo; marcar entregado, volver a abierto, *cancelar y eliminar* en un solo paso) y **Ventas → Facturación** (facturado, costo y ganancia de los pedidos entregados, por período). El costo de cada artículo (columna E, H o H + %, según la tienda) se copia al momento de la compra. Los pedidos de **más de 90 días se borran solos**: lo hace el panel de la tienda al abrirse y también esta gestión al cargar (no hay Cloud Functions en el plan gratuito).
- **Provincias y localidades**: el checkout usa `localidades-ar.json` del catálogo público (24 provincias y ~4.200 localidades, generado desde los datos de Georef de `Cotizadores/Disponibilidad/datos.json`).
- **Caché del catálogo**: la última config de cada tienda queda guardada en el navegador del cliente. Así colores, logo y textos aparecen al instante y sin destello, y después se comparan con la base.

## Usuarios y permisos

- **Admin global** (`admins/<uid>`): entra a la gestión de tiendas y al panel de cualquier tienda.
- **Responsable de tienda** (`tiendas/<id>/admins/<uid>`): entra sólo al panel de sus tiendas, mientras su usuario no esté suspendido.

Desde la **gestión de tiendas** se puede:

- **Tiendas**: crear, editar el nombre interno, el dominio propio y las notas, asignar responsables, copiar los enlaces del catálogo y del panel, descargar la página para dominio propio, **pausar** (los clientes ven un aviso con tu mensaje) o eliminar.
- **Usuarios**: crear con contraseña temporal, asignar tiendas, mandar el email de restablecimiento, pedir contraseña nueva en el próximo ingreso, **suspender** (no puede guardar nada) y quitar del sistema.
- **Solicitudes → Tiendas nuevas**: lo que llega desde el formulario público `catalog.dev.ar/registro` (botones *Ver formulario* y *Copiar enlace*). La persona elige su contraseña al registrarse; la tienda **no existe** hasta que tocás **Revisar → Aprobar y crear tienda** (podés corregir nombre, ID, dominio y notas). Después aparece el mensaje de bienvenida para mandarle por email o WhatsApp: no hay envío automático. **Rechazar** borra la solicitud y, si la cuenta se creó sólo para eso, se borra sola cuando vuelva a entrar.
- **Solicitudes → Eliminación de tiendas**: lo que piden los responsables desde *Panel → Tienda → Estado*. **Eliminar** abre la confirmación de siempre; si también pidió borrar su usuario, viene tildado *quitarlo del sistema* (su cuenta se borra cuando vuelva a entrar). **Rechazar** borra el pedido y la tienda sigue igual. Las tiendas con pedido pendiente muestran *Pidió la baja*.
- **Solicitudes → Acceso a paneles**: si alguien entra a un panel sin permiso (por ejemplo, con Google), toca *Solicitar acceso* y aparece acá para aprobarlo con un clic.

Cada usuario cambia su contraseña desde **Mi cuenta** (su nombre, arriba a la derecha) o con "¿Olvidaste tu contraseña?" en el login.

**Limitaciones** (sin Cloud Functions, que requieren el plan Blaze):

- No se puede ver ni fijar la contraseña de otra persona: se le manda el email de restablecimiento.
- "Quitar del sistema" le saca todos los permisos al instante y deja una marca en `bajas/<uid>`. La cuenta de *Authentication* **se borra sola la próxima vez que esa persona intente entrar** (a un panel o a la gestión): una página sólo puede borrar la cuenta de quien está logueado. Si su sesión es vieja, se le cierra y, al volver a ingresar, se borra. Mientras tanto aparece en *Usuarios → Cuentas quitadas que esperan borrarse*. Si nunca vuelve a entrar, queda sin permisos; para borrarla ya, hacelo desde la consola.
- Si se suspende a un usuario con el panel abierto, puede seguir mirándolo, pero ya no puede guardar.
