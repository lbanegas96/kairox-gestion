import { Users, ArrowUpRight } from 'lucide-react';
import { Skeleton } from './shared';

function TopClientes({ topLoading, topClientes, maxTopTotal, onNavigate }) {
  return (
    <div className="bg-kx-surface border border-kx-border rounded-2xl p-5 shadow-sm dark:shadow-none transition-all duration-200 ease-out hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:border-kx-border-hover">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[13px] font-semibold text-kx-text flex items-center gap-2">
          <Users className="w-4 h-4 text-kx-violet" /> Top Clientes del Mes
        </span>
        <button
          onClick={() => onNavigate?.('clientes')}
          className="text-xs text-kx-text-2 hover:text-kx-text transition-colors flex items-center gap-1"
        >
          Ver clientes <ArrowUpRight className="w-3 h-3" />
        </button>
      </div>

      {topLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : topClientes.length === 0 ? (
        <div className="flex flex-col items-center py-6 text-kx-text-3">
          <Users className="w-7 h-7 mb-2 opacity-30" />
          <p className="text-sm">Sin ventas a clientes identificados este mes</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {topClientes.map((c, i) => {
            const pct = (c.total / maxTopTotal) * 100;
            // Oro/plata/bronce: tono oscuro en light (AA) + tono claro original en dark.
            const rankColors = [
              'text-yellow-700 dark:text-yellow-500',
              'text-slate-600 dark:text-slate-400',
              'text-amber-700 dark:text-amber-600',
              'text-kx-text-3',
              'text-kx-text-3',
            ];
            return (
              <div key={c.nombre} className="bg-kx-surface-2 rounded-xl p-3 border border-kx-border">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-bold tabular-nums ${rankColors[i] ?? 'text-kx-text-3'}`}>#{i + 1}</span>
                  <span className="text-[12px] font-semibold text-kx-text truncate">{c.nombre}</span>
                </div>
                <div className="text-sm font-bold text-kx-text tabular-nums mb-1.5">${c.total.toLocaleString('es-AR', { minimumFractionDigits: 0 })}</div>
                <div className="h-1.5 bg-kx-border rounded-full overflow-hidden">
                  <div className="h-full bg-kx-violet rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-2xs text-kx-text-3 mt-1">{c.count} comprobante{c.count !== 1 ? 's' : ''}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TopClientes;
