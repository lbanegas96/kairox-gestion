import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PanelCarrito from '@/components/caja/PanelCarrito';

// Stubs livianos de los hijos pesados — no es a ellos a quien se testea acá.
vi.mock('@/components/shared/ClienteSelector', () => ({ default: () => <div data-testid="cliente-selector" /> }));
vi.mock('@/components/ui/TipoCambioModal', () => ({ TipoCambioModal: () => null }));
vi.mock('@/components/caja/ModalCobroQR', () => ({ default: () => null }));

const mockConfirmar = vi.fn();
vi.mock('@/hooks/useConfirmarVenta', () => ({
  useConfirmarVenta: () => ({ confirmar: mockConfirmar, loading: false, lastComprobante: null, finalizarVentaPosterior: vi.fn() }),
}));

vi.mock('@/hooks/useCobroQR', () => ({
  useCobroQR: () => ({
    estado: 'idle', qrDataUrl: null, datos: null, error: null, segundosRestantes: null,
    iniciar: vi.fn(), cancelar: vi.fn(), reset: vi.fn(),
  }),
}));

vi.mock('@/hooks/useTCParalelo', () => ({
  useTCParalelo: () => ({ enabled: false, tcMissing: false, tcHoy: null, monedaParalela: 'USD', calcParalelo: () => 0, setTC: vi.fn(), loading: false }),
}));

let mockIsOnline = true;
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));

vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', empresa_id: 'empresa-1' } }),
}));

vi.mock('@/contexts/CajaContext', () => ({
  useCaja: () => ({ currentSession: { id: 'sesion-1' } }),
}));

const mockFrom = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));

const chain = { select: () => chain, eq: () => chain, neq: () => chain, order: () => chain, single: () => Promise.resolve({ data: null, error: null }), then: (r) => r({ data: [], error: null }) };

const FORMAS_PAGO = [
  { id: 'f1', nombre: 'Efectivo', tipo_instrumento: 'efectivo' },
  { id: 'f2', nombre: 'Transferencia', tipo_instrumento: 'transferencia' },
  { id: 'f3', nombre: 'Tarjeta Débito', tipo_instrumento: 'tarjeta_debito' },
  { id: 'f4', nombre: 'QR MercadoPago', tipo_instrumento: 'billetera' },
];

// Flushea el then() del fetch mockeado de clientes/centrosCosto (efectos de
// PanelCarrito) para que no quede una actualización de estado fuera de act().
async function renderPanel(props = {}) {
  const utils = render(
    <PanelCarrito
      apiRef={{ current: {} }}
      carrito={[]}
      onModificarCarrito={() => {}}
      onVentaExitosa={() => {}}
      formasPago={FORMAS_PAGO}
      {...props}
    />
  );
  await act(async () => {});
  return utils;
}

// Modo Offline del POS — Fase 3. Tarjeta/QR/Cuenta Corriente tienen que
// quedar deshabilitados (con tooltip) apenas se corta la red — Efectivo y
// Transferencia siguen disponibles.
describe('PanelCarrito — medios de pago offline', () => {
  beforeEach(() => {
    mockIsOnline = true;
    mockFrom.mockReturnValue(chain);
    mockConfirmar.mockReset();
  });

  it('online: ningún botón de medio de pago está deshabilitado', async () => {
    await renderPanel();
    ['Efectivo', 'Transferencia', 'Tarjeta Débito', 'QR MercadoPago', 'Cuenta Corriente'].forEach(nombre => {
      expect(screen.getByText(nombre).closest('button').disabled).toBe(false);
    });
  });

  it('offline: Efectivo y Transferencia siguen habilitados', async () => {
    mockIsOnline = false;
    await renderPanel();
    expect(screen.getByText('Efectivo').closest('button').disabled).toBe(false);
    expect(screen.getByText('Transferencia').closest('button').disabled).toBe(false);
  });

  it('offline: Tarjeta, QR MercadoPago y Cuenta Corriente quedan deshabilitados con tooltip', async () => {
    mockIsOnline = false;
    await renderPanel();
    for (const nombre of ['Tarjeta Débito', 'QR MercadoPago', 'Cuenta Corriente']) {
      const boton = screen.getByText(nombre).closest('button');
      expect(boton.disabled).toBe(true);
      expect(boton.getAttribute('title')).toBe('Necesita conexión a internet');
    }
  });

  it('offline: clickear un medio deshabilitado no lo selecciona', async () => {
    mockIsOnline = false;
    await renderPanel();
    const boton = screen.getByText('Tarjeta Débito').closest('button');
    fireEvent.click(boton);
    // Si se hubiera seleccionado, aparecería el ícono de check (vía la clase/props del ícono).
    // Chequeo indirecto: el botón sigue deshabilitado y sin la clase "activo".
    expect(boton.disabled).toBe(true);
    expect(boton.className).not.toMatch(/kx-violet/);
  });

  it('vuelve a habilitar todo si la conexión vuelve (re-render con isOnline=true)', async () => {
    mockIsOnline = false;
    const { rerender } = await renderPanel();
    expect(screen.getByText('Tarjeta Débito').closest('button').disabled).toBe(true);

    mockIsOnline = true;
    await act(async () => {
      rerender(
        <PanelCarrito apiRef={{ current: {} }} carrito={[]} onModificarCarrito={() => {}} onVentaExitosa={() => {}} formasPago={FORMAS_PAGO} />
      );
    });
    expect(screen.getByText('Tarjeta Débito').closest('button').disabled).toBe(false);
  });
});
