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

### 5. Clave privada para este programa
1. **Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada**.
2. Se descarga un archivo `.json`. Renombralo a **`clave-firebase.json`** y ponelo
   en esta carpeta (`WhatsAppSync`).
   ⚠️ Esa clave da acceso total a la base: no la compartas ni la subas a ningún lado.

### 6. URL de la base
Abrí `ajustes.js` de esta carpeta y en `DATABASE_URL` pegá la URL de la
Realtime Database (la que empieza con `https://` y termina en `firebaseio.com`
o `firebasedatabase.app`).

### 7. Vincular WhatsApp
1. Doble clic en **`whatsAppSync.bat`**. La primera vez instala lo necesario (tarda unos minutos).
2. Se abre una página con un QR (también aparece en la ventana negra).
3. En el celular del **11 7646-0030**: WhatsApp → ⋮ → **Dispositivos vinculados →
   Vincular un dispositivo** → escaneá el QR.
4. Al vincular, el celular manda el historial reciente (se guardan hasta 90 días).
   Cuando la ventana dice **"Conectado como 5491176460030"**, ya está funcionando.

La ventana negra tiene que quedar abierta (se puede minimizar).

### 8. Que arranque solo al prender la PC
1. Tecla Windows + R → escribí `shell:startup` → Enter.
2. En esa carpeta: clic derecho → **Nuevo → Acceso directo** → elegí `whatsAppSync.bat`
   de esta carpeta.

---

## Si algo falla

| Problema | Qué hacer |
|---|---|
| Vuelve a pedir el QR | Se desvinculó desde el celular o pasó mucho tiempo sin conexión. Escaneá de nuevo. |
| "se vinculó el número X y se esperaba..." | Escaneaste con otro celular. Usá el del 11 7646-0030. |
| En pedidosv2 pide la contraseña | Pasa una sola vez por usuario. Si dice "usuario no creado", falta el paso 3 para ese email. |
| "Todavía no hay mensajes guardados" | Ese número no tiene chat con el local, o el teléfono del pedido está mal cargado. |
| Registro de lo que pasó | Carpeta `logs`, un archivo por día. |

Para desvincular del todo: en el celular, Dispositivos vinculados → cerrar la sesión
de este dispositivo, y borrar la carpeta `sesion`.
