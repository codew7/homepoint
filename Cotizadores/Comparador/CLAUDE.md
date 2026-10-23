# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Comparador local de tarifas de envío que unifica los dos cotizadores hermanos: **Correo Argentino / Paq.ar** (`../Correo`, tarifas reales de la cuenta MiCorreo vía Playwright) y **Vía Cargo** (`../ViaCargo`, API pública de Busplus). **Solo envíos de sucursal a sucursal** (solo Paq.ar Clásico con retiro en sucursal; solo Vía Cargo Estándar agencia → agencia): el usuario no despacha ni entrega a domicilio, así que la UI no contempla esas modalidades aunque los módulos hermanos las soporten. Un solo formulario (paquete + destino) consulta a ambas empresas en paralelo, muestra los resultados a medida que llegan y arma una comparativa ordenada por precio, con ficha para el cliente, historial, caché y precio al cliente con recargo.

**No copia código de los hermanos**: `servidor.py` y `destinos.py` agregan `../Correo` y `../ViaCargo` al `sys.path` e importan `cotizador`, `auth`, `sucursales` y `viacargo`. Si cambia un selector de MiCorreo o la clave de Vía Cargo, se corrige allá. Todo el texto de UI, comentarios y mensajes va en español (sin tildes en los comentarios de Python, con tildes en la UI). Vive dentro del repo git `homepoint` (no commitear sin pedido explícito); no hay tests automatizados ni linter.

Además del uso local, todo se empaqueta como **app instalable de Windows** desde `../Instalador` (ver *App instalable*): los cambios en estos módulos llegan al usuario recompilando el instalador.

## Comandos

Usa el venv de `../Correo` (Python 3.13 con Playwright + dotenv); el `.bat` lo busca solo. Las credenciales siguen en `../Correo/.env` (también se cargan desde Configuración → Cuenta de MiCorreo, que escribe ese mismo `.env`).

```
..\Correo\venv\Scripts\python.exe servidor.py            # UI en http://127.0.0.1:8613 (o Cotizador.bat; puerto opcional; --sin-navegador para no abrir el browser)
..\Correo\venv\Scripts\python.exe destinos.py            # estado del catálogo unificado
..\Correo\venv\Scripts\python.exe destinos.py munro      # buscar destinos (nombre o CP)
..\Correo\venv\Scripts\python.exe destinos.py --reconstruir
..\Correo\venv\Scripts\python.exe -W error -m py_compile servidor.py destinos.py pedidos.py
..\Correo\venv\Scripts\python.exe pedidos.py [texto]     # sesión de pedidosv2 y pedidos pendientes
node --check <script principal de index.html>            # el bloque <script> que sigue a <div class="toast">; el último </script> es de la ficha, dentro de un template literal
```

Prueba de humo contra el servidor real (levantarlo en un puerto de prueba con `--sin-navegador`):

```
curl -X POST http://127.0.0.1:8613/api/viacargo/cotizar -H "Content-Type: application/json" -d "{\"origen\":\"1602\",\"destino\":\"5000\",\"peso\":2,\"largo\":20,\"ancho\":15,\"alto\":10,\"valor\":150000,\"pago\":\"P\"}"
curl -X POST http://127.0.0.1:8613/api/correo/cotizar  -H "Content-Type: application/json" -d "{\"provincia\":\"BUENOS AIRES\",\"entrega\":\"sucursal\",\"sucursal_destino\":\"B0721\",\"peso\":2,\"largo\":20,\"ancho\":15,\"alto\":10,\"valor\":150000}"
```

Caso de referencia (18/09/2026, FLORIDA → Munro 1605 / sucursal B0721, 20×15×10 cm, 2 kg, $150.000): Correo Clásico $5.816 (MiCorreo también devuelve Expreso $6.400, que se descarta); Vía Cargo Estándar $15.000. Los precios cambian; lo que debe mantenerse es la estructura. La UI completa se puede verificar con Playwright headless (rellenar formulario, elegir destino, `#btn`, esperar a que `#btn` se habilite).

