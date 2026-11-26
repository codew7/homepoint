# WhatsApp en pedidosv2 (solo lectura)

Este programa corre en la PC del local. Se vincula al WhatsApp **+54 9 11 7646-0030**
como "dispositivo vinculado" (igual que WhatsApp Web) y guarda en un **proyecto de Firebase aparte**
lo necesario para **emparejar cada cotización con su comprobante de pago**. En pedidosv2, cada pedido
muestra el botón **"Ver conversación de WhatsApp"**.

Qué se guarda:
- **Tus cotizaciones**: los mensajes que mandás desde el 11 7646-0030 con el texto `Subtotal $`,
  con fecha y hora. El resto de tus mensajes no se guarda.
- **Los comprobantes de pago que manda el cliente** (foto, captura o PDF), como imagen comprimida
  (de un PDF, su primera página) y sin el texto que escribe abajo. Para saber si una imagen es un
  comprobante, el programa **lee su texto en la PC** y busca palabras de pago (comprobante,
  transferencia, CBU/CVU, operación, bancos, montos con `$`...). Las fotos de otras cosas
  (productos, lugares) no se guardan. Si es dudosa, se guarda igual para no perder un pago.
  Se marcan como **Comprobante de pago**.
- **Tus remitos**: las fotos o documentos que mandás desde el 11 7646-0030 y que son remitos o
  comprobantes de envío (Vía Cargo, Flecha Carga, Andreani, Correo Argentino, encomiendas, despachos...).
  Se marcan como **Remito** y nunca cuentan como comprobante de pago. Tus otras fotos no se guardan,
  y los remitos que manda otra persona tampoco.
- En pedidosv2, la galería de adjuntos muestra las dos categorías por separado, y el aviso
  "Posible comprobante" de la lista de pedidos solo cuenta los comprobantes de pago.
- Nada más: los textos del cliente, audios, stickers, etc. no se guardan. Grupos, estados y canales tampoco.

### Comprobantes asignados a su pedido
Cada comprobante de pago se asigna solo a un pedido del mismo teléfono creado **antes** del comprobante
(hasta 30 días antes, sin contar los cancelados). Para elegirlo usa, en este orden:
1. El **código de pedido** que pedidosv2 agrega al final de la cotización (`- Pedido: xxxxxx`).
2. El **importe exacto** del comprobante igual al total de un pedido.
3. El **total de tu última cotización** antes del comprobante.
4. Si el cliente tiene **un solo pedido** posible, ese.
5. Si no, el más reciente, marcado **Revisar**.

Los pagos en varias partes se suman: en pedidosv2 el pedido muestra "Pagado $X de $Y" o "Pagado completo",
y el ícono de la lista se pone verde (completo) o ámbar (parcial), con un punto rojo si hay algo para revisar.
Dentro del pedido se puede **Quitar** o **Asignar** un comprobante a mano; esa corrección no se vuelve a cambiar
(el botón **Automático** la deshace). El plazo de 30 días está en `ajustes.js` (`DIAS_ASIGNAR`).

**Reglas de la base:** para las correcciones a mano hay que publicar de nuevo `database.rules.json`
(Firebase → Realtime Database → Reglas → pegar y **Publicar**).

