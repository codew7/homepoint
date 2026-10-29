# Locator: mapa de zonas del depósito

Una vez por semana recorrés el depósito sacando fotos, siempre en el mismo orden. Después pasás las fotos a la PC, ejecutás un programa y en unos minutos Firebase sabe en qué zona está cada producto. pedidosv2 usa ese mapa para ordenar los "Artículos necesarios" según el recorrido.

Las fotos las lee **Claude Code con tu suscripción** de Claude. No se usa la API ni se paga aparte. Todo corre en tu PC con Windows.

## La idea: el orden de las fotos es la ubicación

- **Cada foto es una zona.** La primera foto del recorrido es la zona 1, la segunda la zona 2, y así.
- **Cada foto tiene dos columnas de mercadería.** El programa corta la foto en mitad **izquierda** y mitad **derecha**, y le manda cada mitad a Claude por separado. Así Claude ve las etiquetas con el doble de detalle y además sabemos en qué columna está cada producto.
- **Las ubicaciones quedan así:** "Zona 12 · izquierda", "Zona 12 · derecha"…
- **No hacen falta carteles ni marcas.** El orden sale de la fecha de las fotos o, si preferís, del nombre del archivo.

### Para que los números de zona no cambien de una semana a otra
Los números dependen de la cantidad y del orden de las fotos. Si una semana sacás una foto de más, todas las siguientes se corren un número. Para evitarlo:
1. **Hacé siempre el mismo recorrido**, en el mismo sentido y empezando en el mismo lugar.
2. **Sacá una foto por cada tramo de estantería** (dos columnas), parándote siempre en el mismo lugar. Una buena referencia son los parantes de la estantería.
3. **Si una foto salió mal, borrala en el celular y repetila en el momento.** No dejes las dos.

Si la cantidad de fotos cambió respecto de la semana anterior, el programa **avisa**. El informe trae una **hoja de zonas**, con la miniatura de cada foto y su número, para revisar dónde se corrió.

---

## Archivos

| Archivo | Qué es |
|---|---|
| `relevar.bat` | Lo que usás cada semana. Con doble clic baja el último recorrido de LocatorPic y lo analiza; también podés arrastrar una carpeta de fotos encima. |
| `descargar.py` | Baja el último recorrido de LocatorPic, reemplaza las fotos anteriores y limpia Storage. |
| `instalar.bat` | Se ejecuta una sola vez para instalar lo necesario. |
| `config.ejemplo.env` | Modelo del archivo de configuración `.env`. |
| `relevar.py` | Programa principal: une todos los pasos. |
| `planilla.py` | Lee la planilla y normaliza los precios. |
| `fotos.py` | Ordena las fotos y las corta en dos columnas. |
| `lector_claude.py` | Le pasa las imágenes a Claude Code y valida el JSON que devuelve. |
| `identificar.py` | Decide qué producto es cada etiqueta (incluye el desempate por categoría). |
| `guardar_firebase.py` | Escribe el resultado en Firebase. |
| `informe.py` | Arma el informe HTML con la hoja de zonas. |
| `ubicaciones-api.js` | Funciones para que pedidosv2 y otras apps consulten las zonas. |

---

## Preparación (una sola vez)

### 1. Claude Code
Ya está instalado en esta PC y conectado a tu suscripción. Para comprobarlo, abrí una consola y escribí `claude auth status`. Tiene que decir `"authMethod": "claude.ai"`.

### 2. Python y librerías
Python ya está instalado. Hacé doble clic en **`instalar.bat`**. Instala las librerías y crea el archivo `.env`.

### 3. Credencial de Firebase (cuenta de servicio)
Este archivo le da al programa permiso para leer y escribir en Firebase desde la PC.

