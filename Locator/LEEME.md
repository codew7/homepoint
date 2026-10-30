# Locator: mapa del depósito por grupos y columnas

Una vez por semana recorrés el depósito sacando fotos con la app **LocatorPic**. Después hacés doble clic en `relevar.bat` y en unos minutos Firebase sabe en qué **grupo** y **columna** está cada producto. pedidosv2 usa ese mapa para ordenar los "Artículos necesarios" según el recorrido.

Las fotos las lee **Claude Code con tu suscripción** de Claude. No se usa la API ni se paga aparte. Todo corre en tu PC con Windows.

## La idea: grupos y columnas

- **El depósito se divide en grupos fijos:** **FL** (adelante izquierda), **FR** (adelante derecha), **BL** (atrás izquierda), **BR** (atrás derecha) y **OT** (otros).
- **Cada grupo tiene columnas**, numeradas desde 1 de izquierda a derecha. En la app, cada foto agregada a la derecha es una columna nueva.
- **Una columna puede tener varias fotos**, una debajo de la otra, si no entra en una sola. El programa junta sus etiquetas, y una etiqueta que aparece en dos fotos seguidas cuenta una sola vez.
- **Las ubicaciones quedan así:** "FL · Columna 3", "BR · Columna 12"… Los estantes no se guardan.
- **No hacen falta carteles ni marcas.**

### Para que los números de columna no cambien de una semana a otra
El número de una columna es su lugar en el grupo. Si una semana te salteás una columna, todas las siguientes de **ese grupo** se corren un número (los otros grupos no se tocan). Para evitarlo:
1. **Empezá cada grupo siempre por la misma columna** y avanzá en el mismo sentido.
2. **Usá la foto guía** de la app: muestra cómo quedó esa columna la semana anterior.
3. **Si una foto salió mal, rehacela** desde la cuadrícula de la app. No saques una de más.

Si un grupo tiene otra cantidad de columnas que la semana anterior, la app avisa al finalizar y el programa avisa al analizar. El informe trae una **hoja de columnas**, con las fotos de cada columna y su número, para revisar dónde se corrió.

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
| `fotos.py` | Lee los grupos y columnas del recorrido y prepara las fotos. |
| `unir_columna.py` | Junta las etiquetas de las fotos de una misma columna (sin repetir las del solape). |
| `lector_claude.py` | Le pasa las fotos a Claude Code y valida el JSON que devuelve. |
| `identificar.py` | Decide qué producto es cada etiqueta (incluye el desempate por categoría). |
| `guardar_firebase.py` | Escribe el resultado en Firebase. |
| `informe.py` | Arma el informe HTML con la hoja de columnas. |
| `ubicaciones-api.js` | Funciones para que pedidosv2 y otras apps consulten las ubicaciones. |

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

## Uso semanal con LocatorPic

Las fotos se sacan con la app **LocatorPic** en el Android: ver `..\LocatorPic\README.md`.

1. En la app: sacá el recorrido, grupo por grupo, y tocá **Finalizar**.
2. En la PC: **doble clic en `relevar.bat`**, sin arrastrar nada. El programa:
   - baja el último recorrido terminado a `C:\HomePoint\Relevamiento\actual`, con las fotos nombradas por grupo, columna y estante (`FL_C03_E1_….jpg`);
   - **borra las fotos del recorrido anterior**, pero recién cuando las nuevas bajaron completas;
   - borra de Firebase Storage los recorridos viejos (deja solo el último).
3. Se abre el informe. Respondé **s** para guardar.
4. La app pasa a mostrar "Analizado en la PC: N productos ubicados".

Si volvés a ejecutar `relevar.bat` con el mismo recorrido (por ejemplo, porque falló el guardado), no vuelve a bajar nada ni a consultar a Claude.

La carpeta se cambia en `.env` con `RELEVAMIENTO_CARPETA`. Por seguridad, el programa solo borra una carpeta que haya creado él (que tenga `sesion.json`) o que esté vacía. `descargar.py` también funciona solo (`python descargar.py`): baja el recorrido sin analizarlo.

## Con fotos sueltas (sin la app)

