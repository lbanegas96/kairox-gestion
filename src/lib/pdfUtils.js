import jsPDF from 'jspdf';
import 'jspdf-autotable';

const BRAND_BLUE  = [37, 99, 235];   // blue-600
const BRAND_DARK  = [15, 23, 42];    // slate-900
const GRAY_LIGHT  = [241, 245, 249]; // slate-100
const GRAY_TEXT   = [100, 116, 139]; // slate-500

/**
 * Descarga la imagen de una URL (ej. el logo en Storage) y la devuelve como
 * data URL base64 + su formato ('PNG'/'JPEG'/'WEBP'), listo para
 * doc.addImage(). jsPDF no puede pedir una URL remota directo — necesita los
 * bytes ya en mano. Si falla (red, CORS, SVG no soportado por addImage) o no
 * hay logoUrl, devuelve null y el PDF se genera igual, solo sin el logo.
 */
async function cargarLogoComoDataURL(logoUrl) {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    // addImage soporta PNG/JPEG/WEBP — SVG no (necesitaría rasterizarlo aparte).
    const FORMATOS = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WEBP' };
    const formato = FORMATOS[blob.type];
    if (!formato) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { dataUrl, formato };
  } catch (e) {
    console.warn('[pdfUtils] No se pudo cargar el logo para el PDF, se genera sin logo:', e.message);
    return null;
  }
}

/**
 * @param {object}   opts
 * @param {string}   opts.title
 * @param {string}   opts.startDate
 * @param {string}   opts.endDate
 * @param {object[]} opts.columns        – { header, key, align?, pdfRender? }
 * @param {object[]} opts.data
 * @param {object[]|null} opts.totals    – fila de pie: {content, colSpan?, align?}[], mismo shape que getTableConfig().totals
 * @param {string}   opts.filename
 * @param {string}   [opts.companyName]  – nombre de empresa (de config)
 * @param {string}   [opts.logoUrl]      – URL pública del logo (config.logo_base64)
 * @param {{label:string, value:string, delta?:{text:string,positivo:boolean}}[]} [opts.summaryMetrics]  – cajas KPI antes de la tabla
 */
