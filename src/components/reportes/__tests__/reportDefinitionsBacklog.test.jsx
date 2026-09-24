import { describe, it, expect } from 'vitest';
import {
  REPORTS, buildSummaryMetrics, getTableConfig, applyGrouping, getGroupByOptions,
} from '@/components/reportes/reportDefinitions';
import {
  rendimientoListasPrecio, rankingProveedores, historialAjustesInventario, devolucionesProveedor,
} from '@/lib/reportesBacklog';

// Reportes del Backlog de Reportería (24/09): que estén en el Centro de
// Reportes, que sus indicadores y columnas cierren, y que agrupar funcione.
const IDS = ['rendimiento_listas_precio', 'ranking_proveedores', 'historial_ajustes_inventario', 'devoluciones_proveedor'];

// Suma de colSpan de la fila de totales = cantidad de columnas (si no, la tabla
// se desalinea en pantalla, en el PDF y en el Excel).
const anchoTotales = (totals) => totals.reduce((s, c) => s + (c.colSpan || 1), 0);

const datos = {
  rendimiento_listas_precio: rendimientoListasPrecio(
    [
      { cliente_id: 'c1', lista_precio_id: 'L1', total: 1000, costo_mercaderia_vendida: 600 },
      { cliente_id: 'c1', lista_precio_id: null, total: 800, costo_mercaderia_vendida: 400 },
      { cliente_id: null, lista_precio_id: null, total: 500, costo_mercaderia_vendida: 300 },
    ],
    { c1: 'L1' }, { L1: 'Mayorista' }
  ),
  ranking_proveedores: rankingProveedores([
    { proveedor_id: 'p1', proveedor: 'Ferretex', total: 700, fecha: '2026-09-01T10:00:00Z' },
    { proveedor_id: 'p2', proveedor: 'Distri SA', total: 300, fecha: '2026-09-05T10:00:00Z' },
  ]),
  historial_ajustes_inventario: historialAjustesInventario({
    recuentoItems: [
      { recuento_id: 'r1', numero: 'RC-1', fecha: '2026-09-13T12:00:00Z', producto_id: 'pA', producto: 'A', stock_sistema: 10, cantidad_contada: 7, costo_unitario: 100 },
      { recuento_id: 'r2', numero: 'RC-2', fecha: '2026-08-17T12:00:00Z', producto_id: 'pA', producto: 'A', stock_sistema: 20, cantidad_contada: 26, costo_unitario: 100 },
    ],
    manuales: [{ id: 'm1', fecha: '2026-09-15', producto_id: 'pB', producto: 'B', descripcion: 'Ajuste de stock — B (rotura)', monto: 200, esFaltante: true }],
  }),
  devoluciones_proveedor: devolucionesProveedor([
    { id: 'd1', numero_devolucion: 'DEV-1', fecha: '2026-06-13', motivo: 'Dañada', compensacion: 'nota_credito', proveedores: { nombre: 'Ferretex' }, devolucion_items: [{ subtotal: 100 }] },
    { id: 'd2', numero_devolucion: 'DEV-2', fecha: '2026-07-07', motivo: '', compensacion: 'reemplazo', proveedores: { nombre: 'Ferretex' }, devolucion_items: [{ subtotal: 50 }] },
    { id: 'd3', numero_devolucion: 'DEV-3', fecha: '2026-07-20', motivo: 'Dañada', compensacion: 'nota_credito', proveedores: { nombre: 'Distri SA' }, devolucion_items: [{ subtotal: 25 }] },
  ]),
};

