import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockCalcular = vi.fn();
vi.mock('@/services/ajusteInflacionService', () => ({
  ajusteInflacionService: { calcularAjusteImpositivo: (...a) => mockCalcular(...a) },
}));
vi.mock('@/contexts/SupabaseAuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', empresa_id: 'emp-1' } }) }));
vi.mock('@/contexts/ConfigContext', () => ({ useConfig: () => ({ config: { nombre_empresa: 'Nalux', logo_base64: null } }) }));
const mockGeneratePDF = vi.fn().mockResolvedValue(undefined);
const mockExportReporte = vi.fn();
vi.mock('@/lib/pdfUtils', () => ({ generatePDF: (...a) => mockGeneratePDF(...a) }));
vi.mock('@/lib/excelUtils', () => ({ exportReporte: (...a) => mockExportReporte(...a) }));

import TabAjusteImpositivo from '@/components/impuestos/TabAjusteImpositivo';

const ok = {
  ok: true, activo_computable_inicio: 1000000, pasivo_computable_inicio: 400000, pn_computable_inicio: 600000,
  coeficiente_anual: 1.5, ajuste_estatico: -300000, ajuste_dinamico: -20000, ajuste_total: -320000, meses_sin_indice: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCalcular.mockResolvedValue(ok);
});

// Export del Ajuste Impositivo (Backlog de Reportería, 24/09): el cálculo ya
// existía pero solo se podía mirar en pantalla.
describe('TabAjusteImpositivo — export', () => {
  it('no ofrece descargar nada antes de calcular', () => {
    render(<TabAjusteImpositivo />);
    expect(screen.queryByRole('button', { name: /Descargar PDF/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Descargar Excel/ })).toBeNull();
  });

  it('después de calcular ofrece PDF y Excel con el papel de trabajo del cálculo', async () => {
    render(<TabAjusteImpositivo />);
    fireEvent.click(screen.getByRole('button', { name: /Calcular/ }));
    await screen.findByText('Ajuste por Inflación Impositivo Total');

    fireEvent.click(screen.getByRole('button', { name: /Descargar PDF/ }));
    await waitFor(() => expect(mockGeneratePDF).toHaveBeenCalledTimes(1));
    const pdf = mockGeneratePDF.mock.calls[0][0];
    expect(pdf.title).toBe('Ajuste por Inflación Impositivo (Ganancias)');
    expect(pdf.companyName).toBe('Nalux');
    expect(pdf.filename).toBe('ajuste_inflacion_impositivo');
    expect(pdf.data[6].importe).toBe(320000);
    expect(pdf.data[6].concepto).toMatch(/gravado/);

    fireEvent.click(screen.getByRole('button', { name: /Descargar Excel/ }));
    expect(mockExportReporte).toHaveBeenCalledTimes(1);
    // Cada descarga arma su propio papel: mismo contenido, distinta instancia.
    expect(mockExportReporte.mock.calls[0][0].data).toEqual(pdf.data);
  });

  it('si el cálculo no se pudo hacer (falta un índice) no hay nada para descargar', async () => {
    mockCalcular.mockResolvedValue({ ok: false, mensaje: 'Falta el índice de 12/2025' });
    render(<TabAjusteImpositivo />);
    fireEvent.click(screen.getByRole('button', { name: /Calcular/ }));
    await screen.findByText(/Falta el índice de 12\/2025/);
    expect(screen.queryByRole('button', { name: /Descargar PDF/ })).toBeNull();
  });
});
