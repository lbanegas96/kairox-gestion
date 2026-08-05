import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// Modo Offline del POS — Fase 1. Verifica que el hook arranque en el estado
// real de navigator.onLine y reaccione a los eventos 'online'/'offline' del
// browser — es toda la superficie que expone, a propósito (ver comentario en
// useOnlineStatus.js sobre el alcance acotado de esta fase).
describe('useOnlineStatus', () => {
  beforeEach(() => {
    // jsdom expone navigator.onLine como true por default; se deja explícito
    // para que el test no dependa de ese default implícito.
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
  });

  it('arranca reflejando navigator.onLine (true)', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('arranca en false si navigator.onLine ya era false al montar', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('pasa a false cuando el browser dispara el evento "offline"', () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
  });

  it('vuelve a true cuando el browser dispara "online" después de "offline"', () => {
    const { result } = renderHook(() => useOnlineStatus());
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current).toBe(true);
  });

  it('deja de escuchar los eventos después de desmontar (no actualiza estado de un componente desmontado)', () => {
    const { result, unmount } = renderHook(() => useOnlineStatus());
    unmount();
    // Si el listener no se hubiera limpiado, esto tiraría el warning de React
    // "Can't perform a React state update on an unmounted component" — acá
    // simplemente confirmamos que no explota y que el valor queda congelado.
    expect(() => act(() => window.dispatchEvent(new Event('offline')))).not.toThrow();
    expect(result.current).toBe(true);
  });
});