describe('Backlog de Reportería — definiciones', () => {
  IDS.forEach(id => {
    describe(id, () => {
      it('está en el Centro de Reportes con título, ícono y ayuda', () => {
        const r = REPORTS.find(x => x.id === id);
        expect(r).toBeTruthy();
        expect(r.title).toBeTruthy();
        expect(r.icon).toBeTruthy();
        expect(r.ayuda.queEs).toBeTruthy();
        expect(r.ayuda.queMuestra.length).toBeGreaterThan(0);
        expect(r.ayuda.filtros.length).toBeGreaterThan(0);
      });
      it('los indicadores de arriba salen con 4 cajas y sin NaN', () => {
        const m = buildSummaryMetrics(id, datos[id]);
        expect(m).toHaveLength(4);
        m.forEach(x => expect(String(x.value)).not.toMatch(/NaN|undefined/));
      });
      it('la fila de totales ocupa exactamente las columnas de la tabla', () => {
        const { columns, totals } = getTableConfig(id, datos[id]);
        expect(columns.length).toBeGreaterThan(0);
        expect(anchoTotales(totals)).toBe(columns.length);
      });
      it('cada columna se dibuja para cada fila (pantalla y PDF) sin romper', () => {
        const { columns } = getTableConfig(id, datos[id]);
        datos[id].forEach(row => columns.forEach(col => {
          expect(() => (col.render ? col.render(row) : row[col.key])).not.toThrow();
          if (col.pdfRender) expect(String(col.pdfRender(row))).not.toMatch(/NaN|undefined/);
        }));
      });
      it('con 0 filas no explota', () => {
        expect(() => buildSummaryMetrics(id, [])).not.toThrow();
        expect(() => getTableConfig(id, [])).not.toThrow();
      });
    });
  });

  it('Rendimiento por Lista: indicadores (ventas, vendido, margen, ventas con lista distinta)', () => {
    const m = buildSummaryMetrics('rendimiento_listas_precio', datos.rendimiento_listas_precio);
    expect(m.map(x => x.label)).toEqual(['Ventas', 'Vendido', 'Margen %', 'Con lista distinta a la asignada']);
    expect(m[0].value).toBe(3);
    expect(m[3].value).toMatch(/^1 \(/); // la venta de $800 a precio estándar a un cliente con lista
  });

  it('Ranking: los 3 primeros concentran el 100% cuando hay solo 2 proveedores', () => {
    const m = buildSummaryMetrics('ranking_proveedores', datos.ranking_proveedores);
    expect(m.find(x => x.label === 'Los 3 primeros concentran').value).toBe('100.0%');
    expect(m.find(x => x.label === 'Facturas').value).toBe(2);
  });

  it('Ajustes: faltantes y sobrantes van por separado, nunca compensados', () => {
    const m = buildSummaryMetrics('historial_ajustes_inventario', datos.historial_ajustes_inventario);
    const por = Object.fromEntries(m.map(x => [x.label, x.value]));
    expect(por.Ajustes).toBe(3);
    expect(por['Productos que ajustan seguido']).toBe(1); // el producto A ajustó 2 veces
    expect(por.Faltantes).toMatch(/500/); // -300 (recuento) + -200 (manual)
    expect(por.Sobrantes).toMatch(/600/);
  });

  it('Devoluciones: monto, proveedores distintos y las que no tienen motivo', () => {
    const m = buildSummaryMetrics('devoluciones_proveedor', datos.devoluciones_proveedor);
    const por = Object.fromEntries(m.map(x => [x.label, x.value]));
    expect(por.Devoluciones).toBe(3);
    expect(por.Proveedores).toBe(2);
    expect(por['Sin motivo']).toBe(1);
    expect(por['Monto Devuelto']).toMatch(/175/);
  });

  describe('agrupar', () => {
    it('Ajustes: por producto, mes y origen, con subtotal en $ por grupo', () => {
      expect(getGroupByOptions('historial_ajustes_inventario').map(o => o.value)).toEqual(['none', 'producto', 'mes', 'origen']);
      const porProducto = applyGrouping('historial_ajustes_inventario', datos.historial_ajustes_inventario, 'producto');
      const sub = porProducto.filter(r => r.__rowType === 'subtotal');
      expect(sub).toHaveLength(2); // A y B
      expect(sub.find(s => s.label.endsWith('A')).value).toBe(300);  // -300 + 600
      expect(sub.find(s => s.label.endsWith('B')).value).toBe(-200);
      const porMes = applyGrouping('historial_ajustes_inventario', datos.historial_ajustes_inventario, 'mes');
      expect(porMes.filter(r => r.__rowType === 'group').map(r => r.label.split(' (')[0]).sort()).toEqual(['08/2026', '09/2026']);
    });
    it('Devoluciones: por proveedor, motivo y mes, con subtotal del monto', () => {
      expect(getGroupByOptions('devoluciones_proveedor').map(o => o.value)).toEqual(['none', 'proveedor', 'motivo', 'mes']);
      const porMotivo = applyGrouping('devoluciones_proveedor', datos.devoluciones_proveedor, 'motivo');
      const sub = porMotivo.filter(r => r.__rowType === 'subtotal');
      expect(sub.find(s => s.label.includes('Dañada')).value).toBe(125);
      expect(sub.find(s => s.label.includes('Sin motivo')).value).toBe(50);
      const porProv = applyGrouping('devoluciones_proveedor', datos.devoluciones_proveedor, 'proveedor');
      expect(porProv.filter(r => r.__rowType === 'group')).toHaveLength(2);
    });
    it('sin agrupar devuelve las filas tal cual', () => {
      expect(applyGrouping('devoluciones_proveedor', datos.devoluciones_proveedor, 'none')).toBe(datos.devoluciones_proveedor);
    });
  });
});
