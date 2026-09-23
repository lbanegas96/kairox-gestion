import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TabNuevaCompra from '@/components/compras/TabNuevaCompra';

// MonedaSelector consulta tipos de cambio por su cuenta — acá no importa.
vi.mock('@/components/ui/MonedaSelector', () => ({ MonedaSelector: () => <div data-testid="moneda" /> }));

const formBase = {
  proveedor_id: '', numero_factura: '', fecha: '2026-09-23', forma_pago: 'Efectivo', centro_costo_id: '',
  en_libro_iva: true, tipo_comprobante_letra: 'A', punto_venta_proveedor: '', numero_comprobante_proveedor: '',
};
const proveedores = [
  { id: 'p1', nombre: 'Proveedor Con CUIT', cuit: '30-71234567-8' },
  { id: 'p2', nombre: 'Proveedor Sin CUIT', cuit: '' },
];
const item = { cartItemId: 'i1', nombre: 'Producto', codigo_sku: 'SKU-1', unidad_medida: 'Unidad', cantidad: 1, costo_unitario: '100', packQty: '', packCosto: '' };

function montar({ form = {}, cart = [] } = {}) {
  const props = {
    purchaseForm: { ...formBase, ...form }, setPurchaseForm: vi.fn(), proveedores, centrosCosto: [],
    moneda: 'ARS', setMoneda: vi.fn(), tipoCambioTasa: 1, setTipoCambioTasa: vi.fn(), tcMissing: false, setTcMissing: vi.fn(),
    tcParalelo: { enabled: false }, setShowParaleloTCModal: vi.fn(),
    cart, calculateTotalUnits: () => cart.length, calculateTotal: () => 0,
    searchInputRef: { current: null }, productSearch: '', setProductSearch: vi.fn(),
    showAutocomplete: false, setShowAutocomplete: vi.fn(), handleSearchKeyDown: vi.fn(), filteredProducts: [],
    getShortUnit: () => 'un.', addToCart: vi.fn(), updateCartItem: vi.fn(), applyPackConversion: vi.fn(),
    removeFromCart: vi.fn(), isSubmitting: false, setShowClearConfirm: vi.fn(), handleRegisterPurchase: vi.fn(),
    isPurchaseValid: () => true,
  };
  render(<TabNuevaCompra {...props} />);
  return props;
}

// Compra Rápida "Libro" / "No libro" (23/09): "Libro" pide los datos del
// comprobante del proveedor, "No libro" no pide nada y no va al IVA.
describe('TabNuevaCompra — Libro / No libro', () => {
  it('Libro (por defecto): pide letra, punto de venta y número del comprobante', () => {
    montar();
    expect(screen.getByText(/Comprobante del Proveedor/)).toBeTruthy();
    expect(screen.getByLabelText('Tipo de comprobante')).toBeTruthy();
    expect(screen.getByLabelText('Punto de venta')).toBeTruthy();
    expect(screen.getByLabelText('Número de comprobante')).toBeTruthy();
    expect(screen.queryByText(/N° Factura \/ Referencia/)).toBeNull();
    expect(screen.getByText(/va al Libro IVA Compras y suma crédito fiscal/)).toBeTruthy();
  });

  it('un formulario viejo sin el campo en_libro_iva se trata como Libro', () => {
    const { en_libro_iva: _omitido, ...sinFlag } = formBase;
    montar({ form: sinFlag });
    expect(screen.getByText(/Comprobante del Proveedor/)).toBeTruthy();
  });

  it('No libro: oculta el comprobante y deja una referencia opcional', () => {
    montar({ form: { en_libro_iva: false } });
    expect(screen.queryByText(/Comprobante del Proveedor/)).toBeNull();
    expect(screen.queryByLabelText('Punto de venta')).toBeNull();
    expect(screen.getByText(/N° Factura \/ Referencia \(opcional\)/)).toBeTruthy();
    expect(screen.getByText(/No va al Libro IVA ni suma crédito fiscal/)).toBeTruthy();
  });

  it('los botones cambian el estado del formulario y marcan cuál está elegido', () => {
    const props = montar();
    expect(screen.getByRole('button', { name: 'Libro' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'No libro' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'No libro' }));
    expect(props.setPurchaseForm).toHaveBeenCalledWith(expect.objectContaining({ en_libro_iva: false }));
  });

  it('desde No libro, el botón Libro vuelve a activar el Libro', () => {
    const props = montar({ form: { en_libro_iva: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Libro' }));
    expect(props.setPurchaseForm).toHaveBeenCalledWith(expect.objectContaining({ en_libro_iva: true }));
  });

  it('punto de venta y número: solo dígitos y con tope (5 y 8) — el TXT recorta por la izquierda si se pasan', () => {
    const props = montar();
    const pv = screen.getByLabelText('Punto de venta');
    const nro = screen.getByLabelText('Número de comprobante');
    expect(pv.getAttribute('maxlength')).toBe('5');
    expect(nro.getAttribute('maxlength')).toBe('8');
    fireEvent.change(pv, { target: { value: '12a3' } });
    expect(props.setPurchaseForm).toHaveBeenLastCalledWith(expect.objectContaining({ punto_venta_proveedor: '123' }));
    fireEvent.change(nro, { target: { value: '00-45x' } });
    expect(props.setPurchaseForm).toHaveBeenLastCalledWith(expect.objectContaining({ numero_comprobante_proveedor: '0045' }));
  });

  it('avisa (sin bloquear) cuando el proveedor de una compra Libro no tiene CUIT válido', () => {
    montar({ form: { proveedor_id: 'p2' } });
    expect(screen.getByText(/no tiene un CUIT válido cargado/)).toBeTruthy();
  });

  it('no avisa si el proveedor tiene CUIT', () => {
    montar({ form: { proveedor_id: 'p1' } });
    expect(screen.queryByText(/no tiene un CUIT válido cargado/)).toBeNull();
  });

  it('no avisa mientras no se eligió proveedor', () => {
    montar();
    expect(screen.queryByText(/no tiene un CUIT válido cargado/)).toBeNull();
  });

  it('No libro no avisa por CUIT aunque el proveedor no lo tenga', () => {
    montar({ form: { proveedor_id: 'p2', en_libro_iva: false } });
    expect(screen.queryByText(/no tiene un CUIT válido cargado/)).toBeNull();
  });

  it('Libro con carrito, proveedor y comprobante incompleto: avisa qué falta junto al botón', () => {
    montar({ form: { proveedor_id: 'p1' }, cart: [item] });
    expect(screen.getByText(/Completá el Punto de Venta y el Número del comprobante/)).toBeTruthy();
  });

  it('con el comprobante completo no muestra ese aviso', () => {
    montar({ form: { proveedor_id: 'p1', punto_venta_proveedor: '1', numero_comprobante_proveedor: '123' }, cart: [item] });
    expect(screen.queryByText(/Completá el Punto de Venta y el Número del comprobante/)).toBeNull();
  });

  it('en No libro no pide el comprobante', () => {
    montar({ form: { proveedor_id: 'p1', en_libro_iva: false }, cart: [item] });
    expect(screen.queryByText(/Completá el Punto de Venta y el Número del comprobante/)).toBeNull();
  });
});
