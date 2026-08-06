import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClienteDrillDown from '@/components/shared/ClienteDrillDown';

const mockFrom = vi.fn();
vi.mock('@/lib/customSupabaseClient', () => ({
  supabase: { from: (...args) => mockFrom(...args) },
}));

vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useAuth: () => ({ user: { empresa_id: 'empresa-1' } }),
}));

// Chains mínimas para reproducir lo que ClienteDrillDown realmente encadena:
// clientes/empresas terminan en `.single()` (Promise), comprobantes en `.limit()`
// (thenable de supabase-js, se resuelve directo al esperarlo).
function singleChain(result) {
  const chain = { select: () => chain, eq: () => chain, single: () => Promise.resolve(result) };
  return chain;
}
function listChain(result) {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => Promise.resolve(result) };
  return chain;
}

const CLIENTE = { id: 'cli-1', nombre: 'Juan Pérez' };

// Fidelización por puntos — Fase 2: el drill-down (compartido entre el
// ClienteSelector del POS y el del ERP) es "el lugar natural" para mostrar el
// saldo acumulado, según lo dejó anotado la investigación inicial.
describe('ClienteDrillDown — Saldo de Puntos (Fase 2)', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('empresa con fidelización activa: muestra el saldo de puntos del cliente', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'clientes') return singleChain({ data: { saldo_actual: 0, limite_credito: null, saldo_puntos: 40 } });
      if (table === 'comprobantes') return listChain({ data: [] });
      if (table === 'empresas') return singleChain({ data: { usa_fidelizacion: true } });
      return singleChain({ data: null });
    });

    render(<ClienteDrillDown cliente={CLIENTE} />);
    fireEvent.click(screen.getByRole('button', { name: /Ver info de Juan Pérez/ }));

    expect(await screen.findByText('Saldo de Puntos')).toBeTruthy();
    expect(await screen.findByText('40 pts')).toBeTruthy();
  });

  it('empresa sin fidelización: no muestra el bloque de puntos, aunque el cliente tenga saldo_puntos > 0', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'clientes') return singleChain({ data: { saldo_actual: 0, limite_credito: null, saldo_puntos: 40 } });
      if (table === 'comprobantes') return listChain({ data: [] });
      if (table === 'empresas') return singleChain({ data: { usa_fidelizacion: false } });
      return singleChain({ data: null });
    });

    render(<ClienteDrillDown cliente={CLIENTE} />);
    fireEvent.click(screen.getByRole('button', { name: /Ver info de Juan Pérez/ }));

    // Esperar a que termine de cargar (aparece el saldo de cta. cte., que sí es incondicional).
    await waitFor(() => expect(screen.queryByText(/Cargando/)).toBeNull());
    expect(screen.queryByText('Saldo de Puntos')).toBeNull();
  });

  it('el saldo de Cuenta Corriente sigue mostrándose igual que antes (sin regresión)', async () => {
    mockFrom.mockImplementation((table) => {
      if (table === 'clientes') return singleChain({ data: { saldo_actual: 1500, limite_credito: 5000, saldo_puntos: 0 } });
      if (table === 'comprobantes') return listChain({ data: [] });
      if (table === 'empresas') return singleChain({ data: { usa_fidelizacion: false } });
      return singleChain({ data: null });
    });

    render(<ClienteDrillDown cliente={CLIENTE} />);
    fireEvent.click(screen.getByRole('button', { name: /Ver info de Juan Pérez/ }));

    expect(await screen.findByText('Saldo Cta. Corriente')).toBeTruthy();
    expect(await screen.findByText('$1.500,00')).toBeTruthy();
  });
});