1. Entrá a https://console.firebase.google.com y abrí el proyecto **pedidos-87064**.
2. Tocá el engranaje → **Configuración del proyecto** → pestaña **Cuentas de servicio**.
3. Tocá **Generar nueva clave privada** → **Generar clave**. Se descarga un archivo `.json`.
4. Movelo a una carpeta **fuera** del proyecto, por ejemplo `C:\HomePoint\credenciales\`, y renombralo `firebase-pedidos-87064.json`.

⚠️ Ese archivo da acceso total a la base de datos. No lo subas a GitHub, no lo mandes por WhatsApp y no lo copies a otras PCs.

### 4. Completar `.env`
Abrí el archivo `.env` (en la carpeta `Locator`) con el Bloc de notas y revisá que la línea `FIREBASE_CREDENCIALES` apunte al archivo del paso 3. Los demás datos ya vienen completos.

### 5. Planilla
El programa descarga la hoja **Lista** como CSV, sin clave, porque la planilla está compartida "con cualquier persona que tenga el enlace". Si algún día cambiás eso, el programa avisa que no puede leerla.

### 6. Regla de lectura en Firebase (para las apps)
Para que pedidosv2 pueda **leer** las ubicaciones, en la consola de Firebase andá a **Realtime Database → Reglas** y pegá solo este bloque, al lado de los demás. Ya está en `database.rules.json`.

```json
"ubicaciones": {
  ".read": "auth != null",
  ".write": "auth != null && auth.token.email !== 'homepoint2@homepoint.com' && root.child('admins').child(auth.token.email.replace('.', ',')).exists()"
},
```

El programa de la PC escribe igual aunque esta regla no esté, porque usa la cuenta de servicio.

---

## Cómo sacar las fotos

1. Configurá la cámara en **JPG**, no HEIC.
2. **Una foto por tramo: dos columnas de mercadería**, de frente, ocupando toda la foto. Dejá un poco de margen a los costados para no cortar etiquetas.
3. **Foto horizontal**, con las dos columnas una al lado de la otra. El programa corta la foto justo por el medio.
4. Siempre el **mismo recorrido**, en el mismo orden.
5. Consejos:
   - Tocá la pantalla para enfocar sobre las etiquetas.
   - Si brillan, sacá la foto un poco de costado.
   - Si un producto tapa su etiqueta, correlo.

Las fotos tienen que llegar a la PC **sin cambiar su fecha**. Por cable USB o por Google Fotos (descargando el original) se conserva. Si la fecha se pierde, usá `--orden nombre`: los nombres del celular, del tipo `IMG_20261029_101530`, ya siguen el orden en que se sacaron.

---

## Uso semanal con LocatorPic (recomendado)

Las fotos se sacan con la app **LocatorPic** en el Android: ver `..\LocatorPic\README.md`. La app numera las zonas y sube las fotos sola.

1. En la app: sacá el recorrido y tocá **Finalizar**.
2. En la PC: **doble clic en `relevar.bat`**, sin arrastrar nada. El programa:
   - baja el último recorrido terminado a `C:\HomePoint\Relevamiento\actual`;
   - **borra las fotos del recorrido anterior**, pero recién cuando las nuevas bajaron completas;
   - usa el orden de zonas de la app, sin depender de fechas ni nombres;
   - borra de Firebase Storage los recorridos viejos (deja solo el último).
3. Se abre el informe. Respondé **s** para guardar.
4. La app pasa a mostrar "Analizado en la PC: N productos ubicados".

Si volvés a ejecutar `relevar.bat` con el mismo recorrido (por ejemplo, porque falló el guardado), no vuelve a bajar nada ni a consultar a Claude.

La carpeta se cambia en `.env` con `RELEVAMIENTO_CARPETA`. Por seguridad, el programa solo borra una carpeta que haya creado él (que tenga `sesion.json`) o que esté vacía. `descargar.py` también funciona solo (`python descargar.py`): baja el recorrido sin analizarlo.

## Uso semanal con fotos sueltas (sin la app)

1. Copiá **todas** las fotos del recorrido a una carpeta nueva, por ejemplo `C:\Relevamientos\2026-10-29`.
2. **Arrastrá esa carpeta sobre `relevar.bat`.**
3. Esperá. Con 50 fotos son unas 100 columnas, que tardan entre 5 y 10 minutos. Vas a ver el avance en la ventana.
4. Se abre el informe en el navegador. Revisá la hoja de zonas y los números.
5. En la ventana, respondé **s** para guardar en Firebase o **n** para no guardar.

**Cada relevamiento reemplaza el mapa completo.** Los productos que estaban ubicados y esta semana no aparecieron se marcan "posiblemente movidos": se conserva dónde estaban, pero la app los muestra como inciertos.

Si alguna foto no se pudo analizar, **el programa no guarda**. Si guardara, los productos de esa foto quedarían como movidos sin serlo. Volvé a arrastrar la carpeta: reintenta solo las fotos que fallaron.

### Opciones (desde una consola)

```
python relevar.py "C:\Relevamientos\2026-10-29" --sin-guardar
```

| Opción | Para qué |
|---|---|
| `--sin-guardar` | Probar: arma el informe sin tocar Firebase. Ideal para la primera vez. |
| `--orden nombre` | Ordena las fotos por nombre de archivo en vez de por fecha. |
| `--si` | Guarda sin preguntar. |
| `--forzar` | Guarda aunque haya fotos sin analizar. |
| `--modelo sonnet` | Usa Sonnet en vez del modelo que tengas elegido. Rinde más con el límite de la suscripción. |
| `--lote 8` | Cuántas imágenes se mandan juntas a Claude (de 1 a 10). |

### Si se corta a la mitad
Lo que Claude ya analizó queda guardado dentro de la carpeta de fotos, en `.locator\analisis.json`. Si el programa se corta (por el límite de uso, porque se cerró la ventana o porque se cortó internet), **volvé a arrastrar la misma carpeta** y sigue desde donde quedó, sin gastar de nuevo.

### Límite de la suscripción
Cada columna gasta una parte de tu límite del plan Pro, como si mandaras una imagen en un chat. Un recorrido de menos de 50 fotos debería entrar. Si se alcanza el límite, el programa lo avisa y se detiene: volvé a ejecutarlo más tarde y sigue desde ahí.

---

## Precios repetidos: cómo se desempata

En la planilla, **1079 de 1761 productos comparten precio** con otro. Cuando una etiqueta tiene un precio repetido, el programa prueba en este orden:

1. **El código de la etiqueta**, si llegó a leerse completo. Al cortar las fotos en dos, muchas veces se lee.
2. **El texto de la etiqueta** (nombre, marca, medida), comparado con el nombre de cada candidato.
3. **La categoría (columna A).** Como los productos suelen estar agrupados, cada candidato suma puntos por los productos de su misma categoría que hay:
   - en la misma columna (lo que más pesa);
   - en la otra columna de la misma foto;
   - en las fotos de al lado;
   - en esas zonas según el relevamiento anterior.

   Solo elige si un candidato gana con claridad.
   - Si la pista es fuerte, queda con confianza **media**.
   - Si es débil, queda con confianza **baja**, y la app lo muestra como incierto.
   - Si no hay pistas, queda **ambiguo** y no adivina.

Los pesos se pueden ajustar al principio de la sección "Desempate por categoría" de `identificar.py`.

---

## El informe

Queda en `Locator\informes\` y muestra:
- **Aviso** si la cantidad de fotos cambió respecto de la semana anterior.
- Productos ubicados, precios leídos y qué porcentaje tiene confianza alta.
- Etiquetas identificadas, ambiguas, no encontradas e ilegibles.
- Precios repetidos: cuántos aparecieron y cuántos se desempataron por categoría.
- Recomendaciones para sacar mejores fotos.
- **Hoja de zonas**: la miniatura de cada foto con su número y cuántos productos hay en cada columna. Se puede imprimir.
- Las fotos con problemas.
- El detalle de cada lectura.

Además:
- En `Locator\resultados\` queda un JSON con todos los datos.
- En `Locator\logs\` queda el registro de cada ejecución.

---

## Qué se guarda en Firebase

Todo queda dentro de `ubicaciones`, en el proyecto pedidos-87064:

| Ruta | Qué guarda | Quién lo usa |
|---|---|---|
| `mapa/{código}` | Solo lo necesario: `zona` (12), `columna` ("I"/"D"), `orden` (para ordenar el recorrido), `confianza`, `estado`, `fecha`. | **pedidosv2**: lo descarga entero de una vez (unos 150 KB con todo el catálogo) y queda escuchando los cambios. |
| `detalle/{código}` | Nombre, categoría, precio leído, foto de origen, cómo se identificó. | Revisión. |
| `historial/{código}` | Ubicaciones anteriores del producto. | Revisión. |
| `ultimo` | Cantidad de fotos y fecha del último relevamiento. | El aviso de "cambió el recorrido". |
| `relevamientos/{id}` | Cada recorrido: cada foto procesada (con errores) y el resumen. | Registro. |
| `pendientes/{id}` | Lecturas ambiguas y no encontradas, con los candidatos más probables primero. | Revisión a mano. |

## En pedidosv2: "Artículos necesarios" por zona

Ya está integrado. En el panel **Artículos necesarios** hay un selector **Zona | Categoría**. La elección queda guardada en cada equipo.

- **Zona:** los artículos salen en el orden del recorrido (Zona 1 · izquierda, Zona 1 · derecha, Zona 2 · izquierda…). Al final va el grupo **Sin ubicación segura**: los productos nunca vistos, los posiblemente movidos o los leídos con poca confianza. Si se sabe dónde se vio cada uno por última vez, lo muestra en naranja claro, por ejemplo **¿Z7 der?**.
- **Categoría:** como antes, pero cada fila muestra su zona (por ejemplo **Z12 izq**).
- **El listado impreso** respeta el mismo orden y suma una columna **Zona**.
- **Si todavía no hay un relevamiento guardado**, o no se publicó la regla de lectura en Firebase, agrupa por categoría como siempre.
- **Si falta el archivo `Locator/ubicaciones-api.js` en el servidor**, el selector no aparece y la pantalla funciona como siempre.

Cuando la PC guarda un relevamiento nuevo, el panel se reordena solo, sin recargar la página.

**Para subirlo al hosting:** además de `pedidosv2/pedidosv2.html`, tiene que estar `Locator/ubicaciones-api.js` en el servidor, en la carpeta `Locator` al lado de `pedidosv2`. De esa carpeta solo hace falta ese archivo.

## Usar las ubicaciones desde otras páginas

`ubicaciones-api.js` funciona igual que `armadoVerificados`: escucha el mapa una vez y después todo responde al instante.

```html
<script src="../Locator/ubicaciones-api.js"></script>
```

```js
// 1) Al iniciar (una vez): escuchar el mapa. Si la PC guarda un relevamiento
//    nuevo, la pantalla se redibuja sola.
escucharUbicaciones(db, () => render());