export const generatePDF = async ({
  title,
  startDate,
  endDate,
  columns,
  data,
  totals = null,
  filename = 'reporte',
  companyName = 'KAIROX Gestión',
  logoUrl = null,
  summaryMetrics = null,
}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pw  = doc.internal.pageSize.width;
  const ph  = doc.internal.pageSize.height;

  const logo = await cargarLogoComoDataURL(logoUrl);

  // ── Header band ───────────────────────────────────────────────────────────
  doc.setFillColor(...BRAND_BLUE);
  doc.rect(0, 0, pw, 28, 'F');

  // Logo a la izquierda (si hay) — empuja el texto del nombre de empresa.
  const textX = logo ? 32 : 14;
  if (logo) {
    // Alto fijo 16mm centrado en la banda de 28mm; ancho proporcional simple
    // (18mm) — suficiente para un isologo, no distorsiona relación de aspecto
    // de forma perceptible a este tamaño.
    doc.addImage(logo.dataUrl, logo.formato, 14, 6, 16, 16);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName, textX, 12);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(title, textX, 20);

  // Fecha generado — derecha del header
  const genLabel = `Generado: ${new Date().toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}`;
  doc.setFontSize(8);
  doc.text(genLabel, pw - 14, 12, { align: 'right' });

  // " al " en vez de "→": la fuente 'helvetica' de jsPDF usa codificación
  // WinAnsi (base-14, sin embeber fuente propia) y no tiene el glyph de la
  // flecha unicode — se veía como basura en el PDF real ("!'" en vez de "→").
  const periodoLabel = `Período: ${startDate} al ${endDate}`;
  doc.text(periodoLabel, pw - 14, 20, { align: 'right' });

  // ── Summary metrics (KPI boxes) ───────────────────────────────────────────
  let cursorY = 34;

  if (summaryMetrics?.length) {
    const cols      = Math.min(summaryMetrics.length, 4);
    const boxW      = (pw - 28 - (cols - 1) * 4) / cols;
    // Con delta (comparación de período) la caja necesita una 3ra línea chica.
    const hasDelta  = summaryMetrics.some(m => m.delta);
    const boxH      = hasDelta ? 22 : 18;
    const startX    = 14;

    summaryMetrics.slice(0, 4).forEach((m, i) => {
      const x = startX + i * (boxW + 4);

      doc.setFillColor(...GRAY_LIGHT);
      doc.roundedRect(x, cursorY, boxW, boxH, 2, 2, 'F');

      doc.setDrawColor(210, 218, 230);
      doc.setLineWidth(0.3);
      doc.roundedRect(x, cursorY, boxW, boxH, 2, 2, 'S');

      doc.setTextColor(...GRAY_TEXT);
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.text(m.label, x + boxW / 2, cursorY + 5.5, { align: 'center' });

      doc.setTextColor(...BRAND_DARK);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(String(m.value), x + boxW / 2, cursorY + 13, { align: 'center' });

      if (m.delta) {
        doc.setTextColor(...(m.delta.positivo ? [22, 163, 74] : [220, 38, 38]));
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.text(m.delta.text, x + boxW / 2, cursorY + 19, { align: 'center' });
      }
    });

    cursorY += boxH + 6;
  }

  // Separator line
  doc.setLineWidth(0.3);
  doc.setDrawColor(203, 213, 225);
  doc.line(14, cursorY, pw - 14, cursorY);
  cursorY += 4;

  // ── Table ─────────────────────────────────────────────────────────────────
  // Filas sintéticas de agrupamiento (reportDefinitions.applyGrouping) — se
  // pintan como una fila especial en vez de mapearlas contra `columns`.
  const bodyData = data.map(row => {
    if (row.__rowType === 'group') {
      return [{ content: row.label, colSpan: columns.length, styles: { fillColor: GRAY_LIGHT, fontStyle: 'bold', textColor: BRAND_DARK } }];
    }
    if (row.__rowType === 'subtotal') {
      return [
        { content: row.label, colSpan: columns.length - 1, styles: { fontStyle: 'bold', halign: 'right' } },
        { content: row.valueText, styles: { fontStyle: 'bold', halign: 'right' } },
      ];
    }
    return columns.map(col => (col.pdfRender ? col.pdfRender(row) : row[col.key]));
  });

  const columnStyles = columns.reduce((acc, col, idx) => {
    if (col.align) acc[idx] = { halign: col.align };
    return acc;
  }, {});

  doc.autoTable({
    startY: cursorY,
    head:   [columns.map(c => c.header)],
    body:   bodyData,
    theme:  'grid',
    headStyles: {
      fillColor:  BRAND_BLUE,
      textColor:  [255, 255, 255],
      fontStyle:  'bold',
      fontSize:   8.5,
      halign:     'center',
      cellPadding: 3.5,
    },
    styles: {
      fontSize:    8.5,
      cellPadding: 3,
      valign:      'middle',
      textColor:   BRAND_DARK,
      lineColor:   [226, 232, 240],
      lineWidth:   0.2,
    },
    columnStyles,
    alternateRowStyles: {
      fillColor: [248, 250, 252], // slate-50
    },
    // `totals` es el mismo array de celdas {content,colSpan,align} que arma
    // reportDefinitions.getTableConfig() para la tabla en pantalla — se
    // traduce 1:1 a la sintaxis de celda de autoTable (content/colSpan/
    // styles.halign) en vez de pasar solo el texto ya "pelado", que perdía el
    // colSpan y desalineaba el pie con reportes de muchas columnas (ej. la
    // fila de un solo texto ancho de Financiero/Cta. Corriente) o al agregar
    // una columna nueva (Comprobante en Ventas).
    foot: totals ? [totals.map(t => ({
      content: t.content,
      colSpan: t.colSpan || 1,
      styles: { halign: t.align || 'left' },
    }))] : undefined,
    // Sin esto, autoTable repite el foot (TOTALES) en CADA página — se vio en
    // el PDF real como "TOTALES 22 $709.070,80" también en la página 2, que
    // solo tenía 1 fila, dando la falsa impresión de que esa página también
    // sumaba 22 ventas. Con 'lastPage' aparece una sola vez, al final real.
    showFoot: 'lastPage',
    footStyles: {
      fillColor:  [226, 232, 240],
      textColor:  BRAND_DARK,
      fontStyle:  'bold',
      fontSize:   8.5,
    },
    didDrawPage: ({ pageNumber }) => {
      // Footer line
      doc.setLineWidth(0.3);
      doc.setDrawColor(203, 213, 225);
      doc.line(14, ph - 14, pw - 14, ph - 14);

      doc.setFontSize(7.5);
      doc.setTextColor(...GRAY_TEXT);
      doc.setFont('helvetica', 'normal');
      doc.text('KAIROX Gestión — Sistema Integral de Gestión', 14, ph - 8);
      // Placeholder: al momento de dibujar la página 1, autoTable todavía no
      // creó la página 2 (las crea recién cuando la tabla las necesita), así
      // que getNumberOfPages() da un total parcial acá ("Página 1 de 1" en
      // vez de "1 de 2" — visto en el PDF real). putTotalPages() más abajo
      // reemplaza este placeholder por el total final ya con todas las páginas creadas.
      doc.text(`Página ${pageNumber} de {total_pages_count_string}`, pw - 14, ph - 8, { align: 'right' });
    },
  });

  doc.putTotalPages('{total_pages_count_string}');

  doc.save(`${filename}_${new Date().toISOString().slice(0, 10)}.pdf`);
};
