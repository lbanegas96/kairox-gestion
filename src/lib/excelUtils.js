import * as XLSX from 'xlsx';

/**
 * Exporta datos a un archivo Excel (.xlsx).
 * @param {object[]} rows        - Array de objetos planos
 * @param {string[]} headers     - Encabezados en orden (claves del objeto)
 * @param {string[]} labels      - Etiquetas legibles para cada encabezado
 * @param {string}   filename    - Nombre del archivo sin extensión
 * @param {string}   sheetName   - Nombre de la hoja
 */
export function exportToExcel({ rows, headers, labels, filename = 'exportacion', sheetName = 'Datos' }) {
  const worksheetData = [
    labels,
    ...rows.map(row => headers.map(h => row[h] ?? '')),
  ];

  const ws = XLSX.utils.aoa_to_sheet(worksheetData);

  // Ancho de columnas automático
  const colWidths = labels.map((label, i) => {
    const maxContent = Math.max(
      label.length,
      ...rows.map(row => String(row[headers[i]] ?? '').length)
    );
    return { wch: Math.min(maxContent + 2, 40) };
  });
  ws['!cols'] = colWidths;

  // Estilo encabezado (negrita) — xlsx básico no soporta estilos sin xlsx-style, pero estructuramos el wb
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const date = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `${filename}_${date}.xlsx`);
}

/**
 * Exporta un reporte del módulo Reportería a .xlsx, reusando la misma config
 * de columnas/totales que ya arma reportDefinitions.getTableConfig() para
 * pantalla y PDF (formato {header,key,pdfRender}). Columnas numéricas (total,
 * monto, saldo) se exportan como número real -no como string formateado- para
 * que Excel pueda sumarlas/graficarlas; el resto usa pdfRender si existe
 * (fechas, labels) o el valor crudo.
 */
