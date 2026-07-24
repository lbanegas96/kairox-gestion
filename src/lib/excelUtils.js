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
