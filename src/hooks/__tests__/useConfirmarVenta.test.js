import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmarVenta } from '@/hooks/useConfirmarVenta';
import { offlineDb, leerSnapshot, guardarSnapshot } from '@/lib/offlineDb';

// customSupabaseClient.js tira si faltan VITE_SUPABASE_URL/ANON_KEY — se mockea
// entero, mismo patrón que el resto de los tests de hooks de este proyecto.
const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    rpc: (...args) => mockRpc(...args),
    from: (...args) => mockFrom(...args),
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

let mockCajaState = { isSessionOpen: true, currentSession: { id: 'sesion-1' } };
vi.mock('@/contexts/CajaContext', () => ({
  useCaja: () => mockCajaState,
}));

let mockAfipState = { afipConfig: null, afipActivo: false, determinarTipoComprobante: () => 'B' };
vi.mock('@/hooks/useAfipConfig', () => ({
  useAfipConfig: () => mockAfipState,
}));

const mockCrearAsiento = vi.fn().mockResolvedValue({});
vi.mock('@/services/planCuentasService', () => ({
  asientosAutoService: { crearAsientoVenta: (...args) => mockCrearAsiento(...args) },
}));

const CART = [{ id: 'p1', nombre: 'Agua', precio_venta: 100, cantidad: 2, alicuota_iva: '21' }];
const PAGOS_EFECTIVO = [{ metodo: 'Efectivo', monto: 200 }];

