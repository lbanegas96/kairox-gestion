import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultipago } from '@/hooks/useMultipago';

describe('useMultipago', () => {
  it('arranca con Efectivo seleccionado y sin multipago', () => {
    const { result } = renderHook(() => useMultipago(1000));
    expect(result.current.selectedMethods.has('Efectivo')).toBe(true);
    expect(result.current.selectedMethods.size).toBe(1);
    expect(result.current.isMultiPago).toBe(false);
    expect(result.current.isCC).toBe(false);
  });

  it('seleccionar Cuenta Corriente reemplaza cualquier otra selección (exclusiva)', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Tarjeta'));
    act(() => result.current.toggleMethod('Cuenta Corriente'));
    expect(result.current.selectedMethods.has('Cuenta Corriente')).toBe(true);
    expect(result.current.selectedMethods.size).toBe(1);
    expect(result.current.isCC).toBe(true);
    expect(result.current.isMultiPago).toBe(false);
  });

  it('salir de Cuenta Corriente hacia otro método resetea la selección a ese método solo', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Cuenta Corriente'));
    act(() => result.current.toggleMethod('Tarjeta'));
    expect(result.current.selectedMethods.has('Tarjeta')).toBe(true);
    expect(result.current.selectedMethods.size).toBe(1);
    expect(result.current.isCC).toBe(false);
  });

  it('no permite deseleccionar el último método activo', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Efectivo')); // único método -> no-op
    expect(result.current.selectedMethods.has('Efectivo')).toBe(true);
    expect(result.current.selectedMethods.size).toBe(1);
  });

  it('agregar un segundo método activa isMultiPago', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Tarjeta'));
    expect(result.current.isMultiPago).toBe(true);
    expect(result.current.selectedMethods.size).toBe(2);
  });

  it('Cuenta Corriente: construirPagosFinales asigna el total completo sin pedir montos', () => {
    const { result } = renderHook(() => useMultipago(1500));
    act(() => result.current.toggleMethod('Cuenta Corriente'));
    const { pagos, error } = result.current.construirPagosFinales();
    expect(error).toBeNull();
    expect(pagos).toEqual([{ metodo: 'Cuenta Corriente', monto: 1500, forma_pago_id: null }]);
  });

  it('un solo método (no CC) asigna el total completo a ese método', () => {
    const { result } = renderHook(() => useMultipago(800));
    const { pagos, error } = result.current.construirPagosFinales();
    expect(error).toBeNull();
    expect(pagos).toEqual([{ metodo: 'Efectivo', monto: 800, forma_pago_id: null }]);
  });

  it('multipago con montos que suman el total: sin error', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Tarjeta'));
    act(() => result.current.setMethodAmounts({ Efectivo: '600', Tarjeta: '400' }));
    const { pagos, error } = result.current.construirPagosFinales();
    expect(error).toBeNull();
    expect(pagos.sort((a, b) => a.metodo.localeCompare(b.metodo))).toEqual([
      { metodo: 'Efectivo', monto: 600, forma_pago_id: null },
      { metodo: 'Tarjeta', monto: 400, forma_pago_id: null },
    ]);
  });

  it('resuelve forma_pago_id por nombre cuando se pasa el maestro formasPago', () => {
    const formasPago = [{ id: 'fp-efectivo', nombre: 'Efectivo' }, { id: 'fp-tarjeta', nombre: 'Tarjeta' }];
    const { result } = renderHook(() => useMultipago(800, formasPago));
    const { pagos } = result.current.construirPagosFinales();
    expect(pagos).toEqual([{ metodo: 'Efectivo', monto: 800, forma_pago_id: 'fp-efectivo' }]);
  });

  it('multipago con montos que NO suman el total: error "Pago incompleto"', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Tarjeta'));
    act(() => result.current.setMethodAmounts({ Efectivo: '600', Tarjeta: '300' }));
    const { pagos, error } = result.current.construirPagosFinales();
    expect(pagos).toBeNull();
    expect(error.title).toBe('Pago incompleto');
  });

  it('multipago con formato de monto inválido: error "Monto inválido"', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Tarjeta'));
    act(() => result.current.setMethodAmounts({ Efectivo: '600', Tarjeta: 'abc' }));
    const { pagos, error } = result.current.construirPagosFinales();
    expect(pagos).toBeNull();
    expect(error.title).toBe('Monto inválido');
  });

  it('multipago acepta formato argentino (punto de miles, coma decimal)', () => {
    const { result } = renderHook(() => useMultipago(50000));
    act(() => result.current.toggleMethod('Tarjeta'));
    act(() => result.current.setMethodAmounts({ Efectivo: '30.000,00', Tarjeta: '20.000,00' }));
    const { pagos, error } = result.current.construirPagosFinales();
    expect(error).toBeNull();
    const efectivo = pagos.find(p => p.metodo === 'Efectivo');
    expect(efectivo.monto).toBe(30000);
  });

  it('reset vuelve al estado inicial (Efectivo, sin montos)', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Cuenta Corriente'));
    act(() => result.current.reset());
    expect(result.current.selectedMethods.has('Efectivo')).toBe(true);
    expect(result.current.selectedMethods.size).toBe(1);
    expect(result.current.methodAmounts).toEqual({});
  });

  it('restante se calcula como total menos lo pagado en multipago', () => {
    const { result } = renderHook(() => useMultipago(1000));
    act(() => result.current.toggleMethod('Tarjeta'));
    act(() => result.current.setMethodAmounts({ Efectivo: '600', Tarjeta: '0' }));
    expect(result.current.totalPagado).toBe(600);
    expect(result.current.restante).toBe(400);
  });
});
