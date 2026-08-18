import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MapaRelaciones from '@/components/shared/MapaRelaciones';

const mockFrom = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));
vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useAuth: () => ({ user: { empresa_id: 'empresa-1' } }),
}));

// Chain mínima que soporta select/eq/order/or/limit encadenados (siempre
// vuelve a sí misma) y se resuelve tanto como .single()/.maybeSingle() como
// awaiteada directo (list queries sin terminal, patrón real de MapaRelaciones).
function chain(result) {
  const c = {
    select: () => c, eq: () => c, order: () => c, or: () => c, limit: () => c,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return c;
}

const COMP = {
  id: 'comp-1', numero_venta: 'FAC-1', numero_afip: null, tipo: 'venta',
  total: 10000, fecha: '2026-08-01', cliente_nombre: 'Cliente Test',
  comprobante_origen_id: null, pedido_id: null, cotizacion_id: null,
};
const NCS = [1, 2, 3].map(i => ({
  id: `nc-${i}`, numero_venta: `NC-${i}`, numero_afip: null, tipo: 'nota_credito',
  total: 100, fecha: '2026-08-02', estado_pago: 'pagada',
}));
const NDS = [1, 2].map(i => ({ id: `nd-${i}`, numero_nd: `ND-${i}`, concepto: 'ajuste', monto: 50, fecha: '2026-08-03' }));
const COBROS = [1, 2].map(i => ({ id: `cob-${i}`, tipo: 'HABER', monto: 200, fecha: '2026-08-04', descripcion: `Cobro Test ${i}` }));
const DEVS = [1, 2].map(i => ({ id: `dev-${i}`, numero_devolucion: `DEV-${i}`, fecha: '2026-08-05', compensacion: 'nc' }));

// mockFrom para 'comprobantes' necesita distinguir 3 shapes de .select() distintas
// (fetch principal, lista de NC, y las 2 consultas de fetchDuplicadoInfo) — se
// despacha por el contenido de las columnas pedidas, único dato disponible acá.
function setupMock({ ncs = NCS, nds = NDS, cobros = COBROS, devs = DEVS } = {}) {
  mockFrom.mockImplementation((table) => {
    if (table === 'comprobantes') {
      return {
        select: (cols) => {
          if (cols.includes('comprobante_origen_id')) return chain({ data: COMP });
          if (cols.includes('estado_pago'))            return chain({ data: ncs });
          return chain({ data: null }); // fetchDuplicadoInfo — sin duplicados en este test
        },
      };
    }
    if (table === 'cotizaciones')                 return chain({ data: null });
    if (table === 'entregas')                     return chain({ data: [] });
    if (table === 'notas_debito')                 return chain({ data: nds });
    if (table === 'devoluciones')                 return chain({ data: devs });
    if (table === 'cuenta_corriente_movimientos') return chain({ data: cobros });
    return chain({ data: null });
  });
}

// Fase 4 (PLAN_MAPA_RELACIONES.md): "Documentos derivados" no tenía tope — un
// cliente con muchas NC/ND/cobros sobre la misma factura se veía entero,
// ocupando varias filas de una. Caso real que motivó esto: no hay hoy en Nalux
// ningún comprobante con más de 2 derivados, así que se arma sintético (9)
// para poder probar el "Ver N más" — el mismo caso de "10 NC" que documentaba
// el plan.
describe('MapaRelaciones — Fase 4: colapsar ramas largas de derivados', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('con 9 documentos derivados, muestra sólo los primeros 6 y un botón "Ver 3 más"', async () => {
    setupMock();
    render(<MapaRelaciones open onOpenChange={() => {}} comprobanteId="comp-1" />);

    await screen.findByText('NC-1');

    // Orden real: 3 NC + 2 ND + 2 cobros + 2 devoluciones = 9 -> primeros 6 visibles
    expect(screen.getByText('NC-1')).toBeTruthy();
    expect(screen.getByText('NC-2')).toBeTruthy();
    expect(screen.getByText('NC-3')).toBeTruthy();
    expect(screen.getByText('ND-1')).toBeTruthy();
    expect(screen.getByText('ND-2')).toBeTruthy();
    expect(screen.getByText('Cobro Test 1')).toBeTruthy();

    // El resto queda oculto detrás del botón
    expect(screen.queryByText('Cobro Test 2')).toBeNull();
    expect(screen.queryByText('DEV-1')).toBeNull();
    expect(screen.queryByText('DEV-2')).toBeNull();
    expect(screen.getByText('Ver 3 más')).toBeTruthy();
  });

  it('clic en "Ver N más" muestra el resto, y "Ver menos" los vuelve a ocultar', async () => {
    setupMock();
    render(<MapaRelaciones open onOpenChange={() => {}} comprobanteId="comp-1" />);
    await screen.findByText('NC-1');

    fireEvent.click(screen.getByText('Ver 3 más'));
    expect(await screen.findByText('Cobro Test 2')).toBeTruthy();
    expect(screen.getByText('DEV-1')).toBeTruthy();
    expect(screen.getByText('DEV-2')).toBeTruthy();
    expect(screen.getByText('Ver menos')).toBeTruthy();

    fireEvent.click(screen.getByText('Ver menos'));
    await waitFor(() => expect(screen.queryByText('Cobro Test 2')).toBeNull());
  });

  it('con pocos documentos derivados (el caso real de hoy en Nalux), no hay regresión: se ven todos, sin botón', async () => {
    setupMock({ ncs: NCS.slice(0, 1), nds: [], cobros: [], devs: DEVS.slice(0, 1) });
    render(<MapaRelaciones open onOpenChange={() => {}} comprobanteId="comp-1" />);
    await screen.findByText('NC-1');

    expect(screen.getByText('DEV-1')).toBeTruthy();
    expect(screen.queryByText(/Ver \d+ más/)).toBeNull();
  });
});
