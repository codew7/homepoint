# LocatorPic

App Android para sacar las fotos del recorrido semanal del depósito. Saca cada foto con la **máxima calidad de la cámara**, la subís a Firebase con un toque y en la PC un **doble clic en `Locator\relevar.bat`** baja el recorrido, borra las fotos anteriores, lo analiza y guarda las zonas que usa pedidosv2.

```
 Android (LocatorPic)                    Firebase (pedidos-87064)                PC (Locator)
 ───────────────────                     ────────────────────────                ────────────
 Zona 1 → foto → ✓ Confirmar  ──sube──►  Storage: locatorpic/{recorrido}/        relevar.bat (doble clic)
 Zona 2 → foto → ✓ Confirmar              RTDB:   locatorpic/sesiones/…   ──►     1. baja el último recorrido
 …                                                locatorpic/ultima               2. borra las fotos anteriores
 Finalizar recorrido  ─────────────────►  estado "lista"                          3. analiza con Claude
                                                                                  4. guarda ubicaciones/mapa
 "Analizado: 812 productos"  ◄──────────  estado "procesada"  ◄──────────────       (pedidosv2 lo usa)
```

## Qué tiene la app

- **Calidad máxima:**
  - CameraX con la resolución más alta del equipo en 4:3, modo "máxima calidad" y JPEG al 95%.
  - Si el equipo lo soporta, botón **HDR**.
- **Guías para encuadrar:**
  - Una línea vertical marca dónde se corta la foto en columna izquierda y derecha.
  - Un **nivel** se pone verde cuando el equipo está derecho.
- **Foto guía de la vez anterior:** al sacar la zona 12 ves cómo quedó la zona 12 del recorrido anterior. Si la tocás, se **superpone** semitransparente sobre el visor, para repetir el mismo encuadre. Así los números de zona no se corren de una semana a otra.
- **Revisión antes de confirmar:**
  - zoom para ver que los precios se lean;
  - aviso si la foto parece **borrosa, oscura o torcida**;
  - botones **Confirmar** o **Repetir**.
- **Funciona sin señal:** las fotos confirmadas quedan en el equipo y suben solas cuando hay conexión, aunque cierres la app. Si algo falla, reintenta.
- **Grilla de zonas:** se puede **rehacer** una foto, **insertar** una zona que te salteaste o **eliminar** una que sobra, y las demás se renumeran solas.
- **Al finalizar:** avisa si la cantidad de zonas no coincide con la vez anterior.
- **Pantalla de inicio:** muestra si la PC ya bajó y analizó el último recorrido, y cuántos productos ubicó.
- **Atajos:** la **tecla de volumen** también saca la foto. La pantalla no se apaga mientras sacás fotos.
- **Tomas cercanas (opcional, por zona):** en vez de una foto lejana, varias fotos de cerca por estante, que la PC une como un rompecabezas. Ver más abajo.
- **Sectores:** nombre para grupos de zonas ("Adelante izquierda", "Atrás derecha"). pedidosv2 agrupa la lista de recolección por sector.

---

## Preparación (una sola vez)

### 1. Registrar la app en Firebase
La app nativa necesita su propio archivo de configuración. La clave web de Firebase está restringida a tu sitio y no sirve para Android.

1. Entrá a https://console.firebase.google.com → proyecto **pedidos-87064**.
2. Engranaje → **Configuración del proyecto** → en "Tus apps", **Agregar app** → ícono de **Android**.
3. Nombre del paquete: **`ar.com.homepoint.locatorpic`** (exacto). Apodo: LocatorPic. El SHA-1 no hace falta.
4. **Registrar app** → **Descargar google-services.json**.
5. Copiá ese archivo a **`LocatorPic\android\app\google-services.json`**.

   Ese archivo no se sube a GitHub (está en `.gitignore`).

### 2. Reglas de la base de datos
En la consola de Firebase, andá a **Realtime Database → Reglas** y agregá este bloque al lado de los demás. Ya está en `database.rules.json`.

```json
"locatorpic": {
  ".read": "auth != null",
  ".write": "auth != null && auth.token.email !== 'homepoint2@homepoint.com'"
},
```

### 3. Reglas de Storage
`storage.rules` tiene las reglas **completas** del bucket: las de Artículos, sin cambios, más las de LocatorPic. En la consola de Firebase, andá a **Storage → Reglas**, reemplazá todo el texto por el contenido de ese archivo y tocá **Publicar**.

### 4. Compilar
Doble clic en **`android\compilar.bat`**. La primera vez tarda unos minutos, porque baja las librerías. Deja **`LocatorPic.apk`** en esta carpeta.

Con cada cambio en la app, subí `versionCode` en `android\app\build.gradle`.

### 5. Instalar en el colector o el celular
Elegí una de estas formas:
- **Por cable:**
  1. En el equipo, activá *Opciones de desarrollador → Depuración USB*.
  2. Conectalo a la PC y aceptá el cartel de "Permitir depuración USB".
  3. Hacé doble clic en **`instalar-apk.bat`**.
- **Sin cable:** pasá `LocatorPic.apk` al equipo (WhatsApp, Drive, etc.), abrilo y permití "instalar apps desconocidas".

### 6. Entrar
Abrí LocatorPic y entrá con el mismo usuario y contraseña de pedidosv2.

---

## Uso semanal

1. **En el depósito**:
   1. Abrí LocatorPic y tocá **Empezar recorrido**.
   2. Para cada tramo de estantería: encuadrá las **dos columnas**, una a cada lado de la línea, y sacá la foto con el botón o con la tecla de volumen.
   3. Revisá la foto y tocá **Confirmar**. Pasa sola a la zona siguiente.
   4. Si hay foto guía, tocala para superponerla y repetir el encuadre.
