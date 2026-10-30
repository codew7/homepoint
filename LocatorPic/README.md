# LocatorPic

App Android para sacar las fotos del recorrido semanal del depósito. El depósito se divide en **grupos** (FL, FR, BL, BR, OT) y cada grupo en **columnas**. En la app armás una **cuadrícula** por grupo: cada foto que agregás a la derecha es una columna nueva, y las que agregás debajo son otros estantes de la misma columna. Las fotos suben solas a Firebase y en la PC un **doble clic en `Locator\relevar.bat`** baja el recorrido, lo analiza y guarda dónde está cada producto ("FL · Columna 3"), que es lo que usa pedidosv2.

```
 Android (LocatorPic)                    Firebase (pedidos-87064)                PC (Locator)
 ───────────────────                     ────────────────────────                ────────────
 FL: C1 → C2 → C3 …           ──sube──►  Storage: locatorpic/{recorrido}/        relevar.bat (doble clic)
      ↓     ↓                            RTDB:   locatorpic/sesiones/…   ──►     1. baja el último recorrido
     (estantes de abajo)                         locatorpic/ultima               2. borra las fotos anteriores
 FR: C1 → C2 …                                                                   3. analiza con Claude
 Finalizar recorrido  ─────────────────►  estado "lista"                          4. guarda ubicaciones/mapa
 "Analizado: 812 productos"  ◄──────────  estado "procesada"  ◄──────────────       (pedidosv2 lo usa)
```

## Los grupos

| Grupo | Qué es |
|---|---|
| **FL** | Adelante izquierda |
| **FR** | Adelante derecha |
| **BL** | Atrás izquierda |
| **BR** | Atrás derecha |
| **OT** | Otros |

Las columnas se numeran **desde 1 en cada grupo**: FL · Columna 1, 2, 3… y FR · Columna 1, 2… En pedidosv2 los artículos salen primero por grupo (en el orden FL, FR, BL, BR, OT) y adentro por columna. Los estantes no se muestran.

## Qué tiene la app

- **En vertical**, como se usa el celular normalmente. Cada foto es una columna de ancho completo.
- **Cuadrícula libre:** en la cámara elegís hacia dónde va la próxima foto:
  - **→ Columna nueva:** la siguiente foto es otra columna, a la derecha de la última.
  - **↓ Estante de abajo:** la siguiente foto va debajo, en la misma columna. Sirve cuando una columna no entra en una sola foto. Arriba del visor aparece la franja de abajo de la foto anterior, para seguir desde ahí.

  La elección queda hasta que la cambies.
- **Se guarda sola:** si la foto sale nítida, con luz y derecha, se guarda sin preguntar. Durante unos segundos aparece **"Deshacer"**. Si sale borrosa, oscura o torcida, se abre la revisión con zoom y los botones **Confirmar** o **Repetir**.
- **Nivel:** se pone verde cuando el equipo está derecho.
- **Foto guía de la vez anterior:** al sacar FL · Columna 3 ves, abajo a la izquierda, cómo quedó esa misma columna la semana anterior. Si la tocás, se **superpone** semitransparente sobre el visor, para repetir el encuadre. Así los números de columna no se corren de una semana a otra.
- **Funciona sin señal:** las fotos quedan en el equipo y suben solas cuando hay conexión, aunque cierres la app.
- **Cuadrícula para revisar** (botón de la grilla): una pestaña por grupo, con las columnas una al lado de la otra. Ahí se puede rehacer o eliminar una foto, insertar una columna que te salteaste, agregar un estante abajo o eliminar una columna. Las demás se renumeran solas.
- **Al finalizar:** avisa en qué grupos cambió la cantidad de columnas respecto de la vez anterior.
- **Pantalla de inicio:** muestra si la PC ya bajó y analizó el último recorrido, y cuántos productos ubicó.
- **Atajos:** la **tecla de volumen** también saca la foto. La pantalla no se apaga mientras sacás fotos.
- **Ícono:** el logo de HomePoint en blanco sobre naranja.

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

