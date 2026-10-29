# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Cotizador local de encomiendas de **Flecha Carga**, hermano de `../ViaCargo` y `../Correo` (misma estética y prestaciones: análisis del paquete, historial, ficha para el cliente). A diferencia de ellos no consulta ninguna API: Flecha Carga no tiene cotizador instantáneo en su web (el formulario de `cotiza-tu-envio` pide contacto y responden por mail), así que los precios salen del cuadro tarifario en CSV que manda la empresa (`Flecha Carga - TARIFARIO.csv`). Al flete se le suma un **seguro en monto fijo** que el usuario carga a mano y queda recordado. No está integrado al Comparador ni al instalador.

Frontend en `index.html` servido por `servidor.py` (stdlib, puerto **8614**), lógica en `flechacarga.py`. Texto de UI y comentarios en español (sin tildes en los comentarios de Python, con tildes en la UI). Vive en el repo git `homepoint`: no commitear sin pedido explícito. No hay tests ni linter.

## Comandos

Sin dependencias: Python 3.10+ (`py -3`, o el venv de `../ViaCargo`).

```
py -3 servidor.py [puerto] [--sin-navegador]      # UI en http://127.0.0.1:8614 (o Cotizador.bat)
py -3 flechacarga.py --importar ["otro.csv"]       # regenera tarifas.json
py -3 flechacarga.py --buscar rosario
py -3 flechacarga.py --destino "ALCORTA (SFE)" --peso 12 [--largo 40 --ancho 30 --alto 30 --factor 4000] [--seguro 1500] [--json]
py -3 flechacarga.py --sucursales rosario
py -3 flechacarga.py --actualizar-sucursales       # regenera sucursales.json desde el sitio
py -3 -W error -m py_compile servidor.py flechacarga.py
node --check <script principal de index.html>     # el último </script> es el de la ficha, dentro de un template literal
```

Casos de referencia (tarifario de octubre 2026): 30 DE AGOSTO 3 kg → $7.371; AGRONOMIA (CABA) 45 kg → 16.730 + 5 × 346 = $18.460; AGRONOMIA 2 kg con 40×40×40 y factor 4000 → 16 kg → franja 15-20 = $9.560.

En Bash de este entorno los heredocs largos fallan; usar Write/Edit. `python3` sin ruta abre el stub de Microsoft Store. `PYTHONIOENCODING=utf-8` cuando la salida tiene tildes.

## Arquitectura

**Tarifario** (`flechacarga.importar_tarifario`): el CSV tiene 6 filas de encabezado y después una fila por destino: col. 0 `NOMBRE (PROV) (CODIGO)`, cols. 4–27 NETO/IVA/TOTAL de 8 franjas (0-5, 5-10 … 35-40 kg) con coma de miles (`" 6,092 "`), col. 28 costo por kilo excedente (**con IVA incluido**, confirmado por el usuario). El código entre paréntesis es un código de agencia de Flecha Carga, **no un CP** (`522`, `CBUE`, `1439A`). Los nombres vienen cortados a 20 caracteres, por eso hay paréntesis sin cerrar (`_limpiar_nombre` los arregla) y abreviaturas de provincia truncadas; `PROVINCIAS` mapea solo las inequívocas. Resultado: `tarifas.json` (616 destinos), que `cargar_tarifas()` regenera si el CSV es más nuevo. La UI también importa un CSV nuevo (`POST /api/tarifas/importar`, cuerpo = texto, header `X-Archivo`).

**Precio** (`cotizar()` en Python y `calcular()` en index.html, misma cuenta): peso facturable = peso real, o el mayor entre real y `largo×ancho×alto ÷ factor` si el usuario activa el volumétrico (apagado por defecto, factor 4000 editable). Franja = primera con `hasta ≥ facturable`. Más de 40 kg: total de 35-40 + `ceil(kg - 40) × kg_excedente`. Total = flete + seguro. La UI calcula localmente (instantáneo); `/api/cotizar` queda para scripts.

**Puntos Flecha** (`descargar_sucursales`): la página `https://www.flechacarga.com/donde-estamos/` trae embebido `var backend = { sucursales: [...] }` (≈480, con `name`, `address`, `postalCode`, `hours`, `contact`, `lat/lng`); se lee con `JSONDecoder.raw_decode` desde `sucursales: [`. Algunas son "SOLO CON ENVIO A DOMICILIO" o "(solo despacho)" → `solo_domicilio` / `solo_despacho`. `sucursales_de()` cruza por nombre normalizado como palabras completas; si hay coincidencias exactas (o CP = código) descarta las parciales. `servidor._catalogo()` agrega a cada destino `puntos` (índices en `sucursales`), así la UI no repite el cruce. ~370 de 616 destinos tienen Punto Flecha asociado.

**Frontend** (`index.html`, vanilla JS): destino con `<datalist>` (etiqueta `NOMBRE · CODIGO`), peso, medidas opcionales, seguro, switch de volumétrico. Análisis en vivo con aviso «↓ Bajás…» si quitando hasta 10 % (`UMBRAL_BAJAR`) se cae en la franja anterior. Resultado: costo y «Al cliente» (recargo % / fijo / redondeo de Configuración), desglose, Puntos Flecha del destino y tabla de las 8 franjas. Historial (30) con Ver / Repetir / Ficha y exportación CSV (`;`). Ficha con `htmlFicha()` + html2canvas (cdnjs); con recargo muestra solo el precio al cliente. localStorage `flechacarga:*` (`seguro`, `vol`, `config`, `historial`). Paleta del sitio: azul `#030b84`, rojo `#e30613`; el logo (`logo-flechacarga.png`) es blanco y rojo, para fondo azul.

## Archivos

`tarifas.json` y `sucursales.json` son caches regenerables. No hay datos sensibles.
