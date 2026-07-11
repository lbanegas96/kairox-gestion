import { TrendingUp, TrendingDown, Archive, Wallet, Banknote } from 'lucide-react';
import { fmt, Skeleton } from './shared';

function HeroRow({ loading, kpis, variacion, variacionLabel, cajaLoading, isSessionOpen, currentSession }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_1fr] gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
      {/* Ventas del mes */}
      <div className="bg-kx-surface p-5 min-h-[140px] flex flex-col border-t-2 border-t-kx-violet hover:bg-kx-surface-2 transition-colors duration-200">
        <div className="text-[11.5px] text-kx-text-2 mb-2.5 flex items-center gap-1.5">
          <TrendingUp className="w-3.5 h-3.5" /> Ventas del mes
        </div>
        {loading ? (
          <><Skeleton className="h-9 w-40 mb-2" /><Skeleton className="h-4 w-28" /></>
        ) : (
          <>
            <div className="text-[34px] font-semibold text-kx-text tracking-tight leading-none mb-2 tabular-nums">
              ${fmt(kpis?.ventasMes)}
            </div>
            <div className={`text-xs flex items-center gap-1.5 ${variacion >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
              {variacion >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {variacionLabel}
            </div>
          </>
        )}
      </div>

      {/* Caja */}
      <div className="bg-kx-surface p-5 min-h-[140px] flex flex-col border-t-2 border-t-kx-green hover:bg-kx-surface-2 transition-colors duration-200">
        <div className="text-[11.5px] text-kx-text-2 mb-2.5 flex items-center gap-1.5">
          <Archive className="w-3.5 h-3.5" /> Caja
        </div>
        {cajaLoading ? (
          <><Skeleton className="h-7 w-24 mb-2" /><Skeleton className="h-4 w-36" /></>
        ) : (
          <>
            <div className={`text-[26px] font-semibold tracking-tight leading-none mb-2 ${isSessionOpen ? 'text-kx-green' : 'text-kx-text'}`}>
              {isSessionOpen ? 'Abierta' : 'Cerrada'}
            </div>
            <div className="text-xs text-kx-text-2">
              {isSessionOpen && currentSession
                ? `Saldo inicial $${fmt(currentSession.monto_inicial)}`
                : 'Abrí la caja para operar'}
            </div>
          </>
        )}
      </div>

      {/* Contado del mes: qué % de lo facturado en el mes se cobró en el acto
          (ventas al contado / total facturado). Reemplaza al viejo "margen bruto",
          que era engañoso sin COGS (llegaba a 92%+ y sonaba a rentabilidad — hallazgo
          auditoría sesión 59, decisión sesión 60). Este sí es un número real y
          accionable: cuánto vendés al contado vs cuánto queda en cuenta corriente. */}
      <div className="bg-kx-surface p-5 min-h-[140px] flex flex-col border-t-2 border-t-kx-blue hover:bg-kx-surface-2 transition-colors duration-200">
        <div className="text-[11.5px] text-kx-text-2 mb-2.5 flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5" /> Contado (mes)
        </div>
        {loading ? (
          <><Skeleton className="h-7 w-20 mb-2" /><Skeleton className="h-4 w-24" /></>
        ) : (
          <>
            <div className="text-[26px] font-semibold text-kx-text tracking-tight leading-none mb-2 tabular-nums">
              {(kpis?.tasaContado ?? 0).toFixed(1)}%
            </div>
            <div className="text-xs flex items-center gap-1.5 text-kx-text-2">
              <Banknote className="w-3.5 h-3.5" />
              De lo facturado, cobrado en el acto
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default HeroRow;