En Bash de este entorno los heredocs largos fallan; para archivos grandes usar Write/Edit o un script Python en el scratchpad. `python3` sin ruta abre el stub de Microsoft Store: usar siempre la ruta del venv. `PYTHONIOENCODING=utf-8` cuando la salida tiene tildes.

## Arquitectura

**`servidor.py`** (`http.server`, puerto 8613): al arrancar hace `os.chdir` a `COTIZADOR_DATOS` si está definida (app instalada) o a `../Correo`, porque `auth`/`cotizador`/`sucursales` usan rutas relativas (`.env`, `auth_state.json`, `browser_profile/`, `sucursales.json`); `viacargo` usa rutas absolutas. Sirve `index.html`, `icono.png` (favicon e ícono de la ventana) y los dos logos de las carpetas hermanas (`ESTATICOS`). API: `GET /api/estado` (sesión del Correo por mtime de `auth_state.json`, fechas de catálogos, límites de Vía Cargo, lista de provincias), `GET /api/destinos`, `POST /api/destinos/actualizar {catalogo}`, `GET /api/sucursales?provincia=`, `GET /api/sucursal?codigo=`, `GET /api/agencias?cp=&localidad=`, `POST /api/correo/cotizar`, `POST /api/viacargo/cotizar`, `POST /api/correo/abrir` (handoff a MiCorreo en proceso aparte: `sys.executable .../cotizador.py --abrir ...`, como en `../Correo`), `POST /api/correo/credenciales {email, password}` (escribe `.env` en el cwd, actualiza `os.environ` y, si cambia la cuenta, borra `auth_state.json`; `/api/estado` devuelve `correo.email` pero nunca la contraseña), `GET /api/pedidos`, `GET /api/pedido?id=`, `POST /api/pedidos/login`, `POST /api/pedidos/salir`, y `POST /api/latido` / `POST /api/adios` (señal de vida de la UI: actualizan `ultimo_latido`; `adios` lo atrasa `LATIDO_LIMITE - 8` s para que la app instalada se apague a los ~8 s salvo que vuelva un latido). Solo el Correo se serializa con `_lock_correo` (un navegador por vez); Vía Cargo va en paralelo. Las respuestas llevan `_segundos`.

**`destinos.py`**: catálogo unificado por CP (`destinos.json`, regenerado cuando cambia la fecha de `sucursales.json`, `localidades.json` o `agencias.json`). Por CP: `nombre` (localidad de Vía Cargo si existe, si no la primera sucursal del Correo), `alias` (todos los nombres de ambos listados, normalizados sin tildes), `provincia` con la etiqueta de MiCorreo (prioridad: provincia de las sucursales del Correo en ese CP → provincia de Vía Cargo → rango aproximado `RANGOS_CP`, marcado `provincia_fuente: "rango"`), `correo.sucursales` (código + nombre) y `viacargo` (etiqueta, cantidad de `agencias`) o `null`. **Vía Cargo solo cuenta como cobertura si hay una agencia que recibe encomiendas en ese mismo CP** (`agencias.json`, `recibe_encomiendas`): de los 1.623 CPs de `localidades.json`, la mayoría solo tiene entrega a domicilio y queda en `null`. Hay ~2.130 CPs: 1.360 con sucursal del Correo, ~456 con agencia Vía Cargo. El CLI de `destinos.py` hay que correrlo con cwd en `../Correo` (si no, `cargar_sucursales` no encuentra `sucursales.json` y el catálogo sale sin sucursales). Cinco CPs de frontera tienen sucursales en dos provincias; se toma la mayoritaria y la UI deja corregirla.