### Bajar los comprobantes a la PC y verificarlos
`descargar-comprobantes.bat` baja los comprobantes de pago a la carpeta `comprobantes\`
(`cliente - PEDIDO - fecha.jpg`) y revisa si hay nuevos cada 5 minutos. No hace falta abrirlo a mano si se usa el
**Verificador de comprobantes** (`compVerif`) con el interruptor **Comprobantes de WhatsApp** prendido: el verificador
lo corre oculto y analiza solo cada comprobante nuevo. No se pueden abrir los dos a la vez; el segundo avisa y se cierra.

Según el resultado, el nombre del archivo termina en **[ALTERADO]**, **[REVISAR]** o **[RECHAZADO]**, y en
pedidosv2 el comprobante y el pedido muestran el aviso ("Comprobante posiblemente alterado"). Si en el verificador
se marca **Aprobado**, la marca se quita. El verificador deja su resultado en `comprobantes\verificacion.json` y el
script de descarga es el único que renombra y sube el aviso a Firebase (`lineas/<línea>/imgsIdx/{id}/verif`).

- Lo único que envía es el **aviso de despacho** de Flecha Carga (ver abajo). Ningún otro mensaje.
- Comprobantes y cotizaciones se borran solos a los 90 días.
- La primera vez que lee una imagen baja el idioma español del lector de texto (necesita internet).
- Si a algún banco no lo reconoce, se agrega a la lista `BANCOS` al principio de `index.js`.
- La PC tiene que estar prendida para que se guarden los mensajes. Al prenderla,
  recupera lo que entró mientras estuvo apagada.

### Aviso de despacho (Flecha Carga)
En pedidosv2, en la lista de pendientes, los pedidos con entrega **Flecha Carga** tienen un botón con un
eslabón a la derecha. Ahí se pega el link del envío: queda guardado en el pedido y este programa le manda
al cliente, desde el 11 7646-0030:

> Juan, tu pedido ya fue despachado. Te adjunto el link con el que podrás verificar toda la información:
> https://...
> ¡Muchas gracias nuevamente! 😊

- El botón se pone **ámbar** mientras espera, **verde** cuando se envió y **rojo** si no se pudo
  (número sin WhatsApp, por ejemplo). Al tocarlo de nuevo se ve el detalle y se puede reenviar.
- La PC del local tiene que estar prendida con WhatsAppSync abierto. Si estaba apagada, sale al prenderla,
  salvo que hayan pasado más de 3 días.
- Se guarda en la base de WhatsApp en `lineas/envios/despachos/{pedido}`.

---

## Configuración (una sola vez)

### 1. Crear el proyecto de Firebase
1. Entrá a https://console.firebase.google.com con tu cuenta de Google.
2. **Agregar proyecto** → nombre: `homepoint-whatsapp` → Google Analytics: **desactivado** → Crear.

### 2. Crear la base de datos
1. Menú izquierdo: **Compilación → Realtime Database → Crear base de datos**.
2. Ubicación: **Estados Unidos (us-central1)** → **Comenzar en modo bloqueado**.
3. Pestaña **Reglas**: borrá todo, pegá el contenido de `database.rules.json`
   (está en esta carpeta) y tocá **Publicar**.

### 3. Crear los usuarios
1. Menú: **Compilación → Authentication → Comenzar**.
2. Elegí **Correo electrónico/contraseña** → activar → Guardar.
3. Pestaña **Usuarios → Agregar usuario**: cargá tu usuario con **el mismo email
   y la misma contraseña** que usás en pedidosv2.

### 4. Conectar pedidosv2
1. Engranaje ⚙️ (arriba a la izquierda) → **Configuración del proyecto**.
2. Abajo, en **Tus apps**, tocá el ícono **`</>`** (Web) → apodo `pedidosv2` → Registrar.
3. Copiá los datos de `firebaseConfig` (apiKey, authDomain, databaseURL, projectId,
   appId) en el archivo `pedidosv2/config-whatsapp.js`.
   *Si no aparece `databaseURL`, copiala de la pantalla de Realtime Database.*
4. Subí `pedidosv2.html` y `config-whatsapp.js` al hosting.

### 5. Instalar en la PC servidor
1. Copiá el instalador **`WhatsAppSync-Setup-X.exe`** (carpeta `dist`) a la PC servidor y abrilo.
   Windows puede mostrar *"Windows protegió su PC"* porque el instalador no está firmado:
   tocá **Más información → Ejecutar de todas formas**.
2. Se instala solo, sin preguntas, y abre la ventana de WhatsAppSync. Si la PC ya tenía una versión
   anterior, la pasa sola a la línea **Envíos** (no hace falta volver a escanear) y termina acá.
3. En una PC nueva aparece **Agregar línea de WhatsApp**: elegí la línea (**Envíos**, **Munro** o **Caseros**),
   el tipo, el número (Envíos: **11 7646-0030**) y, la primera vez, la clave privada de Firebase
   (**Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**,
   el archivo `.json` que se descarga). La clave se elige **una sola vez por PC** y sirve para todas sus líneas.
   La **Base de pedidos** se completa sola según la línea. La app se queda con una copia de la clave.
   ⚠️ Esa clave da acceso total a la base: no la compartas ni la subas a ningún lado.
4. Aparece el QR en la misma ventana. En el celular de esa línea: WhatsApp → ⋮ →
   **Dispositivos vinculados → Vincular un dispositivo** → escaneá el QR.
5. Cuando dice **"Conectado y guardando mensajes"**, ya está. Cerrá la ventana.

**Importante:** antes de vincular la PC servidor, cerrá el programa viejo (la ventana negra
de `whatsAppSync.bat`) y en el celular, en Dispositivos vinculados, cerrá esa sesión vieja.
Dos copias a la vez se pisan la conexión.

### Varias líneas de WhatsApp
El mismo instalador sirve para todas las líneas (hasta **3 por PC**). Las tres líneas posibles son
**Envíos**, **Munro** y **Caseros** (lista `NODOS` en `ajustes.js`). Todas van en el **mismo proyecto de Firebase**
(`whatsappsync-e3245`), con **la misma clave**, y cada una guarda lo suyo en su nodo:

```
lineas/
  envios/    chats/  imgs/  imgsIdx/  asigManual/  despachos/  info/
  munro/     (igual)
  caseros/   (igual)
