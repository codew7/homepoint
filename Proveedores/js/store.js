/**
 * Estado en memoria de la app.
 *
 * Firebase Realtime Database empuja los cambios con onValue(), así que el estado
 * es un espejo de la base y las vistas se redibujan cuando algo cambia. Un único
 * lugar de verdad para no desincronizar listados y totales.
 */

const state = {
  proveedores: [],
  facturas: [],
  pagos: [],
  filtros: { proveedorId: '', moneda: '', desde: '', hasta: '' },
  filtrosFacturas: { proveedorId: '', moneda: '', estado: '' },
  verInactivos: false,
  cargando: true,
};

const suscriptores = new Set();

/** Registra un callback que corre en cada cambio de estado. */
export function suscribir(callback) {
  suscriptores.add(callback);
  return () => suscriptores.delete(callback);
}

function notificar() {
  suscriptores.forEach((cb) => cb(state));
}

export function getState() {
  return state;
}

export function setProveedores(proveedores) {
  // Orden alfabético estable para el listado y los <select>.
  state.proveedores = proveedores.sort((a, b) =>
    (a.nombre || '').localeCompare(b.nombre || '', 'es')
  );
  notificar();
}

export function setPagos(pagos) {
  // Más recientes primero; a igual fecha, el último cargado arriba.
  state.pagos = pagos.sort((a, b) => {
    if (a.fecha !== b.fecha) return (b.fecha || '').localeCompare(a.fecha || '');
    return (b.creadoEn || 0) - (a.creadoEn || 0);
  });
  notificar();
}

export function setFacturas(facturas) {
  // Más recientes primero, igual criterio que los pagos.
  state.facturas = facturas.sort((a, b) => {
    if (a.fecha !== b.fecha) return (b.fecha || '').localeCompare(a.fecha || '');
    return (b.creadoEn || 0) - (a.creadoEn || 0);
  });
  notificar();
}

export function setFiltros(parciales) {
  Object.assign(state.filtros, parciales);
  notificar();
}

export function setFiltrosFacturas(parciales) {
  Object.assign(state.filtrosFacturas, parciales);
  notificar();
}

export function limpiarFiltrosFacturas() {
  state.filtrosFacturas = { proveedorId: '', moneda: '', estado: '' };
  notificar();
}

export function limpiarFiltros() {
  state.filtros = { proveedorId: '', moneda: '', desde: '', hasta: '' };
  notificar();
}

export function setVerInactivos(valor) {
  state.verInactivos = valor;
  notificar();
}

export function setCargando(valor) {
  state.cargando = valor;
  notificar();
}

/* ────────────────────────────── Selectores ────────────────────────────── */

export const getProveedorPorId = (id) => state.proveedores.find((p) => p.id === id) || null;

export const getProveedoresActivos = () => state.proveedores.filter((p) => p.activo !== false);

/** Pagos que pasan los filtros vigentes. */
export function getPagosFiltrados() {
  const { proveedorId, moneda, desde, hasta } = state.filtros;

  return state.pagos.filter((pago) => {
    if (proveedorId && pago.proveedorId !== proveedorId) return false;
    if (moneda && pago.moneda !== moneda) return false;
    // Las fechas son 'YYYY-MM-DD': comparar como string equivale a comparar cronológicamente.
    if (desde && (pago.fecha || '') < desde) return false;
    if (hasta && (pago.fecha || '') > hasta) return false;
    return true;
  });
}

/**
 * Suma un conjunto de pagos separando por moneda.
 * montoARS de cada pago ya viene calculado a la cotización del día del pago,
 * así que el total en pesos es histórico y no se mueve si cambia el dólar hoy.
 */
export function calcularTotales(pagos) {
  return pagos.reduce(
    (acc, pago) => {
      const monto = Number(pago.monto) || 0;
      const montoARS = Number(pago.montoARS) || 0;

      if (pago.moneda === 'USD') {
        acc.totalUSD += monto;
        acc.cantidadUSD += 1;
      } else {
        acc.totalARS += monto;
        acc.cantidadARS += 1;
      }

      acc.equivalenteARS += montoARS;
      acc.cantidad += 1;
      return acc;
    },
    { totalARS: 0, totalUSD: 0, equivalenteARS: 0, cantidad: 0, cantidadARS: 0, cantidadUSD: 0 }
  );
}