// Modo Offline del POS — Fase 3. El camino online debe quedar exactamente
// igual que antes del refactor (mismas RPC, mismo orden); el camino offline
// es la rama nueva: encolar en vez de golpear al servidor.
describe('useConfirmarVenta', () => {
  beforeEach(async () => {
    await Promise.all(offlineDb.tables.map(t => t.clear()));
    mockRpc.mockReset();
    mockFrom.mockReset();
    mockCrearAsiento.mockClear();
    mockIsOnline = true;
    mockCajaState = { isSessionOpen: true, currentSession: { id: 'sesion-1' } };
    mockAfipState = { afipConfig: null, afipActivo: false, determinarTipoComprobante: () => 'B' };
  });

  describe('camino online (sin cambios de comportamiento)', () => {
    it('llama obtener_proximo_numero y después crear_venta, devuelve el comprobante real', async () => {
      mockRpc.mockImplementation((fn) => {
        if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0001', error: null });
        if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c1', numero_venta: '0001' }, error: null });
        return Promise.resolve({ data: null, error: null });
      });
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({ cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO });
      });
      expect(venta.id).toBe('c1');
      expect(venta.numero_venta).toBe('0001');
      expect(venta._offline).toBeUndefined();
      expect(mockRpc).toHaveBeenCalledWith('obtener_proximo_numero', expect.any(Object));
      expect(mockRpc).toHaveBeenCalledWith('crear_venta', expect.objectContaining({ p_numero_venta: '0001' }));
      // No debe tocar la cola offline para nada.
      expect(await offlineDb.ventasPendientes.count()).toBe(0);
    });

    it('llama finalizarVentaPosterior (asiento contable) con los datos del RPC', async () => {
      mockRpc.mockImplementation((fn) => {
        if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0002', error: null });
        if (fn === 'crear_venta') return Promise.resolve({
          data: { comprobante_id: 'c2', numero_venta: '0002', neto_gravado: 165, iva_discriminado: 35 }, error: null,
        });
        return Promise.resolve({ data: null, error: null });
      });
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      await act(async () => {
        await result.current.confirmar({ cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO });
      });
      expect(mockCrearAsiento).toHaveBeenCalledWith(EMPRESA_ID, 'user-1', expect.objectContaining({
        ventaId: 'c2', total: 200, neto: 165, iva: 35,
      }));
    });

    it('afipActivo=true: encola la factura a ARCA vía update de comprobantes', async () => {
      mockAfipState = {
        afipConfig: { condicion_iva: 'RI', punto_venta: { id: 'pdv-1' } },
        afipActivo: true,
        determinarTipoComprobante: () => 'B',
      };
      mockRpc.mockImplementation((fn) => {
        if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0003', error: null });
        if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c3', numero_venta: '0003' }, error: null });
        return Promise.resolve({ data: null, error: null });
      });
      const mockEq = vi.fn().mockReturnValue({ then: (cb) => cb({ error: null }) });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
      mockFrom.mockReturnValue({ update: mockUpdate });

      const { result } = renderHook(() => useConfirmarVenta(null, []));
      await act(async () => {
        await result.current.confirmar({ cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO });
      });
      expect(mockFrom).toHaveBeenCalledWith('comprobantes');
      expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ cae_estado: 'pendiente', punto_venta_id: 'pdv-1' }));
    });
  });

  describe('fidelización por puntos (Fase 2)', () => {
    it('propaga puntos_ganados del RPC al comprobante devuelto', async () => {
      mockRpc.mockImplementation((fn) => {
        if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0004', error: null });
        if (fn === 'crear_venta') return Promise.resolve({
          data: { comprobante_id: 'c4', numero_venta: '0004', puntos_ganados: 2 }, error: null,
        });
        return Promise.resolve({ data: null, error: null });
      });
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({
          cart: CART, selectedClient: { id: 'cli-1', nombre: 'Juan Pérez' }, pagos: PAGOS_EFECTIVO,
        });
      });
      expect(venta.puntos_ganados).toBe(2);
    });

    it('sin fidelización activa (RPC no manda el campo) queda en 0, no undefined', async () => {
      mockRpc.mockImplementation((fn) => {
        if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0005', error: null });
        if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c5', numero_venta: '0005' }, error: null });
        return Promise.resolve({ data: null, error: null });
      });
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({ cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO });
      });
      expect(venta.puntos_ganados).toBe(0);
    });
  });

  describe('fidelización — canje de puntos (Fase 3)', () => {
    const CLIENTE = { id: 'cli-1', nombre: 'Juan Pérez' };

    it('resta el descuento del total y manda p_puntos_canjeados a crear_venta', async () => {
      mockRpc.mockImplementation((fn) => {
        if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0006', error: null });
        if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c6', numero_venta: '0006' }, error: null });
        return Promise.resolve({ data: null, error: null });
      });
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        // CART = $200 (ver arriba). Canjea 20 puntos a $5 c/u = $100 de descuento.
        venta = await result.current.confirmar({
          cart: CART, selectedClient: CLIENTE, pagos: PAGOS_EFECTIVO,
          puntosCanjeados: 20, descuentoPuntosPesos: 100,
        });
      });
      expect(venta.total).toBe(100); // 200 - 100
      expect(mockRpc).toHaveBeenCalledWith('crear_venta', expect.objectContaining({
        p_total: 100, p_puntos_canjeados: 20,
      }));
      expect(venta.puntos_canjeados).toBe(20);
      expect(venta.descuento_puntos_pesos).toBe(100);
    });

    it('reparte el descuento proporcionalmente entre los ítems (bug real de IVA/asiento, 07/08)', async () => {
      // Sin esto, crear_venta calculaba neto_gravado/iva_discriminado sobre el
      // precio SIN el descuento de puntos (suma directo de p_items) — el
      // asiento contable automático quedaba desbalanceado por el monto del
      // canje. Fix: cada item se manda ya con el descuento adentro, mismo
      // criterio fiscal que las ofertas.
      let itemsEnviados;
      mockRpc.mockImplementation((fn, args) => {
        if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0008', error: null });
        if (fn === 'crear_venta') {
          itemsEnviados = args.p_items;
          return Promise.resolve({ data: { comprobante_id: 'c8', numero_venta: '0008' }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      });
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      await act(async () => {
        // CART = 1 item de $100 x 2 = $200. Canjea 20 puntos = $100 de descuento
        // → factor 0.5. El item tiene que llegar a mitad de precio.
        await result.current.confirmar({
          cart: CART, selectedClient: CLIENTE, pagos: PAGOS_EFECTIVO,
          puntosCanjeados: 20, descuentoPuntosPesos: 100,
        });
      });
      expect(itemsEnviados).toHaveLength(1);
      expect(itemsEnviados[0].precio_unitario).toBe(50); // 100 * 0.5
      expect(itemsEnviados[0].subtotal).toBe(100);        // 50 * 2 — suma exacto al p_total (100)
      // precio_original NO se toca — sigue siendo el precio de lista real,
      // el descuento por puntos vive aparte (movimientos_puntos + el ticket).
      expect(itemsEnviados[0].precio_original).toBe(100);
    });

    it('sin canje (default): manda p_puntos_canjeados: 0 y no toca el total', async () => {
      mockRpc.mockImplementation((fn) => {
        if (fn === 'obtener_proximo_numero') return Promise.resolve({ data: '0007', error: null });
        if (fn === 'crear_venta') return Promise.resolve({ data: { comprobante_id: 'c7', numero_venta: '0007' }, error: null });
        return Promise.resolve({ data: null, error: null });
      });
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({ cart: CART, selectedClient: CLIENTE, pagos: PAGOS_EFECTIVO });
      });
      expect(venta.total).toBe(200);
      expect(mockRpc).toHaveBeenCalledWith('crear_venta', expect.objectContaining({ p_puntos_canjeados: 0 }));
    });

    it('rechaza canjear sin conexión, sin llamar al servidor (defensivo — la UI ya lo oculta)', async () => {
      mockIsOnline = false;
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({
          cart: CART, selectedClient: CLIENTE, pagos: [{ metodo: 'Efectivo', monto: 100 }],
          puntosCanjeados: 20, descuentoPuntosPesos: 100,
        });
      });
      expect(venta).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rechaza canjear sin cliente asociado (defensivo)', async () => {
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({
          cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO,
          puntosCanjeados: 20, descuentoPuntosPesos: 100,
        });
      });
      expect(venta).toBeNull();
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  describe('camino offline (Fase 3)', () => {
    it('encola la venta en vez de llamar al servidor — ninguna RPC de red', async () => {
      mockIsOnline = false;
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({ cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO });
      });
      expect(venta._offline).toBe(true);
      expect(venta.numero_venta).toMatch(/^OFFLINE-\d+$/);
      expect(venta.cae_estado).toBe('no_aplica');
      expect(mockRpc).not.toHaveBeenCalled();

      const pendientes = await offlineDb.ventasPendientes.toArray();
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0].payload.p_total).toBe(200);
      expect(pendientes[0].payload.p_numero_venta).toBeUndefined();
    });

    it('decrementa el stock local optimista del snapshot (Fase 2)', async () => {
      mockIsOnline = false;
      await guardarSnapshot('productos', EMPRESA_ID, [{ id: 'p1', nombre: 'Agua', stock_actual: 10 }]);
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      await act(async () => {
        await result.current.confirmar({ cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO });
      });
      const [p1] = await leerSnapshot('productos', EMPRESA_ID);
      expect(p1.stock_actual).toBe(8); // 10 - 2
    });

    it('Transferencia también se encola offline (mismo criterio que Efectivo)', async () => {
      mockIsOnline = false;
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({
          cart: CART, selectedClient: null, pagos: [{ metodo: 'Transferencia', monto: 200 }],
        });
      });
      expect(venta._offline).toBe(true);
    });

    it('rechaza (defensivo) un medio de pago que no sea Efectivo/Transferencia', async () => {
      mockIsOnline = false;
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      let venta;
      await act(async () => {
        venta = await result.current.confirmar({
          cart: CART, selectedClient: null, pagos: [{ metodo: 'Tarjeta Débito', monto: 200 }],
        });
      });
      expect(venta).toBeNull();
      expect(await offlineDb.ventasPendientes.count()).toBe(0);
    });

    it('usa el client_uuid de la sesión pendiente cuando la apertura de caja también está encolada', async () => {
      mockIsOnline = false;
      mockCajaState = {
        isSessionOpen: true,
        currentSession: { id: null, client_uuid: 'sesion-client-uuid-1', _pendingSync: true },
      };
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      await act(async () => {
        await result.current.confirmar({ cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO });
      });
      const [fila] = await offlineDb.ventasPendientes.toArray();
      expect(fila.caja_sesion_id).toBeNull();
      expect(fila.caja_sesion_client_uuid).toBe('sesion-client-uuid-1');
    });

    it('no llama a finalizarVentaPosterior (asiento/AFIP) — eso corre recién al sincronizar', async () => {
      mockIsOnline = false;
      mockAfipState = {
        afipConfig: { condicion_iva: 'RI', punto_venta: { id: 'pdv-1' } },
        afipActivo: true,
        determinarTipoComprobante: () => 'B',
      };
      const { result } = renderHook(() => useConfirmarVenta(null, []));
      await act(async () => {
        await result.current.confirmar({ cart: CART, selectedClient: null, pagos: PAGOS_EFECTIVO });
      });
      expect(mockCrearAsiento).not.toHaveBeenCalled();
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });
});
