# Portal "Trabajá con nosotros": guía de instalación

Esta guía es para alguien que no programa. Seguí los pasos en orden. Te va a llevar unos 40 minutos la primera vez.

---

## 0. Qué hay en esta carpeta

| Archivo | Para qué sirve | ¿Se sube al hosting? |
|---|---|---|
| `formulario/` | Página pública con el formulario, lista para subir a su host | Sí (al host del formulario) |
| `panel/` | Panel de administración (con usuario y contraseña), listo para subir a su host | Sí (al host del panel) |
| `config/firebase-config.js` (dentro de cada carpeta) | Credenciales de Firebase | Sí |
| `config/sitio.js` (dentro de cada carpeta) | Textos: presentación, puestos por defecto, direcciones, preguntas frecuentes | Sí |
| `cuestionario.json` | Preguntas **con puntajes**. Se carga desde el panel | **No** |
| `database.rules.json` | Reglas de seguridad de la base de datos | **No** (se pegan en Firebase) |
| `firebase.json`, `INSTRUCCIONES.md` | Uso interno | **No** |

> **Importante sobre `cuestionario.json`:** tiene los puntajes. No lo subas al hosting y, si esta carpeta está en un repositorio público de GitHub, no la subas ahí tampoco (cualquiera podría verla). Una vez cargado en el panel, el formulario usa una copia **sin puntajes** que se genera sola.

---

## 1. Crear el proyecto en Firebase

1. Entrá a <https://console.firebase.google.com> con tu cuenta de Google.
2. Tocá **"Crear un proyecto"**, ponele un nombre (por ejemplo `homepoint-busqueda`) y seguí los pasos. Google Analytics no hace falta, podés desactivarlo.
3. **Plan:** alcanza con el plan gratis (**Spark**). No hace falta cargar tarjeta.

## 2. Registrar la página web y copiar las credenciales

1. En la pantalla principal del proyecto tocá el ícono **`</>`** ("Web").
2. Nombre: `Portal empleo`. **No** marques "Firebase Hosting" (salvo que vayas a usarlo; ver la alternativa del paso 9). Tocá **Registrar app**.
3. Aparece un bloque de código con `const firebaseConfig = { ... }`. Dejá esa pantalla abierta.
4. En tu compu, abrí `config/firebase-config.js` con el Bloc de notas (clic derecho → Abrir con → Bloc de notas).
5. Reemplazá cada `PEGAR_AQUI` por el valor correspondiente (`apiKey`, `authDomain`, etc.). Respetá las comillas.
6. El `databaseURL` todavía no aparece: lo completás en el paso 3. Guardá el archivo.

## 3. Activar Realtime Database (los datos)

1. Menú izquierdo: **Compilación → Realtime Database → Crear base de datos**.
2. Ubicación: la que te ofrece (Estados Unidos está bien). Modo: **"Modo bloqueado"**.
3. Arriba de la base vas a ver una dirección tipo `https://homepoint-busqueda-default-rtdb.firebaseio.com`. Copiala y pegala en `databaseURL` dentro de `config/firebase-config.js`.
4. Pestaña **Reglas**: borrá todo lo que hay, abrí `database.rules.json` con el Bloc de notas, copiá **todo** el contenido, pegalo y tocá **Publicar**.

### Qué hacen estas reglas (en simple)

- **Todo cerrado por defecto.** Nadie lee ni escribe nada, salvo lo que se permite abajo.
- **`cvs`:** las páginas del CV de cada postulación, como imágenes. El público solo puede agregarlas (no leerlas ni cambiarlas), con tamaño máximo. Solo administradores las ven.
- **`postulaciones`:** el público puede **crear** una postulación nueva, pero **no puede leer ninguna** (ni la suya), ni modificarla, ni borrarla. Cada postulación se revisa: deben estar todos los campos obligatorios, con el tipo correcto (texto, número, sí/no), con largo máximo, sin campos extra, y el estado tiene que ser "Nuevo". El público no puede escribir notas internas ni fecha de contacto.
- **`dni`:** guarda cada DNI que ya se postuló. Si el DNI ya existe, la base rechaza el envío y la persona ve "Ya recibimos una postulación con este DNI". Así se evitan duplicados sin que el público pueda consultar datos de nadie.
- **`contadores`:** solo sirve para numerar las postulaciones (HP-2026-0001, 0002…). Solo se puede sumar de a uno.
- **`publico`:** los puestos y las preguntas **sin puntajes**. Lo lee cualquiera; solo los administradores lo cambian.
- **`configuracion`:** cuestionario con puntajes, pesos y entrevista. Solo administradores.
- **`admins`:** la lista de administradores. **Nadie puede modificarla desde la web**, solo vos desde la consola de Firebase.

