import { describe, it, expect } from 'vitest';
import {
  mesLabel, mesAperturaLabel, compararCodigos, armarMemoriaAjuste, totalesMemoria,
  indicadoresMemoria, MEMORIA_COLUMNS, armarAjusteImpositivoExport, IMPOSITIVO_COLUMNS,
} from '@/lib/memoriaAjusteInflacion';

describe('mesLabel / mesAperturaLabel', () => {
  it('mesLabel: fecha → MM/YYYY', () => {
    expect(mesLabel('2026-07-01')).toBe('07/2026');
    expect(mesLabel('2026-07-31T23:00:00Z')).toBe('07/2026');
    expect(mesLabel(null)).toBe('—');
    expect(mesLabel('')).toBe('—');
  });
  it('mesAperturaLabel: el mes anterior al inicio del período (enero → diciembre del año anterior)', () => {
    expect(mesAperturaLabel('2026-07-01')).toBe('06/2026');
    expect(mesAperturaLabel('2026-06-01')).toBe('05/2026');
    expect(mesAperturaLabel('2026-01-01')).toBe('12/2025');
    expect(mesAperturaLabel(undefined)).toBe('—');
  });
});

describe('compararCodigos', () => {
  it('ordena los códigos de cuenta en orden natural (5.2 antes que 5.10)', () => {
    const codigos = ['5.10', '5.2', '3.1', '1.1.3', '3', '1.2.2', '5.1'];
    expect([...codigos].sort(compararCodigos)).toEqual(['1.1.3', '1.2.2', '3', '3.1', '5.1', '5.2', '5.10']);
  });
});

// Forma del JSON de memoria_calculo_ajuste_por_inflacion (mig.401).
const memoria = {
  periodo: { id: 'p1', nombre: 'Ejercicio 2026 - Julio', fecha_inicio: '2026-07-01', fecha_cierre: '2026-07-31', estado: 'cerrado' },
  indice_cierre: { mes: '2026-07-01', indice: 12000 },
  detalle: [
    { codigo: '5.10', nombre: 'Diferencias de Inventario (Faltantes)', tipo: 'egreso', origen: 'movimiento', mes: '2026-07-01', saldo: 100, indice: 12000, coeficiente: 1, saldo_reexpresado: 100, ajuste: 0 },
    { codigo: '3.2', nombre: 'Resultados Acumulados', tipo: 'patrimonio', origen: 'movimiento', mes: '2026-07-01', saldo: 50, indice: 12000, coeficiente: 1, saldo_reexpresado: 50, ajuste: 0 },
    { codigo: '3.2', nombre: 'Resultados Acumulados', tipo: 'patrimonio', origen: 'apertura', mes: '2026-06-01', saldo: 1000, indice: 10000, coeficiente: 1.2, saldo_reexpresado: 1200, ajuste: 200 },
    { codigo: '1.1.3', nombre: 'Mercaderías / Inventario', tipo: 'activo', origen: 'movimiento', mes: '2026-06-01', saldo: 500, indice: 10000, coeficiente: 1.2, saldo_reexpresado: 600, ajuste: 100 },
    { codigo: '1.1.3', nombre: 'Mercaderías / Inventario', tipo: 'activo', origen: 'movimiento', mes: '2026-07-01', saldo: 300, indice: 12000, coeficiente: 1, saldo_reexpresado: 300, ajuste: 0 },
  ],
  lineas: [{ codigo: '1.1.3', monto_ajuste: 100 }, { codigo: '3.2', monto_ajuste: 200 }],
  recpam_ganancia: 100,
  recpam_perdida: 200,
  recpam_neto: -100,
  asiento: null,
  control: { suma_detalle: 300, suma_lineas: 300, diferencia: 0 },
};

