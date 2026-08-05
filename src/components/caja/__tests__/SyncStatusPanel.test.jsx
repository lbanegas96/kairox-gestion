import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import SyncStatusPanel from '@/components/caja/SyncStatusPanel';
import { offlineDb, encolarVenta, marcarVentaConflicto, guardarSnapshot, leerSnapshot } from '@/lib/offlineDb';

const EMPRESA_ID = 'empresa-1';

// Modo Offline del POS — Fase 3. SyncStatusPanel + SyncConflictModal usan la
// cola real (Dexie, vía useVentaOfflineQueue) — se testea contra datos reales
// en vez de mockear el hook, para probar también la integración.
describe('SyncStatusPanel', () => {
  beforeEach(async () => {
    await Promise.all(offlineDb.tables.map(t => t.clear()));
  });

  it('no muestra nada si no hay pendientes', async () => {
    render(<SyncStatusPanel empresaId={EMPRESA_ID} />);
    await act(async () => {});
    expect(screen.queryByText(/sin sincronizar/)).toBeNull();
  });

  it('muestra el badge con el conteo cuando hay una venta pendiente', async () => {
    await encolarVenta(EMPRESA_ID, { payload: { p_total: 100 }, itemsSnapshot: [] });
    render(<SyncStatusPanel empresaId={EMPRESA_ID} />);
    await waitFor(() => expect(screen.getByText('1 sin sincronizar')).toBeTruthy());
  });

  it('abre el modal con el detalle al hacer click', async () => {
    const fila = await encolarVenta(EMPRESA_ID, { payload: { p_total: 250 }, itemsSnapshot: [] });
    render(<SyncStatusPanel empresaId={EMPRESA_ID} />);
    await waitFor(() => screen.getByText('1 sin sincronizar'));

    fireEvent.click(screen.getByText('1 sin sincronizar'));
    expect(screen.getByText(fila.numero_provisorio)).toBeTruthy();
    expect(screen.getByText('Esperando conexión')).toBeTruthy();
  });

  it('un conflicto se ve distinto y permite anular, revirtiendo el stock local', async () => {
    await guardarSnapshot('productos', EMPRESA_ID, [{ id: 'p1', nombre: 'Agua', stock_actual: 5 }]);
    const fila = await encolarVenta(EMPRESA_ID, {
      payload: { p_total: 100 }, itemsSnapshot: [{ id: 'p1', cantidad: 2 }],
    });
    await marcarVentaConflicto(fila.localId, 'Stock insuficiente al sincronizar');

    render(<SyncStatusPanel empresaId={EMPRESA_ID} />);
    await waitFor(() => screen.getByText('1 sin sincronizar'));
    fireEvent.click(screen.getByText('1 sin sincronizar'));

    expect(screen.getByText('Conflicto')).toBeTruthy();
    expect(screen.getByText('Stock insuficiente al sincronizar')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Anular venta'));
    });

    await waitFor(() => expect(screen.queryByText(/sin sincronizar/)).toBeNull());
    const [p1] = await leerSnapshot('productos', EMPRESA_ID);
    expect(p1.stock_actual).toBe(7); // 5 + 2 revertido
  });

  it('el botón "Reintentar ahora" llama a onSincronizarAhora', async () => {
    await encolarVenta(EMPRESA_ID, { payload: { p_total: 100 }, itemsSnapshot: [] });
    const onSincronizarAhora = vi.fn().mockResolvedValue();
    render(<SyncStatusPanel empresaId={EMPRESA_ID} onSincronizarAhora={onSincronizarAhora} />);
    await waitFor(() => screen.getByText('1 sin sincronizar'));

    fireEvent.click(screen.getByText('1 sin sincronizar'));
    await act(async () => {
      fireEvent.click(screen.getByText('Reintentar ahora'));
    });
    expect(onSincronizarAhora).toHaveBeenCalled();
  });
});
