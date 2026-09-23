import { describe, it, expect } from 'vitest';
import { calcularPosicionIva, fetchPosicionIva } from '@/lib/posicionIva';

// Posición IVA compartida por Impuestos → IVA y Reportes → Posición Fiscal
// Consolidada. Antes eran 2 copias del cálculo que daban números distintos
// para el mismo período (y ninguna coincidía con los Libros IVA).
describe('calcularPosicionIva', () => {
  it('vacío → ceros', () => {
    expect(calcularPosicionIva({})).toEqual({ debito: 0, credito: 0, saldo: 0 });
  });

  it('débito: venta + ND de cliente − NC de cliente', () => {
    const r = calcularPosicionIva({ comprobantes: [
      { tipo: 'venta', total: 1210, iva_discriminado: 210 },
      { tipo: 'nota_credito', total: 121, iva_discriminado: 21 },
      { tipo: 'nota_debito', total: 121, iva_discriminado: 10.5 },
    ] });
    expect(r.debito).toBeCloseTo(199.5, 9);
  });

  it('crédito: compras + ND de proveedor − NC de proveedor, con fallback /1.21 si falta iva_discriminado', () => {
    const r = calcularPosicionIva({
      compras: [{ total: 1210, iva_discriminado: 100 }, { total: 121, iva_discriminado: null }],
      ndProveedor: [{ monto: 60, iva_discriminado: 5 }],
      ncProveedor: [{ monto: 30, iva_discriminado: 2 }],
    });
    expect(r.credito).toBeCloseTo(124, 9);
  });

  it('saldo = débito − crédito (positivo = a pagar, negativo = a favor)', () => {
    const r = calcularPosicionIva({
      comprobantes: [{ tipo: 'venta', total: 1210, iva_discriminado: 210 }],
      compras: [{ total: 2420, iva_discriminado: 420 }],
    });
    expect(r.saldo).toBeCloseTo(-210, 9);
  });
});

// Doble de Supabase que registra los filtros de cada consulta: lo que protege
// de volver a contar comprobantes que no deben contar (anuladas, canceladas,
// CAE rechazado, "No libro").
function fakeSupabase(datosPorTabla = {}, errorEnTabla = null) {
  const filtros = {};
  const from = (tabla) => {
    filtros[tabla] = [];
    const b = {
      select: () => b,
      eq: (c, v) => { filtros[tabla].push(['eq', c, v]); return b; },
      neq: (c, v) => { filtros[tabla].push(['neq', c, v]); return b; },
      in: (c, v) => { filtros[tabla].push(['in', c, v]); return b; },
      gte: (c, v) => { filtros[tabla].push(['gte', c, v]); return b; },
      lte: (c, v) => { filtros[tabla].push(['lte', c, v]); return b; },
      then: (resolve) => resolve(
        tabla === errorEnTabla
          ? { data: null, error: new Error('boom') }
          : { data: datosPorTabla[tabla] ?? [], error: null }
      ),
    };
    return b;
  };
  return { supabase: { from }, filtros };
}

describe('fetchPosicionIva — qué comprobantes cuentan', () => {
  it('Ventas: solo venta/NC/ND con CAE emitido o sin AFIP, sin canceladas', async () => {
    const { supabase, filtros } = fakeSupabase();
    await fetchPosicionIva(supabase, 'emp-1', '2026-09-01', '2026-09-30');
    const f = filtros.comprobantes;
    expect(f).toContainEqual(['eq', 'empresa_id', 'emp-1']);
    expect(f).toContainEqual(['in', 'tipo', ['venta', 'nota_credito', 'nota_debito']]);
    expect(f).toContainEqual(['in', 'cae_estado', ['emitido', 'no_aplica']]); // sin pendiente/error/error_definitivo
    expect(f).toContainEqual(['neq', 'estado_pago', 'cancelada']);
    expect(f).toContainEqual(['gte', 'fecha', '2026-09-01T00:00:00']);
    expect(f).toContainEqual(['lte', 'fecha', '2026-09-30T23:59:59']);
  });

  it('Compras: sin anuladas y sin las "No libro"', async () => {
    const { supabase, filtros } = fakeSupabase();
    await fetchPosicionIva(supabase, 'emp-1', '2026-09-01', '2026-09-30');
    expect(filtros.compras).toContainEqual(['eq', 'empresa_id', 'emp-1']);
    expect(filtros.compras).toContainEqual(['neq', 'estado_pago', 'anulada']);
    expect(filtros.compras).toContainEqual(['eq', 'en_libro_iva', true]);
  });

  it('ND recibida y NC de proveedor: sin canceladas', async () => {
    const { supabase, filtros } = fakeSupabase();
    await fetchPosicionIva(supabase, 'emp-1', '2026-09-01', '2026-09-30');
    expect(filtros.notas_debito).toContainEqual(['eq', 'tipo', 'recibida']);
    expect(filtros.notas_debito).toContainEqual(['neq', 'estado', 'cancelada']);
    expect(filtros.notas_credito_proveedor).toContainEqual(['neq', 'estado', 'cancelada']);
  });

  it('suma lo que devuelven las 4 consultas', async () => {
    const { supabase } = fakeSupabase({
      comprobantes: [{ tipo: 'venta', total: 1210, iva_discriminado: 210 }],
      compras: [{ total: 605, iva_discriminado: 105 }],
      notas_debito: [{ monto: 121, iva_discriminado: 21 }],
      notas_credito_proveedor: [{ monto: 60.5, iva_discriminado: 10.5 }],
    });
    const r = await fetchPosicionIva(supabase, 'emp-1', '2026-09-01', '2026-09-30');
    expect(r.debito).toBeCloseTo(210, 9);
    expect(r.credito).toBeCloseTo(105 + 21 - 10.5, 9);
    expect(r.saldo).toBeCloseTo(210 - 115.5, 9);
  });

  it('si una consulta falla, lanza el error (no devuelve ceros en silencio)', async () => {
    const { supabase } = fakeSupabase({}, 'compras');
    await expect(fetchPosicionIva(supabase, 'emp-1', '2026-09-01', '2026-09-30')).rejects.toThrow('boom');
  });
});
