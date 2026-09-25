import { describe, it, expect } from 'vitest';
import {
  armarConciliacion, indicadoresConciliacion, formatearCelda, columnasDetalle,
  DETALLE_COLUMNAS, CONCILIACION_COLUMNS,
} from '../conciliacionControl';

// Respuesta armada a mano con la forma de `conciliacion_cuentas_control` (mig.414).
const respuesta = {
  generado_en: '2026-09-25T20:00:00Z',
  cuentas: [
    { clave: 'clientes', titulo: 'Cuentas a Cobrar — clientes', cuenta_codigo: '1.1.2', cuenta_nombre: 'Cuentas a Cobrar', cuenta_existe: true, mayor: 823621, subdiario: 314103, subdiario_desc: 'Suma de las fichas', diferencia: 509518, conciliado: false },
    { clave: 'proveedores', titulo: 'Cuentas a Pagar — proveedores', cuenta_codigo: '2.1.1', cuenta_nombre: 'Cuentas a Pagar', cuenta_existe: true, mayor: 500, subdiario: 500, subdiario_desc: 'CC proveedores', diferencia: 0, conciliado: true },
    { clave: 'iva_credito', titulo: 'IVA Crédito Fiscal', cuenta_codigo: '1.1.4', cuenta_nombre: null, cuenta_existe: false, mayor: 0, subdiario: 0, subdiario_desc: 'IVA de compras', diferencia: 0, conciliado: true },
  ],
  controles: [
    { clave: 'cc_sin_cliente', titulo: 'Movimientos de cuenta corriente sin cliente', ayuda: 'ayuda 1', casos: 4, monto: -160080, estado: 'revisar',
      detalle: [{ fecha: '2026-07-07', movimiento: 'HABER', monto: 1568, descripcion: 'NC por devolución' }] },
    { clave: 'productos_sin_costo', titulo: 'Productos con stock y sin costo', ayuda: 'ayuda 2', casos: 30, monto: null, estado: 'revisar',
      detalle: Array.from({ length: 25 }, (_, i) => ({ producto: `P${i}`, stock: i + 1 })) },
    { clave: 'asientos_desbalanceados', titulo: 'Asientos desbalanceados', ayuda: 'ayuda 3', casos: 0, monto: 0, estado: 'ok', detalle: [] },
  ],
};

