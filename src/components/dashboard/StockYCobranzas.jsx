import { Package, ArrowUpRight, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { Skeleton } from './shared';

function StockYCobranzas({
  loading, kpis, onNavigate,
  alertasCC, aging30, aging60, aging90,
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">

      {/* Panel izquierdo: Alertas de Stock */}
      <div className="bg-kx-surface border border-kx-border rounded-2xl p-5 shadow-sm dark:shadow-none transition-all duration-200 ease-out hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:border-kx-border-hover">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[13px] font-semibold text-kx-text flex items-center gap-2">
            <Package className="w-4 h-4 text-kx-amber" /> Alertas de Stock
          </span>
          <button
            onClick={() => onNavigate?.('productos')}
            className="text-xs text-kx-text-2 hover:text-kx-text transition-colors flex items-center gap-1"
          >
            Ver todos <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3,4].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (kpis?.productosStockBajo?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center py-8 text-kx-text-3">
            <CheckCircle2 className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">Sin productos en stock bajo ✓</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {(kpis?.productosStockBajo ?? []).slice(0, 8).map(p => (
              <div key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-kx-surface-2 hover:bg-kx-border transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertCircle className="w-3.5 h-3.5 text-kx-amber flex-shrink-0" />
                  <span className="text-[12.5px] font-medium text-kx-text truncate">{p.nombre}</span>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <span className="text-sm font-bold text-kx-amber tabular-nums">{p.stock_actual}</span>
                  <span className="text-xs text-kx-text-3 ml-1">{p.unidad_medida}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Panel derecho: Cobranzas con aging */}
      <div className="bg-kx-surface border border-kx-border rounded-2xl p-5 flex flex-col shadow-sm dark:shadow-none transition-all duration-200 ease-out hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:border-kx-border-hover">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[13px] font-semibold text-kx-text flex items-center gap-2">
            <Clock className="w-4 h-4 text-kx-amber" /> Cobranzas
          </span>
          <button
            onClick={() => onNavigate?.('cuentacorriente')}
            className="text-xs text-kx-text-2 hover:text-kx-text transition-colors flex items-center gap-1"
          >
            Ver CC <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>

        {/* Aging buckets */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center p-2.5 rounded-xl bg-kx-surface-2 border border-kx-border">
            <div className="text-2xs text-kx-text-3 mb-1">30-60 días</div>
            <div className={`text-xl font-bold tabular-nums ${aging30 > 0 ? 'text-kx-amber' : 'text-kx-text-3'}`}>{aging30}</div>
            <div className="text-[9.5px] text-kx-text-3">clientes</div>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-kx-surface-2 border border-kx-border">
            <div className="text-2xs text-kx-text-3 mb-1">60-90 días</div>
            <div className={`text-xl font-bold tabular-nums ${aging60 > 0 ? 'text-orange-500 dark:text-orange-400' : 'text-kx-text-3'}`}>{aging60}</div>
            <div className="text-[9.5px] text-kx-text-3">clientes</div>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-kx-surface-2 border border-kx-border">
            <div className="text-2xs text-kx-text-3 mb-1">+90 días</div>
            <div className={`text-xl font-bold tabular-nums ${aging90 > 0 ? 'text-kx-red' : 'text-kx-text-3'}`}>{aging90}</div>
            <div className="text-[9.5px] text-kx-text-3">clientes</div>
          </div>
        </div>

        {/* Top deudores */}
        <div className="flex-1 space-y-1.5 overflow-y-auto max-h-36">
          {(alertasCC?.lista?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center py-4 text-kx-text-3">
              <CheckCircle2 className="w-7 h-7 mb-1.5 opacity-40" />
              <p className="text-sm">Sin deudas vencidas ✓</p>
            </div>
          ) : (
            alertasCC.lista.map(c => (
              <div
                key={c.id}
                onClick={() => onNavigate?.('cuentacorriente')}
                className="flex items-center justify-between p-2.5 rounded-lg bg-kx-surface-2 hover:bg-kx-border cursor-pointer transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-kx-text truncate">{c.nombre}</p>
                  <p className={`text-[10.5px] font-medium ${c.urgente ? 'text-kx-red' : 'text-kx-amber'}`}>
                    {c.diasVencido} días vencido
                  </p>
                </div>
                <span className="text-sm font-bold text-kx-text flex-shrink-0 ml-2 tabular-nums">
                  ${Number(c.saldo).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Total vencido */}
        {(alertasCC?.montoTotal ?? 0) > 0 && (
          <div className="mt-3 pt-3 border-t border-kx-border flex items-center justify-between">
            <span className="text-2xs text-kx-text-2 uppercase tracking-wide font-medium">Total vencido</span>
            <span className="text-sm font-bold text-kx-red tabular-nums">
              ${(alertasCC.montoTotal).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default StockYCobranzas;