**`pedidos.py`**: lectura (nunca escritura) de pedidos de pedidosv2 en Firebase Realtime Database por REST, para asignarlos a una cotización. Toma `apiKey`/`databaseURL` de `../../pedidosv2/config.js` (`CONFIG_JS`); el login usa el usuario de pedidosv2 y envía el `Referer` del sitio publicado (la apiKey está restringida por referer); la sesión (refresh token) queda en `pedidos_sesion.json` (`SESION_FILE`) y el idToken se renueva solo. Lista los pedidos `ABIERTO` y `CERRADO`; `_resumen()` devuelve código, estado, `tipo_entrega`, cliente y `paquete` (`pedidos/<id>/paquete` de pedidosv2: `{alto, ancho, profundo, peso}` en cm/kg, solo si los cuatro son positivos; si no, `null`).

**`index.html`** (un archivo, vanilla JS, sin build): 
- *Análisis del paquete* para las dos empresas con las mismas constantes que los hermanos (`CORREO.ESCALONES`, `VC.FRANJAS_*`); si para caer en el escalón/franja anterior alcanza con reducir peso real y volumen hasta `UMBRAL_BAJAR` (10 %) cada uno, la tarjeta muestra arriba un aviso dorado corto «↓ Bajás…» (`bloqueBajar`, vía `bajarCorreo`/`bajarVC`) con los kg y cm³ a quitar y la medida que menos cm hay que recortar; si hace falta más, no se muestra nada; el modo "por volumen" busca medidas enteras que no cambien ni el escalón del Correo ni la franja de Vía Cargo.
- *Pedido* (opcional, drawer «Pedidos»): `asignarPedido()` relee el pedido y completa el destinatario para MiCorreo (nombre, email, celular partido en código de área + número con `partirTelefono()`). Salvo al «Repetir» desde el historial (`sugerir: false`), también carga el paquete del pedido con `cargarPaquetePedido()` (pasa a modo medidas; `profundo` → Largo; cm redondeados hacia arriba porque el formulario usa enteros; peso con hasta 2 decimales) y sugiere el destino. La tarjeta del pedido muestra medidas y peso.
- *Destino*: combobox propio sobre el catálogo (por nombre, alias o CP; muestra cobertura de cada empresa). Al elegir, se completan la provincia del Correo y el select de sucursales del CP (se preselecciona la que coincide con el nombre; se puede ampliar a toda la provincia vía `/api/sucursales`). Al asignar un pedido, `sugerirDestino()` elige el destino por la localidad del cliente (filtrada por provincia): compara nombre y alias ignorando el sufijo « - X» de las sucursales y, si no hay exacto, acepta alias que empiezan con la localidad como palabra; con varios CPs se queda con los que tienen sucursal o agencia y luego con los de la empresa del pedido (`tipo_entrega`), y preselecciona la sucursal coincidente. Si quedan varios o ninguno, deja la localidad en el buscador. No se extrae CP de la dirección: los números de 4 cifras ahí son alturas de calle. Al abrir la página, destino, provincia y sucursal arrancan vacíos: no se restaura el último destino (`comparador:ultimo` solo repone CP y sucursal de origen y valor).
- *Servicios*: tres switches (`correo_sucursal`, `viacargo_P`, `viacargo_D` = Estándar con pago en destino, apagado por defecto). `DEF_SERV` y `filasDe()` convierten cada respuesta en filas homogéneas `{empresa, servicio, pago, precio, plazo}`; del Correo solo se toma `clasico` (la respuesta trae también `expreso` y a veces `hoy`, que se ignoran) y de Vía Cargo solo el producto `PRODUCTO_VC = "2000"` (Estándar), aunque `viacargo.cotizar()` devuelve los cuatro. Sobre las filas se calculan la más económica y hasta dos alternativas (hero) y la tabla ordenada por precio. Si en el futuro hicieran falta domicilios, `../Correo` (`entrega: domicilio`, CP) y los productos 3000/4000/0001 de Vía Cargo ya lo soportan.
- *Cotización*: `submit` arma `ACTUAL = {trabajos: [...]}`; todos los trabajos corren en paralelo (el servidor serializa los del Correo) y cada uno actualiza la vista al terminar (`renderResultado`/`renderPaneles`). Validaciones previas (sin sucursal elegida, sin cobertura Vía Cargo, CP de origen sin cobertura) se muestran como fila de error sin bloquear el resto. Vía Cargo se cotiza con el valor declarado acotado a sus límites (`clampValorVC`) y peso con un decimal; se avisa en las notas.
- *Caché* (`comparador:cache`, 30 días) por clave empresa + entrega/pago + destino + origen + escalón/franja + valor; con «Reutilizar cotizaciones recientes» activo, los trabajos con caché se resuelven al instante y se marcan. *Historial* (`comparador:historial`, 60 entradas) guarda las respuestas resumidas (`resumirTrabajo`) y `rehidratar()` las vuelve a convertir en filas para Ver / Ficha / Repetir; exporta CSV (separador `;`, decimales con coma) y JSON.
- *Configuración* (`comparador:config`): nombre del negocio, contacto y nota para la ficha; recargo % / fijo y redondeo hacia arriba (`alCliente()`, aparece como columna "Al cliente" y en la ficha); CP de origen, sucursal de origen, valor declarado y validez por defecto; plazo de referencia del Clásico (MiCorreo no lo informa al cotizar). En el mismo drawer: *Cuenta de MiCorreo* (`/api/correo/credenciales`) y *Respaldo*, que exporta e importa en JSON (`tipo: "respaldo-comparador"`) todas las claves `comparador:*` de localStorage, para pasar historial y configuración entre el navegador y la app instalada (cada una tiene su propio localStorage).
- *Ficha para el cliente*: `abrirFicha()` serializa los datos a JSON y escribe en una ventana nueva `htmlFicha()`, que incluye `fichaRuntime` con `Function.prototype.toString` (por eso esa función no puede referenciar nada del documento principal). La barra de la ficha permite elegir qué servicios incluir (por defecto la más barata de cada empresa), precio al cliente, direcciones de retiro (sucursal del Correo / agencias de Vía Cargo) y nombre del cliente; exporta con html2canvas (copiar al portapapeles / PNG) o impresión. «Copiar resumen» genera texto con formato de WhatsApp.
- Cada 20 s envía `POST /api/latido`, y en `pagehide` un `sendBeacon("/api/adios")`; con el servidor de desarrollo no tiene efecto, en la app instalada decide cuándo apagarse.
- Claves de localStorage `comparador:*` (independientes de `cotizador:*` y `viacargo:*`). Tipografías Instrument Sans / Fraunces / IBM Plex Mono desde Google Fonts, con fallbacks del sistema. Paleta neutra ("papel" + tinta) y colores de marca solo para identificar empresa; dorado para "más económica".

