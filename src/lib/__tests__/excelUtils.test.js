import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import ExcelJS from 'exceljs';
import { exportReporte, exportToExcel } from '../excelUtils';

// exportReporte / exportToExcel ahora escriben con exceljs (antes xlsx, sin parche: SEG-7). Estas pruebas hacen
// el viaje completo: capturan el archivo que se descargaría, lo vuelven a abrir con exceljs y miran las celdas.
let blobDescargado;
let nombreDescargado;

beforeEach(() => {
  blobDescargado = null;
  nombreDescargado = null;
  // El Blob de jsdom no se puede leer de vuelta (no tiene arrayBuffer()); el de Node sí y se comporta igual para esto.
  vi.stubGlobal('Blob', NodeBlob);
  globalThis.URL.createObjectURL = vi.fn((blob) => { blobDescargado = blob; return 'blob:prueba'; });
  globalThis.URL.revokeObjectURL = vi.fn();
  // El "click" de descarga: jsdom no navega, solo nos interesa el nombre del archivo.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { nombreDescargado = this.download; });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const abrirDescargado = async () => {
  const buffer = await blobDescargado.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
};
const valores = (ws) => {
  const filas = [];
  ws.eachRow({ includeEmpty: false }, (row) => { filas.push(row.values.slice(1)); });
  return filas;
};

describe('exportReporte (exceljs)', () => {
  const columns = [
    { header: 'Concepto', key: 'concepto', align: 'left' },
    { header: 'Importe', key: 'importe', align: 'right', pdfRender: (r) => (r.importe == null ? '' : `$ ${r.importe}`) },
    { header: 'Estado', key: 'estado' },
  ];
  const data = [
    { __rowType: 'group', label: 'Sección A' },
    { concepto: 'Uno', importe: 1500.5, estado: 'Concilia' },
    { concepto: 'Dos', importe: null, estado: 'A revisar' },
    { __rowType: 'subtotal', label: 'Subtotal A', value: 1500.5, valueText: '$ 1.500,50' },
  ];

  it('descarga un .xlsx con la fecha en el nombre y el título como hoja', async () => {
    await exportReporte({ title: 'Conciliación de Cuentas de Control', columns, data, totals: null, filename: 'conciliacion' });
    expect(nombreDescargado).toMatch(/^conciliacion_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const wb = await abrirDescargado();
    // el nombre de hoja se recorta a los 31 caracteres que admite Excel
    expect(wb.worksheets[0].name).toBe('Conciliación de Cuentas de Cont');
    expect(wb.worksheets[0].name.length).toBeLessThanOrEqual(31);
  });

  it('las columnas numéricas salen como número real (no texto) y las de sección/subtotal se respetan', async () => {
    await exportReporte({ title: 'Reporte', columns, data, filename: 'r' });
    const ws = (await abrirDescargado()).worksheets[0];
    expect(valores(ws)).toEqual([
      ['Concepto', 'Importe', 'Estado'],
      ['Sección A'],
      ['Uno', 1500.5, 'Concilia'],
      ['Dos', '', 'A revisar'],
      ['Subtotal A', '', 1500.5],
    ]);
    expect(typeof ws.getCell('B3').value).toBe('number');
    expect(ws.getRow(1).font.bold).toBe(true);
  });

  it('agrega la fila de totales usando el valor crudo y respeta el colSpan', async () => {
    await exportReporte({
      title: 'Con totales', columns, data: [{ concepto: 'Uno', importe: 10, estado: 'ok' }],
      totals: [{ content: 'TOTAL', colSpan: 2, align: 'right' }, { content: '$ 10,00', value: 10 }], filename: 't',
    });
    const filas = valores((await abrirDescargado()).worksheets[0]);
    expect(filas[filas.length - 1]).toEqual(['TOTAL', '', 10]);
  });

  it('un título con caracteres que Excel no admite en el nombre de hoja no rompe la exportación', async () => {
    await exportReporte({ title: 'Ventas: 2026/09 [prueba]?', columns, data: [], filename: 'r' });
    const wb = await abrirDescargado();
    expect(wb.worksheets[0].name).toBe('Ventas- 2026-09 -prueba--');
  });
});

describe('exportToExcel (exceljs)', () => {
  it('escribe las etiquetas y una fila por registro, con el encabezado en negrita y anchos automáticos', async () => {
    await exportToExcel({
      rows: [{ sku: 'A1', nombre: 'Aramis TESTE Azul marino', stock: 5 }, { sku: 'B2', nombre: null, stock: 0 }],
      headers: ['sku', 'nombre', 'stock'],
      labels: ['SKU', 'Nombre', 'Stock'],
      filename: 'productos',
      sheetName: 'Inventario',
    });
    expect(nombreDescargado).toMatch(/^productos_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const ws = (await abrirDescargado()).worksheets[0];
    expect(ws.name).toBe('Inventario');
    expect(valores(ws)).toEqual([
      ['SKU', 'Nombre', 'Stock'],
      ['A1', 'Aramis TESTE Azul marino', 5],
      ['B2', '', 0],
    ]);
    expect(ws.getRow(1).font.bold).toBe(true);
    expect(ws.getColumn(2).width).toBe('Aramis TESTE Azul marino'.length + 2);
    expect(ws.getColumn(1).width).toBe(5); // 'SKU'/'A1' → 3 + 2
  });

  it('el ancho de columna tiene tope de 40', async () => {
    await exportToExcel({ rows: [{ d: 'x'.repeat(200) }], headers: ['d'], labels: ['Descripción'], filename: 'r' });
    expect((await abrirDescargado()).worksheets[0].getColumn(1).width).toBe(40);
  });
});