export function exportReporte({ title, columns, data, totals = null, filename = 'reporte' }) {
  const header = columns.map(c => c.header);
  const rows = data.map(row => {
    // Filas sintéticas de agrupamiento (reportDefinitions.applyGrouping) —
    // mismo criterio que ReportTable/pdfUtils, no son un registro real.
    if (row.__rowType === 'group') {
      return [row.label];
    }
    if (row.__rowType === 'subtotal') {
      const r = new Array(columns.length).fill('');
      r[0] = row.label;
      // Número real (no el texto "$ X.XXX,XX") — así se puede sumar/graficar
      // en Excel, mismo criterio que las columnas numéricas de detalle.
      r[columns.length - 1] = row.value ?? row.valueText;
      return r;
    }
    return columns.map(col => {
      const raw = row[col.key];
      if (typeof raw === 'number') return raw;
      return col.pdfRender ? col.pdfRender(row) : (raw ?? '');
    });
  });

  const aoa = [header, ...rows];
  if (totals) {
    const totalsRow = [];
    totals.forEach(t => {
      // t.value (número crudo) si getTableConfig lo definió — igual criterio
      // que las filas de subtotal: el texto formateado queda solo para PDF/pantalla.
      totalsRow.push(t.value ?? t.content);
      for (let i = 1; i < (t.colSpan || 1); i++) totalsRow.push('');
    });
    aoa.push(totalsRow);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = columns.map(() => ({ wch: 18 }));

  const wb = XLSX.utils.book_new();
  // Nombre de hoja tope 31 caracteres (límite de Excel/XLSX).
  XLSX.utils.book_append_sheet(wb, ws, (title || 'Reporte').slice(0, 31));
  XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Helpers por módulo

export function exportProductos(productos) {
  exportToExcel({
    rows: productos,
    headers: ['codigo_sku', 'nombre', 'categoria', 'stock_actual', 'stock_minimo', 'precio_venta', 'costo_compra', 'unidad_medida'],
    labels: ['SKU', 'Nombre', 'Categoría', 'Stock Actual', 'Stock Mínimo', 'Precio Venta', 'Costo Compra', 'Unidad'],
    filename: 'productos',
    sheetName: 'Inventario',
  });
}

export function exportVentas(ventas) {
  exportToExcel({
    rows: ventas.map(v => ({
      ...v,
      fecha: v.created_at ? new Date(v.created_at).toLocaleDateString('es-AR') : '',
      cliente: v.clientes?.nombre ?? v.cliente_nombre ?? '-',
    })),
    headers: ['numero_venta', 'fecha', 'cliente', 'forma_pago', 'total'],
    labels: ['N° Venta', 'Fecha', 'Cliente', 'Forma de Pago', 'Total'],
    filename: 'ventas',
    sheetName: 'Ventas',
  });
}

export function exportCompras(compras) {
  exportToExcel({
    rows: compras.map(c => ({
      ...c,
      fecha: c.fecha ? new Date(c.fecha).toLocaleDateString('es-AR') : '',
      proveedor: c.proveedores?.nombre ?? '-',
    })),
    headers: ['numero_factura', 'fecha', 'proveedor', 'forma_pago', 'estado_pago', 'total'],
    labels: ['N° Factura', 'Fecha', 'Proveedor', 'Forma de Pago', 'Estado', 'Total'],
    filename: 'compras',
    sheetName: 'Compras',
  });
}

export function exportClientes(clientes) {
  exportToExcel({
    rows: clientes,
    headers: ['nombre', 'documento', 'telefono', 'email', 'direccion', 'limite_credito', 'saldo_actual'],
    labels: ['Nombre', 'Documento', 'Teléfono', 'Email', 'Dirección', 'Límite Crédito', 'Saldo Actual'],
    filename: 'clientes',
    sheetName: 'Clientes',
  });
}

export function exportMovimientosCaja(movimientos) {
  exportToExcel({
    rows: movimientos.map(m => ({
      ...m,
      fecha: m.fecha ? new Date(m.fecha).toLocaleDateString('es-AR') : '',
    })),
    headers: ['fecha', 'tipo', 'categoria', 'concepto', 'metodo_pago', 'monto'],
    labels: ['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Método de Pago', 'Monto'],
    filename: 'movimientos_caja',
    sheetName: 'Caja',
  });
}

// ── Reportes de Plan de Cuentas (Estado de Resultados / Balance General) ──
//
// Reemplazan el "Exportar CSV" que tenían estas 2 pantallas (pedido de
// Luciano, 18/09: "no quiero que se exporte a Csv, quiero un Excel bien
// estructurado"). A diferencia de `exportToExcel`/`exportReporte` de arriba
// (xlsx básico, sin estilos), acá se usa `exceljs` con carga diferida —
// solo se descarga la librería cuando alguien realmente exporta, no suma al
// bundle principal — porque para un estado contable "bien estructurado" de
// verdad hace falta negrita en encabezados/totales y formato moneda real en
// las celdas, no solo texto separado por comas.
const CURRENCY_FMT = '"$"#,##0.00;[RED]-"$"#,##0.00';
const COLOR_HEADER_BG = 'FF2A2438';
const COLOR_HEADER_TEXT = 'FFFFFFFF';
const COLOR_INGRESO = 'FF1B7A43';
const COLOR_EGRESO = 'FFB8860B';
const COLOR_ROJO = 'FFC62828';
const COLOR_SUBTLE = 'FF6B7280';

function downloadWorkbookBuffer(buffer, filename) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function tituloReporte(ws, { titulo, empresaNombre, subtitulo, cols = 3 }) {
  const colFin = String.fromCharCode('A'.charCodeAt(0) + cols - 1);
  ws.mergeCells(`A1:${colFin}1`);
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { bold: true, size: 14 };

  ws.mergeCells(`A2:${colFin}2`);
  ws.getCell('A2').value = empresaNombre || '';
  ws.getCell('A2').font = { size: 11, color: { argb: COLOR_SUBTLE } };

  ws.mergeCells(`A3:${colFin}3`);
  ws.getCell('A3').value = subtitulo;
  ws.getCell('A3').font = { size: 10, italic: true, color: { argb: COLOR_SUBTLE } };

  ws.addRow([]);
}

function filaEncabezado(ws, labels) {
  const row = ws.addRow(labels);
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: COLOR_HEADER_TEXT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER_BG } };
  });
  return row;
}