describe('armarMemoriaAjuste', () => {
  const m = armarMemoriaAjuste(memoria);

  it('agrupa por cuenta en orden natural y suma el ajuste de cada una', () => {
    expect(m.cuentas.map(c => c.codigo)).toEqual(['1.1.3', '3.2', '5.10']);
    expect(m.cuentas.map(c => c.ajuste)).toEqual([100, 200, 0]);
  });
  it('dentro de una cuenta va primero la apertura y después los meses en orden', () => {
    expect(m.cuentas[1].filas.map(f => f.origen)).toEqual(['apertura', 'movimiento']);
    expect(m.cuentas[0].filas.map(f => f.mes)).toEqual(['2026-06-01', '2026-07-01']);
  });
  it('arma filas planas: encabezado de cuenta, sus filas y el subtotal', () => {
    const tipos = m.filasPlanas.map(r => r.__rowType || 'fila');
    expect(tipos).toEqual([
      'group', 'fila', 'fila', 'subtotal',       // 1.1.3
      'group', 'fila', 'fila', 'subtotal',       // 3.2
      'group', 'fila', 'subtotal',               // 5.10
    ]);
    expect(m.filasPlanas[0].label).toBe('1.1.3 — Mercaderías / Inventario (activo)');
    const sub = m.filasPlanas[3];
    expect(sub).toMatchObject({ label: 'Ajuste de 1.1.3', value: 100 });
    expect(sub.valueText).toMatch(/100/);
  });
  it('lista los índices usados una sola vez por mes, del más viejo al más nuevo', () => {
    expect(m.indices.map(i => i.mesLabel)).toEqual(['06/2026', '07/2026']);
    expect(m.indices[0]).toMatchObject({ indice: 10000, coeficiente: 1.2 });
  });
  it('total de ajuste, RECPAM, índice de cierre y período', () => {
    expect(m.totalAjuste).toBe(300);
    expect(m.recpam).toEqual({ ganancia: 100, perdida: 200, neto: -100 });
    expect(m.indiceCierre).toMatchObject({ mesLabel: '07/2026', indice: 12000 });
    expect(m.periodo.nombre).toBe('Ejercicio 2026 - Julio');
    expect(m.sinAjuste).toBe(false);
  });
  it('control: cierra cuando el detalle coincide con las líneas oficiales', () => {
    expect(m.control).toEqual({ sumaDetalle: 300, sumaLineas: 300, diferencia: 0, ok: true });
  });
  it('control: tolera centavos pero avisa de una diferencia real', () => {
    expect(armarMemoriaAjuste({ ...memoria, control: { suma_detalle: 300.02, suma_lineas: 300, diferencia: 0.02 } }).control.ok).toBe(true);
    expect(armarMemoriaAjuste({ ...memoria, control: { suma_detalle: 350, suma_lineas: 300, diferencia: 50 } }).control.ok).toBe(false);
  });
  it('un período sin nada que ajustar (todo coeficiente 1) se marca sinAjuste', () => {
    const solo = armarMemoriaAjuste({ ...memoria, detalle: memoria.detalle.filter(d => d.ajuste === 0), lineas: [] });
    expect(solo.sinAjuste).toBe(true);
    expect(solo.totalAjuste).toBe(0);
  });
  it('conserva el asiento cuando el ajuste ya se generó', () => {
    const conAsiento = armarMemoriaAjuste({ ...memoria, asiento: { id: 'a1', numero: 'AS-0042', fecha: '2026-08-01' } });
    expect(conAsiento.asiento).toEqual({ id: 'a1', numero: 'AS-0042', fecha: '2026-08-01' });
  });
  it('no explota con una respuesta vacía', () => {
    const vacio = armarMemoriaAjuste({});
    expect(vacio.cuentas).toEqual([]);
    expect(vacio.filasPlanas).toEqual([]);
    expect(vacio.totalAjuste).toBe(0);
    expect(vacio.indiceCierre).toBeNull();
    expect(() => armarMemoriaAjuste(null)).not.toThrow();
  });
});

