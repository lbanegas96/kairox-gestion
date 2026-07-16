import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCreditoCliente } from '@/hooks/useCreditoCliente';

// customSupabaseClient.js tira si faltan VITE_SUPABASE_URL/ANON_KEY (no hay .env
// en el entorno de test) — se mockea entero, nunca se ejecuta el módulo real.
const mockSingle = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => mockSingle(),
        }),
      }),
    }),
  },
}));

describe('useCreditoCliente.verificarLimite', () => {
  beforeEach(() => {
    mockSingle.mockReset();
  });

  it('sin límite configurado (limite_credito <= 0): aplica=false', async () => {
    mockSingle.mockResolvedValue({ data: { saldo_actual: 500, limite_credito: 0, bloquear_en_limite: false } });
    const { result } = renderHook(() => useCreditoCliente());
    const res = await result.current.verificarLimite('cliente-1', 1000);
    expect(res).toEqual({ aplica: false });
  });

  it('dentro del límite: aplica=true, excede=false', async () => {
    mockSingle.mockResolvedValue({ data: { saldo_actual: 500, limite_credito: 2000, bloquear_en_limite: true } });
    const { result } = renderHook(() => useCreditoCliente());
    const res = await result.current.verificarLimite('cliente-1', 1000); // 500+1000=1500 <= 2000
    expect(res).toEqual({ aplica: true, excede: false });
  });

  it('excede el límite con bloquear_en_limite=true: excede=true, bloquea=true', async () => {
    mockSingle.mockResolvedValue({ data: { saldo_actual: 1800, limite_credito: 2000, bloquear_en_limite: true } });
    const { result } = renderHook(() => useCreditoCliente());
    const res = await result.current.verificarLimite('cliente-1', 500); // 1800+500=2300 > 2000
    expect(res).toEqual({ aplica: true, excede: true, bloquea: true, limite: 2000, saldoActual: 1800 });
  });

  it('excede el límite con bloquear_en_limite=false: excede=true, bloquea=false (deja pasar con aviso)', async () => {
    mockSingle.mockResolvedValue({ data: { saldo_actual: 1800, limite_credito: 2000, bloquear_en_limite: false } });
    const { result } = renderHook(() => useCreditoCliente());
    const res = await result.current.verificarLimite('cliente-1', 500);
    expect(res.excede).toBe(true);
    expect(res.bloquea).toBe(false);
  });

  it('justo en el límite (nuevoSaldo === limite) NO excede (estrictamente mayor)', async () => {
    mockSingle.mockResolvedValue({ data: { saldo_actual: 1500, limite_credito: 2000, bloquear_en_limite: true } });
    const { result } = renderHook(() => useCreditoCliente());
    const res = await result.current.verificarLimite('cliente-1', 500); // 1500+500=2000, no > 2000
    expect(res).toEqual({ aplica: true, excede: false });
  });

  it('cliente sin datos (data null): trata límite/saldo como 0 -> aplica=false', async () => {
    mockSingle.mockResolvedValue({ data: null });
    const { result } = renderHook(() => useCreditoCliente());
    const res = await result.current.verificarLimite('cliente-inexistente', 1000);
    expect(res).toEqual({ aplica: false });
  });
});
