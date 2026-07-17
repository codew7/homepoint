# Control de Pagos a Proveedores

App web para llevar la cuenta corriente con cada proveedor: facturas, pagos en pesos y dólares,
saldos, balance e informes en PDF.

HTML + CSS + JavaScript vanilla (módulos ES), sin build step ni dependencias que instalar.
Persistencia en Firebase Realtime Database.

## Correr el proyecto

La app usa módulos ES, así que **no funciona abriendo `proveedores.html` con doble clic**
(el navegador bloquea los módulos con `file://`). Necesita un servidor estático:

```bash
python -m http.server 8000     # o:  npx serve .
```

Después abrí `http://localhost:8000/proveedores.html`. Si usás VS Code, la extensión **Live Server**
hace lo mismo con un clic.

> Si cambiás código y no ves el cambio, es la caché del navegador: recargá con **Ctrl+F5**.

## Estructura

```
Proveedores/
├── proveedores.html        # Las 5 vistas y los modales (punto de entrada)
├── css/
│   └── styles.css          # Estilos, incluye responsive
├── js/
│   ├── firebase-config.js  # Credenciales del proyecto (ya cargadas)
│   ├── db.js               # Acceso a Realtime Database (lectura/escritura + errores)
│   ├── store.js            # Estado en memoria y todos los cálculos (saldos, balance)
│   ├── cotizacion.js       # ⭐ Módulo aislado del dólar (punto de integración de la API)
│   ├── pdf.js              # ⭐ Generación del PDF (único módulo que conoce jsPDF)
│   ├── pagos.js            # Vista de pagos e imputación a facturas
│   ├── facturas.js         # Vista de facturas y saldos
│   ├── proveedores.js      # Vista de proveedores (ABM)
│   ├── resumen.js          # Vista de balance por proveedor
│   ├── informes.js         # Vista de informes (filtros + vista previa + descarga)
│   ├── confirmar.js        # Diálogo de confirmación
│   ├── utils.js            # Formato de moneda/fecha, validaciones, avisos
│   └── app.js              # Punto de entrada: inicializa y coordina
├── database.rules.json     # Reglas de seguridad para pegar en la consola
├── CLAUDE.md               # Notas técnicas para Claude Code
└── README.md
```

## Funcionalidades

- **Proveedores**: alta, edición y baja lógica (con reactivación). El único campo obligatorio es
  el nombre; el CUIT es opcional pero, si se carga, no puede repetirse entre proveedores.
- **Facturas**: proveedor, N° (único por proveedor), fecha, monto y moneda. Cada una muestra
  cuánto se pagó, cuánto falta y su estado (pendiente / parcial / pagada).
- **Pagos**: proveedor, fecha, monto, moneda, método de pago y concepto opcional. En dólares pide
  la cotización usada y muestra el equivalente en pesos mientras escribís. La moneda **Pesos/USD**
  es un atajo: cargás la cifra en pesos y la cotización, y el pago se registra en dólares
  (equivalente = pesos ÷ cotización).
- **Imputación**: un pago se puede repartir entre varias facturas del proveedor. La app propone
  cuánto cubrir de cada una y avisa en vivo cuánto queda sin imputar. Si el pago y la factura
  están en monedas distintas, pide la cotización para convertir.
- **Filtros**: por proveedor, moneda, estado y rango de fechas.
- **Resumen**: balance de la cuenta corriente con cada proveedor.
- **Informes**: estado de cuenta filtrable por proveedor y período, con vista previa y descarga
  en PDF.
- **Tiempo real**: los cambios se reflejan solos, incluso desde otra pestaña o dispositivo.

## Firebase

Está configurado y funcionando contra el proyecto **`proveedores-98f1d`**: las credenciales están
en `js/firebase-config.js` y la lectura y escritura quedaron verificadas. No hace falta crear los
nodos a mano: se crean solos al guardar el primer registro.

### Las reglas hay que volver a pegarlas cuando cambia la estructura

`database.rules.json` es **un archivo suelto en tu carpeta: Firebase no lo lee**. Para que tenga
efecto hay que pegar su contenido en **Realtime Database → Reglas → Publicar** (sin el bloque
`_comentario`, que es una nota para vos).

Las reglas rechazan cualquier campo que no conozcan (`"$otro": { ".validate": false }`). Por eso,
**cada vez que cambie la estructura de datos hay que volver a pegar el archivo**. Si no, Firebase
responde `PERMISSION_DENIED` y el guardado falla. No hay sincronización automática.

Hoy tus reglas están al día y verificadas: aceptan las imputaciones y rechazan datos corruptos
(moneda inválida, montos negativos, fechas mal formadas, campos inventados y pagos que apunten a
un proveedor inexistente).

Si alguna vez cambiás de proyecto, los valores salen de **Configuración del proyecto → Tus apps →
Web (`</>`)**. El campo clave es **`databaseURL`**; si falta, la app no arranca y avisa con un
banner.

## Estructura de datos

```
proveedores/{id}   → { nombre, cuit, telefono, notas, activo, creadoEn, actualizadoEn }
facturas/{id}      → { proveedorId, numero, fecha, moneda, montoTotal, creadoEn, actualizadoEn }
pagos/{id}         → { proveedorId, fecha, moneda, monto, cotizacion, montoARS,
                       concepto, metodoPago, imputaciones, creadoEn }
config/cotizacion  → { valor, fuente, actualizadoEn }
```

`imputaciones` es un mapa `{ facturaId: monto }` que indica cuánto de ese pago cubre cada factura.
**El monto está siempre en la moneda de la factura**, no en la del pago: si pagás $500.000 a 1.250
contra una factura de US$1.000, se guarda `400` y la factura queda debiendo US$600. Un pago sin
`imputaciones` es un pago a cuenta, perfectamente válido.