## 4. Los CV (no hay que activar nada)

Los CV se guardan **dentro de la misma Realtime Database**, como imágenes JPG, en el nodo `cvs`. **No se usa Firebase Storage**, así que el proyecto funciona con el **plan gratis (Spark)** y no hace falta cargar una tarjeta.

- Si la persona sube un PDF, el navegador lo convierte en una imagen JPG por página (hasta 5 páginas). **El PDF original no se guarda.**
- Cada página queda en 900 KB como máximo (si pesa más, se recomprime sola).
- Las reglas del paso 3 ya protegen este nodo: el público solo puede **agregar** las páginas de una postulación que se acaba de enviar (dentro de las 24 horas), no puede leerlas ni reemplazarlas, y cada página tiene un tamaño máximo. Solo los administradores las ven.

**Cuánto entra en el plan gratis:** la base tiene 1 GB. Una página de CV ocupa entre 150 y 750 KB (las fotos y los textos muy cargados pesan más). Con un promedio de 2 páginas por persona entran **entre 700 y 1.500 postulaciones**. Podés ver cuánto usaste en **Realtime Database → Uso**. Para liberar espacio, borrá los CV de búsquedas viejas (nodo `cvs/…` de cada postulación).

## 5. Activar Authentication (login del panel)

1. Menú: **Compilación → Authentication → Comenzar**.
2. En **Método de acceso**, activá **Correo electrónico/contraseña** (solo la primera opción) y guardá.
3. En **Configuración → Dominios autorizados**, agregá el dominio donde vas a publicar el sitio (por ejemplo `trabajo.homepoint.com.ar`).

## 6. Crear el usuario administrador y darle permiso

1. **Authentication → Usuarios → Agregar usuario**. Poné el email y una contraseña segura.
2. En la lista aparece el usuario con una columna **UID** (un código largo). Copialo.
3. Andá a **Realtime Database → Datos**. Pasá el mouse sobre la raíz y tocá **+**:
   - Nombre: `admins` → tocá el **+** de ese nuevo nodo.
   - Nombre: *el UID que copiaste*. Valor: `true`. Tipo: booleano (si te deja elegir). Tocá **Agregar**.

## 7. Activar App Check (protección contra robots)

Hace que solo tu página pueda escribir en la base. El postulante no ve nada (no hay "no soy un robot").

1. Entrá a <https://www.google.com/recaptcha/admin/create>.
   - Etiqueta: `HomePoint empleo`. Tipo: **reCAPTCHA v3** (basado en puntuación).
   - Dominios: el de tu sitio (ej. `trabajo.homepoint.com.ar`). Enviar.
   - Te da dos claves: **de sitio** y **secreta**.
2. Pegá la **clave de sitio** en `config/firebase-config.js`, en `recaptchaSiteKey`.
3. En Firebase: **Compilación → App Check → Apps**, elegí tu app web → **reCAPTCHA** → pegá la **clave secreta** → Guardar.
4. **Todavía no toques "Aplicar".** Primero publicá el sitio (paso 9) y hacé una postulación de prueba.
5. Cuando todo funcione: en **App Check → APIs**, en **Realtime Database** tocá **Aplicar** (Enforce). Desde ese momento, todo pedido que no venga de tu página se rechaza.

## 8. Cargar el cuestionario

1. Publicá el panel (paso 9) y entrá a su dirección.
2. Ingresá con el email y contraseña del paso 6.
3. Pestaña **Configuración → Cuestionario → "Cargar cuestionario.json"** y elegí el archivo `cuestionario.json` de esta carpeta.
4. Listo: el formulario público ya muestra las preguntas, **sin puntajes**.
5. En la misma pantalla revisá los **Puestos** (tocá "Guardar puestos" para publicarlos), los **Pesos** y la **Entrevista**.

### Cambiar preguntas o puntajes más adelante

- **Configuración → Cuestionario → "Editar acá"**, cambiás y tocás **Guardar y publicar**. Se crea una versión nueva; las postulaciones viejas se siguen calculando con la versión que respondieron.
- O editás `cuestionario.json` en tu compu y lo volvés a cargar.

