import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PanelCarrito from '@/components/caja/PanelCarrito';

// Stubs livianos de los hijos pesados — no es a ellos a quien se testea acá.
// Interactivo (a diferencia de un stub mudo) para poder simular la selección
// de cliente en los tests de Fidelización — Fase 3 (canje de puntos).
vi.mock('@/components/shared/ClienteSelector', () => ({
  default: ({ clientes = [], value, onChange }) => (
    <select data-testid="cliente-selector" value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">Sin cliente</option>
      {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
    </select>
  ),
}));
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

const CLIENTE_CON_PUNTOS = { id: 'cli-1', nombre: 'Juan Pérez', saldo_puntos: 50 };
const CARRITO_10000 = [{ id: 'p1', nombre: 'Producto', precio_venta: 1000, cantidad: 10, alicuota_iva: '21' }];

// Chain propia por tabla — a diferencia de `chain` (arriba), cuyos métodos
// siempre devuelven la MISMA instancia sin importar el resultado final, acá
// cada llamada a mockFrom(tabla) arma una cadena que resuelve al resultado
// que le corresponde a esa tabla, tanto vía `.single()` (Promise real) como
// vía `.then()` directo (mismo patrón que usa PanelCarrito para clientes).
function makeChain(finalResult) {
  const c = {
    select: () => c, eq: () => c, neq: () => c, order: () => c,
    single: () => Promise.resolve(finalResult),
    then: (resolve) => resolve(finalResult),
  };
  return c;
}

function mockFromFidelizacion({ usaFidelizacion = true, puntosValorPesos = 10, clientes = [CLIENTE_CON_PUNTOS] } = {}) {
  mockFrom.mockImplementation((table) => {
    if (table === 'clientes') return makeChain({ data: clientes, error: null });
    if (table === 'empresas') return makeChain({ data: { usa_fidelizacion: usaFidelizacion, puntos_valor_pesos: puntosValorPesos }, error: null });
    return makeChain({ data: [], error: null });
  });
}

// Fidelización por puntos — Fase 3: canje en el checkout del POS.
describe('PanelCarrito — canje de puntos (Fase 3)', () => {
  beforeEach(() => {
    mockIsOnline = true;
    mockConfirmar.mockReset();
    mockConfirmar.mockResolvedValue({ id: 'c1', numero_venta: '0001', puntos_ganados: 0 });
  });

  it('sin cliente elegido: no muestra el input de canje', async () => {
    mockFromFidelizacion();
    await renderPanel({ carrito: CARRITO_10000 });
    expect(screen.queryByText(/Canjear puntos/)).toBeNull();
  });

  it('con cliente y fidelización activa: muestra el input, clampeado al saldo disponible', async () => {
    mockFromFidelizacion();
    await renderPanel({ carrito: CARRITO_10000 });
    await act(async () => {
      fireEvent.change(screen.getByTestId('cliente-selector'), { target: { value: 'cli-1' } });
    });
    expect(await screen.findByText(/Canjear puntos/)).toBeTruthy();

    const input = screen.getByLabelText('Canjear puntos');
    fireEvent.change(input, { target: { value: '999' } }); // pide más de lo que tiene
    expect(input.value).toBe('50'); // clampeado al saldo (50), no al total/ratio (1000)

    expect(screen.getByText(/Descuento por puntos \(50\)/)).toBeTruthy();
    expect(screen.getByText('-$500,00')).toBeTruthy(); // 50 puntos * $10
    expect(screen.getByText('$9.500,00')).toBeTruthy(); // 10000 - 500
  });

  it('sin fidelización activa: no muestra el input aunque el cliente tenga puntos', async () => {
    mockFromFidelizacion({ usaFidelizacion: false });
    await renderPanel({ carrito: CARRITO_10000 });
    await act(async () => {
      fireEvent.change(screen.getByTestId('cliente-selector'), { target: { value: 'cli-1' } });
    });
    expect(screen.queryByText(/Canjear puntos/)).toBeNull();
  });

  it('offline: no muestra el input aunque haya cliente con puntos y fidelización activa', async () => {
    mockIsOnline = false;
    mockFromFidelizacion();
    await renderPanel({ carrito: CARRITO_10000 });
    await act(async () => {
      fireEvent.change(screen.getByTestId('cliente-selector'), { target: { value: 'cli-1' } });
    });
    expect(screen.queryByText(/Canjear puntos/)).toBeNull();
  });

  it('al confirmar, pasa puntosCanjeados y descuentoPuntosPesos a confirmar()', async () => {
    mockFromFidelizacion();
    await renderPanel({ carrito: CARRITO_10000 });
    await act(async () => {
      fireEvent.change(screen.getByTestId('cliente-selector'), { target: { value: 'cli-1' } });
    });
    const input = await screen.findByLabelText('Canjear puntos');
    fireEvent.change(input, { target: { value: '20' } });

    await act(async () => {
      fireEvent.click(screen.getByText('Confirmar Venta').closest('button'));
    });

    expect(mockConfirmar).toHaveBeenCalledWith(expect.objectContaining({
      puntosCanjeados: 20,
      descuentoPuntosPesos: 200,
    }));
  });
});