actualizacion     aviso de versión nueva (común a todas las PCs)
```

`info/` dice qué número usa la línea. Si otra PC intenta usar la misma línea con **otro** número, la app no
arranca esa línea ("Esta línea la usa otro número") para no mezclar datos; si el cambio es a propósito, se
confirma con **Usar este número**. Lo normal es una línea por PC, pero una PC puede tener dos o tres: cada una
funciona por separado y, si una falla, las demás siguen. Cada línea tiene **su propia base de pedidos**
(Envíos y Munro: `pedidos-87064`; Caseros: `homepoint2-pedidos`): tiene que dejar **leer sin clave** y tener
índice en `timestamp` para `pedidos`. La app lo prueba al guardar y avisa si algo falta.

**Dos tipos de línea** (cada línea puede ser de cualquiera de los dos, y se puede cambiar cuando quieras):

| | **Envíos** | **Cobros** |
|---|---|---|
| Mensajes nuestros que se guardan | Cotizaciones (con «Subtotal $») | Solo el mensaje con la palabra **alias** |
| Comprobantes de pago del cliente | Sí | Sí |
| Archivos que mandamos nosotros | Remitos de envío | **Ninguno** |
| Aviso de despacho (Flecha Carga) | Sí | No |
| Asignar comprobantes a pedidos | Sí, con su base de pedidos | Sí, con su base de pedidos |

En las líneas de **cobros**, nuestro mensaje que trae la palabra **alias** (el que le pasa al cliente los datos
para transferir) cumple el papel de la cotización: se guarda y sirve para ubicar el pedido; si trae un importe con `$`,
se usa para compararlo con el comprobante. Como los alias rotan todo el tiempo, no se carga ninguno: alcanza con
que el mensaje diga «alias» (no importan mayúsculas ni tildes: «Alias:», «ALIAS», etc.).

**Agregar la línea:** en la ventana, botón **+** (o clic derecho en el ícono → **Agregar línea...**):
qué línea es (las que ya están en la PC aparecen apagadas), tipo (Envíos o Cobros), número, base de pedidos
y, si es la primera de la PC, la clave
→ **Guardar y vincular** → escanear el QR con el celular de esa línea.

**Línea principal:** en cada PC, una de sus líneas es la **principal** (★ en la pestaña). Puede ser de cualquier tipo.
Va primera, y es la que usan **Descargar comprobantes** y el **Verificador**. Para cambiarla: pestaña de la línea →
**Datos de la línea** → **Hacer principal**. La primera línea que se agrega en una PC queda como principal; si se quita
la principal, la siguiente pasa a serlo.

- Arriba de la ventana hay una pestaña por línea, con un punto verde (conectada), amarillo (esperando) o rojo (falta algo).
- En **Datos de la línea** se ven y se cambian sus datos (también el tipo), y está **Quitar línea de esta PC**.
- En el celular, el dispositivo vinculado aparece como *WhatsAppSync · nombre de la línea*.
- Los **avisos de despacho** salen de cada línea de tipo Envíos, para los envíos que pedidosv2 carga en **su** nodo.
  Hoy pedidosv2 solo carga en `lineas/envios`, así que en la práctica salen desde la línea Envíos.
- pedidosv2 y el control de transferencias muestran solo la línea **Envíos** (`whatsappRaiz` en
  `pedidosv2/config-whatsapp.js`). Ver Munro o Caseros ahí es trabajo aparte.
- El aviso de **actualización** va en la raíz de la base (`actualizacion`), común a todas las PCs.

**Pasar una línea a otra PC:** en la PC vieja, **Quitar línea de esta PC**. En la nueva, **+** con los mismos datos
y escanear el QR. ⚠️ Una línea no puede estar en dos PCs a la vez: se pisan la conexión y aparece "Hay otra copia conectada".

### Cómo se usa
- Vive en la **bandeja**, al lado del reloj (si no lo ves, tocá la flechita **^**).
  Ícono verde: todas las líneas conectadas. Con punto amarillo: alguna esperando o reconectando.
  Gris con punto rojo: a alguna le falta algo. Al pasar el mouse se ve el estado de cada una.
- **Cerrar o minimizar la ventana no lo detiene.** Para salir de verdad: clic derecho en el
  ícono → **Salir...** y confirmar.
- Arranca solo al prender la PC (se puede desactivar en *Iniciar con Windows*). Siempre arranca
  escondido en la bandeja, también si lo abrís a mano: la ventana solo aparece al hacer clic en el ícono,
  o sola cuando hace falta algo (escanear el QR, cargar la clave, otra copia conectada).
- Los datos de cada línea (sesión de WhatsApp, registros) están en `%APPDATA%\WhatsAppSync\lineas\<línea>`
  (botón **Carpeta de datos**) y la clave común en `%APPDATA%\WhatsAppSync\firebase\clave.json`.
  Desinstalar la app no los borra.
- Los plazos (90 días, 30 días) están en `ajustes.js` y valen para todas las líneas.
- La primera vez que arranca esta versión hace una **limpieza única**: borra de Firebase los textos
  que se guardaban antes y revisa las fotos ya guardadas, dejando solo cotizaciones y comprobantes.
  Puede tardar un rato; el avance queda en `limpieza-cotizaciones.json` y, si se corta, sigue
  en el próximo arranque.

### Actualizaciones automáticas
Las PCs se actualizan **solas, sin preguntar nada**: bajan la versión nueva en segundo plano, se cierran
y se vuelven a abrir (escondidas en la bandeja, como siempre). Las líneas se detienen con cuidado antes,
así que no hace falta volver a escanear el QR.

**Publicar una versión nueva** (después de hacer cambios en el programa):
1. Doble clic en **`publicar-actualizacion.bat`** (en esta carpeta).
2. La primera vez pide un **token de GitHub** y explica cómo sacarlo. Queda guardado en `.token-github`
   (no se sube a git; no lo compartas).
3. Pregunta qué cambió (opcional) y hace todo solo: sube un número la versión, arma el instalador,
   lo sube a GitHub (entrega **whatsappsync** del repositorio homepoint) y avisa a las PCs.
4. Las PCs prendidas se actualizan **en segundos**. Las que estaban apagadas o sin internet,
   al prenderse o en 10 minutos como mucho.

**Una sola vez, para que el aviso sea al instante:** publicar de nuevo `database.rules.json` en la base
de **Envíos** (Firebase → Realtime Database → Reglas → pegar y **Publicar**). Sin eso igual se actualizan,
pero revisando cada 10 minutos.

**Primera vez en cada PC:** las versiones anteriores no saben actualizarse solas. Después de la primera
publicación, instalá a mano en cada PC el instalador `dist\WhatsAppSync-Setup-X.exe` que armó el publicador.
De ahí en adelante, todo es automático.

- La versión instalada y el estado de la actualización se ven al pie de la ventana.
- Lo que pasó queda en la **Actividad** de cada línea y en `actualizaciones.log` (carpeta de datos).
- La entrega en GitHub es un *pre-release*: así la app Android de pedidos, que busca el último release, no la confunde con la suya.

### Armar un instalador a mano (sin publicarlo)
En esta carpeta: `npm install` (una vez) y después `npm run instalador`. Sale en `dist`.
Para probar sin instalar: `npm start`. El `whatsAppSync.bat` queda como modo alternativo
sin bandeja: no usarlo al mismo tiempo que la app.

---

## Si algo falla

| Problema | Qué hacer |
|---|---|
| Vuelve a pedir el QR | Se desvinculó desde el celular o pasó mucho tiempo sin conexión. Escaneá de nuevo. |
| "se vinculó el número X y se esperaba..." | Escaneaste con otro celular. Usá el de esa línea (el que dice el QR). |
| "La clave o la base de Firebase no sirven" | La clave no es del proyecto de WhatsApp. Elegí la clave correcta (una sola para toda la PC). |
| "Esta línea la usa otro número" | Esa línea ya está en Firebase con otro número (otra PC, o se equivocó de línea). Corregí **Editar datos** o, si es a propósito, **Usar este número**. |
| En pedidosv2 pide la contraseña | Pasa una sola vez por usuario. Si dice "usuario no creado", falta el paso 3 para ese email. |
| "Todavía no hay mensajes guardados" | Ese número no tiene chat con el local, o el teléfono del pedido está mal cargado. |
| "Hay otra copia conectada" | Esa línea está abierta en otra PC (o quedó el programa viejo). Quitala allá y tocá **Reiniciar conexión**. |
| Registro de lo que pasó | Sección **Actividad** de la ventana, o carpeta `logs` dentro de la carpeta de datos. |

Para desvincular: en la pestaña de la línea, botón **Desvincular WhatsApp**. También cierra la sesión en el celular.

---

## Mudanza a un solo proyecto (una sola vez, 2026-11)

Hasta la versión anterior todo estaba en la raíz de la base. Para pasar al formato de líneas, en horario sin movimiento:

1. Publicar **`database.rules.transicion.json`** en Firebase → Realtime Database → Reglas (sirve para el formato viejo y el nuevo).
2. **`publicar-actualizacion.bat`**: las PCs se actualizan solas y desde ese momento guardan en `lineas/envios`.
   La clave de cada PC se pasa sola a la carpeta común; no hace falta volver a escanear el QR.
3. Subir **`pedidosv2/pedidosv2.html`**, **`pedidosv2/config-whatsapp.js`** y **`controlTransferencias.html`**.
4. En una PC con la clave: `node migrar-a-lineas.js` (solo mide) y después `node migrar-a-lineas.js --mudar`.
   Si se corta, se vuelve a correr. Después, **Reiniciar conexión** en la línea Envíos.
5. Revisar pedidosv2 (conversaciones, comprobantes, avisos de despacho) y publicar **`database.rules.json`** (la final).
