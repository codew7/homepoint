# App Android de Pedidos (APK)

Esto arma la app instalable de **Pedidos HomePoint** para tablets y celulares Android.

La app es una ventana propia que muestra `pedidosv2.html` desde el sitio publicado
(`https://home-point-admin.dev.ar/pedidosv2/pedidosv2.html`). O sea: **cuando subís un cambio
al repositorio, la app lo toma sola**. No hay que volver a instalar nada salvo que cambie
algo de esta carpeta (el ícono, el nombre, la dirección que abre).

Ningún archivo de la web se tocó: todo lo que hace falta para que funcione adentro de la app
se agrega desde acá.

---

## 1. Cargar la clave de firma en GitHub (una sola vez)

Android exige que la app esté firmada. La clave ya está generada y guardada en tu PC en:

```
C:\Users\alero\Documents\HomePoint-firma-apk\
```

Esa carpeta tiene tres archivos: `firma.p12` (la clave), `firma-base64.txt` (la misma clave
en texto, para pegar en GitHub) y `clave.txt` (la contraseña).

> **Guardá esa carpeta.** Si se pierde la clave no se puede actualizar la app instalada:
> habría que desinstalarla de cada dispositivo e instalar una nueva. Hacé una copia en un
> pendrive o en Drive.

Pasos en la web de GitHub:

1. Entrá al repositorio → pestaña **Settings** → menú izquierdo **Secrets and variables** →
   **Actions**.
2. Botón **New repository secret**. Alcanza con estos dos:

   | Name (nombre exacto)        | Secret (valor)                                            |
   |-----------------------------|-----------------------------------------------------------|
   | `ANDROID_KEYSTORE_BASE64`   | todo el contenido de `firma-base64.txt` (una línea larga) |
   | `ANDROID_KEYSTORE_PASSWORD` | la contraseña que figura en `clave.txt`                   |

   Al pegarlos, cuidado con no dejar espacios ni saltos de línea al final.
   El nombre interno de la clave (*alias*) lo detecta solo el workflow.

Si te salteás este paso igual se compila, pero sale una versión de prueba que **cambia de
firma cada vez** y no se puede instalar encima de la anterior.

---

## 2. Compilar el APK

En la web del repositorio: pestaña **Actions** → workflow **APK Pedidos** → botón
**Run workflow**.

- **Publicar en Releases**: dejalo tildado. Deja el APK con un link de descarga directo,
  cómodo para abrir desde el celular.
- **Número de versión**: `1.0`, `1.1`, lo que quieras. Es solo un texto que se ve en la
  ficha de la app.

Tarda entre 3 y 6 minutos. Cuando termina, el APK queda en dos lugares:

- **Releases** (menú derecho de la portada del repositorio): link directo para abrir desde
  el celular.
- **Actions** → el run que corriste → sección *Artifacts* → `PedidosHomePoint-apk`
  (baja un ZIP, hay que descomprimirlo).

El workflow también se dispara solo cuando se modifica algo dentro de `pedidosv2/android`.

---

## 3. Instalar en el dispositivo

1. Abrí el link del APK desde el navegador del celular o la tablet.
2. Android va a avisar que el archivo viene de un origen desconocido: tocá
   **Configuración** y habilitá *Permitir instalar apps de esta fuente* para el navegador.
3. Volvé atrás y tocá **Instalar**.
4. La primera vez que escanees un código, la app va a pedir permiso de **cámara**: aceptalo.
5. Antes de imprimir por primera vez, emparejá la impresora térmica desde los
   **ajustes de Bluetooth de Android** (una sola vez, como con cualquier otro dispositivo
   Bluetooth). La app va a pedir permiso de **Bluetooth** y, si hace falta, activar el
   Bluetooth del equipo.

Para actualizar más adelante no hay que hacer nada a mano: la app revisa el último release
de GitHub al abrirse (y como mucho una vez por hora mientras está abierta). Si hay una versión
más nueva, pregunta **Actualizar / Más tarde**; con *Actualizar* baja el APK y abre el
instalador de Android, que pide confirmar con un toque. Se instala encima, sin desinstalar
nada y sin perder la sesión. *Más tarde* lo posterga 24 horas.

La primera vez Android puede pedir habilitar *Instalar apps desconocidas* para
**Pedidos HomePoint** (la app te lleva directo a ese ajuste); al volver, sigue sola.

Para que los teléfonos vean una versión nueva tiene que estar publicada en **Releases**: los
builds que salen solos por un push a `main` se publican siempre; los lanzados a mano, solo
con *Publicar en Releases* tildado. Los APK de prueba (sin secrets de firma) nunca se
publican, porque no se pueden instalar encima del firmado.

---

## 4. Qué hace la app además de mostrar la web

Un navegador incrustado no sabe hacer algunas cosas por su cuenta. La app las resuelve:

- **Imprimir el Ticket y el Rótulo (tira POS)**: los dos van directo por **Bluetooth** a
  la impresora térmica emparejada, con los mismos comandos ESC-POS que usa la impresión
  por PC. El Ticket sale como texto nítido de la fuente nativa; el Rótulo (que es una
  imagen: nombre, dirección, QR) se manda como bitmap ESC-POS partido en tiras, para no
  saturar el buffer de impresoras chicas. Ninguno de los dos depende de *ESC Print
  Service* ni de ningún cuadro de diálogo. La primera vez piden elegir la impresora;
  después queda guardada, y se puede cambiar en cualquier momento desde el menú
  **Imprimir → Impresora Bluetooth**.
- **Generar Rótulo PDF y Generar Pedido PDF**: siguen igual, se descargan/comparten como
  PDF, no pasan por la impresora.
- **Guardar PDF**: van a la carpeta Descargas y se abren en el visor.
- **Compartir PDF**: usa el menú de compartir de Android (WhatsApp, mail, Drive).
- **Copiar al portapapeles**: usa el portapapeles del sistema.
- **Links de WhatsApp, teléfono y mail**: se abren en la app que corresponde, no adentro.
- **Botón atrás**: vuelve dentro de la página; dos toques seguidos cierran la app.
- **Sin conexión**: muestra una pantalla con botón *Reintentar*.

QZ Tray (la impresión por USB desde la PC) no existe en Android; la propia página ya lo
detecta y usa Bluetooth directo para el Ticket y el Rótulo.

---

## 5. Cambiar cosas

| Qué                     | Dónde                                                                 |
|-------------------------|-----------------------------------------------------------------------|
| Dirección que abre      | `URL_APP` y `HOST_APP` en `app/src/main/java/ar/com/homepoint/pedidos/MainActivity.java` |
| Nombre bajo el ícono    | `app_name` en `app/src/main/res/values/strings.xml`                    |
| Colores de las barras   | `app/src/main/res/values/colors.xml`                                   |
| Ícono                   | los PNG en `app/src/main/res/mipmap-*` (se generaron de `faviconblanco.png`) |

Después de cambiar algo, volvé a correr el workflow y reinstalá el APK.

---

## 6. Compilar en tu PC (opcional)

No hace falta: GitHub lo hace gratis. Si algún día lo querés local, necesitás
**Android Studio** (trae el JDK y el SDK). Abrís esta carpeta `android` como proyecto, y
Android Studio ofrece descargar lo que falte y crear el *Gradle wrapper*. Para firmar,
copiá `firma.p12` acá y creá un archivo `firma.properties` con:

```properties
storeFile=firma.p12
storePassword=LA_CONTRASEÑA
keyAlias=pedidos
keyPassword=LA_CONTRASEÑA
storeType=PKCS12
```

Ese archivo está en el `.gitignore`, no se sube al repositorio.
