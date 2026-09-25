import { describe, it, expect } from 'vitest';
import {
  esFacturaProveedorDuplicada,
  mensajeErrorCompra,
  MSG_FACTURA_DUPLICADA,
} from '../erroresCompra';

describe('erroresCompra — factura de proveedor duplicada (mig.411)', () => {
  const errorPostgrest = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "uq_compras_factura_proveedor"',
    details: 'Key (empresa_id, proveedor_id, upper(btrim(numero_factura::text)))=(...) already exists.',
  };

  it('reconoce el error crudo de Postgres/PostgREST', () => {
    expect(esFacturaProveedorDuplicada(errorPostgrest)).toBe(true);
  });

  it('reconoce el error cuando un servicio lo envolvió en un Error nuevo (solo queda el mensaje)', () => {
    expect(esFacturaProveedorDuplicada(new Error(errorPostgrest.message))).toBe(true);
  });

  it('reconoce el nombre del índice aunque venga solo en details o en hint', () => {
    expect(esFacturaProveedorDuplicada({ message: 'error', details: 'viola uq_compras_factura_proveedor' })).toBe(true);
    expect(esFacturaProveedorDuplicada({ message: 'error', hint: 'uq_compras_factura_proveedor' })).toBe(true);
  });

  it('no confunde otras violaciones únicas ni otros errores', () => {
    expect(esFacturaProveedorDuplicada({ code: '23505', message: 'duplicate key value violates unique constraint "productos_pkey"' })).toBe(false);
    expect(esFacturaProveedorDuplicada(new Error('Falta configurar las cuentas contables'))).toBe(false);
    expect(esFacturaProveedorDuplicada(null)).toBe(false);
    expect(esFacturaProveedorDuplicada(undefined)).toBe(false);
  });

  it('mensajeErrorCompra devuelve el texto amigable para la factura duplicada', () => {
    expect(mensajeErrorCompra(errorPostgrest)).toBe(MSG_FACTURA_DUPLICADA);
    expect(MSG_FACTURA_DUPLICADA).toMatch(/ya hay una factura/i);
  });

  it('mensajeErrorCompra deja pasar el mensaje original de cualquier otro error', () => {
    expect(mensajeErrorCompra(new Error('Período cerrado: la fecha 2026-06-01 pertenece a un período contable cerrado'))).toBe(
      'Período cerrado: la fecha 2026-06-01 pertenece a un período contable cerrado'
    );
  });

  it('mensajeErrorCompra usa un texto por defecto si el error no trae mensaje', () => {
    expect(mensajeErrorCompra({})).toBe('Ocurrió un error inesperado');
    expect(mensajeErrorCompra(undefined, 'Falló')).toBe('Falló');
  });
});