2. Al terminar: **Ver zonas → Finalizar**. Si todavía hay fotos subiendo, esperá a tener señal o WiFi.
3. **En la PC**: doble clic en **`Locator\relevar.bat`**. Baja el recorrido, analiza, abre el informe y pregunta si guardar.
4. En la app, la pantalla de inicio pasa a decir **"Analizado en la PC: N productos ubicados"**.

### Tomas cercanas (para tramos con etiquetas chicas)

Arriba a la izquierda de la cámara hay un selector: **Foto única | Tomas cercanas**. Se elige por zona. La app propone el modo que tuvo esa zona la semana anterior.

Con **Tomas cercanas**:
1. Acercate al **estante de arriba** y sacá la primera toma **del extremo izquierdo** del tramo.
2. Correte un paso a la derecha. A la izquierda del visor vas a ver, semitransparente, **la franja derecha de la toma anterior**. Encuadrá para que esa franja coincida con lo que ves y sacá la toma siguiente.

   Las tomas se tienen que pisar un poco. Si no se pisan, la PC no las puede unir.
3. Seguí así hasta el extremo derecho del tramo.
4. Tocá **↓ Siguiente estante** y repetí con el estante de abajo, otra vez de izquierda a derecha. Ahora la franja de guía aparece arriba: es la parte de abajo del estante anterior.
5. Al terminar el último estante, tocá **✓ Terminar zona**. Pasa a la zona siguiente.

Detalles:
- **Confirmación automática:** si la toma sale nítida, con luz y derecha, se guarda sola. Durante unos segundos aparece **"Deshacer"** por si querés repetirla. Si sale borrosa u oscura, se abre la revisión completa.
- **El encabezado** muestra en qué estante y toma vas: "Estante 2 · toma 3".
- **Resolución:** las tomas se sacan a unos 8 MP, porque de cerca alcanza y suben más rápido.
- **Orientación del celular:** se guarda en cada toma. La PC la usa si dos tomas no se pueden unir por imagen.
- **En la grilla de zonas,** estas zonas muestran "3 est. · 9 tomas".
- **Para pedidosv2 no cambia nada:** cada producto sigue siendo "Zona 12 · izquierda/derecha". Lo que mejora es la lectura de los precios.
- **Gasta más límite de la suscripción.** Cada toma es una imagen para Claude: usalo solo donde haga falta.

### Sectores

El chip con la banderita, debajo del número de zona, pone un nombre al grupo de zonas que **empieza** en esa zona. El sector sigue hasta la zona donde empieza otro.

- **Para ponerlo:** tocá el chip y elegí un nombre usado antes, o escribí uno nuevo.
- **Si la semana anterior un sector empezaba en esa zona,** el chip se pone naranja: "¿Acá empieza «Adelante izquierda»? Tocá". Con un toque se aplica.
- **Para cambiarlo después:** en la grilla de zonas, tocá una zona → **Cambiar sector desde acá**. Ahí también se puede quitar.
- **Al eliminar la zona donde empieza un sector,** el sector pasa a empezar en la siguiente.

En pedidosv2, "Artículos necesarios" muestra un encabezado por sector y adentro las zonas en orden. Así se junta la mercadería a medida que se avanza.

### Qué pasa con las fotos

| Dónde | Qué queda |
|---|---|
| Equipo Android | Las fotos de un recorrido se borran solas cuando la PC lo baja. |
| Firebase Storage | Solo el **último** recorrido. Cuando la PC baja uno nuevo, borra los anteriores. Las miniaturas del último son la foto guía de la semana siguiente. |
| PC (`C:\HomePoint\Relevamiento\actual`) | Solo el último recorrido. Se reemplaza recién cuando el nuevo bajó completo. |

### Estados de un recorrido

| Estado | Qué significa |
|---|---|
| `en_curso` | Se está sacando en la app. |
| `lista` | Finalizado en la app, esperando a la PC. |
| `descargada` | La PC lo bajó. |
| `procesada` | La PC guardó las ubicaciones. |
| `archivada` | Recorrido viejo: sus fotos ya se borraron de Storage. |

---

## Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| "Falta configurar Firebase" en la app | Falta `google-services.json` (paso 1). Copialo y volvé a compilar. |
| Fotos que no suben ("sin subir · tocá para reintentar") | Revisá la señal. Si dice "Sin permiso en Storage", faltan las reglas del paso 3. |
| La PC dice "La foto de la zona N no está en Storage" | Ese recorrido se finalizó sin terminar de subir. En la app, abrí la grilla, esperá a que todo tenga ✓ y volvé a ejecutar `relevar.bat`. |
| La PC dice "Todavía no hay recorridos terminados" | Falta tocar **Finalizar** en la app. |
| El nivel o el HDR se comportan raro en algún equipo | El HDR se puede apagar con su botón; la app recuerda la elección. |

## Archivos

| Archivo | Para qué |
|---|---|
| `android/` | Proyecto Android, en Java con CameraX y Firebase. La estructura de build es la misma que `pedidosv2T51/android`. |
| `android/compilar.bat` | Compila y deja `LocatorPic.apk`. |
| `instalar-apk.bat` | Instala el APK por USB. |
| `storage.rules` | Bloque de reglas de Storage para agregar en la consola. |
| `../Locator/descargar.py` | La parte de la PC que baja el recorrido; la usa `relevar.py`. |