## Decisiones que conviene tener presentes

- **El saldo de una factura no se guarda: se calcula** (`montoTotal` − lo imputado por todos los
  pagos). Guardarlo obligaría a mantenerlo sincronizado en cada alta, edición y borrado de pago,
  que es justo donde se cuelan los errores de contabilidad.
- **`montoARS` se congela al momento del pago.** Se guarda `monto × cotizacion` con el tipo de
  cambio de ese día y nunca se recalcula. Los totales en pesos son históricos reales: no se mueven
  cuando cambia el dólar de hoy.
- **Los pesos y los dólares nunca se suman entre sí.** Sin una cotización única, un total mezclado
  sería un número que no significa nada. Cada moneda lleva su propia cuenta.
- **Los proveedores se dan de baja lógica** (`activo: false`), nunca se borran, porque los pagos
  los referencian por id. Las facturas no se pueden borrar si tienen pagos imputados. Los pagos sí
  se eliminan de verdad.

## El balance (pestaña Resumen)

Para cada proveedor **y cada moneda**:

```
balance = facturado − pagado        (pagado = lo imputado a facturas + lo entregado a cuenta)
```

- `balance > 0` → **deudor**: falta pagarle.
- `balance < 0` → **saldo a favor**: se le entregó más de lo que facturó. Lo producen los pagos a
  cuenta (sin factura imputada) y los sobrantes de un pago que no se imputó entero.
- `balance ≈ 0` → **saldada**.

Un proveedor puede aparecer en dos filas y con signos opuestos: deberle US$600 y tener $40.000 a
favor al mismo tiempo es una situación normal y real, no un error.

**La deuda y el saldo a favor no se netean entre proveedores.** Deberle $60.000 a uno y tener $10 a
favor con otro no es "deber $59.990": son cuentas distintas y compensarlas daría un número que no
significa nada. Por eso van en tarjetas separadas.

## Informes (PDF)

La pestaña **Informes** arma un estado de cuenta al estilo resumen bancario:

```
Saldo anterior al inicio del período
  + facturas del período        (debe)
  − pagos del período           (haber)
= Saldo final
```

El saldo anterior trae todo lo que quedó pendiente de antes, así que **cada período cierra contra
el siguiente** y ningún movimiento se pierde ni se cuenta dos veces. Sin filtro de fechas, el
informe cubre todos los movimientos y su saldo final coincide con el balance de la pestaña Resumen.

El **saldo final se muestra con su signo**: positivo es deuda, negativo es saldo a favor. El color
ayuda (ámbar / verde), pero el signo es lo que distingue los dos casos si imprimís en blanco y
negro.

Un mismo pago puede aparecer en las secciones de dos monedas: si pagás $600.000 imputando US$400 a
una factura en dólares, la sección USD muestra el haber de US$400 y la sección ARS los $100.000 que
quedaron a cuenta. Es lo que hace auditable el cruce de monedas.

Con "Todos los proveedores", el PDF arranca cada proveedor en una hoja nueva.

**Dependencia**: el PDF se genera con [jsPDF](https://github.com/parallax/jsPDF) y su plugin
autotable, cargados desde CDN **solo al pedir el primer informe** (`js/pdf.js`), para no pesar en el
arranque. Sin internet, la app funciona pero el PDF no se genera y te avisa con un error.

## Cotización del dólar

Todo lo del dólar vive en **`js/cotizacion.js`**, el único módulo que conoce la fuente. El
encabezado muestra el **dólar Oficial y el Blue en vivo** (valor de venta), traídos de
[bluelytics](https://api.bluelytics.com.ar/v2/latest) y refrescados cada 10 minutos. Son
informativos: no se guardan en Firebase ni entran en ningún cálculo.

En el modal de pago, el campo **"Cotización usada"** muestra el oficial como *placeholder* (una
sugerencia en gris), pero **se completa a mano**: la cotización de cada pago se tipea y se congela
con ese pago (nunca se recalcula contra el dólar de hoy).

Si no hay internet, el chip muestra `s/d` y la app sigue funcionando: la cotización se carga
igual a mano. Para cambiar de fuente, se ajusta el `fetch` y el mapeo de la respuesta en
`js/cotizacion.js`, sin tocar nada más.

## Sobre la seguridad de la base

No hay login. Tené en cuenta qué significa: **con `.read` y `.write` en `true`, cualquiera que
consiga la URL de tu base puede leer y escribir todo.** Las credenciales de Firebase viajan en el
JS del navegador, así que son públicas por diseño: no son un secreto que puedas ocultar.

Las reglas publicadas validan la *forma* de los datos (que los montos sean positivos, que la moneda
sea ARS o USD, etc.), pero **no controlan quién entra**. Son dos problemas distintos.

Mientras corras la app solo en tu máquina (`localhost`), la base no está expuesta. Si la publicás
en una URL, la opción más simple para cerrarla es **autenticación anónima**, que no le pide nada al
usuario:

1. Firebase Console → **Authentication → Sign-in method → Anónimo → Habilitar**.
2. En `database.rules.json`, cambiar `".read": true` y `".write": true` por `"auth != null"`,
   y volver a pegar el archivo en la consola.
3. En `js/app.js`, antes de `initDb()`, agregar el login anónimo:

   ```js
   import { getAuth, signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
   await signInAnonymously(getAuth());
   ```

Eso frena a los bots que escanean bases de Firebase abiertas, pero no distingue entre personas:
cualquiera que abra la página sigue entrando. Si necesitás que solo entre gente autorizada, el paso
siguiente es email/contraseña con usuarios creados a mano desde la consola.
