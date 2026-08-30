import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFinalizarVentaPosterior } from '@/hooks/useFinalizarVentaPosterior';

const mockFrom = vi.fn();
// dispararArcaWorker (src/lib/afipQueue.js, 29/08) llama supabase.functions.invoke
// tras encolar — mock resuelto para que el fire-and-forget no explote acá.
const mockInvoke = vi.fn().mockResolvedValue({});
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: { from: (...args) => mockFrom(...args), functions: { invoke: (...args) => mockInvoke(...args) } },
}));

const mockUser = { id: 'user-1', empresa_id: 'empresa-1' };
vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

let mockAfipState = { afipConfig: null, afipActivo: false, determinarTipoComprobante: () => 'B' };
vi.mock('@/hooks/useAfipConfig', () => ({
  useAfipConfig: () => mockAfipState,
}));

const mockCrearAsiento = vi.fn().mockResolvedValue({});
vi.mock('@/services/planCuentasService', () => ({
  asientosAutoService: { crearAsientoVenta: (...args) => mockCrearAsiento(...args) },
}));

// Modo Offline del POS — Fase 3. Este hook es infraestructura compartida
// entre useConfirmarVenta (camino online) y useSyncEngine (ventas
// sincronizadas después de haberse encolado offline) — se testea aparte para
// que ninguno de los dos caminos pueda romperlo en silencio para el otro.
describe('useFinalizarVentaPosterior', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockCrearAsiento.mockClear();
    mockInvoke.mockClear();
    mockAfipState = { afipConfig: null, afipActivo: false, determinarTipoComprobante: () => 'B' };
  });

  it('siempre genera el asiento contable con los datos del RPC', () => {
    const { result } = renderHook(() => useFinalizarVentaPosterior());
    act(() => {
      result.current.finalizarVentaPosterior({
        comprobante: { id: 'c1' },
        rpcResult: { neto_gravado: 100, iva_discriminado: 21, monto_pendiente_liquidacion: 0, costo_mercaderia_vendida: 50 },
        total: 121, saleNumber: '0001', centroCostoId: null, isCC: false,
      });
    });
    expect(mockCrearAsiento).toHaveBeenCalledWith('empresa-1', 'user-1', expect.objectContaining({
      ventaId: 'c1', total: 121, neto: 100, iva: 21, descripcion: 'Venta #0001',
    }));
  });

  it('afipActivo=false: no toca la tabla comprobantes (no hay nada que encolar a ARCA)', () => {
    const { result } = renderHook(() => useFinalizarVentaPosterior());
    act(() => {
      result.current.finalizarVentaPosterior({
        comprobante: { id: 'c1' }, rpcResult: {}, total: 100, saleNumber: '0001',
      });
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('afipActivo=true: encola la factura con el tipo de comprobante correcto', () => {
    mockAfipState = {
      afipConfig: { condicion_iva: 'RI', punto_venta: { id: 'pdv-1' } },
      afipActivo: true,
      determinarTipoComprobante: vi.fn().mockReturnValue('A'),
    };
    const mockEq = vi.fn().mockReturnValue({ then: (cb) => cb({ error: null }) });
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });
    mockFrom.mockReturnValue({ update: mockUpdate });

    const { result } = renderHook(() => useFinalizarVentaPosterior());
    act(() => {
      result.current.finalizarVentaPosterior({
        comprobante: { id: 'c1' }, rpcResult: {}, total: 100, saleNumber: '0001',
        clienteCondicionIva: 'RI',
      });
    });

    expect(mockAfipState.determinarTipoComprobante).toHaveBeenCalledWith('RI', 'RI');
    expect(mockFrom).toHaveBeenCalledWith('comprobantes');
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      tipo_comprobante_afip: 'A', punto_venta_id: 'pdv-1', cae_estado: 'pendiente',
    }));
    // 29/08 — apenas se encola, dispara arca-worker ahora mismo en vez de
    // esperar al próximo tick del cron (dispararArcaWorker, afipQueue.js).
    expect(mockInvoke).toHaveBeenCalledWith('arca-worker');
  });

  it('sin cliente (Consumidor Final): usa CF por defecto para el tipo de comprobante', () => {
    mockAfipState = {
      afipConfig: { condicion_iva: 'RI', punto_venta: { id: 'pdv-1' } },
      afipActivo: true,
      determinarTipoComprobante: vi.fn().mockReturnValue('B'),
    };
    mockFrom.mockReturnValue({ update: () => ({ eq: () => ({ then: (cb) => cb({ error: null }) }) }) });

    const { result } = renderHook(() => useFinalizarVentaPosterior());
    act(() => {
      result.current.finalizarVentaPosterior({ comprobante: { id: 'c1' }, rpcResult: {}, total: 100, saleNumber: '0001' });
    });
    expect(mockAfipState.determinarTipoComprobante).toHaveBeenCalledWith('RI', 'CF');
  });

  it('expone puntoVentaId resuelto desde afipConfig', () => {
    mockAfipState = {
      afipConfig: { punto_venta: { id: 'pdv-99' } }, afipActivo: true,
      determinarTipoComprobante: () => 'B',
    };
    const { result } = renderHook(() => useFinalizarVentaPosterior());
    expect(result.current.puntoVentaId).toBe('pdv-99');
  });

  it('sin punto de venta configurado: puntoVentaId es null', () => {
    const { result } = renderHook(() => useFinalizarVentaPosterior());
    expect(result.current.puntoVentaId).toBeNull();
  });
});
