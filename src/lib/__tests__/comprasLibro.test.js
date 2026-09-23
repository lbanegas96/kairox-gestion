import { describe, it, expect } from 'vitest';
import {
  TIPOS_COMPROBANTE, factorIva, netoIvaCompra, numeroFacturaDerivado,
  comprobanteProveedorCompleto, tieneCuitValido, resolverCompraLibro,
} from '@/lib/comprasLibro';

// Compra Rápida "Libro" / "No libro" (23/09): la regla de neto/IVA y los datos
// del comprobante viven acá para que creación y edición compartan exactamente
// lo mismo.
describe('factorIva', () => {
  it('discrimina 21, 10.5 y 27', () => {
    expect(factorIva('21')).toBe(1.21);
    expect(factorIva('10.5')).toBe(1.105);
    expect(factorIva('27')).toBe(1.27);
  });
  it('0 / exento / no_gravado no discriminan IVA (factor 1) — antes un exento se calculaba al 21%', () => {
    expect(factorIva('0')).toBe(1);
    expect(factorIva('exento')).toBe(1);
    expect(factorIva('no_gravado')).toBe(1);
  });
  it('sin dato (o número) = 21%', () => {
    expect(factorIva(undefined)).toBe(1.21);
    expect(factorIva(null)).toBe(1.21);
    expect(factorIva(21)).toBe(1.21);
    expect(factorIva(10.5)).toBe(1.105);
  });
});

describe('netoIvaCompra', () => {
  it('Libro: separa neto e IVA de un precio final con IVA incluido', () => {
    const r = netoIvaCompra([{ cantidad: 1, costo_unitario: 1210, alicuota_iva: '21' }]);
    expect(r.neto).toBeCloseTo(1000, 9);
    expect(r.iva).toBeCloseTo(210, 9);
  });
  it('Libro: mezcla de alícuotas', () => {
    const r = netoIvaCompra([
      { cantidad: 1, costo_unitario: 1210, alicuota_iva: '21' },
      { cantidad: 1, costo_unitario: 1105, alicuota_iva: '10.5' },
    ]);
    expect(r.neto).toBeCloseTo(2000, 9);
    expect(r.iva).toBeCloseTo(315, 9);
  });
  it('Libro: un ítem exento no genera IVA', () => {
    const r = netoIvaCompra([
      { cantidad: 2, costo_unitario: 500, alicuota_iva: 'exento' },
      { cantidad: 1, costo_unitario: 1210, alicuota_iva: '21' },
    ]);
    expect(r.neto).toBeCloseTo(2000, 9);
    expect(r.iva).toBeCloseTo(210, 9);
  });
  it('No libro: todo el importe es neto y el IVA es 0, sin importar la alícuota', () => {
    const r = netoIvaCompra([
      { cantidad: 1, costo_unitario: 1210, alicuota_iva: '21' },
      { cantidad: 3, costo_unitario: 100, alicuota_iva: '10.5' },
    ], false);
    expect(r.neto).toBe(1510);
    expect(r.iva).toBe(0);
  });
  it('sin ítems o con datos sucios no explota', () => {
    expect(netoIvaCompra([])).toEqual({ neto: 0, iva: 0 });
    expect(netoIvaCompra(undefined)).toEqual({ neto: 0, iva: 0 });
    expect(netoIvaCompra([{ cantidad: 'x', costo_unitario: null }])).toEqual({ neto: 0, iva: 0 });
  });
  it('neto + IVA = importe bruto (Libro)', () => {
    const items = [
      { cantidad: 3, costo_unitario: 333.33, alicuota_iva: '21' },
      { cantidad: 7, costo_unitario: 12.5, alicuota_iva: '10.5' },
    ];
    const bruto = 3 * 333.33 + 7 * 12.5;
    const { neto, iva } = netoIvaCompra(items);
    expect(neto + iva).toBeCloseTo(bruto, 9);
  });
});

describe('numeroFacturaDerivado', () => {
  it('arma A-0001-00012345 con ceros a la izquierda', () => {
    expect(numeroFacturaDerivado('A', '1', '123')).toBe('A-0001-00000123');
    expect(numeroFacturaDerivado('B', '00012', '12345678')).toBe('B-00012-12345678');
  });
  it('vacío si falta el punto de venta o el número', () => {
    expect(numeroFacturaDerivado('A', '', '123')).toBe('');
    expect(numeroFacturaDerivado('A', '1', '  ')).toBe('');
    expect(numeroFacturaDerivado('A', undefined, undefined)).toBe('');
  });
});

