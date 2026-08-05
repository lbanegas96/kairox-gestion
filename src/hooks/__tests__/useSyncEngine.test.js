import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSyncEngine } from '@/hooks/useSyncEngine';
import {
  offlineDb, encolarVenta, encolarAperturaCaja, listarVentasPendientes, listarAperturasPendientes,
} from '@/lib/offlineDb';

const mockRpc = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: { rpc: (...args) => mockRpc(...args) },
}));

const EMPRESA_ID = 'empresa-1';

// Modo Offline del POS — Fase 3. El motor de sync es la pieza de mayor
// riesgo real (toca ventas/stock/caja de verdad al reconectar) — se testea a
// fondo con RPCs mockeadas: orden cronológico, aperturas antes que ventas,
// conflictos que no frenan la cola, y el guard anti-duplicado-de-asiento.
describe('useSyncEngine', () => {
  beforeEach(async () => {
    await Promise.all(offlineDb.tables.map(t => t.clear()));
    mockRpc.mockReset();
  });

  it('sin nada pendiente: no llama ninguna RPC', async () => {
    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true }));
    await waitFor(() => expect(mockRpc).not.toHaveBeenCalled());
  });

  it('sincroniza una venta pendiente: numeración real + crear_venta + marca sincronizada', async () => {
    await encolarVenta(EMPRESA_ID, { payload: { p_total: 500 }, itemsSnapshot: [] });
    mockRpc.mockImplementation((fn) => {
      if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0010', error: null });
      if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c1', numero_venta: '0010' }, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const onVentaSincronizada = vi.fn();
    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true, onVentaSincronizada }));

    await waitFor(async () => {
      const [fila] = await offlineDb.ventasPendientes.toArray();
      expect(fila.estado).toBe('sincronizada');
    });
    const [fila] = await offlineDb.ventasPendientes.toArray();
    expect(fila.resultado).toEqual({ comprobante_id: 'c1', numero_venta: '0010' });
    expect(onVentaSincronizada).toHaveBeenCalledWith(expect.objectContaining({
      comprobante: { id: 'c1' }, saleNumber: '0010', total: 500,
    }));
  });

  it('duplicate:true (reintento de algo ya sincronizado) marca sincronizada pero NO vuelve a correr el post-proceso', async () => {
    await encolarVenta(EMPRESA_ID, { payload: { p_total: 300 }, itemsSnapshot: [] });
    mockRpc.mockImplementation((fn) => {
      if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0011', error: null });
      if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c1', numero_venta: '0011', duplicate: true }, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const onVentaSincronizada = vi.fn();
    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true, onVentaSincronizada }));

    await waitFor(async () => {
      const [fila] = await offlineDb.ventasPendientes.toArray();
      expect(fila.estado).toBe('sincronizada');
    });
    // Guard clave: evita un asiento contable duplicado en un reintento.
    expect(onVentaSincronizada).not.toHaveBeenCalled();
  });

  it('crear_venta falla (ej. stock insuficiente): marca conflicto y sigue con la siguiente venta', async () => {
    const v1 = await encolarVenta(EMPRESA_ID, { payload: { p_total: 100 }, itemsSnapshot: [] });
    await offlineDb.ventasPendientes.update(v1.localId, { creado_en: '2026-08-05T10:00:00.000Z' });
    const v2 = await encolarVenta(EMPRESA_ID, { payload: { p_total: 200 }, itemsSnapshot: [] });
    await offlineDb.ventasPendientes.update(v2.localId, { creado_en: '2026-08-05T10:00:01.000Z' });

    mockRpc.mockImplementation((fn, params) => {
      if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0020', error: null });
      if (fn === 'crear_venta') {
        if (params.p_client_uuid === v1.client_uuid) {
          return Promise.resolve({ data: null, error: { message: 'Stock insuficiente' } });
        }
        return Promise.resolve({ data: { comprobante_id: 'c2', numero_venta: '0020' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true }));

    await waitFor(async () => {
      const filas = await offlineDb.ventasPendientes.toArray();
      expect(filas.every(f => f.estado !== 'pendiente')).toBe(true);
    });
    const filas = await offlineDb.ventasPendientes.toArray();
    const f1 = filas.find(f => f.localId === v1.localId);
    const f2 = filas.find(f => f.localId === v2.localId);
    expect(f1.estado).toBe('conflicto');
    expect(f1.error).toBe('Stock insuficiente');
    expect(f2.estado).toBe('sincronizada'); // el conflicto de v1 no frenó a v2
  });

  it('sincroniza en orden cronológico (viejo primero) — importa para la numeración correlativa', async () => {
    const v1 = await encolarVenta(EMPRESA_ID, { payload: { p_total: 1 }, itemsSnapshot: [] });
    await offlineDb.ventasPendientes.update(v1.localId, { creado_en: '2026-08-05T09:00:02.000Z' });
    const v2 = await encolarVenta(EMPRESA_ID, { payload: { p_total: 2 }, itemsSnapshot: [] });
    await offlineDb.ventasPendientes.update(v2.localId, { creado_en: '2026-08-05T09:00:01.000Z' }); // más viejo que v1

    const ordenLlamado = [];
    mockRpc.mockImplementation((fn, params) => {
      if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0030', error: null });
      if (fn === 'crear_venta') {
        ordenLlamado.push(params.p_client_uuid);
        return Promise.resolve({ data: { comprobante_id: 'c-' + params.p_client_uuid, numero_venta: '0030' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true }));

    await waitFor(() => expect(ordenLlamado).toHaveLength(2));
    expect(ordenLlamado).toEqual([v2.client_uuid, v1.client_uuid]); // v2 es más viejo → primero
  });

  it('apertura de caja pendiente se sincroniza antes que la venta que depende de ella', async () => {
    const apertura = await encolarAperturaCaja(EMPRESA_ID, { p_caja_id: 'caja-1', p_monto_inicial: 1000 });
    const venta = await offlineDb.ventasPendientes.add({
      empresa_id: EMPRESA_ID, client_uuid: 'venta-uuid-1', estado: 'pendiente',
      creado_en: new Date().toISOString(), numero_provisorio: 'OFFLINE-1',
      caja_sesion_id: null, caja_sesion_client_uuid: apertura.client_uuid,
      payload: { p_total: 50 }, itemsSnapshot: [], resultado: null, error: null,
    });

    mockRpc.mockImplementation((fn, params) => {
      if (fn === 'abrir_caja_sesion') return Promise.resolve({ data: { sesion_id: 'sesion-real-1', duplicate: false, conflict: false }, error: null });
      if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0040', error: null });
      if (fn === 'crear_venta') {
        expect(params.p_caja_sesion_id).toBe('sesion-real-1'); // se resolvió antes de vender
        return Promise.resolve({ data: { comprobante_id: 'c1', numero_venta: '0040' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true }));

    await waitFor(async () => {
      const filaVenta = await offlineDb.ventasPendientes.get(venta);
      expect(filaVenta.estado).toBe('sincronizada');
    });
  });

  it('apertura ya sincronizada en una corrida anterior resuelve una venta nueva en ésta (reconexión intermitente)', async () => {
    // Simula: la apertura sincronizó en un intento previo (queda 'sincronizada'
    // con resultado.sesion_id) pero la conexión se cortó antes de sincronizar
    // sus ventas dependientes.
    const apertura = await encolarAperturaCaja(EMPRESA_ID, {});
    await offlineDb.cajaSesionesPendientes.update(apertura.localId, {
      estado: 'sincronizada', resultado: { sesion_id: 'sesion-vieja-1' },
    });
    const venta = await offlineDb.ventasPendientes.add({
      empresa_id: EMPRESA_ID, client_uuid: 'venta-uuid-2', estado: 'pendiente',
      creado_en: new Date().toISOString(), numero_provisorio: 'OFFLINE-2',
      caja_sesion_id: null, caja_sesion_client_uuid: apertura.client_uuid,
      payload: { p_total: 80 }, itemsSnapshot: [], resultado: null, error: null,
    });

    mockRpc.mockImplementation((fn, params) => {
      if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0050', error: null });
      if (fn === 'crear_venta') {
        expect(params.p_caja_sesion_id).toBe('sesion-vieja-1');
        return Promise.resolve({ data: { comprobante_id: 'c1', numero_venta: '0050' }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true }));

    await waitFor(async () => {
      const filaVenta = await offlineDb.ventasPendientes.get(venta);
      expect(filaVenta.estado).toBe('sincronizada');
    });
    // La RPC abrir_caja_sesion no debía llamarse de nuevo (ya estaba sincronizada).
    expect(mockRpc).not.toHaveBeenCalledWith('abrir_caja_sesion', expect.anything());
  });

  it('apertura en conflicto: la venta que depende de ella queda pendiente, no se intenta vender', async () => {
    const apertura = await encolarAperturaCaja(EMPRESA_ID, {});
    await offlineDb.ventasPendientes.add({
      empresa_id: EMPRESA_ID, client_uuid: 'venta-uuid-3', estado: 'pendiente',
      creado_en: new Date().toISOString(), numero_provisorio: 'OFFLINE-3',
      caja_sesion_id: null, caja_sesion_client_uuid: apertura.client_uuid,
      payload: { p_total: 10 }, itemsSnapshot: [], resultado: null, error: null,
    });

    mockRpc.mockImplementation((fn) => {
      if (fn === 'abrir_caja_sesion') return Promise.resolve({ data: { conflict: true, sesion_id: 'otra-sesion' }, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true }));

    await waitFor(async () => {
      const filaApertura = (await listarAperturasPendientes(EMPRESA_ID))[0];
      expect(filaApertura.estado).toBe('conflicto');
    });
    // crear_venta nunca debía llamarse — la venta sigue esperando.
    expect(mockRpc).not.toHaveBeenCalledWith('crear_venta', expect.anything());
    const [filaVenta] = await listarVentasPendientes(EMPRESA_ID);
    expect(filaVenta.estado).toBe('pendiente');
  });

  it('no corre si isOnline es false', async () => {
    await encolarVenta(EMPRESA_ID, { payload: { p_total: 1 }, itemsSnapshot: [] });
    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: false }));
    await new Promise(r => setTimeout(r, 50));
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('corre también al montar si ya arranca online (no sólo en la transición)', async () => {
    await encolarVenta(EMPRESA_ID, { payload: { p_total: 1 }, itemsSnapshot: [] });
    mockRpc.mockImplementation((fn) => {
      if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0060', error: null });
      if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c1', numero_venta: '0060' }, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledWith('crear_venta', expect.anything()));
  });

  it('sincronizarAhora (botón manual) no corre dos veces en paralelo (lock isSyncing)', async () => {
    await encolarVenta(EMPRESA_ID, { payload: { p_total: 1 }, itemsSnapshot: [] });
    let resolverNumero;
    const numeroPromise = new Promise(r => { resolverNumero = r; });
    let llamadasNumero = 0;
    mockRpc.mockImplementation((fn) => {
      if (fn === 'obtener_proximo_numero') { llamadasNumero += 1; return numeroPromise; }
      if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c1', numero_venta: '0070' }, error: null });
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useSyncEngine({ empresaId: EMPRESA_ID, isOnline: true }));
    await waitFor(() => expect(llamadasNumero).toBe(1)); // la corrida del mount ya está "colgada" en el número

    // Un segundo disparo manual mientras la primera sigue en vuelo no debe sumar otra llamada.
    await act(async () => { await result.current.sincronizarAhora(); });
    expect(llamadasNumero).toBe(1);

    await act(async () => { resolverNumero({ data: '0070', error: null }); });
    await waitFor(async () => {
      const [fila] = await offlineDb.ventasPendientes.toArray();
      expect(fila.estado).toBe('sincronizada');
    });
  });
});