/* ────────────────────────────────── Facturas ────────────────────────────────── */

/** Diferencias menores a un centavo son ruido de coma flotante, no deuda. */
const TOLERANCIA = 0.01;

export const getFacturaPorId = (id) => state.facturas.find((f) => f.id === id) || null;

/**
 * Cuánto de un pago se puede imputar a una factura, expresado en la moneda de la factura.
 * Solo sirve para PROPONER un valor en la UI: lo que se guarda es lo que confirma el usuario.
 *
 * @returns {number} NaN si falta la cotización necesaria para cruzar monedas.
 */
export function convertirAMonedaFactura(pago, monedaFactura) {
  const monto = Number(pago.monto) || 0;
  const cotizacion = Number(pago.cotizacion);

  if (pago.moneda === monedaFactura) return monto;
  if (!Number.isFinite(cotizacion) || cotizacion <= 0) return NaN;

  // USD → ARS multiplica; ARS → USD divide.
  return pago.moneda === 'USD' ? monto * cotizacion : monto / cotizacion;
}

/**
 * Convierte un importe expresado en la moneda de una factura a la moneda de un pago.
 * Es la operación inversa de convertirAMonedaFactura().
 *
 * @returns {number} NaN si falta la cotización necesaria para cruzar monedas.
 */
export function convertirAMonedaPago(monto, monedaFactura, pago) {
  if (monedaFactura === pago.moneda) return monto;

  const cotizacion = Number(pago.cotizacion);
  if (!Number.isFinite(cotizacion) || cotizacion <= 0) return NaN;

  // El importe está en la moneda de la factura: USD → ARS multiplica, ARS → USD divide.
  return monedaFactura === 'USD' ? monto * cotizacion : monto / cotizacion;
}

/**
 * Suma de todo lo que un pago imputó, expresado en la MONEDA DEL PAGO. Permite comparar las
 * imputaciones (cada una en la moneda de su factura) contra el monto del pago.
 *
 * @returns {number} NaN si alguna imputación cruza monedas y el pago no tiene cotización.
 */
export function getImputadoEnMonedaDelPago(pago) {
  let total = 0;

  for (const [facturaId, monto] of Object.entries(pago.imputaciones || {})) {
    const factura = getFacturaPorId(facturaId);
    // Factura inexistente (borrada a mano en la base): esa imputación no se puede interpretar.
    if (!factura) continue;

    const convertido = convertirAMonedaPago(Number(monto) || 0, factura.moneda, pago);
    if (!Number.isFinite(convertido)) return NaN;

    total += convertido;
  }

  return total;
}

/**
 * Parte del pago que no está aplicada a ninguna factura: plata entregada "a cuenta".
 * Es lo que genera saldo a favor con un proveedor.
 *
 * Si no se puede saber cuánto se imputó (falta cotización) devuelve 0: es preferible no
 * declarar un saldo a favor antes que inventar uno.
 */
export function getMontoACuenta(pago) {
  const imputado = getImputadoEnMonedaDelPago(pago);
  if (!Number.isFinite(imputado)) return 0;

  return Math.max((Number(pago.monto) || 0) - imputado, 0);
}

/**
 * Estado de una factura. El saldo NO se guarda en la base: se deriva de los pagos, así no hay
 * dos fuentes de verdad que puedan quedar desincronizadas.
 *
 * @param {object} factura
 * @param {string} [ignorarPagoId] Excluye un pago del cálculo. Sirve al editar: las
 *   imputaciones que ese pago ya tenía no deben contar como saldo ajeno.
 * @returns {{total:number, pagado:number, saldo:number, estado:'pendiente'|'parcial'|'pagada'}}
 */
