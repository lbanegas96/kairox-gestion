import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useProductosSnapshot } from '@/hooks/useProductosSnapshot';
import { offlineDb, guardarSnapshot } from '@/lib/offlineDb';

// customSupabaseClient.js tira si faltan VITE_SUPABASE_URL/ANON_KEY (no hay .env
// en el entorno de test) — se mockea entero, mismo patrón que useCreditoCliente.test.js.
const mockEq2 = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => mockEq2(),
        }),
      }),
    }),
  },
}));

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111';

// Modo Offline del POS — Fase 2. El hook tiene dos responsabilidades: (1)
// refrescar el snapshot en Dexie mientras hay conexión, (2) servir búsquedas
// desde ese snapshot cuando no la hay. Se testean por separado.
describe('useProductosSnapshot', () => {
  beforeEach(async () => {
    await Promise.all(offlineDb.tables.map(t => t.clear()));
    mockEq2.mockReset();
  });

  it('online: refresca el snapshot desde Supabase al montar', async () => {
    mockEq2.mockResolvedValue({
      data: [{ id: 'p1', empresa_id: EMPRESA_ID, nombre: 'Coca Cola', codigo_sku: 'COC1' }],
      error: null,
    });
    const { result } = renderHook(() => useProductosSnapshot(EMPRESA_ID, true));

    await waitFor(async () => {
      const filas = await result.current.buscarOffline('');
      expect(filas).toHaveLength(1);
    });
  });

  it('online pero Supabase devuelve error: no pisa el snapshot existente con nada', async () => {
    await guardarSnapshot('productos', EMPRESA_ID, [{ id: 'p1', nombre: 'Ya guardado antes' }]);
    mockEq2.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const { result } = renderHook(() => useProductosSnapshot(EMPRESA_ID, true));
    await waitFor(() => expect(mockEq2).toHaveBeenCalled());

    const filas = await result.current.buscarOffline('');
    expect(filas).toHaveLength(1);
    expect(filas[0].nombre).toBe('Ya guardado antes');
  });

  it('offline: no llama a Supabase, sirve búsquedas desde el snapshot ya guardado', async () => {
    await guardarSnapshot('productos', EMPRESA_ID, [
      { id: 'p1', nombre: 'Coca Cola 500ml', codigo_sku: 'COC500', codigo_barras: '7790001' },
      { id: 'p2', nombre: 'Agua Mineral', codigo_sku: 'AGU1', codigo_barras: '7790002' },
    ]);

    const { result } = renderHook(() => useProductosSnapshot(EMPRESA_ID, false));
    expect(mockEq2).not.toHaveBeenCalled();

    const todos = await result.current.buscarOffline('');
    expect(todos).toHaveLength(2);

    const porNombre = await result.current.buscarOffline('coca');
    expect(porNombre.map(p => p.id)).toEqual(['p1']);

    const porCodigo = await result.current.buscarPorCodigoBarras('7790002');
    expect(porCodigo?.id).toBe('p2');

    expect(await result.current.buscarPorCodigoBarras('no-existe')).toBeNull();
  });

  it('buscarOffline sin empresa_id devuelve vacío, no explota', async () => {
    const { result } = renderHook(() => useProductosSnapshot(null, false));
    expect(await result.current.buscarOffline('')).toEqual([]);
  });
});
