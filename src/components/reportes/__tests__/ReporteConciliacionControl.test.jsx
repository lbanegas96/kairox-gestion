import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const mockRpc = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({ supabase: { rpc: (...a) => mockRpc(...a) } }));
vi.mock('@/contexts/SupabaseAuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', empresa_id: 'emp-1' } }) }));
vi.mock('@/contexts/ConfigContext', () => ({ useConfig: () => ({ config: { nombre_empresa: 'Nalux', logo_base64: null } }) }));
const mockGeneratePDF = vi.fn().mockResolvedValue(undefined);
const mockExportReporte = vi.fn();
vi.mock('@/lib/pdfUtils', () => ({ generatePDF: (...a) => mockGeneratePDF(...a) }));
vi.mock('@/lib/excelUtils', () => ({ exportReporte: (...a) => mockExportReporte(...a) }));

import ReporteConciliacionControl from '@/components/reportes/ReporteConciliacionControl';

const respuesta = {
  generado_en: '2026-09-25T20:00:00Z',
  cuentas: [
    { clave: 'clientes', titulo: 'Cuentas a Cobrar — clientes', cuenta_codigo: '1.1.2', cuenta_nombre: 'Cuentas a Cobrar', cuenta_existe: true, mayor: 823621, subdiario: 314103, subdiario_desc: 'Suma de los saldos de la ficha de cada cliente.', diferencia: 509518, conciliado: false },
    { clave: 'proveedores', titulo: 'Cuentas a Pagar — proveedores', cuenta_codigo: '2.1.1', cuenta_nombre: 'Cuentas a Pagar', cuenta_existe: true, mayor: 500, subdiario: 500, subdiario_desc: 'Cuenta Corriente de proveedores.', diferencia: 0, conciliado: true },
    { clave: 'iva_credito', titulo: 'IVA Crédito Fiscal', cuenta_codigo: '1.1.4', cuenta_nombre: null, cuenta_existe: false, mayor: 0, subdiario: 0, subdiario_desc: 'IVA de compras.', diferencia: 0, conciliado: true },
  ],
  controles: [
    { clave: 'cc_sin_cliente', titulo: 'Movimientos de cuenta corriente sin cliente', ayuda: 'Cobros o notas que no pertenecen a ningún cliente.', casos: 4, monto: -160080, estado: 'revisar',
      detalle: [{ fecha: '2026-07-07', movimiento: 'HABER', monto: 1568, descripcion: 'NC NC-20260707-004 por devolucion' }] },
    { clave: 'asientos_duplicados', titulo: 'Documentos con asiento duplicado', ayuda: 'Más de un asiento vigente.', casos: 1, monto: 550000.66, estado: 'revisar',
      detalle: [{ tipo: 'compra', asientos: 'AS-000318, AS-000319', importe_de_mas: 550000.66 }] },
    { clave: 'asientos_desbalanceados', titulo: 'Asientos desbalanceados', ayuda: 'Ninguno debería haber.', casos: 0, monto: 0, estado: 'ok', detalle: [] },
  ],
};

const montar = async () => {
  const r = render(<ReporteConciliacionControl onBack={vi.fn()} />);
  await screen.findByText('Cuentas de control: mayor contra subdiario');
  return r;
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: respuesta, error: null });
});

