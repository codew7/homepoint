# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Cotizador local de envíos de Vía Cargo que reproduce las tarifas del cotizador público `https://viacargo.com.ar/cotizar-envio/`. Es la versión "hermana" del cotizador de Correo Argentino (`../Correo`), con la misma UI y prestaciones (análisis del paquete, modo por volumen, historial, cache, ficha para compartir), pero mucho más simple: no hay login ni navegador. El formulario del sitio es un iframe Angular (`formularios.viacargo.com.ar`) que llama a una API pública (`ws.busplus.com.ar`) con una clave fija embebida en su JS; `viacargo.py` llama a esos endpoints directamente con `urllib`. Solo se puede cotizar: Vía Cargo no permite gestionar envíos desde el sitio, así que no hay "handoff" al navegador.

Frontend en `index.html` servido por `servidor.py` (stdlib), lógica en Python. Todo el texto de UI, comentarios y mensajes va en español (sin tildes en los comentarios de Python, con tildes en la UI). Funciona en paralelo e independiente del cotizador del Correo (puerto 8612 vs 8611; claves de localStorage `viacargo:*`).

No es repo git. No hay tests automatizados ni linter; la verificación se hace ejecutando contra la API real o con Playwright headless (el venv de `../Correo` lo tiene instalado) contra `servidor.py`.

## Comandos

Sin dependencias externas: alcanza con Python 3.10+ (el venv del proyecto es un venv vacío, o `py -3`):

```
.\venv\Scripts\python.exe servidor.py            # UI en http://127.0.0.1:8612 (o Cotizador.bat; puerto opcional como argumento)
.\venv\Scripts\python.exe viacargo.py --origen 1602 --destino 5000 --peso 2 --largo 20 --ancho 15 --alto 10 --valor 150000 [--pago D] [--json]
.\venv\Scripts\python.exe viacargo.py --buscar munro        # localidades que coinciden (nombre o CP)
.\venv\Scripts\python.exe viacargo.py --agencias 5000       # agencias de un CP / localidad
.\venv\Scripts\python.exe viacargo.py --actualizar          # regenera localidades.json (1899) y agencias.json (572)
.\venv\Scripts\python.exe -W error -m py_compile servidor.py viacargo.py
node --check <script extraido de index.html>     # extraer el bloque <script> que sigue a </main> (el ultimo </script> es el de la ficha, dentro de un template literal)
```

Caso de referencia (18/09/2026): FLORIDA (1602) → CORDOBA (5000), 20×15×10 cm, 2 kg, $150.000, pago en origen → Estándar $19.000 / Plus RD $27.000 / Plus ED $27.000 / Puerta a puerta $35.000. Los precios cambian con el tiempo; lo que debe mantenerse es la estructura.

En Bash de este entorno, los heredocs largos fallan; para archivos grandes usar Write/Edit o un script Python en el scratchpad. `python3` sin ruta abre el stub de Microsoft Store: usar `./venv/Scripts/python.exe` o `py -3`. Poner `PYTHONIOENCODING=utf-8` cuando la salida tiene tildes.

## Arquitectura

**API de Vía Cargo** (`viacargo.py`): base `https://ws.busplus.com.ar`, header `PUBLIC-KEY` (constante `PUBLIC_KEY`, sacada de `environment.keyAccess` del bundle `main-*.js` de formularios.viacargo.com.ar). Endpoints: `POST /alerce/cotizar` (payload con `IdClienteRemitente=99999999`/`IdCentroRemitente=99`, CPs, `Kilos`, `Largo/Alto/Ancho`, `ImporteValorDeclarado`, `NumeroBultos`, `TipoPortes` P/D), `GET /alerce/productos`, `GET /alerce/limite_importe_declarado?IdlimitanteDeclarado=9` (mín. $100.000 / máx. $1.000.000, los mismos que aplica el formulario), `GET /encomiendas/codigopostal/search` (sin clave), `GET /agencias/agencias_datos_mapas?TipoAgencias=2`. Los errores llegan como HTTP 404/405 con `{"status":false,"message":"..."}` ("Sin cotización Alerce" = ruta sin cobertura) y se convierten en `RuntimeError`; HTTP 400 es payload mal formado. **Restricciones del payload**: medidas enteras 1–999; peso con un solo decimal (`"2.55"` → 400; `_fmt_decimal` redondea); valor declarado con 2 decimales. El CP manda: `resolver_localidad()` acepta "NOMBRE (CP) - PROVINCIA", un CP o un nombre. `cotizar()` devuelve los 4 productos normalizados (`codigo`, `nombre`, `modalidad`, `total`, `entrega_estimada`, `conceptos`, `neto`, `iva`) más `raw`.

