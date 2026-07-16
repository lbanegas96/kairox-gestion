import { describe, it, expect } from 'vitest';
import { determinarTipoComprobante } from '@/hooks/useAfipConfig';

// Reglas fiscales (RG AFIP), ver comentario en useAfipConfig.js:
//   RI + RI               -> A
//   RI + cualquier otro    -> B
//   Monotributo (emisor)   -> C siempre, sin importar receptor
//   Exento (emisor)        -> C siempre, sin importar receptor
describe('determinarTipoComprobante', () => {
  it('RI a RI -> Factura A', () => {
    expect(determinarTipoComprobante('RI', 'RI')).toBe('A');
  });

  it('acepta el alias largo "Responsable Inscripto" como equivalente a RI', () => {
    expect(determinarTipoComprobante('Responsable Inscripto', 'Responsable Inscripto')).toBe('A');
    expect(determinarTipoComprobante('RI', 'Responsable Inscripto')).toBe('A');
  });

  it('RI a Consumidor Final -> Factura B', () => {
    expect(determinarTipoComprobante('RI', 'CF')).toBe('B');
  });

  it('RI a Exento -> Factura B', () => {
    expect(determinarTipoComprobante('RI', 'Exento')).toBe('B');
  });

  it('RI a Monotributo -> Factura B', () => {
    expect(determinarTipoComprobante('RI', 'Monotributo')).toBe('B');
  });

  it('Monotributo (emisor) siempre factura C, sin importar el receptor', () => {
    expect(determinarTipoComprobante('Monotributo', 'RI')).toBe('C');
    expect(determinarTipoComprobante('Monotributo', 'CF')).toBe('C');
    expect(determinarTipoComprobante('Monotributo', 'Exento')).toBe('C');
  });

  it('Exento (emisor) siempre factura C, sin importar el receptor', () => {
    expect(determinarTipoComprobante('Exento', 'RI')).toBe('C');
    expect(determinarTipoComprobante('Exento', 'CF')).toBe('C');
  });

  it('condición de emisor desconocida cae a Factura B (fallback seguro)', () => {
    expect(determinarTipoComprobante('condicion_invalida', 'RI')).toBe('B');
    expect(determinarTipoComprobante(undefined, 'RI')).toBe('B');
  });
});