describe('ReporteConciliacionControl', () => {
  it('al abrirlo carga solo, llamando a la función de la base', async () => {
    await montar();
    expect(mockRpc).toHaveBeenCalledWith('conciliacion_cuentas_control');
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('muestra cada cuenta con su mayor, su subdiario, la diferencia y si concilia', async () => {
    await montar();
    const clientes = within(screen.getByTestId('cuenta-clientes'));
    expect(clientes.getByText(/Cuentas a Cobrar — clientes/)).toBeTruthy();
    expect(clientes.getByText(/823\.621/)).toBeTruthy();
    expect(clientes.getByText(/314\.103/)).toBeTruthy();
    expect(clientes.getByText(/509\.518/)).toBeTruthy();
    expect(clientes.getByText('Con diferencia')).toBeTruthy();
    expect(within(screen.getByTestId('cuenta-proveedores')).getByText('Concilia')).toBeTruthy();
  });

  it('cada línea explica cómo se calcula el subdiario', async () => {
    await montar();
    expect(screen.getByText('Suma de los saldos de la ficha de cada cliente.')).toBeTruthy();
  });

  it('avisa si la cuenta de control no existe en el plan de cuentas de la empresa', async () => {
    await montar();
    expect(within(screen.getByTestId('cuenta-iva_credito')).getByText(/no existe en el plan de cuentas/)).toBeTruthy();
  });

  it('los indicadores de arriba resumen cuántas concilian y cuántos controles hay que revisar', async () => {
    await montar();
    // 2 de 3 cuentas concilian y 2 de 3 controles están a revisar: el mismo texto en dos cajas distintas
    expect(screen.getAllByText('2 de 3')).toHaveLength(2);
    expect(screen.getByText('Cuentas con diferencia')).toBeTruthy();
    expect(screen.getByText('Controles a revisar')).toBeTruthy();
  });

  it('un control con casos se abre y muestra el detalle; uno sin casos no se abre', async () => {
    await montar();
    const control = screen.getByTestId('control-cc_sin_cliente');
    expect(within(control).getByText('4 casos')).toBeTruthy();
    expect(screen.queryByText('NC NC-20260707-004 por devolucion')).toBeNull();

    fireEvent.click(within(control).getByRole('button'));
    expect(await screen.findByText('NC NC-20260707-004 por devolucion')).toBeTruthy();
    expect(screen.getByText('07/07/2026')).toBeTruthy();

    const sinCasos = within(screen.getByTestId('control-asientos_desbalanceados'));
    expect(sinCasos.getByText('Sin casos')).toBeTruthy();
    expect(sinCasos.getByRole('button').disabled).toBe(true);
  });

  it('cuando hay más casos que filas de detalle lo aclara', async () => {
    await montar();
    fireEvent.click(within(screen.getByTestId('control-cc_sin_cliente')).getByRole('button'));
    expect(await screen.findByText(/Se muestran los 1 casos más recientes o de mayor diferencia, de 4/)).toBeTruthy();
  });

  it('el duplicado muestra los dos asientos que hay que mirar', async () => {
    await montar();
    fireEvent.click(within(screen.getByTestId('control-asientos_duplicados')).getByRole('button'));
    expect(await screen.findByText('AS-000318, AS-000319')).toBeTruthy();
  });

  it('un error de la base se muestra tal cual y no rompe la pantalla', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'No autorizado: sin permiso de módulo reportes' } });
    render(<ReporteConciliacionControl onBack={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/sin permiso de módulo reportes/)).toBeTruthy();
    expect(screen.queryByText('Cuentas de control: mayor contra subdiario')).toBeNull();
  });

  it('"Actualizar" vuelve a pedir los datos', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Actualizar/ }));
    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(2));
  });

  it('PDF y Excel salen con las mismas filas y columnas que la pantalla', async () => {
    await montar();
    fireEvent.click(screen.getByRole('button', { name: /Descargar PDF/ }));
    await waitFor(() => expect(mockGeneratePDF).toHaveBeenCalledTimes(1));
    const pdf = mockGeneratePDF.mock.calls[0][0];
    expect(pdf.title).toBe('Conciliación de Cuentas de Control');
    expect(pdf.esSnapshot).toBe(true);
    expect(pdf.companyName).toBe('Nalux');
    expect(pdf.data.map(f => f.__rowType || 'fila')).toEqual(['group', 'fila', 'fila', 'fila', 'group', 'fila', 'fila', 'fila']);
    expect(pdf.summaryMetrics.map(m => m.label)).toEqual(['Cuentas que concilian', 'Cuentas con diferencia', 'Controles a revisar']);

    fireEvent.click(screen.getByRole('button', { name: /Descargar Excel/ }));
    expect(mockExportReporte).toHaveBeenCalledTimes(1);
    expect(mockExportReporte.mock.calls[0][0].data).toBe(pdf.data);
  });

  it('volver llama a onBack', async () => {
    const onBack = vi.fn();
    render(<ReporteConciliacionControl onBack={onBack} />);
    await screen.findByText('Cuentas de control: mayor contra subdiario');
    fireEvent.click(screen.getByRole('button', { name: /Volver/ }));
    expect(onBack).toHaveBeenCalled();
  });
});