**Productos**: `2000` Estándar (agencia→agencia), `3000` Plus RD (retiro domicilio→agencia), `4000` Plus ED (agencia→entrega domicilio), `0001` Puerta a puerta. `PRODUCTO_PERMITIDO` "N" se muestra como no disponible.

**Estructura del precio** (deducida cotizando): conceptos sin IVA — `PORT` flete, `REDO` retiro domicilio, `ENDO` entrega domicilio, `SEGU` seguro = 5 % del valor declarado, `PADO` pago en destino = 15 % del flete, `REDP`/`REDD` "ajustes de redondeo" — y `TOTAL` = suma × 1,21 redondeado a miles. `NumeroBultos` no cambia el precio. Los conceptos y umbrales de franjas se comprobaron en dos rutas (1602→5000 y 1602→1000).

**Franjas del flete** (constantes en `index.html`): por peso real hasta 5/10/20/30/40/50 kg y después por kg (tarifa por kg decreciente: hasta 100 kg, hasta 200, más); por volumen hasta 28/72/120/160/200 dm³ (`FRANJAS_VOL = [27999, 71999, 120000, 160000, 200000]`: 28.000 cm³ ya paga como 10 kg, 72.000 como 20 kg) y después vol/4000 kg (250 kg/m³). Cada franja de volumen cuesta lo mismo que la de peso de 5/10/20/40/50 kg (no existe la de 30 por volumen). Se paga la más cara de las dos (`analizar()` → `rango`). No es peso volumétrico clásico con factor 6000: no ajustar sin volver a medir.

**Servidor** (`servidor.py`): `http.server` que sirve solo `index.html` y `logo-viacargo.png`; API: `POST /api/cotizar`, `GET /api/localidades` (+ `POST /api/localidades/actualizar`), `GET /api/agencias` (+ `POST /api/agencias/actualizar`), `GET /api/limites`. Sin lock para cotizar (son llamadas HTTP), con lock solo para escribir los catálogos.

**Catálogos** (`localidades.json`, `agencias.json`): se descargan la primera vez y quedan en disco. Localidades: 1899, con `cp`, `nombre`, `provincia`, `etiqueta` ("NOMBRE (CP) - PROVINCIA"); 198 CPs se repiten entre barrios (el precio depende solo del CP). Agencias: 572, con dirección, teléfono, horarios, coordenadas y `recibe_encomiendas` (la API trae la clave `"RecepcionEncomiendas "` con espacio final). `agencias_en()` busca por CP y, si no hay, por nombre de localidad.

**Frontend** (`index.html`, un solo archivo, vanilla JS): misma estructura que el del Correo. Origen/destino son inputs con `<datalist>` de las 1899 etiquetas; `resolverLocalidad()` valida contra el listado y muestra ✓/✗ debajo. Forma de pago P / D / "ambos" (dos llamadas, comparación lado a lado). Resultado: 4 tarjetas (más económica destacada), desglose por concepto con IVA, agencias en origen y destino (máx. 4, las que no reciben encomiendas al final), JSON crudo. Análisis del paquete con las franjas de arriba. Estado en localStorage `viacargo:*`: último origen/destino/pago, modo, historial (30, guarda una respuesta resumida para reabrir la ficha), cache por origen+destino+pago+franja+valor (30 días). Origen por defecto la primera vez: FLORIDA (1602). Ficha "Compartir cotización" con `htmlFicha()` + html2canvas (cdnjs): logo, trayecto, 4 servicios, hasta 3 agencias del destino, paquete. Paleta del sitio: verde `#1e8d34`, rojo `#dc2525`, gris `#212121`.