export function calcularSaldoFactura(factura, ignorarPagoId = null) {
  const total = Number(factura.montoTotal) || 0;

  const pagado = state.pagos.reduce((acc, pago) => {
    if (pago.id === ignorarPagoId) return acc;
    return acc + (Number(pago.imputaciones?.[factura.id]) || 0);
  }, 0);

  const saldo = total - pagado;

  let estado = 'parcial';
  if (pagado <= TOLERANCIA) estado = 'pendiente';
  else if (saldo <= TOLERANCIA) estado = 'pagada';

  return { total, pagado, saldo, estado };
}

/** Facturas que todavía deben algo. Es lo que se ofrece para imputar en el modal de pago. */
export function getFacturasConSaldo(proveedorId, ignorarPagoId = null) {
  return state.facturas
    .filter((f) => f.proveedorId === proveedorId)
    .map((f) => ({ factura: f, ...calcularSaldoFactura(f, ignorarPagoId) }))
    .filter((f) => f.saldo > TOLERANCIA);
}

/** Facturas que pasan los filtros de esa vista, ya con su saldo calculado. */
export function getFacturasFiltradas() {
  const { proveedorId, moneda, estado } = state.filtrosFacturas;

  return state.facturas
    .map((factura) => ({ factura, ...calcularSaldoFactura(factura) }))
    .filter((fila) => {
      if (proveedorId && fila.factura.proveedorId !== proveedorId) return false;
      if (moneda && fila.factura.moneda !== moneda) return false;
      if (estado && fila.estado !== estado) return false;
      return true;
    });
}

/**
 * Totales de facturación separados por moneda.
 * ARS y USD no se suman entre sí: cada factura conserva su moneda y no existe una cotización
 * única que haga honesto un total mezclado.
 */
export function getTotalesFacturas(filas) {
  const vacio = () => ({ facturado: 0, pagado: 0, saldo: 0, cantidad: 0 });
  const totales = { ARS: vacio(), USD: vacio() };

  filas.forEach(({ factura, total, pagado, saldo }) => {
    const t = totales[factura.moneda] || totales.ARS;
    t.facturado += total;
    t.pagado += pagado;
    t.saldo += Math.max(saldo, 0);
    t.cantidad += 1;
  });

  return totales;
}

/** Pagos que tienen imputada una factura. Se usa antes de borrarla. */
export const getPagosDeFactura = (facturaId) =>
  state.pagos.filter((p) => Number(p.imputaciones?.[facturaId]) > 0);

/* ─────────────────────── Balance de cuenta por proveedor ─────────────────────── */

/**
 * Balance de la cuenta corriente con cada proveedor, una fila por proveedor y moneda.
 *
 *   balance = facturado − pagado     (pagado = lo imputado a facturas + lo entregado a cuenta)
 *
 * Positivo = le debemos; negativo = tenemos saldo a favor.
 *
 * Cada moneda se lleva por separado: no existe una cotización única que permita sumar pesos con
 * dólares sin falsear el número. Un pago en pesos imputado a una factura en dólares aporta a la
 * columna USD (por su imputación) y solo deja saldo a favor en pesos si sobró algo.
 *
 * @returns {Array<{proveedor:object, moneda:string, facturado:number, pagado:number,
 *                  balance:number, estado:'deudor'|'favor'|'saldada'}>}
 */
export function getBalancePorProveedor({ proveedorId = '', desde = '', hasta = '' } = {}) {
  const filas = [];

  const proveedores = proveedorId
    ? state.proveedores.filter((p) => p.id === proveedorId)
    : state.proveedores;

  proveedores.forEach((proveedor) => {
    const acumulado = acumularMovimientos(proveedor.id, { desde, hasta });

    ['ARS', 'USD'].forEach((moneda) => {
      const { facturado, pagado } = acumulado[moneda];
      if (Math.abs(facturado) <= TOLERANCIA && Math.abs(pagado) <= TOLERANCIA) return;

      const balance = facturado - pagado;

      let estado = 'saldada';
      if (balance > TOLERANCIA) estado = 'deudor';
      else if (balance < -TOLERANCIA) estado = 'favor';

      filas.push({ proveedor, moneda, facturado, pagado, balance, estado });
    });
  });

  // Mayor deuda primero; los saldos a favor quedan al final.
  return filas.sort((a, b) => b.balance - a.balance);
}

