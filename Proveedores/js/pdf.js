/**
 * ════════════════════════════════════════════════════════════════════════════
 *  GENERACIÓN DE PDF
 *  Único módulo que sabe de jsPDF. El resto de la app le pasa datos ya
 *  calculados y no conoce la librería.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * jsPDF y su plugin de tablas se cargan desde CDN y RECIÉN al pedir el primer
 * informe: son ~600 KB que no tienen por qué pesar en el arranque de la app.
 */

import { formatearMonto, formatearFecha, formatearTimestamp } from './utils.js';

const CDN = {
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
};

/** Paleta sobria, alineada con la app pero pensada para papel. */
const COLOR = {
  texto: [17, 24, 39],
  suave: [107, 114, 128],
  linea: [209, 213, 219],
  encabezado: [31, 41, 55],
  cebra: [249, 250, 251],
  deuda: [180, 83, 9],
  favor: [5, 150, 105],
};

const MARGEN = 14;

/** Promesa cacheada: las librerías se descargan una sola vez por sesión. */
let cargaLibrerias = null;

function cargarScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`No se pudo descargar ${src}`));
    document.head.appendChild(script);
  });
}

async function getJsPDF() {
  if (!cargaLibrerias) {
    // El plugin se registra sobre jsPDF, así que el orden importa.
    cargaLibrerias = (async () => {
      await cargarScript(CDN.jspdf);
      await cargarScript(CDN.autotable);
    })().catch((error) => {
      // Si falla, no dejar la promesa rota cacheada: permitir reintentar.
      cargaLibrerias = null;
      throw new Error(
        'No se pudieron cargar las librerías para generar el PDF. Revisá tu conexión a internet.'
      );
    });
  }

  await cargaLibrerias;

  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error('La librería de PDF no se inicializó correctamente.');
  return jsPDF;
}

/* ──────────────────────────── Piezas del documento ──────────────────────────── */

function dibujarEncabezado(doc, meta) {
  const ancho = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...COLOR.encabezado);
  doc.text('ESTADO DE CUENTA', MARGEN, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COLOR.suave);
  doc.text(`Emitido: ${formatearTimestamp(Date.now())}`, ancho - MARGEN, 20, { align: 'right' });

  doc.setFontSize(10);
  doc.setTextColor(...COLOR.texto);
  doc.text(`Proveedor: ${meta.proveedor}`, MARGEN, 28);
  doc.text(`Período: ${meta.periodo}`, MARGEN, 33.5);

  doc.setDrawColor(...COLOR.linea);
  doc.setLineWidth(0.4);
  doc.line(MARGEN, 37, ancho - MARGEN, 37);

  return 44;
}

/** Pie con numeración. Se dibuja al final, cuando ya se sabe el total de páginas. */
function dibujarPies(doc) {
  const total = doc.internal.getNumberOfPages();
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();

  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setDrawColor(...COLOR.linea);
    doc.setLineWidth(0.3);
    doc.line(MARGEN, alto - 14, ancho - MARGEN, alto - 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...COLOR.suave);
    doc.text('Control de pagos a proveedores', MARGEN, alto - 9);
    doc.text(`Página ${i} de ${total}`, ancho - MARGEN, alto - 9, { align: 'right' });
  }
}

const NOMBRE_MONEDA = { ARS: 'Pesos (ARS)', USD: 'Dólares (USD)' };

/** Una sección = un proveedor y una moneda. Devuelve la Y donde terminó. */
function dibujarSeccion(doc, seccion, y) {
  const { proveedor, moneda, saldoAnterior, movimientos, totalDebe, totalHaber, saldoFinal, estado } =
    seccion;
  const ancho = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLOR.encabezado);
  doc.text(`${proveedor.nombre} · ${NOMBRE_MONEDA[moneda]}`, MARGEN, y);

  const filas = [
    [
      { content: 'Saldo anterior', colSpan: 2, styles: { fontStyle: 'italic' } },
      '',
      '',
      { content: formatearMonto(saldoAnterior, moneda), styles: { fontStyle: 'italic' } },
    ],
    ...movimientos.map((mov) => [
      formatearFecha(mov.fecha),
      mov.descripcion,
      mov.debe ? formatearMonto(mov.debe, moneda) : '',
      mov.haber ? formatearMonto(mov.haber, moneda) : '',
      formatearMonto(mov.saldo, moneda),
    ]),
  ];

  doc.autoTable({
    startY: y + 3,
    head: [['Fecha', 'Concepto', 'Debe', 'Haber', 'Saldo']],
    body: filas,
    foot: [
      [
        { content: 'Totales del período', colSpan: 2 },
        formatearMonto(totalDebe, moneda),
        formatearMonto(totalHaber, moneda),
        formatearMonto(saldoFinal, moneda),
      ],
    ],
    theme: 'grid',
    margin: { left: MARGEN, right: MARGEN, bottom: 20 },
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: 2,
      lineColor: COLOR.linea,
      lineWidth: 0.1,
      textColor: COLOR.texto,
    },
    headStyles: {
      fillColor: COLOR.encabezado,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'left',
    },
    footStyles: {
      fillColor: [243, 244, 246],
      textColor: COLOR.texto,
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: COLOR.cebra },
    columnStyles: {
      0: { cellWidth: 20 },
      2: { halign: 'right', cellWidth: 28 },
      3: { halign: 'right', cellWidth: 28 },
      4: { halign: 'right', cellWidth: 30, fontStyle: 'bold' },
    },
    // Debe y Haber a la derecha también en el pie.
    didParseCell: (data) => {
      if (data.section === 'foot' && data.column.index >= 2) data.cell.styles.halign = 'right';
    },
  });

  let finY = doc.lastAutoTable.finalY + 8;

  // Cierre destacado: es el número que el lector busca. Va con su signo, no en valor absoluto:
  // sin la etiqueta de estado, el signo es lo único que distingue una deuda de un saldo a favor
  // cuando el informe se imprime en blanco y negro.
  const colorSaldo = estado === 'deudor' ? COLOR.deuda : estado === 'favor' ? COLOR.favor : COLOR.texto;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...colorSaldo);
  doc.text(`SALDO FINAL: ${formatearMonto(saldoFinal, moneda)}`, ancho - MARGEN, finY, {
    align: 'right',
  });

  return finY + 10;
}

/* ─────────────────────────────── API pública ─────────────────────────────── */

/**
 * Arma y descarga el estado de cuenta.
 *
 * @param {Array} secciones Salida de getEstadoDeCuenta() del store.
 * @param {{proveedor:string, periodo:string, archivo:string}} meta
 */
export async function generarPdfEstadoDeCuenta(secciones, meta) {
  if (!secciones.length) throw new Error('No hay movimientos para informar.');

  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  let y = dibujarEncabezado(doc, meta);
  let proveedorPrevio = secciones[0].proveedor.id;

  secciones.forEach((seccion, i) => {
    const alto = doc.internal.pageSize.getHeight();
    const cambiaProveedor = seccion.proveedor.id !== proveedorPrevio;

    // Cada proveedor arranca en hoja nueva; dentro de uno, solo se salta si no entra.
    if (i > 0 && (cambiaProveedor || y > alto - 60)) {
      doc.addPage();
      y = MARGEN + 8;
    }
    proveedorPrevio = seccion.proveedor.id;

    y = dibujarSeccion(doc, seccion, y);
  });

  dibujarPies(doc);
  doc.save(meta.archivo);
}