describe('tabla, totales e indicadores de la memoria', () => {
  const m = armarMemoriaAjuste(memoria);
  it('cada columna se dibuja para cada fila (pantalla y PDF)', () => {
    // Igual que ReportTable / pdfUtils: sin render, se muestra el valor crudo de la clave.
    m.cuentas.flatMap(c => c.filas).forEach(fila => MEMORIA_COLUMNS.forEach(col => {
      expect(String(col.render ? col.render(fila) : fila[col.key])).not.toMatch(/NaN|undefined/);
      expect(String(col.pdfRender ? col.pdfRender(fila) : fila[col.key])).not.toMatch(/NaN|undefined/);
    }));
  });
  it('el coeficiente sale con 6 decimales', () => {
    const col = MEMORIA_COLUMNS.find(c => c.key === 'coeficiente');
    expect(col.render({ coeficiente: 1.2 })).toBe('1,200000');
  });
  it('la fila de totales ocupa exactamente las columnas', () => {
    const t = totalesMemoria(m);
    expect(t.reduce((s, c) => s + (c.colSpan || 1), 0)).toBe(MEMORIA_COLUMNS.length);
    expect(t[1].value).toBe(300);
  });
  it('4 indicadores: ajuste total y RECPAM (ganancia, pérdida, neto)', () => {
    expect(indicadoresMemoria(m).map(i => i.label)).toEqual(['Ajuste total', 'RECPAM ganancia', 'RECPAM pérdida', 'RECPAM neto']);
  });
});

describe('armarAjusteImpositivoExport', () => {
  const resultado = {
    ok: true, activo_computable_inicio: 1000000, pasivo_computable_inicio: 400000, pn_computable_inicio: 600000,
    coeficiente_anual: 1.5, ajuste_estatico: -300000, ajuste_dinamico: -20000, ajuste_total: -320000, meses_sin_indice: [],
  };
  const fechas = { fechaInicio: '2026-01-01', fechaCierre: '2026-12-31' };

  it('si el cálculo no fue ok no hay nada que exportar', () => {
    expect(armarAjusteImpositivoExport(null, fechas)).toBeNull();
    expect(armarAjusteImpositivoExport({ ok: false, mensaje: 'Falta el índice' }, fechas)).toBeNull();
  });
  it('arma las filas del cálculo con su fórmula y las salvedades', () => {
    const p = armarAjusteImpositivoExport(resultado, fechas);
    expect(p.columns).toBe(IMPOSITIVO_COLUMNS);
    expect(p.startDate).toBe('2026-01-01');
    expect(p.endDate).toBe('2026-12-31');
    expect(p.data.slice(0, 6).map(r => r.concepto)).toEqual([
      'Activo computable al inicio', 'Pasivo computable al inicio', 'Patrimonio Neto computable al inicio',
      'Coeficiente anual', 'Ajuste estático', 'Ajuste dinámico',
    ]);
    expect(p.data.some(r => r.concepto === 'Salvedades')).toBe(true);
    expect(p.data.every(r => r.formula)).toBe(true);
  });
  it('total negativo = gravado (aumenta Ganancias), en positivo', () => {
    const p = armarAjusteImpositivoExport(resultado, fechas);
    const total = p.data[6];
    expect(total.concepto).toMatch(/gravado \(aumenta Ganancias\)/);
    expect(total.importe).toBe(320000);
    expect(p.summaryMetrics.map(m => m.label)).toEqual(['Ajuste estático', 'Ajuste dinámico', 'Total (gravado)']);
  });
  it('total positivo = deducible (reduce Ganancias)', () => {
    const p = armarAjusteImpositivoExport({ ...resultado, ajuste_estatico: 500, ajuste_dinamico: 0, ajuste_total: 500 }, fechas);
    expect(p.data[6].concepto).toMatch(/deducible \(reduce Ganancias\)/);
    expect(p.summaryMetrics[2].label).toBe('Total (deducible)');
  });
  it('avisa los meses sin índice cargado', () => {
    const p = armarAjusteImpositivoExport({ ...resultado, meses_sin_indice: ['2026-03', '2026-04'] }, fechas);
    const aviso = p.data.find(r => r.concepto.startsWith('ATENCIÓN'));
    expect(aviso.formula).toMatch(/2026-03, 2026-04/);
  });
  it('cada columna se dibuja para cada fila (el coeficiente sale como texto, no como $)', () => {
    const p = armarAjusteImpositivoExport(resultado, fechas);
    p.data.forEach(row => IMPOSITIVO_COLUMNS.forEach(col => {
      const v = col.render ? col.render(row) : row[col.key];
      expect(String(v)).not.toMatch(/NaN|undefined/);
    }));
    expect(IMPOSITIVO_COLUMNS[1].render(p.data[3])).toBe('1,5000');
  });
});