describe('comprobanteProveedorCompleto', () => {
  it('completo con letra válida, PV y número', () => {
    expect(comprobanteProveedorCompleto({ letra: 'A', puntoVenta: '1', numero: '123' })).toBe(true);
    TIPOS_COMPROBANTE.forEach(letra =>
      expect(comprobanteProveedorCompleto({ letra, puntoVenta: '0001', numero: '1' })).toBe(true));
  });
  it('incompleto si falta cualquiera de los 3', () => {
    expect(comprobanteProveedorCompleto({ letra: 'A', puntoVenta: '', numero: '123' })).toBe(false);
    expect(comprobanteProveedorCompleto({ letra: 'A', puntoVenta: '1', numero: '  ' })).toBe(false);
    expect(comprobanteProveedorCompleto({ letra: '', puntoVenta: '1', numero: '123' })).toBe(false);
    expect(comprobanteProveedorCompleto({ letra: 'Z', puntoVenta: '1', numero: '123' })).toBe(false);
    expect(comprobanteProveedorCompleto({})).toBe(false);
  });
});

// Lo que Compra Rápida guarda en `compras` según el botón Libro / No libro.
describe('resolverCompraLibro', () => {
  const items = [{ cantidad: 1, costo_unitario: 1210, alicuota_iva: '21' }];
  const formLibro = {
    en_libro_iva: true, numero_factura: 'referencia que se ignora',
    tipo_comprobante_letra: 'A', punto_venta_proveedor: '1', numero_comprobante_proveedor: '123',
  };

  it('Libro: número derivado del comprobante, 3 columnas estructuradas y neto/IVA discriminados', () => {
    const r = resolverCompraLibro(formLibro, items, 1210);
    expect(r.enLibro).toBe(true);
    expect(r.numeroFactura).toBe('A-0001-00000123');
    expect(r.comprobante).toEqual({
      tipo_comprobante_letra: 'A', punto_venta_proveedor: '1', numero_comprobante_proveedor: '123',
    });
    expect(r.neto).toBeCloseTo(1000, 9);
    expect(r.iva).toBeCloseTo(210, 9);
  });

  it('Libro: recorta espacios del punto de venta y del número', () => {
    const r = resolverCompraLibro({ ...formLibro, punto_venta_proveedor: ' 1 ', numero_comprobante_proveedor: ' 123 ' }, items, 1210);
    expect(r.comprobante.punto_venta_proveedor).toBe('1');
    expect(r.comprobante.numero_comprobante_proveedor).toBe('123');
  });

  it('No libro: sin comprobante estructurado, IVA 0 y neto = total', () => {
    const r = resolverCompraLibro({ ...formLibro, en_libro_iva: false, numero_factura: 'ticket 0012-345' }, items, 1210);
    expect(r.enLibro).toBe(false);
    expect(r.numeroFactura).toBe('ticket 0012-345');
    expect(r.comprobante).toEqual({}); // las 3 columnas quedan en NULL
    expect(r.neto).toBe(1210);
    expect(r.iva).toBe(0);
  });

  it('No libro sin referencia: S/N', () => {
    expect(resolverCompraLibro({ ...formLibro, en_libro_iva: false, numero_factura: '' }, items, 1210).numeroFactura).toBe('S/N');
  });

  it('No libro usa el total tal cual (no la suma de ítems, que trunca la cantidad a entero)', () => {
    const r = resolverCompraLibro({ ...formLibro, en_libro_iva: false }, [{ cantidad: 1, costo_unitario: 1510, alicuota_iva: '21' }], 1510.5);
    expect(r.neto).toBe(1510.5);
    expect(r.iva).toBe(0);
  });

  it('un formulario sin el flag se trata como Libro', () => {
    const { en_libro_iva: _omitido, ...sinFlag } = formLibro;
    expect(resolverCompraLibro(sinFlag, items, 1210).enLibro).toBe(true);
  });

  it('Libro sin punto de venta / número (la pantalla no lo deja pasar): cae en S/N en vez de romper', () => {
    const r = resolverCompraLibro({ ...formLibro, punto_venta_proveedor: '', numero_comprobante_proveedor: '' }, items, 1210);
    expect(r.numeroFactura).toBe('S/N');
  });
});

describe('tieneCuitValido', () => {
  it('acepta 11 dígitos con o sin guiones', () => {
    expect(tieneCuitValido('30712345678')).toBe(true);
    expect(tieneCuitValido('30-71234567-8')).toBe(true);
  });
  it('rechaza vacío, corto o largo', () => {
    expect(tieneCuitValido('')).toBe(false);
    expect(tieneCuitValido(null)).toBe(false);
    expect(tieneCuitValido(undefined)).toBe(false);
    expect(tieneCuitValido('3071234567')).toBe(false);
    expect(tieneCuitValido('307123456789')).toBe(false);
  });
});