// 2) Al dibujar "Artículos necesarios": agrupar en el orden del recorrido.
const grupos = ordenarPorZona(Object.values(articulos));
// [{ titulo: 'Zona 1 · izquierda', items: [...] },
//  { titulo: 'Zona 1 · derecha',   items: [...] },
//  { titulo: 'Zona 2 · izquierda', items: [...] }, ...
//  { titulo: 'Sin ubicación / incierta', items: [...] }]
// Cada item trae item.ubicacion = { zona, columna, texto: 'Zona 12 · izquierda', incierta } o null.

// Zona de un producto suelto
const u = await obtenerUbicacion('12345');   // u.texto -> 'Zona 12 · izquierda'
```

Un producto va a "incierta" en cualquiera de estos casos:
- nunca se vio;
- quedó marcado como posiblemente movido;
- se leyó con confianza baja;
- hace más de 15 días que no se confirma (se salteó un relevamiento). Ese plazo se cambia en `UBICACION_DIAS_VIGENCIA`.

En ese grupo, `item.ubicacion.texto` dice dónde se lo vio por última vez, para mostrar "probablemente en Zona 12 · izquierda".

---

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| "No encuentro Claude Code" | Abrí una consola y escribí `claude`. Si no existe, reinstalá Claude Code. |
| "Se alcanzó el límite de uso" | Esperá a que se renueve el límite de la suscripción y volvé a arrastrar la carpeta. |
| "Hay N foto(s) sin analizar: no se guarda" | Volvé a arrastrar la carpeta: reintenta solo esas. |
| "Los números de zona pueden haberse corrido" | Revisá la hoja de zonas del informe. Si sobra o falta una foto, corregí la carpeta y volvé a ejecutar. |
| "No se pudo leer la planilla" | Revisá internet y que la planilla siga compartida con enlace. |
| "Faltan datos en el archivo .env" | Completá `.env` (paso 4 de la preparación). |
| Fotos "HEIC" ignoradas | Configurá la cámara en JPG, o convertilas antes. |