/** Una fecha 'YYYY-MM-DD' cae en el rango. Comparar strings ISO equivale a comparar fechas. */
const enRango = (fecha, desde, hasta) =>
  (!desde || (fecha || '') >= desde) && (!hasta || (fecha || '') <= hasta);

/**
 * Acumula facturado y pagado por moneda para un proveedor, mirando los MOVIMIENTOS del rango.
 *
 * Se recorre por movimiento y no por saldo de factura porque un saldo no se puede repartir entre
 * períodos: una factura de junio pagada en julio tiene que sumar al debe de junio y al haber de
 * julio. Sin filtro de fechas el resultado es idéntico a sumar los saldos de las facturas: son los
 * mismos pares (pago, factura) recorridos en otro orden.
 */
function acumularMovimientos(proveedorId, { desde = '', hasta = '' } = {}) {
  const acumulado = { ARS: { facturado: 0, pagado: 0 }, USD: { facturado: 0, pagado: 0 } };

  state.facturas
    .filter((f) => f.proveedorId === proveedorId && enRango(f.fecha, desde, hasta))
    .forEach((factura) => {
      const cuenta = acumulado[factura.moneda];
      if (cuenta) cuenta.facturado += Number(factura.montoTotal) || 0;
    });

  state.pagos
    .filter((p) => p.proveedorId === proveedorId && enRango(p.fecha, desde, hasta))
    .forEach((pago) => {
      // Cada imputación suma en la moneda de SU factura, sin importar en qué moneda se pagó.
      Object.entries(pago.imputaciones || {}).forEach(([facturaId, monto]) => {
        const factura = getFacturaPorId(facturaId);
        const cuenta = factura && acumulado[factura.moneda];
        if (cuenta) cuenta.pagado += Number(monto) || 0;
      });

      // Lo no imputado queda como entrega a cuenta, en la moneda del pago.
      const cuentaPago = acumulado[pago.moneda];
      if (cuentaPago) cuentaPago.pagado += getMontoACuenta(pago);
    });

  return acumulado;
}

/**
 * Estado de cuenta por proveedor y moneda: saldo anterior + movimientos del período = saldo final.
 * Es la estructura que consumen la vista previa de informes y el PDF.
 *
 * Un mismo pago puede aparecer en dos secciones de moneda distintas (por ejemplo, si imputa US$400
 * a una factura en dólares y deja $100.000 a cuenta). Es correcto: son dos hechos separados y así
 * el cruce de monedas queda auditable.
 *
 * @returns {Array<{proveedor, moneda, saldoAnterior, movimientos, totalDebe, totalHaber,
 *                  saldoFinal, estado}>}
 */
export function getEstadoDeCuenta({ proveedorId = '', desde = '', hasta = '' } = {}) {
  const secciones = [];

  const proveedores = proveedorId
    ? state.proveedores.filter((p) => p.id === proveedorId)
    : state.proveedores;

  proveedores.forEach((proveedor) => {
    // Todo lo anterior al período arranca como saldo de apertura.
    const previo = desde
      ? acumularMovimientos(proveedor.id, { hasta: fechaAnterior(desde) })
      : { ARS: { facturado: 0, pagado: 0 }, USD: { facturado: 0, pagado: 0 } };

    const movimientosPorMoneda = construirMovimientos(proveedor.id, { desde, hasta });

    ['ARS', 'USD'].forEach((moneda) => {
      const movimientos = movimientosPorMoneda[moneda];
      const saldoAnterior = previo[moneda].facturado - previo[moneda].pagado;

      // Sin movimientos y sin saldo previo, esa moneda no tuvo actividad: no se informa.
      if (movimientos.length === 0 && Math.abs(saldoAnterior) <= TOLERANCIA) return;

      let saldo = saldoAnterior;
      let totalDebe = 0;
      let totalHaber = 0;

      movimientos.forEach((mov) => {
        saldo += mov.debe - mov.haber;
        mov.saldo = saldo;
        totalDebe += mov.debe;
        totalHaber += mov.haber;
      });

      let estado = 'saldada';
      if (saldo > TOLERANCIA) estado = 'deudor';
      else if (saldo < -TOLERANCIA) estado = 'favor';

      secciones.push({
        proveedor,
        moneda,
        saldoAnterior,
        movimientos,
        totalDebe,
        totalHaber,
        saldoFinal: saldo,
        estado,
      });
    });
  });

  return secciones;
}

