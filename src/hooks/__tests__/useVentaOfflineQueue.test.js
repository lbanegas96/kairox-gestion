import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useVentaOfflineQueue } from '@/hooks/useVentaOfflineQueue';
import { offlineDb, encolarVenta, encolarAperturaCaja, marcarVentaConflicto, guardarSnapshot, leerSnapshot } from '@/lib/offlineDb';

const EMPRESA_ID = '11111111-1111-1111-1111-111111111111';

// Modo Offline del POS — Fase 3. useLiveQuery hace que el hook se actualice
// solo cuando Dexie cambia (sin polling ni callbacks manuales) — se verifica
// escribiendo directo en offlineDb y esperando (waitFor) a que el hook lo refleje.
describe('useVentaOfflineQueue', () => {
  beforeEach(async () => {
    await Promise.all(offlineDb.tables.map(t => t.clear()));
  });

  it('arranca vacío: sin pendientes, cantidadPendiente=0', async () => {
    const { result } = renderHook(() => useVentaOfflineQueue(EMPRESA_ID));
    await waitFor(() => expect(result.current.ventasPendientes).toEqual([]));
    expect(result.current.cantidadPendiente).toBe(0);
  });

  it('refleja una venta encolada sin recargar (reactivo)', async () => {
    const { result } = renderHook(() => useVentaOfflineQueue(EMPRESA_ID));
    await waitFor(() => expect(result.current.ventasPendientes).toEqual([]));

    await act(() => encolarVenta(EMPRESA_ID, { payload: { p_total: 500 }, itemsSnapshot: [] }));

    await waitFor(() => expect(result.current.cantidadPendiente).toBe(1));
    expect(result.current.ventasPendientes).toHaveLength(1);
  });

  it('cuenta pendientes de venta + de apertura de caja juntos', async () => {
    await act(async () => {
      await encolarVenta(EMPRESA_ID, { payload: {}, itemsSnapshot: [] });
      await encolarAperturaCaja(EMPRESA_ID, {});
    });

    const { result } = renderHook(() => useVentaOfflineQueue(EMPRESA_ID));
    await waitFor(() => expect(result.current.cantidadPendiente).toBe(2));
  });

  it('conflictosVenta separa las que necesitan resolución manual', async () => {
    let venta;
    await act(async () => {
      venta = await encolarVenta(EMPRESA_ID, { payload: {}, itemsSnapshot: [] });
      await marcarVentaConflicto(venta.localId, 'Stock insuficiente');
    });

    const { result } = renderHook(() => useVentaOfflineQueue(EMPRESA_ID));
    await waitFor(() => expect(result.current.conflictosVenta).toHaveLength(1));
    expect(result.current.conflictosVenta[0].error).toBe('Stock insuficiente');
  });

  it('anularVentaConflicto revierte el stock local optimista y saca la venta de la cola', async () => {
    await guardarSnapshot('productos', EMPRESA_ID, [{ id: 'p1', nombre: 'Agua', stock_actual: 7 }]);
    let venta;
    await act(async () => {
      venta = await encolarVenta(EMPRESA_ID, {
        payload: {},
        itemsSnapshot: [{ id: 'p1', cantidad: 3 }],
      });
      await marcarVentaConflicto(venta.localId, 'Stock insuficiente');
    });

    const { result } = renderHook(() => useVentaOfflineQueue(EMPRESA_ID));
    await waitFor(() => expect(result.current.conflictosVenta).toHaveLength(1));

    await act(() => result.current.anularVentaConflicto(result.current.conflictosVenta[0]));

    await waitFor(() => expect(result.current.cantidadPendiente).toBe(0));
    const [p1] = await leerSnapshot('productos', EMPRESA_ID);
    expect(p1.stock_actual).toBe(10); // 7 + 3 revertido
  });
});
