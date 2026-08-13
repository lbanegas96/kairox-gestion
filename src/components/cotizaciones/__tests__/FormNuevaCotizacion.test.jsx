import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import FormNuevaCotizacion from '@/components/cotizaciones/FormNuevaCotizacion';

vi.mock('@/components/ui/MonedaSelector', () => ({
  MonedaSelector: () => null,
}));

const PRODUCTO = { id: 'prod-1', nombre: 'Aramis TESTE Azul marino', precio_venta: 1200, unidad_medida: 'Unidad', alicuota_iva: '21' };

function buildProps(overrides = {}) {
  const items = [{ producto_id: '', descripcion: '', cantidad: 1, unidad_medida: '', precio_unitario: '', alicuota_iva: '21', descuento_item: '' }];
  return {
    form: { cliente_nombre: 'Consumidor Final', cliente_id: '', condiciones_pago: '', fecha_vencimiento: '', moneda: 'ARS', tipoCambioTasa: 1, descuento: '', notas: '' },
    setForm: vi.fn(),
    items,
    addItem: vi.fn(),
    removeItem: vi.fn(),
    updateItem: vi.fn(),
    prodSearch: { 0: 'Aramis TESTE Azul marino' },
    prodResults: { 0: [PRODUCTO] },
    prodOpen: { 0: true },
    setProdOpen: vi.fn(),
    searchProducto: vi.fn(),
    selectProducto: vi.fn(),
    unidadesMedida: [],
    condicionesPago: [],
    allClientes: [],
    showClienteDropdown: false,
    setShowClienteDropdown: vi.fn(),
    clienteWrapperRef: { current: null },
    tcMissing: false,
    setTcMissing: vi.fn(),
    totales: { subtotal: 1200, descuento: 0, neto: 0, iva: 0, total: 1200 },
    discrimina: false,
    handleSubmit: vi.fn(e => e.preventDefault()),
    resetForm: vi.fn(),
    onCancel: vi.fn(),
    createMutation: { isPending: false },
    isEditing: false,
    ...overrides,
  };
}

describe('FormNuevaCotizacion — atajo Enter en Descripción/Producto', () => {
  it('con el desplegable abierto y resultados, Enter selecciona el producto en vez de agregar una fila', () => {
    const props = buildProps();
    render(<FormNuevaCotizacion {...props} />);
    const input = screen.getByPlaceholderText('Buscar producto o escribir descripción');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.selectProducto).toHaveBeenCalledWith(0, PRODUCTO);
    expect(props.addItem).not.toHaveBeenCalled();
  });

  it('sin desplegable abierto (texto libre), Enter agrega una fila nueva', () => {
    const props = buildProps({ prodOpen: { 0: false }, prodResults: { 0: [] } });
    render(<FormNuevaCotizacion {...props} />);
    const input = screen.getByPlaceholderText('Buscar producto o escribir descripción');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.addItem).toHaveBeenCalled();
    expect(props.selectProducto).not.toHaveBeenCalled();
  });

  it('en el campo Cantidad, Enter sigue agregando una fila nueva (sin cambios)', () => {
    const props = buildProps();
    render(<FormNuevaCotizacion {...props} />);
    const cantidadInputs = screen.getAllByRole('spinbutton');
    fireEvent.keyDown(cantidadInputs[0], { key: 'Enter' });
    expect(props.addItem).toHaveBeenCalled();
  });
});
