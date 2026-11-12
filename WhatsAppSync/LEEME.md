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
script de descarga es el único que renombra y sube el aviso a Firebase (`imgsIdx/{id}/verif`).

- No envía mensajes nunca.
- Comprobantes y cotizaciones se borran solos a los 90 días.
- La primera vez que lee una imagen baja el idioma español del lector de texto (necesita internet).
- Si a algún banco no lo reconoce, se agrega a la lista `BANCOS` al principio de `index.js`.
- La PC tiene que estar prendida para que se guarden los mensajes. Al prenderla,
  recupera lo que entró mientras estuvo apagada.

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
1. Copiá el instalador **`WhatsAppSync Setup 1.0.0.exe`** (carpeta `dist`) a la PC servidor y abrilo.
   Windows puede mostrar *"Windows protegió su PC"* porque el instalador no está firmado:
   tocá **Más información → Ejecutar de todas formas**.
2. Se instala solo, sin preguntas, y abre la ventana de WhatsAppSync.
3. Tocá **Elegir archivo de clave…** y elegí la clave privada de Firebase
   (**Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**,
   el archivo `.json` que se descarga). La app se queda con una copia.
   ⚠️ Esa clave da acceso total a la base: no la compartas ni la subas a ningún lado.
4. Aparece el QR en la misma ventana. En el celular del **11 7646-0030**: WhatsApp → ⋮ →
   **Dispositivos vinculados → Vincular un dispositivo** → escaneá el QR.
5. Cuando dice **"Conectado y guardando mensajes"**, ya está. Cerrá la ventana.

**Importante:** antes de vincular la PC servidor, cerrá el programa viejo (la ventana negra
de `whatsAppSync.bat`) y en el celular, en Dispositivos vinculados, cerrá esa sesión vieja.
Dos copias a la vez se pisan la conexión.

### Cómo se usa
- Vive en la **bandeja**, al lado del reloj (si no lo ves, tocá la flechita **^**).
  Ícono verde: conectado. Con punto amarillo: esperando o reconectando. Gris con punto rojo: falta algo.
- **Cerrar o minimizar la ventana no lo detiene.** Para salir de verdad: clic derecho en el
  ícono → **Salir...** y confirmar.
- Arranca solo al prender la PC (se puede desactivar en *Iniciar con Windows*). Siempre arranca
  escondido en la bandeja, también si lo abrís a mano: la ventana solo aparece al hacer clic en el ícono,
  o sola cuando hace falta algo (escanear el QR, cargar la clave, otra copia conectada).
- Sus datos (clave, sesión de WhatsApp, registros) están en `%APPDATA%\WhatsAppSync`
  (botón **Carpeta de datos**). Desinstalar la app no los borra.
- La URL de la base y los plazos (90 días, 30 días) están en `ajustes.js`.
- La primera vez que arranca esta versión hace una **limpieza única**: borra de Firebase los textos
  que se guardaban antes y revisa las fotos ya guardadas, dejando solo cotizaciones y comprobantes.
  Puede tardar un rato; el avance queda en `limpieza-cotizaciones.json` y, si se corta, sigue
  en el próximo arranque.

### Armar un instalador nuevo (si se cambia el programa)
En esta carpeta: `npm install` (una vez) y después `npm run instalador`. Sale en `dist`.
Para probar sin instalar: `npm start`. El `whatsAppSync.bat` queda como modo alternativo
sin bandeja: no usarlo al mismo tiempo que la app.

---

## Si algo falla

| Problema | Qué hacer |
|---|---|
| Vuelve a pedir el QR | Se desvinculó desde el celular o pasó mucho tiempo sin conexión. Escaneá de nuevo. |
| "se vinculó el número X y se esperaba..." | Escaneaste con otro celular. Usá el del 11 7646-0030. |
| En pedidosv2 pide la contraseña | Pasa una sola vez por usuario. Si dice "usuario no creado", falta el paso 3 para ese email. |
| "Todavía no hay mensajes guardados" | Ese número no tiene chat con el local, o el teléfono del pedido está mal cargado. |
| "Hay otra copia conectada" | Quedó abierto el programa viejo u otra PC con la misma sesión. Cerralo y tocá **Reiniciar conexión**. |
| Registro de lo que pasó | Sección **Actividad** de la ventana, o carpeta `logs` dentro de la carpeta de datos. |

Para desvincular: botón **Desvincular WhatsApp** de la ventana, y en el celular,
Dispositivos vinculados → cerrar la sesión de "WhatsAppSync".