## App instalable (`../Instalador`)

App de Windows con todo adentro (Python, los tres módulos, la UI, catálogos iniciales, el motor de Playwright y su `chromium_headless_shell`). No copia código: PyInstaller compila los módulos desde sus carpetas (`--paths`) y `app.py` solo los reubica.

```
..\Instalador\Construir instalador.bat                    # = .venv\Scripts\python.exe construir.py
"..\Instalador\dist\Cotizador de envios\Cotizador de envios.exe" --sin-ventana   # prueba: solo el servidor en :8620; se apaga a los ~3,5 min sin latidos
```

- **`app.py`** (punto de entrada): define `COTIZADOR_DATOS` = `%LOCALAPPDATA%\Cotizador de envios`. Ahí van la cuenta `.env`, `auth_state.json`, `browser_profile/`, catálogos, `destinos.json`, `pedidos_sesion.json`, `ventana/` (perfil del navegador de la ventana, con el localStorage de la app) y `registro.log` (stdout/stderr; no hay consola). Copia ahí los catálogos iniciales la primera vez, apunta `PLAYWRIGHT_BROWSERS_PATH` al navegador empaquetado, carga el `.env` de esa carpeta (auth.py lo buscaría junto a su archivo) y reasigna las rutas que los módulos escriben junto a sí mismos (`viacargo.LOCALIDADES_FILE`/`AGENCIAS_FILE`, `destinos.DESTINOS_FILE`, `pedidos.SESION_FILE`/`CONFIG_JS`, `servidor.ESTATICOS`). **Si un módulo agrega un archivo que escribe con ruta absoluta, hay que reubicarlo acá**: la carpeta del programa se reemplaza al actualizar.
- La app levanta `servidor.Handler` en el **puerto 8620** (el 8613 queda para desarrollo; el puerto fijo importa porque el localStorage es por origen) y abre la UI con Edge (o Chrome) en modo `--app` con `--user-data-dir` propio; si no hay ninguno, usa el navegador por defecto. Se apaga cuando pasan `servidor.LATIDO_LIMITE` (150 s; largo porque las ventanas minimizadas espacian los timers) sin latidos. Un segundo lanzamiento detecta la instancia abierta con `POST /api/latido` y solo abre otra ventana; no usar `/api/estado` ni `/api/limites`, que consultan Vía Cargo y pueden tardar 20 s. Si `argv[1]` termina en `cotizador.py`, corre `cotizador.main()`: así funciona «Abrir en MiCorreo», que lanza `sys.executable` (el .exe).
- **`construir.py`**:
  - Genera `icono.ico` y `../Comparador/icono.png` si faltan (caja con cinta dorada sobre tinta, con Pillow).
  - Arma `build/recursos`: `web/` (index.html, ícono, logos), `catalogos/`, `pedidosv2/config.js` y `ms-playwright/chromium_headless_shell-<rev>`. El navegador se copia de `%LOCALAPPDATA%\ms-playwright` si la revisión coincide con la de Playwright; si no, se descarga.
  - Corre PyInstaller (`--windowed`, carpeta, con archivo de versión) → `dist/`, e Inno Setup → `salida/Instalador Cotizador de envios <VERSION>.exe` (~115 MB). Subir `VERSION` en cada entrega.