1. **En el depósito:**
   1. Abrí LocatorPic y tocá **Empezar recorrido**. La app pregunta **qué grupo vas a fotografiar** (FL, FR, BL, BR u OT). Después lo podés cambiar con los botones de arriba de la cámara.
   2. Parate frente a la **primera columna de la izquierda** del grupo y encuadrala entera, de ancho completo. Sacá la foto con el botón o con la tecla de volumen.
   3. Con **→ Columna nueva** marcado, correte a la columna siguiente y sacá otra foto. Así hasta terminar el grupo.
   4. Si una columna no entra en una foto: sacá la parte de arriba, tocá **↓ Estante de abajo** y sacá la parte de abajo, haciendo coincidir la franja que aparece arriba del visor. Después volvé a **→ Columna nueva** para seguir.
   5. Cambiá de grupo arriba y repetí.
2. Al terminar: botón de la **grilla** → **Finalizar**. Si todavía hay fotos subiendo, esperá a tener señal o WiFi.
3. **En la PC:** doble clic en **`Locator\relevar.bat`**. Baja el recorrido, analiza, abre el informe y pregunta si guardar.
4. En la app, la pantalla de inicio pasa a decir **"Analizado en la PC: N productos ubicados"**.

### Corregir en la cuadrícula

| Para… | Tocá… |
|---|---|
| Rehacer una foto | la foto → **Rehacer esta foto** |
| Borrar una foto | la foto → **Eliminar esta foto** (si era la única de la columna, la columna desaparece) |
| Agregar una columna que te salteaste | el número de la columna siguiente (C4) → **Insertar una columna antes** |
| Agregar un estante abajo | el **+ ↓ Estante** debajo de la columna |
| Agregar columnas al final | el **+ → Columna nueva** a la derecha de todo |
| Borrar una columna entera | el número de la columna → **Eliminar la columna** |

### Qué pasa con las fotos

| Dónde | Qué queda |
|---|---|
| Equipo Android | Las fotos de un recorrido se borran solas cuando la PC lo baja. |
| Firebase Storage | Solo el **último** recorrido. Cuando la PC baja uno nuevo, borra los anteriores. Las miniaturas del último son la foto guía de la semana siguiente. |
| PC (`C:\HomePoint\Relevamiento\actual`) | Solo el último recorrido. Se reemplaza recién cuando el nuevo bajó completo. |

Cada foto se saca a unos **8 MP**: de cerca alcanza y suben más rápido.

### Estados de un recorrido

| Estado | Qué significa |
|---|---|
| `en_curso` | Se está sacando en la app. |
| `lista` | Finalizado en la app, esperando a la PC. |
| `descargada` | La PC lo bajó. |
| `procesada` | La PC guardó las ubicaciones. |
| `archivada` | Recorrido viejo: sus fotos ya se borraron de Storage. |

### Datos en Firebase

```
locatorpic/sesiones/{id}/grupos/FL = [ [fotoId, fotoId], [fotoId], … ]   columna 1, columna 2…
                                                                          (fotos de arriba hacia abajo)
locatorpic/ultima/grupos            lo mismo, del último recorrido terminado (foto guía)
```

---

## Problemas frecuentes

| Problema | Qué hacer |
|---|---|
| "Falta configurar Firebase" en la app | Falta `google-services.json` (paso 1). Copialo y volvé a compilar. |
| Fotos que no suben ("sin subir · tocá para reintentar") | Revisá la señal. Si dice "Sin permiso en Storage", faltan las reglas del paso 3. |
| La PC dice "La foto de FL columna N no está en Storage" | Ese recorrido se finalizó sin terminar de subir. En la app, abrí la grilla, esperá a que todo tenga ✓ y volvé a ejecutar `relevar.bat`. |
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
