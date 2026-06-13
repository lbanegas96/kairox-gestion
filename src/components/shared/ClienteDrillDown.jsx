import React, { useState, useEffect } from 'react';
import { Eye, X, CreditCard, Receipt, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';

/**
 * ClienteDrillDown — botón ojo que abre popover con info del cliente.
 * props:
 *   cliente: { id, nombre } | null
 */
function ClienteDrillDown({ cliente }) {
  const { user } = useAuth();
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo]       = useState(null);

  const fetchInfo = async () => {
    if (!cliente?.id || !user?.empresa_id) return;
    setLoading(true);
    try {
      const [{ data: cc }, { data: ventas }] = await Promise.all([
        supabase
          .from('cuenta_corriente_clientes')
          .select('saldo, limite_credito')
          .eq('empresa_id', user.empresa_id)
          .eq('cliente_id', cliente.id)
          .single(),
        supabase
          .from('comprobantes')
          .select('numero_venta, fecha, total')
          .eq('empresa_id', user.empresa_id)
          .eq('cliente_id', cliente.id)
          .in('tipo', ['factura', 'ticket'])
          .order('fecha', { ascending: false })
          .limit(3),
      ]);
      setInfo({ cc: cc || null, ventas: ventas || [] });
    } catch {
      setInfo({ cc: null, ventas: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchInfo();
    else setInfo(null);
  }, [open, cliente?.id]);

  if (!cliente) return null;

  return (
    <div className="relative inline-block">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-kx-text-2 hover:text-kx-text"
        onClick={() => setOpen(v => !v)}
        title={`Ver info de ${cliente.nombre}`}
      >
        <Eye className="h-4 w-4" />
      </Button>

      {open && (
        <>
          {/* Overlay for click-outside */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute left-0 top-10 z-50 w-72 rounded-xl border border-kx-border bg-kx-surface shadow-xl p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <p className="font-semibold text-kx-text text-sm truncate">{cliente.nombre}</p>
              <button onClick={() => setOpen(false)} className="text-kx-text-3 hover:text-kx-text">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2].map(i => (
                  <div key={i} className="h-4 bg-kx-surface-2 rounded animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {/* Saldo Cta Cte */}
                <div className="flex items-center gap-2 p-2 rounded-lg bg-kx-surface-2">
                  <CreditCard className="h-4 w-4 text-kx-text-3 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-kx-text-3">Saldo Cta. Corriente</p>
                    {info?.cc ? (
                      <p className={`font-mono font-semibold text-sm ${Number(info.cc.saldo) > 0 ? 'text-[rgb(var(--kx-red))]' : 'text-[rgb(var(--kx-green))]'}`}>
                        ${Number(info.cc.saldo || 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </p>
                    ) : (
                      <p className="text-xs text-kx-text-3">Sin cuenta corriente</p>
                    )}
                  </div>
                  {info?.cc?.limite_credito && (
                    <div className="text-right shrink-0">
                      <p className="text-xs text-kx-text-3">Límite</p>
                      <p className="font-mono text-xs text-kx-text-2">
                        ${Number(info.cc.limite_credito).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                      </p>
                    </div>
                  )}
                </div>

                {/* Últimas compras */}
                {info?.ventas?.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-kx-text-3 uppercase mb-1.5">Últimas compras</p>
                    <div className="space-y-1">
                      {info.ventas.map(v => (
                        <div key={v.numero_venta} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 text-kx-text-2">
                            <Receipt className="h-3 w-3 shrink-0" />
                            <span className="font-mono">{v.numero_venta}</span>
                            <span className="text-kx-text-3">{formatDateAR(v.fecha)}</span>
                          </div>
                          <span className="font-mono font-medium text-kx-text">
                            ${Number(v.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-kx-text-3">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Sin comprobantes anteriores
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default ClienteDrillDown;
