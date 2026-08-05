import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useArqueoCaja } from '@/hooks/useArqueoCaja';
import { offlineDb, encolarVenta } from '@/lib/offlineDb';

const mockFrom = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));

const EMPRESA_ID = 'empresa-1';
vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', empresa_id: EMPRESA_ID } }),
}));

let mockCurrentSession = { id: 'sesion-1' };
vi.mock('@/contexts/CajaContext', () => ({
  useCaja: () => ({ currentSession: mockCurrentSession }),
}));

const chain = {
  select: () => chain,
  eq: () => Promise.resolve({ data: [], error: null }),
};

function wrapper({ children }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// Modo Offline del POS — Fase 3. pendienteSyncEfectivo/Transferencia son
// líneas informativas aparte — nunca deben sumarse a `esperado` (verdad-servidor).
describe('useArqueoCaja — Fase 3 (pendientes de sync)', () => {
  beforeEach(async () => {
    await Promise.all(offlineDb.tables.map(t => t.clear()));
    mockFrom.mockReset();
    mockFrom.mockReturnValue(chain);
    mockCurrentSession = { id: 'sesion-1' };
  });

  it('sin ventas encoladas: pendienteSyncEfectivo/Transferencia en 0', async () => {
    const { result } = renderHook(() => useArqueoCaja(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pendienteSyncEfectivo).toBe(0);
    expect(result.current.pendienteSyncTransferencia).toBe(0);
  });

  it('suma sólo las ventas encoladas de la sesión actual (por id real)', async () => {
    await encolarVenta(EMPRESA_ID, {
      payload: { p_total: 500, p_pagos: [{ metodo: 'Efectivo', monto: 500 }] },
      itemsSnapshot: [], cajaSesionId: 'sesion-1',
    });
    await encolarVenta(EMPRESA_ID, {
      payload: { p_total: 300, p_pagos: [{ metodo: 'Efectivo', monto: 300 }] },
      itemsSnapshot: [], cajaSesionId: 'otra-sesion', // no es la actual — no debe sumar
    });

    const { result } = renderHook(() => useArqueoCaja(), { wrapper });
    await waitFor(() => expect(result.current.pendienteSyncEfectivo).toBe(500));
  });

  it('separa Efectivo de Transferencia (venta mixta encolada)', async () => {
    await encolarVenta(EMPRESA_ID, {
      payload: {
        p_total: 800,
        p_pagos: [{ metodo: 'Efectivo', monto: 500 }, { metodo: 'Transferencia', monto: 300 }],
      },
      itemsSnapshot: [], cajaSesionId: 'sesion-1',
    });

    const { result } = renderHook(() => useArqueoCaja(), { wrapper });
    await waitFor(() => expect(result.current.pendienteSyncEfectivo).toBe(500));
    expect(result.current.pendienteSyncTransferencia).toBe(300);
  });

  it('una sesión pendiente de sincronizar (id null, client_uuid) matchea por client_uuid', async () => {
    mockCurrentSession = { id: null, client_uuid: 'sesion-client-uuid-1', _pendingSync: true };
    await encolarVenta(EMPRESA_ID, {
      payload: { p_total: 200, p_pagos: [{ metodo: 'Efectivo', monto: 200 }] },
      itemsSnapshot: [], cajaSesionClientUuid: 'sesion-client-uuid-1',
    });

    const { result } = renderHook(() => useArqueoCaja(), { wrapper });
    await waitFor(() => expect(result.current.pendienteSyncEfectivo).toBe(200));
  });

  it('una venta ya sincronizada no se cuenta (ya no es "pendiente")', async () => {
    const fila = await encolarVenta(EMPRESA_ID, {
      payload: { p_total: 500, p_pagos: [{ metodo: 'Efectivo', monto: 500 }] },
      itemsSnapshot: [], cajaSesionId: 'sesion-1',
    });
    await offlineDb.ventasPendientes.update(fila.localId, { estado: 'sincronizada' });

    const { result } = renderHook(() => useArqueoCaja(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pendienteSyncEfectivo).toBe(0);
  });
});
