import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TicketPrint from '@/components/caja/TicketPrint';

const VENTA_BASE = {
  numero_venta: '0001', fecha: '2026-08-05T12:00:00.000Z', total: 100,
  forma_pago: 'Efectivo', cliente_nombre: 'Consumidor Final',
};

// Modo Offline del POS — Fase 3: el ticket tiene que avisar claramente que
// una venta offline es provisoria, y NUNCA decir "CAE pendiente" sobre un
// comprobante que ni siquiera se mandó al servidor todavía.
describe('TicketPrint — Fase 3 (venta offline)', () => {
  it('venta online normal: no muestra la banda PROVISORIO', () => {
    render(<TicketPrint venta={VENTA_BASE} items={[]} empresa={{ usa_factura_electronica: true }} />);
    expect(screen.queryByText(/PROVISORIO/)).toBeNull();
  });

  it('venta offline (_offline:true): muestra la banda PROVISORIO', () => {
    render(<TicketPrint venta={{ ...VENTA_BASE, numero_venta: 'OFFLINE-123456', _offline: true, cae_estado: 'no_aplica' }} items={[]} empresa={{ usa_factura_electronica: true }} />);
    expect(screen.getByText('PROVISORIO — pendiente de sincronizar')).toBeTruthy();
  });

  it('venta offline: no dice "CAE pendiente" (cae_estado no_aplica) aunque la empresa facture electrónicamente', () => {
    render(<TicketPrint venta={{ ...VENTA_BASE, _offline: true, cae_estado: 'no_aplica' }} items={[]} empresa={{ usa_factura_electronica: true }} />);
    expect(screen.queryByText(/CAE pendiente/)).toBeNull();
  });
});