Si arrastrás una carpeta de fotos cualquiera sobre `relevar.bat`, **cada foto es una columna del grupo OT**, en el orden de la fecha en que se sacaron (o por nombre, con `--orden nombre`). Sirve para pruebas; para el uso semanal conviene la app.

**Cada relevamiento reemplaza el mapa completo.** Los productos que estaban ubicados y esta semana no aparecieron se marcan "posiblemente movidos": se conserva dónde estaban, pero la app los muestra como inciertos.

Si alguna columna no se pudo analizar, **el programa no guarda**. Si guardara, sus productos quedarían como movidos sin serlo. Volvé a ejecutarlo: reintenta solo las fotos que fallaron.

### Opciones (desde una consola)

```
python relevar.py "C:\Relevamientos\2026-10-29" --sin-guardar
```

| Opción | Para qué |
|---|---|
| `--sin-guardar` | Probar: arma el informe sin tocar Firebase. Ideal para la primera vez. |
| `--orden nombre` | Fotos sueltas: las ordena por nombre de archivo en vez de por fecha. |
| `--si` | Guarda sin preguntar. |
| `--forzar` | Guarda aunque haya columnas sin analizar. |
| `--modelo sonnet` | Usa Sonnet en vez del modelo que tengas elegido. Rinde más con el límite de la suscripción. |
| `--lote 8` | Cuántas fotos se mandan juntas a Claude (de 1 a 10). |

### Si se corta a la mitad
Lo que Claude ya analizó queda guardado dentro de la carpeta de fotos, en `.locator\analisis.json`. Si el programa se corta (por el límite de uso, porque se cerró la ventana o porque se cortó internet), **volvé a ejecutarlo** y sigue desde donde quedó, sin gastar de nuevo.

### Límite de la suscripción
Cada foto gasta una parte de tu límite del plan Pro, como si mandaras una imagen en un chat. Una columna de una sola foto es una imagen; una de tres fotos, tres. Si se alcanza el límite, el programa lo avisa y se detiene: volvé a ejecutarlo más tarde y sigue desde ahí.

---

## Precios repetidos: cómo se desempata

En la planilla, **1079 de 1761 productos comparten precio** con otro. Cuando una etiqueta tiene un precio repetido, el programa prueba en este orden:

1. **El código de la etiqueta**, si llegó a leerse completo. Con las fotos de cerca, muchas veces se lee.
2. **El texto de la etiqueta** (nombre, marca, medida), comparado con el nombre de cada candidato.
3. **La categoría (columna A).** Como los productos suelen estar agrupados, cada candidato suma puntos por los productos de su misma categoría que hay:
   - en la misma columna (lo que más pesa);
   - en las columnas de al lado, del mismo grupo;
   - a dos columnas, del mismo grupo;
   - cerca de esa columna según el relevamiento anterior.

   Solo elige si un candidato gana con claridad.
   - Si la pista es fuerte, queda con confianza **media**.
   - Si es débil, queda con confianza **baja**, y la app lo muestra como incierto.
   - Si no hay pistas, queda **ambiguo** y no adivina.

Los pesos se pueden ajustar al principio de la sección "Desempate por categoría" de `identificar.py`.

---

## El informe

