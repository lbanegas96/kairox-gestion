import React, { useState, useEffect } from 'react';
import { Eye, X, CreditCard, ShoppingBag, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { formatDateAR } from '@/lib/dateUtils';

function ProveedorDrillDown({ proveedor }) {
  const { user } = useAuth();
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo]       = useState(null);

  const fetchInfo = async () => {
    if (!proveedor?.id || !user?.empresa_id) return;
    setLoading(true);
    try {
      // Proveedores no tiene saldo_actual; lo calculamos sumando movimientos.
      const [{ data: movs }, { data: ocs }] = await Promise.all([
        supabase
          .from('cuenta_corriente_proveedores')
          .select('tipo, monto')
          .eq('empresa_id', user.empresa_id)
          .eq('proveedor_id', proveedor.id),
        supabase
          .from('ordenes_compra')
          .select('numero, created_at, total')
          .eq('empresa_id', user.empresa_id)
          .eq('proveedor_id', proveedor.id)
          .order('created_at', { ascending: false })
          .limit(3),
      ]);
      const saldo = (movs ?? []).reduce((acc, m) => {
        if (m.tipo === 'compra' || m.tipo === 'nota_debito') return acc + Number(m.monto);
        if (m.tipo === 'pago'   || m.tipo === 'nota_credito') return acc - Number(m.monto);
        return acc;
      }, 0);
      setInfo({ cc: { saldo }, ocs: ocs || [] });
    } catch {
      setInfo({ cc: null, ocs: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) fetchInfo();
    else setInfo(null);
  }, [open, proveedor?.id]);

  if (!proveedor) return null;

  return (
    <div className="relative inline-block">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-kx-text-2 hover:text-kx-text"
        onClick={() => setOpen(v => !v)}
        title={`Ver info de ${proveedor.nombre}`}
      >
        <Eye className="h-4 w-4" />
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div className="absolute left-0 top-10 z-50 w-72 rounded-xl border border-kx-border bg-kx-surface shadow-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-kx-text text-sm truncate">{proveedor.nombre}</p>
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
                </div>

                {info?.ocs?.length > 0 ? (
                  <div>
                    <p className="text-xs font-semibold text-kx-text-3 uppercase mb-1.5">Últimas OC</p>
                    <div className="space-y-1">
                      {info.ocs.map(oc => (
                        <div key={oc.numero} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5 text-kx-text-2">
                            <ShoppingBag className="h-3 w-3 shrink-0" />
                            <span className="font-mono">{oc.numero}</span>
                            <span className="text-kx-text-3">{formatDateAR(oc.created_at)}</span>
                          </div>
                          <span className="font-mono font-medium text-kx-text">
                            ${Number(oc.total).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-kx-text-3">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    Sin órdenes de compra anteriores
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

export default ProveedorDrillDown;