**Cómo está armado `cuestionario.json`:**
- `tipo: "perfil"`: suma puntos. Cada opción tiene `"puntos": { "AUT": 3, "NOR": 1 }`.
- `tipo: "espejo"`: repite otra pregunta con otras palabras (`"espejoDe": "P4"`). Cada opción dice con qué respuestas de la original es coherente (`"coincideCon": ["A"]`). Si no coincide, cuenta una contradicción.
- `tipo: "sinceridad"`: afirmaciones Verdadero/Falso. `"alerta": true` marca la respuesta "para quedar bien".
- `confiabilidad`: cada contradicción suma 2 y cada "Verdadero" suma 1. Con 0–1 es **Alta**, con 2–3 **Media** y con 4 o más **Baja**. Podés cambiar esos números.

## 9. Publicar el sitio en Hostinger

El formulario y el panel van en **dos hosts distintos**. Cada uno tiene su carpeta lista para subir:

| Carpeta | Qué es | Dónde va |
|---|---|---|
| `formulario/` | La página pública para los postulantes | Host del formulario (ej. `trabajo.homepoint.com.ar`) |
| `panel/` | El panel de administración (su página principal es `index.html`) | Host del panel (ej. `seleccion.homepoint.com.ar`) |

1. En el Administrador de archivos de cada host, subí **todo el contenido** de su carpeta (no la carpeta en sí): los archivos sueltos, el `.htaccess` y las subcarpetas `css`, `js` y `config`.
2. **No subas** `cuestionario.json`, `database.rules.json`, `firebase.json` ni este archivo. Quedan solo en tu compu.
3. Asegurate de que **los dos dominios** tengan **SSL activo** (candado). En hPanel: **Seguridad → SSL**.
4. En Firebase, **Authentication → Dominios autorizados**: agregá el dominio del **panel** (es donde se inicia sesión).
5. En reCAPTCHA (paso 7): agregá **los dos dominios**, el del formulario y el del panel.
6. Si cambiás `config/sitio.js` o `config/firebase-config.js`, el archivo está en las dos carpetas: hacé el mismo cambio en las dos y subilo a los dos hosts.

### Alternativa: Firebase Hosting

Requiere instalar Node.js y usar la terminal. Si te interesa: instalá Node.js desde <https://nodejs.org>, abrí la terminal en esta carpeta y corré `npm install -g firebase-tools`, `firebase login`, `firebase use --add` (elegí tu proyecto) y `firebase deploy --only hosting`. El archivo `firebase.json` ya excluye los archivos privados.

## 10. Prueba final (checklist)

- [ ] Abrí la página pública desde el celular y completá una postulación de prueba con tu DNI.
- [ ] Ves la pantalla de "¡Gracias!" con un número HP-AAAA-0001.
- [ ] Intentá postularte de nuevo con el mismo DNI: tiene que aparecer el aviso de duplicado.
- [ ] En el panel aparece la postulación, con perfil, gráfico, respuestas y CV.
- [ ] Probá "Invitar a entrevista por WhatsApp".
- [ ] Activá App Check (paso 7.5) y repetí una postulación de prueba.
- [ ] Borrá las postulaciones de prueba: en **Realtime Database → Datos**, borrá su entrada en `postulaciones`, en `cvs` y su DNI en `dni`. Si querés que la numeración vuelva a empezar, borrá también `contadores`.

---

## Preguntas frecuentes del administrador

**¿Cómo cambio colores?** En `css/estilos.css`, arriba de todo (`:root`): `--marca` es el violeta del botón principal, `--tinta` el color de los títulos.

**¿Cómo cambio textos de inicio, direcciones o preguntas frecuentes?** En `config/sitio.js`. Después volvé a subir ese archivo.

**¿Cómo agrego otro administrador?** Creá el usuario en Authentication, copiá su UID, agregalo en `admins` con valor `true`. Listo.

**Una persona pide corregir sus datos.** Abrí su ficha → **Editar datos**. Si te pide borrarlos (derecho de la Ley 25.326), borrá su entrada en `postulaciones`, en `cvs` y en `dni`.

**Exportar a Excel.** El botón "Exportar a Excel" baja un archivo `.csv` con lo que estás viendo (respeta filtros y búsqueda), con puntajes. Se abre directo con Excel.

**Probar en tu compu antes de publicar (opcional).** Los navegadores no dejan abrir este tipo de página con doble clic: hace falta un servidor local (por ejemplo, la extensión "Live Server" de VS Code). Si App Check está configurado, en la consola del navegador (F12) aparece un "debug token": registralo en **App Check → Apps → ⋮ → Administrar tokens de depuración**.
