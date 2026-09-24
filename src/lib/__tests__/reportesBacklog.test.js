import { describe, it, expect } from 'vitest';
import {
  nombreLista, situacionLista, rendimientoListasPrecio, rankingProveedores,
  motivoDeAsiento, historialAjustesInventario, devolucionesProveedor,
} from '@/lib/reportesBacklog';

describe('situacionLista', () => {
  it('coincide cuando usó la asignada, o ninguna y no tiene', () => {
    expect(situacionLista('L1', 'L1')).toBe('coincide');
    expect(situacionLista(null, null)).toBe('coincide');
    expect(situacionLista(undefined, null)).toBe('coincide');
  });
  it('detecta las 3 formas de desvío', () => {
    expect(situacionLista(null, 'L1')).toBe('sin_lista');     // tiene lista y se facturó a precio estándar
    expect(situacionLista('L1', null)).toBe('sin_asignar');   // se aplicó una lista que no tiene asignada
    expect(situacionLista('L2', 'L1')).toBe('otra_lista');
  });
});

describe('nombreLista', () => {
  it('sin lista = Precio estándar; lista borrada = Lista eliminada', () => {
    expect(nombreLista(null, {})).toBe('Precio estándar');
    expect(nombreLista('L1', { L1: 'Mayorista' })).toBe('Mayorista');
    expect(nombreLista('L9', { L1: 'Mayorista' })).toBe('Lista eliminada');
  });
});

describe('rendimientoListasPrecio', () => {
  const nombres = { L1: 'Mayorista', L2: 'Gremio' };
  const asignada = { c1: 'L1', c2: null };
  const ventas = [
    { cliente_id: 'c1', lista_precio_id: 'L1', total: 1000, costo_mercaderia_vendida: 600 },   // coincide
    { cliente_id: 'c1', lista_precio_id: 'L1', total: 500, costo_mercaderia_vendida: 300 },    // coincide
    { cliente_id: 'c1', lista_precio_id: null, total: 800, costo_mercaderia_vendida: 400 },    // sin_lista
    { cliente_id: 'c1', lista_precio_id: 'L2', total: 300, costo_mercaderia_vendida: 100 },    // otra_lista
    { cliente_id: 'c2', lista_precio_id: 'L1', total: 200, costo_mercaderia_vendida: 150 },    // sin_asignar
    { cliente_id: null, lista_precio_id: null, total: 5000, costo_mercaderia_vendida: 3000 },  // consumidor final, estándar
  ];
  const filas = rendimientoListasPrecio(ventas, asignada, nombres);
  const fila = (situacion) => filas.find(f => f.situacion === situacion);

  it('una fila por par (usada, asignada)', () => {
    expect(filas).toHaveLength(5);
    expect(filas.map(f => f.situacion).sort()).toEqual(['coincide', 'coincide', 'otra_lista', 'sin_asignar', 'sin_lista']);
  });
  it('agrega ventas, monto, costo y margen de cada par', () => {
    const c = filas.find(f => f.usada === 'Mayorista' && f.asignada === 'Mayorista');
    expect(c).toMatchObject({ ventas: 2, venta: 1500, costo: 900, margen: 600, clientes: 1, esDesvio: false });
    expect(c.margenPct).toBeCloseTo(40, 9);
  });
  it('los desvíos van primero (por monto), después los que coinciden', () => {
    expect(filas.slice(0, 3).every(f => f.esDesvio)).toBe(true);
    expect(filas.slice(3).every(f => !f.esDesvio)).toBe(true);
    expect(filas[0].venta).toBeGreaterThanOrEqual(filas[1].venta);
    expect(fila('sin_lista')).toMatchObject({ usada: 'Precio estándar', asignada: 'Mayorista', venta: 800 });
    expect(fila('otra_lista')).toMatchObject({ usada: 'Gremio', asignada: 'Mayorista' });
    expect(fila('sin_asignar')).toMatchObject({ usada: 'Mayorista', asignada: 'Sin lista asignada' });
  });
  it('consumidor final a precio estándar coincide y cuenta como un cliente', () => {
    const cf = filas.find(f => f.usada === 'Precio estándar' && f.situacion === 'coincide');
    expect(cf).toMatchObject({ ventas: 1, venta: 5000, clientes: 1 });
  });
  it('sin costo cargado el margen es el 100% de la venta (caveat conocido)', () => {
    const [f] = rendimientoListasPrecio([{ cliente_id: null, lista_precio_id: null, total: 100, costo_mercaderia_vendida: null }]);
    expect(f.costo).toBe(0);
    expect(f.margenPct).toBe(100);
  });
  it('sin ventas → sin filas; venta 0 → margen % 0 sin NaN', () => {
    expect(rendimientoListasPrecio([], {}, {})).toEqual([]);
    const [f] = rendimientoListasPrecio([{ cliente_id: null, lista_precio_id: null, total: 0 }]);
    expect(f.margenPct).toBe(0);
  });
  it('cuenta clientes distintos, no ventas', () => {
    const r = rendimientoListasPrecio([
      { cliente_id: 'a', lista_precio_id: null, total: 1 },
      { cliente_id: 'a', lista_precio_id: null, total: 1 },
      { cliente_id: 'b', lista_precio_id: null, total: 1 },
    ], {}, {});
    expect(r[0]).toMatchObject({ ventas: 3, clientes: 2 });
  });
});

