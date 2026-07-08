import { TrendingUp, TrendingDown, ArrowUpRight, Receipt } from 'lucide-react';
import { fmt, fmtK, Skeleton } from './shared';

function KpiGrids({
  loading, kpis, variacion, variacionLabel, balanceNeto, dsoHealth,
  onNavigate,
}) {
  return (
    <>
      {/* ── KPI row — Operaciones ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
        {/* Ventas del día */}
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between border-t-2 border-t-kx-violet hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Ventas del día</div>
          <div>
            {loading ? <Skeleton className="h-6 w-28 mb-1" /> :
              <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">${fmt(kpis?.ventasHoy)}</div>}
            <div className={`text-[11.5px] flex items-center gap-1 ${variacion >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
              {variacion >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {variacionLabel}
            </div>
          </div>
        </div>

        {/* Gastos del mes */}
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between border-t-2 border-t-kx-red hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Gastos del mes</div>
          <div>
            {loading ? <Skeleton className="h-6 w-28 mb-1" /> :
              <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">${fmt(kpis?.gastosMes)}</div>}
            <div className="text-[11.5px] text-kx-text-3">Egresos acumulados</div>
          </div>
        </div>

        {/* Balance neto */}
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between border-t-2 border-t-kx-green hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Balance neto</div>
          <div>
            {loading ? <Skeleton className="h-6 w-28 mb-1" /> :
              <div className={`text-xl font-semibold tracking-tight tabular-nums mb-1 ${balanceNeto >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
                ${fmt(balanceNeto)}
              </div>}
            <div className={`text-[11.5px] flex items-center gap-1 ${balanceNeto >= 0 ? 'text-kx-green' : 'text-kx-red'}`}>
              {balanceNeto >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {balanceNeto >= 0 ? 'Superávit' : 'Déficit'}
            </div>
          </div>
        </div>

        {/* Deuda clientes */}
        <div
          className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between cursor-pointer border-t-2 border-t-kx-amber hover:bg-kx-surface-2 transition-colors duration-200"
          onClick={() => onNavigate?.('cuentacorriente')}
        >
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Deuda clientes</div>
          <div>
            {loading ? <Skeleton className="h-6 w-28 mb-1" /> :
              <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">${fmt(kpis?.deudaClientes)}</div>}
            <div className="text-[11.5px] text-kx-text-3 flex items-center gap-1">
              Cuentas corrientes <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </div>

      {/* ── KPI row — Salud Financiera ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">

        {/* DSO — Días en cobrar */}
        <div className={`bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between border-t-2 ${dsoHealth.border} hover:bg-kx-surface-2 transition-colors duration-200`}>
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium flex items-center gap-1">
            DSO
            <span className="text-[9px] normal-case font-normal text-kx-text-3">(días en cobrar)</span>
          </div>
          <div>
            {loading ? <Skeleton className="h-6 w-20 mb-1" /> :
              <div className={`text-xl font-semibold tracking-tight tabular-nums mb-1 ${dsoHealth.color}`}>
                {kpis?.dso !== null && kpis?.dso !== undefined ? `${kpis.dso} días` : '—'}
              </div>}
            <div className={`text-[11.5px] flex items-center gap-1 ${dsoHealth.color}`}>
              {dsoHealth.icon}
              {dsoHealth.label}
            </div>
          </div>
        </div>

        {/* Facturas del mes */}
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between border-t-2 border-t-kx-violet hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium flex items-center gap-1">
            <Receipt className="w-3 h-3" /> Facturas del mes
          </div>
          <div>
            {loading ? <Skeleton className="h-6 w-16 mb-1" /> :
              <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">
                {kpis?.facturasMesCount ?? 0}
              </div>}
            <div className="text-[11.5px] text-kx-text-3">{fmtK(kpis?.facturasMesTotal ?? 0)} facturado</div>
          </div>
        </div>

        {/* Ticket promedio */}
        <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between border-t-2 border-t-kx-blue hover:bg-kx-surface-2 transition-colors duration-200">
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Ticket promedio</div>
          <div>
            {loading ? <Skeleton className="h-6 w-24 mb-1" /> :
              <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">
                {kpis?.ticketPromedio ? fmtK(kpis.ticketPromedio) : '—'}
              </div>}
            <div className="text-[11.5px] text-kx-text-3">por comprobante</div>
          </div>
        </div>

        {/* OC pendientes */}
        <div
          className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between cursor-pointer border-t-2 border-t-kx-amber hover:bg-kx-surface-2 transition-colors duration-200"
          onClick={() => onNavigate?.('ordenes_compra')}
        >
          <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">OC pendientes</div>
          <div>
            {loading ? <Skeleton className="h-6 w-10 mb-1" /> :
              <div className={`text-xl font-semibold tracking-tight tabular-nums mb-1 ${(kpis?.ocPendientes ?? 0) > 0 ? 'text-kx-amber' : 'text-kx-text'}`}>
                {kpis?.ocPendientes ?? 0}
              </div>}
            <div className="text-[11.5px] text-kx-text-3 flex items-center gap-1">
              Órdenes activas <ArrowUpRight className="w-3 h-3" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default KpiGrids;