function filaSeccion(ws, label, argb, cols = 3) {
  const row = ws.addRow([label]);
  const colFin = String.fromCharCode('A'.charCodeAt(0) + cols - 1);
  ws.mergeCells(`A${row.number}:${colFin}${row.number}`);
  row.font = { bold: true, color: { argb: COLOR_HEADER_TEXT } };
  row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  return row;
}

function filaTotal(ws, valores, montoCol) {
  const row = ws.addRow(valores);
  row.font = { bold: true };
  row.getCell(montoCol).numFmt = CURRENCY_FMT;
  row.eachCell((cell) => { cell.border = { top: { style: 'thin', color: { argb: 'FFAAAAAA' } } }; });
  return row;
}

// asientos_contables.origen → etiqueta legible. Lista no exhaustiva a
// propósito: lo que no está mapeado cae al fallback (guiones bajos → espacio,
// primera letra mayúscula) en vez de mostrar el código crudo o quedar en blanco.
const ORIGEN_LABEL = {
  venta: 'Venta', compra: 'Compra', compra_rapida: 'Compra Rápida',
  cobro_cliente: 'Cobro a Cliente', pago_proveedor: 'Pago a Proveedor',
  nota_credito_cliente: 'NC Cliente', nota_debito_cliente: 'ND Cliente',
  nota_credito_proveedor: 'NC Proveedor', nota_debito_proveedor: 'ND Proveedor',
  devolucion_cliente: 'Devolución de Cliente', devolucion_proveedor: 'Devolución a Proveedor',
  anulacion_compra: 'Anulación de Compra', anulacion_venta: 'Anulación de Venta',
  ajuste_stock: 'Ajuste de Stock', recuento_inventario: 'Recuento de Inventario',
  revalorizacion_inventario: 'Revalorización de Inventario',
  cierre_ejercicio: 'Cierre de Ejercicio', apertura_ejercicio: 'Apertura de Ejercicio',
  reversa_asiento_duplicado: 'Reversa (corrección)', manual: 'Asiento Manual',
};
const origenLabel = (o) => ORIGEN_LABEL[o] || (o ? o.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

/**
 * Hoja "Detalle de Operaciones" — una fila por movimiento real (asientos_
 * items), no por cuenta. `filas` ya viene filtrada al tipo que corresponde
 * (ingreso/egreso/activo/etc.) desde el caller.
 */
function hojaDetalle(wb, { nombreHoja, titulo, empresaNombre, subtitulo, filas, colorSeccion }) {
  const ws = wb.addWorksheet(nombreHoja.slice(0, 31), { views: [{ state: 'frozen', ySplit: 6, showGridLines: false }] });
  ws.columns = [
    { width: 12 }, // Fecha
    { width: 14 }, // N° Asiento
    { width: 10 }, // Código
    { width: 32 }, // Cuenta
    { width: 40 }, // Descripción
    { width: 20 }, // Origen
    { width: 16 }, // Debe
    { width: 16 }, // Haber
  ];
  tituloReporte(ws, { titulo, empresaNombre, subtitulo, cols: 8 });
  filaEncabezado(ws, ['Fecha', 'N° Asiento', 'Código', 'Cuenta', 'Descripción', 'Origen', 'Debe', 'Haber']);

  if (colorSeccion) filaSeccion(ws, titulo.toUpperCase(), colorSeccion, 8);

  if (filas.length === 0) {
    const row = ws.addRow(['Sin operaciones en el período']);
    ws.mergeCells(`A${row.number}:H${row.number}`);
    row.font = { italic: true, color: { argb: COLOR_SUBTLE } };
  }
  filas.forEach((r) => {
    const row = ws.addRow([
      r.fecha, r.numero_asiento, r.codigo, r.cuenta, r.descripcion, origenLabel(r.origen), r.debe || 0, r.haber || 0,
    ]);
    row.getCell(7).numFmt = CURRENCY_FMT;
    row.getCell(8).numFmt = CURRENCY_FMT;
  });

  if (filas.length > 0) {
    const totalDebe = filas.reduce((s, r) => s + (r.debe || 0), 0);
    const totalHaber = filas.reduce((s, r) => s + (r.haber || 0), 0);
    const row = ws.addRow(['', '', '', '', '', 'Totales', totalDebe, totalHaber]);
    row.font = { bold: true };
    row.getCell(7).numFmt = CURRENCY_FMT;
    row.getCell(8).numFmt = CURRENCY_FMT;
    row.eachCell((cell) => { cell.border = { top: { style: 'thin', color: { argb: 'FFAAAAAA' } } }; });
  }
  return ws;
}

/**
 * Estado de Resultados → .xlsx en 3 hojas: Resumen (Ingresos/Egresos/
 * Resultado, igual que antes) + Detalle Ingresos + Detalle Egresos, una fila
 * por movimiento real (pedido de Luciano, 18/09: "como muy general, pongamos
 * más detalles de las operaciones").
 */
export async function exportEstadoResultadosXLSX({ empresaNombre, fechaDesde, fechaHasta, ingresos, egresos, totalIngresos, totalEgresos, resultado, detalle = [] }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KAIROX Gestión';
  wb.created = new Date();

  const subtitulo = `Período: ${fechaDesde || 'inicio'} a ${fechaHasta || 'hoy'}`;

  const ws = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 5, showGridLines: false }] });
  ws.columns = [{ width: 12 }, { width: 44 }, { width: 20 }];

  tituloReporte(ws, { titulo: 'Estado de Resultados', empresaNombre, subtitulo });
  filaEncabezado(ws, ['Código', 'Cuenta', 'Monto']);

  filaSeccion(ws, 'INGRESOS', COLOR_INGRESO);
  ingresos.forEach((r) => {
    const row = ws.addRow([r.codigo, r.nombre, r.monto]);
    row.getCell(3).numFmt = CURRENCY_FMT;
  });
  filaTotal(ws, ['', 'Total Ingresos', totalIngresos], 3);

  ws.addRow([]);
  filaSeccion(ws, 'EGRESOS / GASTOS', COLOR_EGRESO);
  egresos.forEach((r) => {
    const row = ws.addRow([r.codigo, r.nombre, r.monto]);
    row.getCell(3).numFmt = CURRENCY_FMT;
  });
  filaTotal(ws, ['', 'Total Egresos', totalEgresos], 3);

  ws.addRow([]);
  const resultRow = ws.addRow(['', 'RESULTADO DEL PERÍODO', resultado]);
  resultRow.font = { bold: true, size: 12 };
  resultRow.getCell(3).numFmt = CURRENCY_FMT;
  resultRow.getCell(3).font = { bold: true, size: 12, color: { argb: resultado >= 0 ? COLOR_INGRESO : COLOR_ROJO } };

  hojaDetalle(wb, {
    nombreHoja: 'Detalle Ingresos', titulo: 'Detalle de Ingresos', empresaNombre, subtitulo,
    filas: detalle.filter((r) => r.tipo === 'ingreso'), colorSeccion: COLOR_INGRESO,
  });
  hojaDetalle(wb, {
    nombreHoja: 'Detalle Egresos', titulo: 'Detalle de Egresos / Gastos', empresaNombre, subtitulo,
    filas: detalle.filter((r) => r.tipo === 'egreso'), colorSeccion: COLOR_EGRESO,
  });

  const buffer = await wb.xlsx.writeBuffer();
  downloadWorkbookBuffer(buffer, `estado-resultados_${fechaDesde || 'inicio'}_${fechaHasta || 'hoy'}.xlsx`);
}