- **`instalador.iss`** (Inno Setup 6, guardado en UTF-8 con BOM por las tildes):
  - Instala por usuario, sin admin, en `%LOCALAPPDATA%\Programs\Cotizador de envios`, con acceso en Inicio y en el escritorio opcional.
  - `AppId` fijo: no cambiarlo, es lo que hace que una versión nueva reemplace a la anterior. Al actualizar borra `_internal`.
  - Al desinstalar pregunta si borrar la carpeta de datos (por defecto la conserva).
  - `Compression=lzma2/max`: con `ultra64`, ISCC se queda sin memoria.
- Entorno de compilación:
  - `.venv` propio, creado desde `../Correo/venv` con `requisitos-build.txt`; `playwright` debe ser la misma versión que en `../Correo`.
  - Inno Setup 6: `winget install JRSoftware.InnoSetup`, queda en `%LOCALAPPDATA%\Programs\Inno Setup 6`. Desde Git Bash, los parámetros `/D...` de ISCC se rompen por la conversión de rutas de MSYS: correrlo desde PowerShell o desde `construir.py`.
  - `.venv/`, `build/`, `dist/` y `salida/` están en `.gitignore`.
- El instalador no está firmado: SmartScreen avisa la primera vez («Más información» → «Ejecutar de todas formas»).

## Archivos sensibles

En esta carpeta solo `pedidos_sesion.json` (refresh token de pedidosv2, en .gitignore). Las credenciales de MiCorreo, la sesión y el perfil de navegador quedan en `../Correo` (ver su CLAUDE.md) o, en la app instalada, en `%LOCALAPPDATA%\Cotizador de envios`; el instalador no incluye nada de eso. `destinos.json` es un cache regenerable.
