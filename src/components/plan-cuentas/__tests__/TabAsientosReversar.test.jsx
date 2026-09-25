import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetAsientos = vi.fn();
const mockReversar = vi.fn();
vi.mock('@/services/planCuentasService', () => ({
  asientosService: {
    getAsientos: (...a) => mockGetAsientos(...a),
    reversarAsiento: (...a) => mockReversar(...a),
    confirmarAsiento: vi.fn(),
    anularAsiento: vi.fn(),
  },
  PLAN_CUENTAS_KEYS: { asientos: (e, f) => ['asientos', e, f] },
}));
const mockToast = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: (...a) => mockToast(...a) }) }));
vi.mock('@/components/plan-cuentas/ModalNuevoAsiento', () => ({ default: () => null }));
vi.mock('@/components/shared/ModalDetalleAsiento', () => ({ default: () => null }));

import TabAsientos from '@/components/plan-cuentas/TabAsientos';

const asientos = [
  { id: 'a1', numero: 'AS-000001', fecha: '2026-09-20', descripcion: 'Venta', total_debe: 100, total_haber: 100, estado: 'confirmado', origen: 'venta' },
  { id: 'a2', numero: 'AS-000002', fecha: '2026-09-21', descripcion: 'Borrador', total_debe: 50, total_haber: 50, estado: 'borrador', origen: null },
  { id: 'a3', numero: 'AS-000003', fecha: '2026-09-22', descripcion: 'Reversa', total_debe: 100, total_haber: 100, estado: 'confirmado', origen: 'reversa_asiento' },
];

const montar = (userRole) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TabAsientos empresaId="emp-1" userId="u1" userRole={userRole} cuentasFlat={[]} />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAsientos.mockResolvedValue({ data: asientos, count: 3, pages: 1 });
  mockReversar.mockResolvedValue({ id: 'r1', numero: 'AS-000004', estado: 'confirmado', reversa_de: 'AS-000001' });
});

describe('TabAsientos — reversar un asiento confirmado (mig.410)', () => {
  it('un administrador ve "Reversar" solo en los confirmados que no son una reversa', async () => {
    montar('admin');
    await screen.findByText('AS-000001');
    expect(screen.getByRole('button', { name: 'Reversar asiento AS-000001' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reversar asiento AS-000002' })).toBeNull(); // borrador: se anula, no se reversa
    expect(screen.queryByRole('button', { name: 'Reversar asiento AS-000003' })).toBeNull(); // ya es una reversa
  });

  it('un empleado no ve la acción', async () => {
    montar('staff');
    await screen.findByText('AS-000001');
    expect(screen.queryByRole('button', { name: /Reversar asiento/ })).toBeNull();
  });

  it('exige un motivo de al menos 5 caracteres antes de habilitar el botón', async () => {
    montar('admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Reversar asiento AS-000001' }));
    const boton = await screen.findByRole('button', { name: /^Reversar asiento$/ });
    expect(boton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'abc' } });
    expect(screen.getByText(/al menos 5 caracteres/)).toBeTruthy();
    expect(boton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Motivo/), { target: { value: 'duplicado por error' } });
    expect(boton.disabled).toBe(false);
  });

  it('reversa con el motivo escrito, avisa el número del contra-asiento y refresca la lista', async () => {
    montar('admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Reversar asiento AS-000001' }));
    fireEvent.change(await screen.findByLabelText(/Motivo/), { target: { value: '  duplicado por error  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Reversar asiento$/ }));

    await waitFor(() => expect(mockReversar).toHaveBeenCalledWith('a1', 'duplicado por error'));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Asiento AS-000001 reversado',
      description: 'Se generó el contra-asiento AS-000004.',
    })));
    // la lista se vuelve a pedir al invalidar la caché
    await waitFor(() => expect(mockGetAsientos.mock.calls.length).toBeGreaterThan(1));
  });

  it('si la base rechaza la reversa muestra su mensaje y deja el diálogo abierto', async () => {
    mockReversar.mockRejectedValue(new Error('Este asiento pertenece a un documento (comprobantes). Para deshacerlo cancelá el documento.'));
    montar('admin');
    fireEvent.click(await screen.findByRole('button', { name: 'Reversar asiento AS-000001' }));
    fireEvent.change(await screen.findByLabelText(/Motivo/), { target: { value: 'quiero deshacerla' } });
    fireEvent.click(screen.getByRole('button', { name: /^Reversar asiento$/ }));

    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'No se pudo reversar',
      description: expect.stringContaining('pertenece a un documento'),
      variant: 'destructive',
    })));
    expect(screen.getByLabelText(/Motivo/)).toBeTruthy();
  });
});
