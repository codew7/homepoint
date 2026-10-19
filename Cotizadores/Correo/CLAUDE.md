# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Cotizador local de envíos de Correo Argentino (Paq.ar) que reproduce las tarifas exactas de la cuenta MiCorreo del usuario. No hay API pública: un navegador Playwright completa el formulario real de MiCorreo y lee los precios que el sitio calcula. Frontend en `index.html` servido por `servidor.py` (stdlib), lógica en Python. Todo el texto de UI, comentarios y mensajes va en español (sin tildes en los comentarios de Python, con tildes en la UI).

No es repo git. No hay tests automatizados ni linter; la verificación se hace ejecutando contra el sitio real o con Playwright headless contra `servidor.py`.

## Comandos

Siempre con el venv del proyecto (Python 3.13, Playwright + chromium instalados):

```
.\venv\Scripts\python.exe servidor.py            # UI en http://127.0.0.1:8611 (o Cotizador.bat; puerto opcional como argumento)
.\venv\Scripts\python.exe cotizador.py --entrega sucursal --provincia "Buenos Aires" --sucursal-destino B0721 --peso 2 --largo 20 --ancho 15 --alto 10 --valor 150000
.\venv\Scripts\python.exe cotizador.py --abrir ...mismos args...        # abre MiCorreo visible con el formulario cargado (handoff al usuario)
.\venv\Scripts\python.exe cotizador.py --largo 20 --ancho 15 --alto 10 --guardar-medidas "Alias"   # medida frecuente en MiCorreo (solo CLI)
.\venv\Scripts\python.exe sucursales.py          # regenera sucursales.json (3765 sucursales, requiere sesion)
.\venv\Scripts\python.exe sucursales.py B0721    # direccion/horario de una sucursal (buscador publico, sin sesion)
.\venv\Scripts\python.exe auth.py                # fuerza relogin
.\venv\Scripts\python.exe -W error -m py_compile servidor.py cotizador.py sucursales.py auth.py
node --check <script extraido de index.html>     # el JS inline no tiene otro chequeo; extraer el bloque <script> final
```

Caso de referencia verificado contra la pagina oficial: origen FLORIDA (cabecera), sucursal MUNRO (B0721), 20x15x10 cm, 2 kg, $150000 → Clasico $5.816,00 / Expreso $6.400,00.

En Bash de este entorno, los heredocs largos fallan ("unexpected EOF"); para archivos grandes usar Write/Edit o un script Python en el scratchpad. `python3` sin ruta abre el stub de Microsoft Store y cuelga: usar siempre `./venv/Scripts/python.exe`. Poner `PYTHONIOENCODING=utf-8` cuando la salida tiene tildes.

## Arquitectura

**Dos aplicaciones de MiCorreo encadenadas** (`auth.py`): el portal nuevo `micorreo.correoargentino.com.ar` (React, API `api.correoargentino.com.ar/ed/v2`, JWT en localStorage `auth_access_token`, ~2 h) y el sitio clasico `www.correoargentino.com.ar/MiCorreo/public/envioCla` (Laravel + jQuery, `funCla.js`). El login (reCAPTCHA v3, rechazos intermitentes) se hace en el portal nuevo con perfil persistente `browser_profile/` y un navegador real (Brave si está instalado, si no Chrome/Edge; ver `opciones_navegador()`, que también usa `abrir_en_micorreo`); luego `POST /auth/redirect {token, path:'/envioCla'}` devuelve una URL puente hacia el sitio clasico. Las cookies resultantes se guardan en `auth_state.json`; `ensure_logged_in()` renueva por antigüedad (mtime) y las funciones de alto nivel reintentan una vez con `force=True` si `envioCla` redirige. **Playwright sync no se puede anidar**: el relogin debe ocurrir fuera del bloque `with sync_playwright()` (por eso `cotizar()` envuelve a `_cotizar_con_sesion()`).

**Cotizacion = manejar la UI real** (`cotizador.py`, `_completar_formulario`): medidas → `#next` (descartar modal `#exampleModal` de medidas frecuentes) → `#tipoEntrega` → provincia + CP (`#provincia`/`#cpCpa`) o provincia + sucursal (`#provincia2`/`#sucursalDestino2`, cargado via AJAX `consultarSO`) → esperar `#CLASICO/#EXPRESO/#HOY`. Los inputs del sitio sanean texto: enviar enteros sin decimales y peso con coma (`_fmt_entero`, `_fmt_peso`); "2.0" se interpretaba como 20 kg. En `#sucursalDestino2` el `value` es el CP (compartido entre varias sucursales) y la `class` es el codigo de sucursal (ej. B0721): seleccionar por codigo. El origen por defecto es la sucursal cabecera de la cuenta (FLORIDA, CP 1602), igual que el sitio.

**Servidor** (`servidor.py`): `http.server` que sirve solo `index.html` y `logo-correo.png`; API: `POST /api/cotizar`, `GET /api/sucursales` (+ `POST /api/sucursales/actualizar`), `GET /api/sucursal?codigo=`, `POST /api/abrir`. Las operaciones con navegador se serializan con un lock; `/api/abrir` lanza `cotizador.py --abrir` como proceso independiente para que la ventana visible no bloquee al servidor.

**Sucursales** (`sucursales.py`): `sucursales.json` viene del endpoint interno `consultarSO` (nombre, CP, codigo) recorriendo las 24 provincias desde la pagina autenticada. Direccion/horario/coordenadas vienen del buscador publico `wsFacade.php` (`localidadesconsucursales` → `sucursales` por localidad), vinculando por nombre normalizado; cache en `sucursales_detalle.json`. CABA es una unica localidad (id 5001). El Correo no publica telefono por sucursal; solo el 0810-777-7787 general.

**Frontend** (`index.html`, un solo archivo, vanilla JS): analisis local del paquete con reglas deducidas empiricamente (peso volumetrico = L×A×H/6000, se cobra max(real, volumetrico) redondeado a escalones 0,5/1/2/3/5/10/15/20/25 kg; constantes `FACTOR_VOL`, `ESCALONES`). Dos modos de carga (`name="modo"`, selector segmentado): "por medidas" (L×A×H) o "por volumen" (cm³ o litros); como MiCorreo solo acepta cm enteros, `medidasDesdeVolumen()` busca tres enteros ≤ 999 cuyo producto sea el volumen exacto (o un vecino a < 0,2 % con medidas mas parejas, nunca de otro escalon) y el backend recibe siempre largo/ancho/alto; `leerPaquete()` es la unica fuente del paquete a cotizar. Los campos del paquete arrancan vacios (valor declarado 100000 por defecto); solo se recuerdan el destino y el modo. Layout de dos columnas (formulario + resultado / historial lateral sticky) hasta 1023 px. Estado en localStorage: ultima consulta, modo, historial (30, `p.modo`/`p.volumen_cm3` cuando fue por volumen), cache de precios por clave escalon+destino+valor (30 dias). La ficha "Compartir cotizacion" se genera con `htmlFicha()` en una ventana nueva (`document.write`) con html2canvas desde cdnjs; Clasico siempre destacado. Paleta oficial tomada del CSS de MiCorreo: azul `#152663`, amarillo `#ffce00`, gris `#49454f`.

## Archivos sensibles

`.env` (credenciales reales), `auth_state.json`, `browser_profile/` y `capture_log.jsonl` (captura de red con contraseña en claro y datos personales) estan en `.gitignore`; no copiar su contenido a la conversacion ni a otros archivos. `capture_*.py`, `login.py` y `envioCla_full.html` son restos de la fase de descubrimiento (el HTML sirve para consultar selectores del sitio).
