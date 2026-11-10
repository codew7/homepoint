# WhatsApp en pedidosv2 (solo lectura)

Este programa corre en la PC del local. Se vincula al WhatsApp **+54 9 11 7646-0030**
como "dispositivo vinculado" (igual que WhatsApp Web) y copia los mensajes de los
chats individuales a un **proyecto de Firebase aparte**. En pedidosv2, cada pedido
muestra el botón **"Ver conversación de WhatsApp"**.

- No envía mensajes nunca.
- Grupos, estados y canales no se guardan.
- Las **fotos y los documentos que manda el cliente** (PDF o imagen, como comprobantes) se guardan
  como imagen comprimida (de un PDF, su primera página) y se borran solos a los 90 días.
  Tus propios adjuntos, los audios y otros archivos (Word, Excel) aparecen solo como texto.
- Los **mensajes de texto** de números que nunca hicieron un pedido (curiosos) se borran a los 30 días.
  Sus fotos y documentos no se tocan. Los chats de clientes (con pedido vigente o cerrado) quedan completos.
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
- Arranca solo al prender la PC, sin mostrar la ventana (se puede desactivar en *Iniciar con Windows*).
- Sus datos (clave, sesión de WhatsApp, registros) están en `%APPDATA%\WhatsAppSync`
  (botón **Carpeta de datos**). Desinstalar la app no los borra.
- La URL de la base y los plazos (90 días, 30 días) están en `ajustes.js`.

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