Queda en `Locator\informes\` y muestra:
- **Aviso** si en algún grupo cambió la cantidad de columnas respecto de la semana anterior.
- Productos ubicados, precios leídos y qué porcentaje tiene confianza alta.
- Etiquetas identificadas, ambiguas, no encontradas e ilegibles.
- Precios repetidos: cuántos aparecieron y cuántos se desempataron por categoría.
- Recomendaciones para sacar mejores fotos.
- **Hoja de columnas**, agrupada por grupo: las fotos de cada columna (una debajo de la otra, unidas con una línea naranja), su número y cuántos productos tiene. Se puede imprimir.
- Las columnas con problemas.
- El detalle de cada lectura.

Además:
- En `Locator\resultados\` queda un JSON con todos los datos.
- En `Locator\logs\` queda el registro de cada ejecución.

---

## Qué se guarda en Firebase

Todo queda dentro de `ubicaciones`, en el proyecto pedidos-87064:

| Ruta | Qué guarda | Quién lo usa |
|---|---|---|
| `mapa/{código}` | Solo lo necesario: `grupo` ("FL"), `columna` (3), `orden` (para ordenar el recorrido), `confianza`, `estado`, `fecha`. | **pedidosv2**: lo descarga entero de una vez (unos 150 KB con todo el catálogo) y queda escuchando los cambios. |
| `detalle/{código}` | Nombre, categoría, precio leído, columna de origen y cómo se identificó. | Revisión. |
| `historial/{código}` | Ubicaciones anteriores del producto. | Revisión. |
| `ultimo` | Columnas por grupo y fecha del último relevamiento. | El aviso de "cambió el recorrido". |
| `relevamientos/{id}` | Cada recorrido: cada columna procesada (con errores) y el resumen. | Registro. |
| `pendientes/{id}` | Lecturas ambiguas y no encontradas, con los candidatos más probables primero. | Revisión a mano. |

Los productos guardados con la versión anterior ("Zona 12 · izquierda") se siguen entendiendo hasta que se vuelvan a ver.

## En pedidosv2: "Artículos necesarios" por ubicación

En el panel **Artículos necesarios** hay un selector **Ubicación | Categoría**. La elección queda guardada en cada equipo.

- **Ubicación:** un encabezado por grupo, en el orden **FL, FR, BL, BR, OT** (por ejemplo "FL · Adelante izquierda · 14 art."), y adentro sus columnas en orden ("Columna 1", "Columna 4"…). Al final va el grupo **Sin ubicación segura**: los productos nunca vistos, los posiblemente movidos o los leídos con poca confianza. Si se sabe dónde se vio cada uno por última vez, lo muestra en naranja claro, por ejemplo **¿FL C7?**.
- **Categoría:** como antes, pero cada fila muestra su ubicación (por ejemplo **FL C12**).
- **El listado impreso** respeta el mismo orden, suma una columna **Ubic.** y una fila oscura por cada grupo.
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
// [{ grupo: 'FL', columna: 1, sector: 'FL · Adelante izquierda', titulo: 'Columna 1', items: [...] },
//  { grupo: 'FL', columna: 4, sector: 'FL · Adelante izquierda', titulo: 'Columna 4', items: [...] },
//  { grupo: 'FR', columna: 2, sector: 'FR · Adelante derecha',   titulo: 'Columna 2', items: [...] }, ...
//  { grupo: null, titulo: 'Sin ubicación / incierta', items: [...] }]
// Cada item trae item.ubicacion = { grupo, columna, texto: 'FL · Columna 3', incierta } o null.

// Ubicación de un producto suelto
const u = await obtenerUbicacion('12345');   // u.texto -> 'FL · Columna 3'
textoCortoUbicacion(u);                       // 'FL C3'
```

Un producto va a "incierta" en cualquiera de estos casos:
- nunca se vio;
- quedó marcado como posiblemente movido;
- se leyó con confianza baja;
- hace más de 15 días que no se confirma (se salteó un relevamiento). Ese plazo se cambia en `UBICACION_DIAS_VIGENCIA`.

En ese grupo, `item.ubicacion.texto` dice dónde se lo vio por última vez, para mostrar "probablemente en FL · Columna 3".

---

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| "No encuentro Claude Code" | Abrí una consola y escribí `claude`. Si no existe, reinstalá Claude Code. |
| "Se alcanzó el límite de uso" | Esperá a que se renueve el límite de la suscripción y volvé a ejecutarlo. |
| "Hay N columna(s) sin analizar: no se guarda" | Volvé a ejecutarlo: reintenta solo esas fotos. |
| "Cambió la cantidad de columnas" | Revisá la hoja de columnas del informe para ver dónde se corrió. La app ya avisa esto antes de finalizar: ese es el mejor momento para corregirlo en la cuadrícula. |
| "El recorrido no tiene fotos (o es de una versión vieja de LocatorPic)" | El último recorrido se sacó con la versión anterior de la app. Sacá uno nuevo con la versión 2.0. |
| "No se pudo leer la planilla" | Revisá internet y que la planilla siga compartida con enlace. |
| "Faltan datos en el archivo .env" | Completá `.env` (paso 4 de la preparación). |
| Fotos "HEIC" ignoradas | Configurá la cámara en JPG, o convertilas antes. |