/**
 * Balance General → mismo criterio: hoja Resumen (Activo/Pasivo/Patrimonio,
 * totales en negrita, chequeo de balanceado) + una hoja de Detalle por cada
 * sección, una fila por movimiento real.
 */
export async function exportBalanceGeneralXLSX({ empresaNombre, fechaCorte, activos, pasivos, patrimonios, totalActivo, totalPasivo, totalPatrimonio, resultadoEjercicio, cierra, diferencia, detalle = [] }) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'KAIROX Gestión';
  wb.created = new Date();

  const subtitulo = `Al ${fechaCorte}`;
  const COLOR_PATRIMONIO = 'FF5B4B9E';

  const ws = wb.addWorksheet('Resumen', { views: [{ state: 'frozen', ySplit: 5, showGridLines: false }] });
  ws.columns = [{ width: 12 }, { width: 44 }, { width: 20 }];

  tituloReporte(ws, { titulo: 'Balance General', empresaNombre, subtitulo });
  filaEncabezado(ws, ['Código', 'Cuenta', 'Monto']);

  filaSeccion(ws, 'ACTIVO', COLOR_INGRESO);
  activos.forEach((r) => {
    const row = ws.addRow([r.codigo, r.nombre, r.monto]);
    row.getCell(3).numFmt = CURRENCY_FMT;
  });
  filaTotal(ws, ['', 'Total Activo', totalActivo], 3);

  ws.addRow([]);
  filaSeccion(ws, 'PASIVO', COLOR_EGRESO);
  pasivos.forEach((r) => {
    const row = ws.addRow([r.codigo, r.nombre, r.monto]);
    row.getCell(3).numFmt = CURRENCY_FMT;
  });
  filaTotal(ws, ['', 'Total Pasivo', totalPasivo], 3);

  ws.addRow([]);
  filaSeccion(ws, 'PATRIMONIO', COLOR_PATRIMONIO);
  patrimonios.forEach((r) => {
    const row = ws.addRow([r.codigo, r.nombre, r.monto]);
    row.getCell(3).numFmt = CURRENCY_FMT;
  });
  const resEjRow = ws.addRow(['', 'Resultado del Ejercicio (calculado)', resultadoEjercicio]);
  resEjRow.getCell(3).numFmt = CURRENCY_FMT;
  filaTotal(ws, ['', 'Total Patrimonio', totalPatrimonio], 3);

  ws.addRow([]);
  filaTotal(ws, ['', 'Pasivo + Patrimonio', totalPasivo + totalPatrimonio], 3);

  ws.addRow([]);
  const chequeoRow = ws.addRow(['', cierra ? 'Balanceado: Activo = Pasivo + Patrimonio' : `Descuadrado — diferencia: ${diferencia}`, cierra ? '' : diferencia]);
  chequeoRow.font = { bold: true, color: { argb: cierra ? COLOR_INGRESO : COLOR_ROJO } };
  if (!cierra) chequeoRow.getCell(3).numFmt = CURRENCY_FMT;

  hojaDetalle(wb, {
    nombreHoja: 'Detalle Activo', titulo: 'Detalle de Activo', empresaNombre, subtitulo,
    filas: detalle.filter((r) => r.tipo === 'activo'), colorSeccion: COLOR_INGRESO,
  });
  hojaDetalle(wb, {
    nombreHoja: 'Detalle Pasivo', titulo: 'Detalle de Pasivo', empresaNombre, subtitulo,
    filas: detalle.filter((r) => r.tipo === 'pasivo'), colorSeccion: COLOR_EGRESO,
  });
  hojaDetalle(wb, {
    nombreHoja: 'Detalle Patrimonio', titulo: 'Detalle de Patrimonio', empresaNombre, subtitulo,
    filas: detalle.filter((r) => r.tipo === 'patrimonio' || r.tipo === 'ingreso' || r.tipo === 'egreso'), colorSeccion: COLOR_PATRIMONIO,
  });

  const buffer = await wb.xlsx.writeBuffer();
  downloadWorkbookBuffer(buffer, `balance-general_${fechaCorte}.xlsx`);
}
