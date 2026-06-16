import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Loader2, History, TrendingUp, ShoppingBag, CreditCard } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { formatDateAR, formatTimeAR } from '@/lib/dateUtils';

const fmt = (n) =>
  Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function KpiCard({ icon: Icon, label, value, accent = 'text-kx-text' }) {
  return (
    <div className="bg-kx-surface-2 rounded-xl p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-kx-surface flex items-center justify-center flex-shrink-0">
        <Icon className={`w-4 h-4 ${accent}`} />
      </div>
      <div>
        <p className="text-[10px] text-kx-text-3 uppercase tracking-wide">{label}</p>
        <p className={`text-base font-bold tabular-nums ${accent}`}>{value}</p>
      </div>
    </div>
  );
}

function HistorialTurnoModal({ open, onOpenChange }) {
  const { user }           = useAuth();
  const { currentSession } = useCaja();
  const [ventas, setVentas] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !user?.empresa_id) return;
    fetchVentas();
  }, [open, user?.empresa_id, currentSession?.apertura_fecha]);

  const fetchVentas = async () => {
    setLoading(true);
    try {
      // Las ventas no tienen user_id (no existe la columna). Filtramos por turno:
      // todas las ventas con fecha >= apertura del turno actual. Si el turno está
      // cerrado, también respetamos cierre_fecha como tope.
      const inicioDeTurno = currentSession?.apertura_fecha ?? new Date(0).toISOString();
      let q = supabase
        .from('comprobantes')
        .select('id, numero_venta, total, fecha, cliente_nombre, forma_pago, estado_pago, moneda')
        .eq('empresa_id', user.empresa_id)
        .gte('fecha', inicioDeTurno)
        .order('fecha', { ascending: false });
      if (currentSession?.cierre_fecha) {
        q = q.lte('fecha', currentSession.cierre_fecha);
      }
      const { data } = await q;
      setVentas(data ?? []);
    } finally {
      setLoading(false);
    }
  };

  // KPIs del turno
  const totalVendido = ventas.reduce((s, v) => s + Number(v.total ?? 0), 0);
  const nroTransacciones = ventas.length;

  const porMetodo = ventas.reduce((acc, v) => {
    const m = v.forma_pago || 'Otro';
    acc[m] = (acc[m] ?? 0) + Number(v.total ?? 0);
    return acc;
  }, {});

  const horaInicio = currentSession?.apertura_fecha
    ? new Date(currentSession.apertura_fecha).toLocaleString('es-AR', {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })
    : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-kx-surface border-kx-border text-kx-text max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-kx-violet" />
            Mi Turno
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            Ventas registradas desde {horaInicio}
          </DialogDescription>
        </DialogHeader>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 flex-shrink-0">
          <KpiCard icon={TrendingUp} label="Total vendido"
            value={`$${fmt(totalVendido)}`} accent="text-kx-green" />
          <KpiCard icon={ShoppingBag} label="Transacciones"
            value={nroTransacciones} accent="text-kx-blue" />
          <KpiCard icon={CreditCard} label="Efectivo"
            value={`$${fmt(porMetodo['Efectivo'] ?? 0)}`} accent="text-kx-text" />
        </div>

        {/* Por método */}
        {Object.keys(porMetodo).length > 1 && (
          <div className="flex gap-2 flex-wrap flex-shrink-0">
            {Object.entries(porMetodo).map(([m, monto]) => (
              <div key={m} className="text-xs bg-kx-surface-2 border border-kx-border rounded-lg px-2 py-1">
                <span className="text-kx-text-3">{m}: </span>
                <span className="font-semibold text-kx-text">${fmt(monto)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tabla de ventas */}
        <div className="flex-1 overflow-y-auto rounded-xl border border-kx-border">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-kx-text-3" />
            </div>
          ) : ventas.length === 0 ? (
            <div className="text-center text-kx-text-3 text-sm py-10">
              Sin ventas en este turno
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-kx-surface-2 border-b border-kx-border">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-kx-text-2">Nro.</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-kx-text-2">Hora</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-kx-text-2">Cliente</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-kx-text-2">Pago</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-kx-text-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-kx-border">
                {ventas.map(v => (
                  <tr key={v.id} className="hover:bg-kx-surface-2 transition-colors">
                    <td className="px-3 py-2 font-mono text-xs text-kx-text-3">{v.numero_venta}</td>
                    <td className="px-3 py-2 text-xs text-kx-text-2">{formatTimeAR(v.fecha)}</td>
                    <td className="px-3 py-2 text-kx-text truncate max-w-[140px]">
                      {v.cliente_nombre || <span className="text-kx-text-3 italic">CF</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-kx-text-2">{v.forma_pago}</td>
                    <td className="px-3 py-2 text-right font-bold text-kx-text tabular-nums">
                      ${fmt(v.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default HistorialTurnoModal;
