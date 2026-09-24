import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockRpc = vi.fn();
let mockPeriodos = [];
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    from: () => {
      const b = { select: () => b, eq: () => b, order: () => Promise.resolve({ data: mockPeriodos, error: null }) };
      return b;
    },
    rpc: (...args) => mockRpc(...args),
  },
}));
vi.mock('@/contexts/SupabaseAuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', empresa_id: 'emp-1' } }) }));
vi.mock('@/contexts/ConfigContext', () => ({ useConfig: () => ({ config: { nombre_empresa: 'Nalux', logo_base64: null } }) }));
const mockGeneratePDF = vi.fn().mockResolvedValue(undefined);
const mockExportReporte = vi.fn();
vi.mock('@/lib/pdfUtils', () => ({ generatePDF: (...a) => mockGeneratePDF(...a) }));
vi.mock('@/lib/excelUtils', () => ({ exportReporte: (...a) => mockExportReporte(...a) }));

import ReporteMemoriaAjusteInflacion from '@/components/reportes/ReporteMemoriaAjusteInflacion';

const periodos = [
  { id: 'p-jul', nombre: 'Ejercicio 2026 - Julio', fecha_inicio: '2026-07-01', fecha_cierre: '2026-07-31', estado: 'cerrado' },
  { id: 'p-jun', nombre: 'Ejercicio 2026 - Junio', fecha_inicio: '2026-06-01', fecha_cierre: '2026-06-30', estado: 'abierto' },
];
const respuesta = {
  periodo: periodos[0],
  indice_cierre: { mes: '2026-07-01', indice: 12000 },
  detalle: [
    { codigo: '1.1.3', nombre: 'Mercaderías / Inventario', tipo: 'activo', origen: 'movimiento', mes: '2026-06-01', saldo: 500, indice: 10000, coeficiente: 1.2, saldo_reexpresado: 600, ajuste: 100 },
    { codigo: '1.1.3', nombre: 'Mercaderías / Inventario', tipo: 'activo', origen: 'movimiento', mes: '2026-07-01', saldo: 300, indice: 12000, coeficiente: 1, saldo_reexpresado: 300, ajuste: 0 },
  ],
  lineas: [{ codigo: '1.1.3', monto_ajuste: 100 }],
  recpam_ganancia: 100, recpam_perdida: 0, recpam_neto: 100,
  asiento: null,
  control: { suma_detalle: 100, suma_lineas: 100, diferencia: 0 },
};

const montar = async () => {
  render(<ReporteMemoriaAjusteInflacion onBack={vi.fn()} />);
  await screen.findByText(/Ejercicio 2026 - Julio \(cerrado\)/);
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPeriodos = periodos;
  mockRpc.mockResolvedValue({ data: respuesta, error: null });
});

describe('ReporteMemoriaAjusteInflacion', () => {
  it('lista los períodos (el más nuevo elegido) y no muestra nada hasta generar', async () => {
    await montar();
    expect(screen.getByRole('option', { name: /Ejercicio 2026 - Junio \(abierto\)/ })).toBeTruthy();
    expect(screen.queryByText('RECPAM ganancia')).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('sin períodos avisa qué hacer', async () => {
    mockPeriodos = [];
    render(<ReporteMemoriaAjusteInflacion onBack={vi.fn()} />);
    expect(await screen.findByText(/Todavía no tenés períodos contables/)).toBeTruthy();
  });

  it('generar llama a la función de la base con el período elegido y muestra el papel de trabajo', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Generar memoria/ }));
    expect(await screen.findByText('RECPAM ganancia')).toBeTruthy();
    expect(mockRpc).toHaveBeenCalledWith('memoria_calculo_ajuste_por_inflacion', { p_periodo_id: 'p-jul' });
    expect(screen.getByText(/1\.1\.3 — Mercaderías \/ Inventario \(activo\)/)).toBeTruthy();
    expect(screen.getByText('Ajuste de 1.1.3')).toBeTruthy();
    expect(screen.getByText(/Índices utilizados/)).toBeTruthy();
    expect(screen.getByText(/El detalle cierra contra el ajuste oficial/)).toBeTruthy();
    expect(screen.getByText(/todavía no se generó para este período/)).toBeTruthy();
  });

  it('cambiar de período borra lo generado', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Generar memoria/ }));
    await screen.findByText('RECPAM ganancia');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p-jun' } });
    expect(screen.queryByText('RECPAM ganancia')).toBeNull();
  });

  it('si el detalle no cierra contra el ajuste oficial lo avisa fuerte', async () => {
    mockRpc.mockResolvedValue({ data: { ...respuesta, control: { suma_detalle: 150, suma_lineas: 100, diferencia: 50 } }, error: null });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Generar memoria/ }));
    expect(await screen.findByText(/El detalle NO cierra contra el ajuste oficial/)).toBeTruthy();
  });

  it('muestra el número de asiento cuando el ajuste ya se generó', async () => {
    mockRpc.mockResolvedValue({ data: { ...respuesta, asiento: { id: 'a1', numero: 'AS-0042', fecha: '2026-08-01' } }, error: null });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Generar memoria/ }));
    expect(await screen.findByText(/asiento N° AS-0042/)).toBeTruthy();
  });

  it('un error del cálculo (ej. índice faltante) se muestra tal cual y no rompe la pantalla', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'Falta cargar el índice de inflación de 05/2026 en Configuración → Finanzas' } });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Generar memoria/ }));
    expect(await screen.findByText(/Falta cargar el índice de inflación de 05\/2026/)).toBeTruthy();
    expect(screen.queryByText('RECPAM ganancia')).toBeNull();
  });

  it('un período sin nada que ajustar lo explica y igual muestra el detalle', async () => {
    mockRpc.mockResolvedValue({ data: { ...respuesta, detalle: [respuesta.detalle[1]], lineas: [], recpam_ganancia: 0, recpam_neto: 0, control: { suma_detalle: 0, suma_lineas: 0, diferencia: 0 } }, error: null });
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Generar memoria/ }));
    expect(await screen.findByText(/Este período no genera ajuste/)).toBeTruthy();
    expect(screen.getByText('Ajuste de 1.1.3')).toBeTruthy();
  });

  it('PDF y Excel salen con las mismas filas, columnas y totales que la pantalla', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Generar memoria/ }));
    await screen.findByText('RECPAM ganancia');

    fireEvent.click(screen.getByRole('button', { name: /Descargar PDF/ }));
    await waitFor(() => expect(mockGeneratePDF).toHaveBeenCalledTimes(1));
    const pdf = mockGeneratePDF.mock.calls[0][0];
    expect(pdf.title).toMatch(/Memoria de Cálculo/);
    expect(pdf.companyName).toBe('Nalux');
    expect(pdf.startDate).toBe('2026-07-01');
    expect(pdf.data.map(r => r.__rowType || 'fila')).toEqual(['group', 'fila', 'fila', 'subtotal']);
    expect(pdf.totals).toHaveLength(2);
    expect(pdf.summaryMetrics.map(m => m.label)).toEqual(['Ajuste total', 'RECPAM ganancia', 'RECPAM pérdida', 'RECPAM neto']);

    fireEvent.click(screen.getByRole('button', { name: /Descargar Excel/ }));
    expect(mockExportReporte).toHaveBeenCalledTimes(1);
    expect(mockExportReporte.mock.calls[0][0].data).toBe(pdf.data);
  });
});
