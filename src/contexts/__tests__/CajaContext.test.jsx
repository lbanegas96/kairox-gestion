import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { CajaProvider, useCaja } from '@/contexts/CajaContext';
import { offlineDb, encolarVenta, listarAperturasPendientes } from '@/lib/offlineDb';

const mockFrom = vi.fn();
const mockRpc = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    from: (...args) => mockFrom(...args),
    rpc: (...args) => mockRpc(...args),
  },
}));

let mockIsOnline = true;
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

const EMPRESA_ID = 'empresa-1';
const mockUser = { id: 'user-1', empresa_id: EMPRESA_ID };
vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

const CAJA = { id: 'caja-1', empresa_id: EMPRESA_ID, activo: true };

// Helper: arma el mock de supabase.from() encadenado tal como lo usa
// CajaContext.jsx (.select().eq()...maybeSingle()/.single()/.insert()...).
function chainResolve(finalValue) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    update: () => chain,
    insert: () => chain,
    maybeSingle: () => Promise.resolve(finalValue),
    single: () => Promise.resolve(finalValue),
    then: (resolve) => resolve(finalValue), // por si algo hace await directo sobre el builder
  };
  return chain;
}

const wrapper = ({ children }) => <CajaProvider>{children}</CajaProvider>;

// Modo Offline del POS — Fase 3. CajaContext es la pieza que decide si el
// cajero puede seguir vendiendo Efectivo sin conexión (isSessionOpen) y si
// puede cerrar el turno (bloqueado con cola pendiente) — se testea a fondo.
describe('CajaContext', () => {
  beforeEach(async () => {
    await Promise.all(offlineDb.tables.map(t => t.clear()));
    mockFrom.mockReset();
    mockRpc.mockReset();
    mockIsOnline = true;
    // Por defecto: no hay caja ni sesión abierta del lado del servidor.
    mockFrom.mockImplementation((tabla) => {
      if (tabla === 'cajas') return chainResolve({ data: [CAJA], error: null });
      if (tabla === 'caja_sesiones') return chainResolve({ data: null, error: null });
      return chainResolve({ data: null, error: null });
    });
  });

  it('openSession online: llama abrir_caja_sesion y deja la sesión real abierta', async () => {
    // Simula el estado real del servidor: no hay sesión abierta hasta que la
    // RPC abrir_caja_sesion "la crea" — si el mock devolviera la sesión real
    // desde el arranque, el fetch inicial (al montar) ya vería la caja
    // abierta y openSession fallaría con "ya existe una caja abierta".
    let sesionServidor = null;
    mockRpc.mockImplementation((fn, params) => {
      if (fn === 'abrir_caja_sesion') {
        sesionServidor = { id: 'sesion-real-1', estado: 'abierta', caja_id: params.p_caja_id };
        return Promise.resolve({ data: { sesion_id: 'sesion-real-1', duplicate: false, conflict: false }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
    mockFrom.mockImplementation((tabla) => {
      if (tabla === 'cajas') return chainResolve({ data: [CAJA], error: null });
      if (tabla === 'caja_sesiones') return chainResolve({ data: sesionServidor, error: null });
      return chainResolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useCaja(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok;
    await act(async () => { ok = await result.current.openSession('1000'); });

    expect(ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('abrir_caja_sesion', expect.objectContaining({
      p_caja_id: 'caja-1', p_monto_inicial: 1000,
    }));
    expect(result.current.isSessionOpen).toBe(true);
    expect(result.current.currentSession.id).toBe('sesion-real-1');
    expect(result.current.currentSession._pendingSync).toBeUndefined();
  });

  it('openSession online con conflict:true: no abre localmente, refresca la sesión que ganó', async () => {
    mockRpc.mockResolvedValue({ data: { conflict: true, sesion_id: 'sesion-de-otro' }, error: null });

    const { result } = renderHook(() => useCaja(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok;
    await act(async () => { ok = await result.current.openSession('1000'); });
    expect(ok).toBe(false);
  });

  it('openSession offline: encola en Dexie y deja una sesión local _pendingSync', async () => {
    mockIsOnline = false;
    const { result } = renderHook(() => useCaja(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok;
    await act(async () => { ok = await result.current.openSession('500'); });

    expect(ok).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(result.current.isSessionOpen).toBe(true);
    expect(result.current.currentSession._pendingSync).toBe(true);
    expect(result.current.currentSession.client_uuid).toBeTruthy();

    const pendientes = await listarAperturasPendientes(EMPRESA_ID);
    expect(pendientes).toHaveLength(1);
    expect(pendientes[0].payload.p_monto_inicial).toBe(500);
  });

  it('fetchCurrentSession (ej. al recargar la página offline) restaura una apertura encolada como sesión pendiente', async () => {
    // Simula: la caja se abrió offline en una sesión de la app anterior; ahora
    // se "recarga" (nuevo montaje de CajaProvider) y no hay sesión real —
    // Dexie sigue teniendo la apertura pendiente.
    mockIsOnline = false;
    const { result: r1 } = renderHook(() => useCaja(), { wrapper });
    await waitFor(() => expect(r1.current.loading).toBe(false));
    await act(async () => { await r1.current.openSession('700'); });

    // "Recarga": un nuevo montaje del provider, mismo Dexie de fondo.
    const { result: r2 } = renderHook(() => useCaja(), { wrapper });
    await waitFor(() => expect(r2.current.isSessionOpen).toBe(true));
    expect(r2.current.currentSession._pendingSync).toBe(true);
    expect(r2.current.currentSession.monto_inicial).toBe(700);
  });

  describe('multi-caja', () => {
    const CAJA_2 = { id: 'caja-2', empresa_id: EMPRESA_ID, activo: true };

    it('con 2+ cajas activas y ninguna elegida en este dispositivo, expone needsCajaSelection sin auto-seleccionar', async () => {
      mockFrom.mockImplementation((tabla) => {
        if (tabla === 'cajas') return chainResolve({ data: [CAJA, CAJA_2], error: null });
        return chainResolve({ data: null, error: null });
      });

      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.needsCajaSelection).toBe(true);
      expect(result.current.activeCaja).toBeNull();
      expect(result.current.availableCajas).toHaveLength(2);
    });

    it('selectCaja persiste la elección en localStorage y resuelve la sesión de esa caja', async () => {
      localStorage.removeItem(`kx_caja_activa_${EMPRESA_ID}`);
      mockFrom.mockImplementation((tabla) => {
        if (tabla === 'cajas') return chainResolve({ data: [CAJA, CAJA_2], error: null });
        if (tabla === 'caja_sesiones') return chainResolve({ data: null, error: null });
        return chainResolve({ data: null, error: null });
      });

      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.needsCajaSelection).toBe(true));

      act(() => { result.current.selectCaja('caja-2'); });

      await waitFor(() => expect(result.current.needsCajaSelection).toBe(false));
      expect(result.current.activeCaja.id).toBe('caja-2');
      expect(localStorage.getItem(`kx_caja_activa_${EMPRESA_ID}`)).toBe('caja-2');
    });

    it('con una elección guardada inválida (caja desactivada/borrada), vuelve a pedir selección', async () => {
      localStorage.setItem(`kx_caja_activa_${EMPRESA_ID}`, 'caja-inexistente');
      mockFrom.mockImplementation((tabla) => {
        if (tabla === 'cajas') return chainResolve({ data: [CAJA, CAJA_2], error: null });
        return chainResolve({ data: null, error: null });
      });

      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.needsCajaSelection).toBe(true);
      expect(result.current.activeCaja).toBeNull();
    });
  });

  // Bug real de producción (07/08, pruebas de Nadia): un intento de "abrir
  // caja sin conexión" quedaba encolado y abandonado (el cajero después
  // terminaba abriendo la caja de nuevo ya con internet). El poll periódico
  // de fetchCurrentSession podía "resucitar" esa apertura vieja mientras
  // estaba offline y pisar la sesión real en memoria — dejando cualquier
  // venta posterior varada, sin forma de sincronizar sola nunca.
  describe('reconciliación de aperturas offline viejas (bug real de producción, 07/08)', () => {
    it('openSession online reconcilia una apertura vieja de la misma caja y las ventas que dependían de ella', async () => {
      const vieja = await offlineDb.cajaSesionesPendientes.add({
        empresa_id: EMPRESA_ID, client_uuid: 'client-uuid-vieja', estado: 'pendiente',
        creado_en: new Date().toISOString(),
        payload: { p_caja_id: 'caja-1', p_monto_inicial: 999 },
        resultado: null, error: null,
      });
      const venta = await encolarVenta(EMPRESA_ID, {
        payload: { p_total: 500 }, itemsSnapshot: [],
        cajaSesionClientUuid: 'client-uuid-vieja',
      });

      mockRpc.mockResolvedValue({ data: { sesion_id: 'sesion-real-1', duplicate: false, conflict: false }, error: null });
      mockFrom.mockImplementation((tabla) => {
        if (tabla === 'cajas') return chainResolve({ data: [CAJA], error: null });
        if (tabla === 'caja_sesiones') return chainResolve({ data: { id: 'sesion-real-1', estado: 'abierta' }, error: null });
        return chainResolve({ data: null, error: null });
      });

      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => { await result.current.openSession('1000'); });

      const filaVieja = await offlineDb.cajaSesionesPendientes.get(vieja);
      expect(filaVieja.estado).toBe('sincronizada');
      expect(filaVieja.resultado).toEqual({ sesion_id: 'sesion-real-1', reconciliada: true });

      const filaVenta = await offlineDb.ventasPendientes.get(venta.localId);
      expect(filaVenta.caja_sesion_id).toBe('sesion-real-1');
      expect(filaVenta.caja_sesion_client_uuid).toBeNull();
    });

    it('fetchCurrentSession NO pisa una sesión real en memoria con una apertura vieja mientras está offline', async () => {
      // El mock de caja_sesiones simula una falla de red real (lo que hace
      // supabase-js si de verdad no hay conexión) cuando mockIsOnline=false —
      // así se puede reproducir el poll periódico fallando en el momento
      // justo, en vez de simplemente no simular nada.
      mockRpc.mockResolvedValue({ data: { sesion_id: 'sesion-real-1', duplicate: false, conflict: false }, error: null });
      mockFrom.mockImplementation((tabla) => {
        if (tabla === 'cajas') return chainResolve({ data: [CAJA], error: null });
        if (tabla === 'caja_sesiones') {
          if (!mockIsOnline) return chainResolve({ data: null, error: { message: 'Failed to fetch' } });
          return chainResolve({ data: { id: 'sesion-real-1', estado: 'abierta' }, error: null });
        }
        return chainResolve({ data: null, error: null });
      });

      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => { await result.current.openSession('1000'); });
      expect(result.current.currentSession.id).toBe('sesion-real-1');

      // Aparece una apertura vieja pendiente en Dexie para la MISMA caja
      // (simula el intento abandonado que Nadia encontró), y se corta la red.
      await offlineDb.cajaSesionesPendientes.add({
        empresa_id: EMPRESA_ID, client_uuid: 'client-uuid-vieja', estado: 'pendiente',
        creado_en: new Date().toISOString(),
        payload: { p_caja_id: 'caja-1', p_monto_inicial: 1 },
        resultado: null, error: null,
      });
      mockIsOnline = false;

      // Mismo código que corre cada 30s (setInterval) — sin red, no puede
      // reconfirmar la sesión real.
      await act(async () => { await result.current.refreshSession(); });

      expect(result.current.currentSession.id).toBe('sesion-real-1');
      expect(result.current.currentSession._pendingSync).toBeUndefined();
    });

    it('sin sesión real en memoria todavía (mount offline en frío), sí recupera la apertura pendiente de Dexie', async () => {
      // Contraprueba del guard: el guard sólo protege una sesión YA
      // confirmada — si nunca hubo ninguna (primer montaje offline), el
      // fallback de recuperación original sigue funcionando como siempre.
      mockIsOnline = false;
      await offlineDb.cajaSesionesPendientes.add({
        empresa_id: EMPRESA_ID, client_uuid: 'client-uuid-vieja', estado: 'pendiente',
        creado_en: new Date().toISOString(),
        payload: {
          p_caja_id: 'caja-1', p_user_id: 'user-1', p_monto_inicial: 321,
          p_apertura_fecha: '2026-08-07T10:00:00.000Z',
        },
        resultado: null, error: null,
      });

      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.isSessionOpen).toBe(true));
      expect(result.current.currentSession._pendingSync).toBe(true);
      expect(result.current.currentSession.monto_inicial).toBe(321);
    });
  });

  describe('closeSession', () => {
    it('bloqueado si hay ventas pendientes de sincronizar', async () => {
      await encolarVenta(EMPRESA_ID, { payload: { p_total: 100 }, itemsSnapshot: [] });
      mockFrom.mockImplementation((tabla) => {
        if (tabla === 'cajas') return chainResolve({ data: [CAJA], error: null });
        if (tabla === 'caja_sesiones') return chainResolve({ data: { id: 'sesion-1', estado: 'abierta' }, error: null });
        return chainResolve({ data: null, error: null });
      });

      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.isSessionOpen).toBe(true));

      let ok;
      await act(async () => { ok = await result.current.closeSession(1000, '', 1000, 0); });
      expect(ok).toBe(false);
      expect(result.current.isSessionOpen).toBe(true); // sigue abierta, no se tocó
    });

    it('bloqueado si la propia sesión todavía no se sincronizó (_pendingSync)', async () => {
      mockIsOnline = false;
      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.loading).toBe(false));
      await act(async () => { await result.current.openSession('500'); });
      expect(result.current.currentSession._pendingSync).toBe(true);

      let ok;
      await act(async () => { ok = await result.current.closeSession(500, '', 500, 0); });
      expect(ok).toBe(false);
    });

    it('cierra normalmente cuando no hay nada pendiente', async () => {
      const mockUpdate = vi.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
      mockFrom.mockImplementation((tabla) => {
        if (tabla === 'cajas') return chainResolve({ data: [CAJA], error: null });
        if (tabla === 'caja_sesiones') {
          return { ...chainResolve({ data: { id: 'sesion-1', estado: 'abierta' }, error: null }), update: mockUpdate };
        }
        return chainResolve({ data: null, error: null });
      });

      const { result } = renderHook(() => useCaja(), { wrapper });
      await waitFor(() => expect(result.current.isSessionOpen).toBe(true));

      let ok;
      await act(async () => { ok = await result.current.closeSession(1000, '', 1000, 0); });
      expect(ok).toBe(true);
      expect(result.current.isSessionOpen).toBe(false);
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ estado: 'cerrada' }));
    });
  });
});
