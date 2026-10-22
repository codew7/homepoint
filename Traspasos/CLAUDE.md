# CLAUDE.md — Traspasos

App móvil (vertical) para pedir y despachar mercadería entre sucursales. **Independiente del resto del repo**: `index.html` (HTML+CSS+JS inline, JS clásico, Firebase compat 10.12.0 por CDN) + `config.js` propio (copia de `firebaseConfig` de pedidos-87064; gitignored) + `manifest.json`/`icon.png`. No referenciar archivos de fuera de esta carpeta.

## Flujo
- El teléfono se configura una vez con su sucursal (`localStorage.hpTraspasoSucursal`, ids de `SUCURSALES`: '1' Munro, '2' Caseros — mismos que `puntoVenta.js`). No hay roles: cualquiera pide para su sucursal y prepara lo que le pide la otra.
- **Pedir** (sucursal destino) → `traspasos/{id}` en `PENDIENTE`, número `TR-NNNN` correlativo por transaction sobre `traspasosMeta` (`ultimoNumero` + `libres`). Eliminar un pedido (solo root, nunca un `ENVIADO`) libera su número: si era el último baja `ultimoNumero`, si no queda en `libres` y el próximo pedido reusa el menor. `pedidosv2.html` numera con la misma lógica.
- **Preparar** (sucursal origen) → "Empezar a preparar" toma el pedido por transaction (`PREPARANDO` + `preparadoPor`). Cada artículo se revisa (✓ o editar cantidad); se puede bajar la cantidad (nunca subir sobre lo pedido), marcar sin stock o quitar. El avance se guarda en `localStorage` (`hpTraspasoPick_{id}`).
- **Despachar** → un único `db.ref().update()` con estado `ENVIADO`, `enviada`/`motivo` por item (`PARCIAL`|`SIN_STOCK`|`QUITADO`) y los movimientos **SI** (sucursal origen) y **EI** (sucursal destino) por cada artículo con unidades. Si no se envía nada, el pedido pasa a `CANCELADO` sin movimientos.
- Las claves de movimiento son determinísticas (`movimientos/tr_{id}_{codigo}_SI|EI`): un reintento o doble despacho pisa las mismas claves y no duplica stock. No cambiar a `push()`.
- **Recibido** lo marca la sucursal destino; es solo seguimiento, no escribe movimientos. Cancelar: solo desde destino y solo mientras está `PENDIENTE` (transaction).

## UI
- Capas (sheets/pantallas) apiladas en `capas[]` con `history.pushState` para que el botón Atrás del celular las cierre. Para cerrar una capa y abrir otra en secuencia usar `cerrarCapaAsync()`/`cambiarCapa()`, no `history.back()` + abrir en el mismo tick.
- Firma visual: componente de ruta `rutaHtml(origen, destino)` con los colores de cada sucursal (mismos que `articulos.html`).
