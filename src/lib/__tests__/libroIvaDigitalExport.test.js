import { describe, it, expect } from 'vitest';
import { voucherTypeAfip, monedaAfip, tipoCambioAfip } from '@/lib/afipCodigos';
import {
  generarComprasCbte, generarComprasAlicuotas, generarVentasCbte,
} from '@/lib/libroIvaDigitalExport';

describe('voucherTypeAfip', () => {
  it('Factura A/B/C/M/E', () => {
    expect(['A', 'B', 'C', 'M', 'E'].map(l => voucherTypeAfip(l, 'venta'))).toEqual([1, 6, 11, 51, 19]);
  });
  it('Nota de Crédito A/B/C/M/E', () => {
    expect(['A', 'B', 'C', 'M', 'E'].map(l => voucherTypeAfip(l, 'nota_credito'))).toEqual([3, 8, 13, 53, 21]);
  });
  it('Nota de Débito A/B/C/M/E', () => {
    expect(['A', 'B', 'C', 'M', 'E'].map(l => voucherTypeAfip(l, 'nota_debito'))).toEqual([2, 7, 12, 52, 20]);
  });
  it('una letra desconocida sigue cayendo en B (comportamiento previo)', () => {
    expect(voucherTypeAfip('X', 'venta')).toBe(6);
    expect(voucherTypeAfip(undefined, 'nota_credito')).toBe(8);
  });
});

describe('monedaAfip / tipoCambioAfip', () => {
  it('monedas de KAIROX → código de ARCA; lo desconocido se declara en pesos', () => {
    expect(['ARS', 'USD', 'EUR', 'BRL', undefined, null, 'XXX'].map(monedaAfip))
      .toEqual(['PES', 'DOL', '060', '012', 'PES', 'PES', 'PES']);
  });
  it('PES siempre TC 1 (ARCA rechaza PES con otro TC); extranjera usa su TC; inválido → 1', () => {
    expect(tipoCambioAfip('PES', 1530)).toBe(1);
    expect(tipoCambioAfip('DOL', 1530)).toBe(1530);
    expect(tipoCambioAfip('DOL', '1530.5')).toBe(1530.5);
    expect(tipoCambioAfip('DOL', null)).toBe(1);
    expect(tipoCambioAfip('DOL', 0)).toBe(1);
  });
});

// Posiciones (0-based) de "Código de moneda" y "Tipo de cambio" en cada registro.
const COMPRAS = { moneda: [224, 227], tc: [227, 237] };
const VENTAS = { moneda: [228, 231], tc: [231, 241] };

const compra = {
  id: 'c1', fecha: '2026-09-22', tipo: 'compra',
  tipo_comprobante_letra: 'A', punto_venta_proveedor: '1', numero_comprobante_proveedor: '123',
  proveedor_nombre: 'Proveedor Test SA', proveedor_cuit: '30712345678',
  total: 12100, neto_gravado: 10000, iva_discriminado: 2100,
  moneda: 'ARS', tipo_cambio_tasa: 1,
};
const itemsCompra = { c1: [{ subtotal: 10000, alicuota_iva: '21' }] };
const lineaCompra = (c) => generarComprasCbte([c], itemsCompra).contenido.replace('\r\n', '');

describe('COMPRAS_CBTE — moneda y tipo de cambio', () => {
  it('en pesos: PES / TC 1, línea de 325 caracteres', () => {
    const l = lineaCompra(compra);
    expect(l).toHaveLength(325);
    expect(l.slice(...COMPRAS.moneda)).toBe('PES');
    expect(l.slice(...COMPRAS.tc)).toBe('0001000000');
  });
  it('en pesos con un TC cualquiera guardado: igual PES / TC 1', () => {
    const l = lineaCompra({ ...compra, tipo_cambio_tasa: 1446.61 });
    expect(l.slice(...COMPRAS.moneda)).toBe('PES');
    expect(l.slice(...COMPRAS.tc)).toBe('0001000000');
  });
  it('en USD: DOL con su TC, y los importes siguen en pesos', () => {
    const l = lineaCompra({ ...compra, moneda: 'USD', tipo_cambio_tasa: 1530 });
    expect(l).toHaveLength(325);
    expect(l.slice(...COMPRAS.moneda)).toBe('DOL');
    expect(l.slice(...COMPRAS.tc)).toBe('1530000000');
    expect(l.slice(104, 119)).toBe('000000001210000');
  });
  it('EUR → 060 y BRL → 012', () => {
    expect(lineaCompra({ ...compra, moneda: 'EUR', tipo_cambio_tasa: 1654.41 }).slice(...COMPRAS.moneda)).toBe('060');
    expect(lineaCompra({ ...compra, moneda: 'BRL', tipo_cambio_tasa: 281.01 }).slice(...COMPRAS.moneda)).toBe('012');
  });
  it('fila vieja sin moneda: PES / TC 1', () => {
    const { moneda: _omitida, ...sinMoneda } = compra;
    const l = lineaCompra(sinMoneda);
    expect(l.slice(...COMPRAS.moneda)).toBe('PES');
    expect(l.slice(...COMPRAS.tc)).toBe('0001000000');
  });
  it('letras M/E: Factura M = 051, NC M = 053, ND E = 020', () => {
    expect(lineaCompra({ ...compra, tipo_comprobante_letra: 'M' }).slice(8, 11)).toBe('051');
    expect(lineaCompra({ ...compra, tipo: 'nota_credito', tipo_comprobante_letra: 'M' }).slice(8, 11)).toBe('053');
    expect(lineaCompra({ ...compra, tipo: 'nota_debito', tipo_comprobante_letra: 'E' }).slice(8, 11)).toBe('020');
  });
  it('COMPRAS_ALICUOTAS sigue en 84 caracteres', () => {
    expect(generarComprasAlicuotas([compra], itemsCompra).contenido.replace('\r\n', '')).toHaveLength(84);
  });
});

const venta = {
  id: 'v1', tipo: 'venta', fecha: '2026-09-22', numero_afip: '0001-00000053',
  tipo_comprobante_afip: 'B', cliente_nombre: 'Cliente Test', cliente_documento: '',
  total: 12100, neto_gravado: 10000, iva_discriminado: 2100,
  moneda: 'ARS', tipo_cambio_tasa: 1,
};
const lineaVenta = (c) =>
  generarVentasCbte([c], { v1: [{ subtotal: 10000, alicuota_iva: '21' }] }).contenido.replace('\r\n', '');

describe('VENTAS_CBTE — moneda y tipo de cambio', () => {
  it('en pesos: PES / TC 1, línea de 266 caracteres', () => {
    const l = lineaVenta(venta);
    expect(l).toHaveLength(266);
    expect(l.slice(...VENTAS.moneda)).toBe('PES');
    expect(l.slice(...VENTAS.tc)).toBe('0001000000');
  });
  it('comprobante interno en USD con TC 1446,61: sale PES / TC 1 (el arca-worker autoriza todo CAE en pesos)', () => {
    const l = lineaVenta({ ...venta, moneda: 'USD', tipo_cambio_tasa: 1446.61 });
    expect(l.slice(...VENTAS.moneda)).toBe('PES');
    expect(l.slice(...VENTAS.tc)).toBe('0001000000');
  });
});