describe('rankingProveedores', () => {
  const compras = [
    { proveedor_id: 'p1', proveedor: 'Ferretex', total: 600, fecha: '2026-09-01T10:00:00Z' },
    { proveedor_id: 'p2', proveedor: 'Distri SA', total: 300, fecha: '2026-09-05T10:00:00Z' },
    { proveedor_id: 'p1', proveedor: 'Ferretex', total: 100, fecha: '2026-09-10T10:00:00Z' },
    { proveedor_id: null, proveedor: undefined, total: 0, fecha: '2026-09-02T10:00:00Z' },
  ];
  const r = rankingProveedores(compras);
  it('ordena por total y numera la posición', () => {
    expect(r.map(p => p.nombre)).toEqual(['Ferretex', 'Distri SA', 'Sin proveedor']);
    expect(r.map(p => p.posicion)).toEqual([1, 2, 3]);
  });
  it('cuenta facturas, ticket promedio y última compra', () => {
    expect(r[0]).toMatchObject({ facturas: 2, total: 700, ticket: 350, ultima: '2026-09-10T10:00:00Z' });
  });
  it('% del total y % acumulado suman 100 al final', () => {
    expect(r[0].pct).toBeCloseTo(70, 9);
    expect(r[1].pct).toBeCloseTo(30, 9);
    expect(r[0].pctAcum).toBeCloseTo(70, 9);
    expect(r[r.length - 1].pctAcum).toBeCloseTo(100, 9);
  });
  it('sin compras → []; todo en cero → % 0, sin NaN', () => {
    expect(rankingProveedores([])).toEqual([]);
    expect(rankingProveedores(undefined)).toEqual([]);
    const z = rankingProveedores([{ proveedor_id: 'p', proveedor: 'X', total: 0, fecha: '2026-09-01' }]);
    expect(z[0].pct).toBe(0);
    expect(z[0].pctAcum).toBe(0);
  });
});

describe('motivoDeAsiento', () => {
  it('formato actual: saca el nombre del producto y los paréntesis', () => {
    expect(motivoDeAsiento('Ajuste de stock — Tornillo (rotura en depósito)', 'Tornillo')).toBe('rotura en depósito');
  });
  it('sin motivo → vacío', () => {
    expect(motivoDeAsiento('Ajuste de stock — aromaza', 'aromaza')).toBe('');
  });
  it('formato viejo, sin la raya', () => {
    expect(motivoDeAsiento('Ajuste de stock QA TEST INV A (QA-13SEP ajuste manual FALTANTE 40 a 33)', 'QA TEST INV A'))
      .toBe('QA-13SEP ajuste manual FALTANTE 40 a 33');
  });
  it('un producto con paréntesis en el nombre y un motivo con paréntesis', () => {
    expect(motivoDeAsiento('Ajuste de stock — Remera (talle M) (sobrante (40->46))', 'Remera (talle M)')).toBe('sobrante (40->46)');
  });
  it('si el producto se renombró, deja el texto sin el prefijo en vez de inventar un motivo', () => {
    expect(motivoDeAsiento('Ajuste de stock — Nombre viejo (rotura)', 'Nombre nuevo')).toBe('Nombre viejo (rotura)');
  });
});

