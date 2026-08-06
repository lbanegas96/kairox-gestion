import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';

// Modo Offline del POS — Fase 1 + mejora post-Fase 3 (ping activo). El hook
// combina navigator.onLine (síncrono, vía eventos del browser) con un ping
// liviano a Supabase (asíncrono, agarra el caso "wifi conectado sin salida
// real a internet" que navigator.onLine no puede ver por sí solo).
//
// `fetch` se mockea SIEMPRE en este archivo — sin esto, el hook pega de
// verdad a `VITE_SUPABASE_URL` (stubeado a localhost:54321 en
// vitest.config.js, pero igual sería una llamada de red real e innecesaria
// en un test unitario).
describe('useOnlineStatus', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { value: true, writable: true, configurable: true });
    // Por default, el ping "funciona" — mantiene el comportamiento de los
    // tests que no ejercitan el ping en sí explícitamente.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it('pasa a false cuando el browser dispara el evento "offline"', async () => {
    const { result } = renderHook(() => useOnlineStatus());
    // Deja resolver el ping inicial (disparado al montar, porque
    // navigator.onLine ya es true) antes de seguir, para que su `setPingOk`
    // no quede afuera de ningún `act()`.
    await act(async () => {});
    expect(result.current).toBe(true);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
  });

  it('vuelve a true cuando el browser dispara "online" después de "offline" (con ping OK)', async () => {
    const { result } = renderHook(() => useOnlineStatus());
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
    act(() => window.dispatchEvent(new Event('online')));
    // navOnline pasa a true en el acto (síncrono); el ping que dispara el
    // mismo evento resuelve en un microtask — se espera explícitamente.
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('deja de escuchar los eventos después de desmontar (no actualiza estado de un componente desmontado)', () => {
    const { result, unmount } = renderHook(() => useOnlineStatus());
    unmount();
    expect(() => act(() => window.dispatchEvent(new Event('offline')))).not.toThrow();
    expect(result.current).toBe(true);
  });

  it('con navigator.onLine=true pero el ping fallando (wifi sin salida real), queda en false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
    const { result } = renderHook(() => useOnlineStatus());
    // navOnline arranca true, pero el ping inicial (disparado al montar,
    // porque navOnline ya es true) falla y baja isOnline a false.
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('un ping exitoso después de uno fallido vuelve a poner isOnline en true', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();

    const { result } = renderHook(() => useOnlineStatus());
    // El ping inicial (disparado al montar) rechaza — deja resolver ese
    // microtask (con fake timers activos, no se puede usar `waitFor` real).
    await act(async () => {});
    expect(result.current).toBe(false);

    // Avanza al siguiente ping periódico — esta vez el mock resuelve OK.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(result.current).toBe(true);
  });

  it('no pinguea mientras navigator.onLine es false (no tiene sentido sin interfaz de red)', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, writable: true, configurable: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    renderHook(() => useOnlineStatus());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