/** El día anterior a una fecha 'YYYY-MM-DD'. Se usa para cerrar el saldo previo al período. */
function fechaAnterior(fechaISO) {
  const fecha = new Date(`${fechaISO}T12:00:00`);
  fecha.setDate(fecha.getDate() - 1);
  return fecha.toISOString().slice(0, 10);
}

/**
 * Las líneas del período, agrupadas por moneda y ordenadas por fecha.
 * Las facturas van al debe (aumentan la deuda) y los pagos al haber (la reducen).
 */
function construirMovimientos(proveedorId, { desde, hasta }) {
  const porMoneda = { ARS: [], USD: [] };

  state.facturas
    .filter((f) => f.proveedorId === proveedorId && enRango(f.fecha, desde, hasta))
    .forEach((factura) => {
      if (!porMoneda[factura.moneda]) return;
      porMoneda[factura.moneda].push({
        fecha: factura.fecha,
        tipo: 'factura',
        descripcion: `Factura ${factura.numero}`,
        debe: Number(factura.montoTotal) || 0,
        haber: 0,
        saldo: 0,
      });
    });

  state.pagos
    .filter((p) => p.proveedorId === proveedorId && enRango(p.fecha, desde, hasta))
    .forEach((pago) => {
      const metodo = pago.metodoPago ? ` ${pago.metodoPago}` : '';

      Object.entries(pago.imputaciones || {}).forEach(([facturaId, monto]) => {
        const factura = getFacturaPorId(facturaId);
        if (!factura || !porMoneda[factura.moneda]) return;

        porMoneda[factura.moneda].push({
          fecha: pago.fecha,
          tipo: 'pago',
          descripcion: `Pago${metodo} · imputado a ${factura.numero}`,
          debe: 0,
          haber: Number(monto) || 0,
          saldo: 0,
        });
      });

      const aCuenta = getMontoACuenta(pago);
      if (aCuenta > TOLERANCIA && porMoneda[pago.moneda]) {
        porMoneda[pago.moneda].push({
          fecha: pago.fecha,
          tipo: 'pago',
          descripcion: `Pago${metodo} · a cuenta${pago.concepto ? ` · ${pago.concepto}` : ''}`,
          debe: 0,
          haber: aCuenta,
          saldo: 0,
        });
      }
    });

  // Cronológico; a igual fecha, primero la factura (se emite antes de cobrarse).
  ['ARS', 'USD'].forEach((moneda) => {
    porMoneda[moneda].sort((a, b) => {
      if (a.fecha !== b.fecha) return (a.fecha || '').localeCompare(b.fecha || '');
      return a.tipo === b.tipo ? 0 : a.tipo === 'factura' ? -1 : 1;
    });
  });

  return porMoneda;
}

/**
 * Totales del balance por moneda.
 *
 * La deuda y el saldo a favor se acumulan por separado a propósito: deberle $60.000 a un
 * proveedor y tener $10 a favor con otro no es "deber $59.990". Son cuentas distintas y no se
 * compensan entre sí.
 */
export function getTotalesBalance(filas) {
  const vacio = () => ({ deuda: 0, aFavor: 0, deudores: 0, aFavorCant: 0 });
  const totales = { ARS: vacio(), USD: vacio() };

  filas.forEach(({ moneda, balance }) => {
    const t = totales[moneda];
    if (!t) return;

    if (balance > TOLERANCIA) {
      t.deuda += balance;
      t.deudores += 1;
    } else if (balance < -TOLERANCIA) {
      t.aFavor += Math.abs(balance);
      t.aFavorCant += 1;
    }
  });

  return totales;
}