describe('armarConciliacion', () => {
  const c = armarConciliacion(respuesta);

  it('normaliza las cuentas (números, nombre de la cuenta, si existe en el plan)', () => {
    expect(c.cuentas).toHaveLength(3);
    expect(c.cuentas[0]).toMatchObject({ clave: 'clientes', cuentaCodigo: '1.1.2', mayor: 823621, subdiario: 314103, diferencia: 509518, conciliado: false });
    expect(c.cuentas[2].cuentaExiste).toBe(false);
    expect(c.cuentas[2].cuentaNombre).toBeNull();
  });

  it('normaliza los controles: ok o a revisar, monto nulo y columnas conocidas del detalle', () => {
    expect(c.controles.map(k => [k.clave, k.ok, k.casos])).toEqual([
      ['cc_sin_cliente', false, 4], ['productos_sin_costo', false, 30], ['asientos_desbalanceados', true, 0],
    ]);
    expect(c.controles[1].monto).toBeNull();
    expect(c.controles[0].monto).toBe(-160080);
    expect(c.controles[0].columnas.map(col => col.label)).toEqual(['Fecha', 'Movimiento', 'Monto', 'Descripción']);
  });

  it('calcula el resumen: cuántas concilian, cuántas no y cuántos controles hay que revisar', () => {
    expect(c.resumen).toEqual({
      cuentasTotal: 3, cuentasConcilian: 2, cuentasConDiferencia: 1,
      controlesTotal: 3, controlesARevisar: 2, todoOk: false,
    });
    expect(indicadoresConciliacion(c)).toEqual([
      { label: 'Cuentas que concilian', value: '2 de 3' },
      { label: 'Cuentas con diferencia', value: '1' },
      { label: 'Controles a revisar', value: '2 de 3' },
    ]);
  });

  it('todoOk solo si concilian todas las cuentas y ningún control tiene casos', () => {
    const limpio = armarConciliacion({
      cuentas: [respuesta.cuentas[1]],
      controles: [respuesta.controles[2]],
    });
    expect(limpio.resumen.todoOk).toBe(true);
    expect(limpio.resumen.cuentasConDiferencia).toBe(0);
  });

  it('una respuesta vacía o nula no rompe: todo en cero y sin filas', () => {
    [null, undefined, {}].forEach(vacio => {
      const v = armarConciliacion(vacio);
      expect(v.cuentas).toEqual([]);
      expect(v.controles).toEqual([]);
      expect(v.resumen.cuentasTotal).toBe(0);
    });
  });

  it('arma una sola tabla con dos secciones para el PDF y el Excel', () => {
    const tipos = c.filasPlanas.map(f => f.__rowType || 'fila');
    expect(tipos).toEqual(['group', 'fila', 'fila', 'fila', 'group', 'fila', 'fila', 'fila']);
    expect(c.filasPlanas[0].label).toMatch(/Cuentas de control/);
    expect(c.filasPlanas[1]).toMatchObject({ concepto: 'Cuentas a Cobrar — clientes (1.1.2)', mayor: 823621, subdiario: 314103, importe: 509518, estado: 'Con diferencia' });
    expect(c.filasPlanas[2].estado).toBe('Concilia');
    // los controles: el concepto lleva la cantidad de casos si hay; el importe es el monto
    expect(c.filasPlanas[5]).toMatchObject({ concepto: 'Movimientos de cuenta corriente sin cliente — 4 casos', importe: -160080, estado: 'A revisar', mayor: null });
    expect(c.filasPlanas[7]).toMatchObject({ concepto: 'Asientos desbalanceados', estado: 'Sin casos' });
  });

  it('las columnas de export dejan vacío lo que no aplica (los controles no tienen mayor ni subdiario)', () => {
    const control = c.filasPlanas[5];
    const [concepto, mayor, subdiario, importe, estado] = CONCILIACION_COLUMNS;
    expect(mayor.pdfRender(control)).toBe('');
    expect(subdiario.pdfRender(control)).toBe('');
    expect(importe.pdfRender(control)).toMatch(/160\.080/);
    expect(concepto.key).toBe('concepto');
    expect(estado.key).toBe('estado');
  });
});

describe('detalle de los controles', () => {
  it('formatearCelda muestra moneda, número y fecha en formato argentino', () => {
    expect(formatearCelda(1568, 'moneda')).toMatch(/1\.568/);
    expect(formatearCelda(1234, 'numero')).toBe('1.234');
    expect(formatearCelda('2026-07-07', 'fecha')).toBe('07/07/2026');
    expect(formatearCelda('hola', 'texto')).toBe('hola');
  });

  it('un dato ausente se muestra como raya', () => {
    expect(formatearCelda(null, 'moneda')).toBe('—');
    expect(formatearCelda(undefined, 'texto')).toBe('—');
    expect(formatearCelda('', 'fecha')).toBe('—');
    expect(formatearCelda('no-es-fecha', 'fecha')).toBe('—');
  });

  it('hay columnas definidas para cada uno de los 7 controles de la base', () => {
    expect(Object.keys(DETALLE_COLUMNAS).sort()).toEqual([
      'asientos_desbalanceados', 'asientos_duplicados', 'cc_ficha_vs_movimientos', 'cc_sin_cliente',
      'cuentas_saldo_desfasado', 'documentos_sin_asiento', 'productos_sin_costo',
    ]);
  });

  it('un control que el frontend no conoce igual se ve, con sus claves como títulos', () => {
    expect(columnasDetalle('control_nuevo', [{ a: 1, b: 2 }])).toEqual([
      { key: 'a', label: 'a', tipo: 'texto' }, { key: 'b', label: 'b', tipo: 'texto' },
    ]);
    expect(columnasDetalle('control_nuevo', [])).toEqual([]);
  });
});