describe('historialAjustesInventario', () => {
  const recuentoItems = [
    { recuento_id: 'r1', numero: 'RC-1', fecha: '2026-09-13T12:00:00Z', producto_id: 'pA', producto: 'A', stock_sistema: 10, cantidad_contada: 7, costo_unitario: 100 },  // -3 → -300
    { recuento_id: 'r1', numero: 'RC-1', fecha: '2026-09-13T12:00:00Z', producto_id: 'pB', producto: 'B', stock_sistema: 5, cantidad_contada: 5, costo_unitario: 50 },    // sin diferencia
    { recuento_id: 'r1', numero: 'RC-1', fecha: '2026-09-13T12:00:00Z', producto_id: 'pC', producto: 'C', stock_sistema: 5, cantidad_contada: null, costo_unitario: 50 }, // sin contar
    { recuento_id: 'r2', numero: 'RC-2', fecha: '2026-09-17T12:00:00Z', producto_id: 'pA', producto: 'A', stock_sistema: 20, cantidad_contada: 26, costo_unitario: 100 }, // +6 → +600
  ];
  const manuales = [
    { id: 'm1', fecha: '2026-09-15', producto_id: 'pA', producto: 'A', descripcion: 'Ajuste de stock — A (rotura)', monto: 200, esFaltante: true },
    { id: 'm2', fecha: '2026-09-11', producto_id: 'pD', producto: 'D', descripcion: 'Ajuste de stock — D', monto: 50, esFaltante: false },
  ];
  const filas = historialAjustesInventario({ recuentoItems, manuales });

  it('ignora ítems sin contar y sin diferencia', () => {
    expect(filas).toHaveLength(4);
    expect(filas.some(f => f.productoId === 'pB' || f.productoId === 'pC')).toBe(false);
  });
  it('recuento: unidades = contado − sistema y $ = unidades × costo del ítem', () => {
    const f = filas.find(x => x.documento === 'RC-1' && x.productoId === 'pA');
    expect(f).toMatchObject({ origen: 'Recuento', unidades: -3, valor: -300 });
    expect(filas.find(x => x.documento === 'RC-2')).toMatchObject({ unidades: 6, valor: 600 });
  });
  it('ajuste manual: solo $, con signo según sea faltante o sobrante, y el motivo', () => {
    expect(filas.find(x => x.id === 'mn_m1')).toMatchObject({ origen: 'Ajuste manual', unidades: null, valor: -200, detalle: 'rotura' });
    expect(filas.find(x => x.id === 'mn_m2')).toMatchObject({ valor: 50, detalle: '' });
  });
  it('"veces" cuenta los ajustes del producto entre las dos fuentes', () => {
    expect(filas.filter(f => f.productoId === 'pA').every(f => f.veces === 3)).toBe(true);
    expect(filas.find(f => f.productoId === 'pD').veces).toBe(1);
  });
  it('ordena de más nuevo a más viejo', () => {
    const fechas = filas.map(f => f.fecha);
    expect(fechas).toEqual([...fechas].sort().reverse());
  });
  it('sin datos → []', () => {
    expect(historialAjustesInventario()).toEqual([]);
    expect(historialAjustesInventario({})).toEqual([]);
  });
});

describe('devolucionesProveedor', () => {
  const devs = [
    { id: 'd1', numero_devolucion: 'DEV-1', fecha: '2026-06-13', motivo: 'Mercaderia dañada', compensacion: 'nota_credito', proveedores: { nombre: 'Ferretex' }, devolucion_items: [{ subtotal: 100 }, { subtotal: 50 }] },
    { id: 'd2', numero_devolucion: 'DEV-2', fecha: '2026-07-07', motivo: '  MERCADERÍA DAÑADA ', compensacion: 'reemplazo', proveedores: { nombre: 'Ferretex' }, devolucion_items: [{ subtotal: 30 }] },
    { id: 'd3', numero_devolucion: 'DEV-3', fecha: '2026-09-13', motivo: null, compensacion: 'otra_cosa', proveedores: null, devolucion_items: null },
    { id: 'd4', numero_devolucion: 'DEV-4', fecha: '2026-09-14', motivo: '   ', compensacion: 'ninguna', proveedores: { nombre: 'Distri SA' }, devolucion_items: [] },
  ];
  const filas = devolucionesProveedor(devs);
  const f = (id) => filas.find(x => x.id === id);

  it('suma los ítems de cada devolución (sin ítems = 0)', () => {
    expect(f('d1').total).toBe(150);
    expect(f('d3').total).toBe(0);
    expect(f('d4').total).toBe(0);
  });
  it('junta los motivos que solo cambian en mayúsculas, tildes o espacios', () => {
    expect(f('d1').motivo).toBe('Mercaderia dañada');
    expect(f('d2').motivo).toBe('Mercaderia dañada');
  });
  it('sin motivo (vacío o solo espacios) → "Sin motivo" y marcada', () => {
    expect(f('d3')).toMatchObject({ motivo: 'Sin motivo', sinMotivo: true });
    expect(f('d4')).toMatchObject({ motivo: 'Sin motivo', sinMotivo: true });
    expect(f('d1').sinMotivo).toBe(false);
  });
  it('traduce la compensación y no rompe con valores desconocidos', () => {
    expect(f('d1').compensacion).toBe('Nota de crédito');
    expect(f('d2').compensacion).toBe('Reemplazo');
    expect(f('d3').compensacion).toBe('otra_cosa');
    expect(f('d4').compensacion).toBe('Sin compensación');
  });
  it('proveedor faltante → "Sin proveedor"; ordena por fecha desc', () => {
    expect(f('d3').proveedor).toBe('Sin proveedor');
    expect(filas.map(x => x.id)).toEqual(['d4', 'd3', 'd2', 'd1']);
  });
  it('sin devoluciones → []', () => {
    expect(devolucionesProveedor([])).toEqual([]);
    expect(devolucionesProveedor(undefined)).toEqual([]);
  });
});
