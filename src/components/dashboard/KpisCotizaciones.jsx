import { Skeleton } from './shared';

function KpisCotizaciones({ cotLoading, cotStats, onNavigate }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
      <div
        className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between cursor-pointer border-t-2 border-t-kx-violet hover:bg-kx-surface-2 transition-colors duration-200"
        onClick={() => onNavigate?.('cotizaciones')}
      >
        <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Cotizaciones / mes</div>
        <div>
          {cotLoading ? <Skeleton className="h-6 w-12 mb-1" /> :
            <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">{cotStats?.totalMes ?? 0}</div>}
          <div className="text-[11.5px] text-kx-text-3">${(cotStats?.montoMes ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })} cotizado</div>
        </div>
      </div>
      <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between border-t-2 border-t-kx-green hover:bg-kx-surface-2 transition-colors duration-200">
        <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Tasa de conversión</div>
        <div>
          {cotLoading ? <Skeleton className="h-6 w-16 mb-1" /> :
            <div className={`text-xl font-semibold tracking-tight tabular-nums mb-1 ${(cotStats?.tasaConversion ?? 0) >= 50 ? 'text-kx-green' : 'text-kx-amber'}`}>
              {(cotStats?.tasaConversion ?? 0).toFixed(0)}%
            </div>}
          <div className="text-[11.5px] text-kx-text-3">{cotStats?.convertidas ?? 0} convertidas</div>
        </div>
      </div>
      <div
        className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between cursor-pointer border-t-2 border-t-kx-violet hover:bg-kx-surface-2 transition-colors duration-200"
        onClick={() => onNavigate?.('cotizaciones')}
      >
        <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Aprobadas pendientes</div>
        <div>
          {cotLoading ? <Skeleton className="h-6 w-10 mb-1" /> :
            <div className={`text-xl font-semibold tracking-tight tabular-nums mb-1 ${(cotStats?.aprobadas ?? 0) > 0 ? 'text-kx-violet' : 'text-kx-text'}`}>
              {cotStats?.aprobadas ?? 0}
            </div>}
          <div className="text-[11.5px] text-kx-text-3 flex items-center gap-1">
            {(cotStats?.aprobadas ?? 0) > 0 ? 'Listas para convertir' : 'Sin pendientes ✓'}
          </div>
        </div>
      </div>
      <div className="bg-kx-surface p-4 min-h-[88px] flex flex-col justify-between border-t-2 border-t-kx-amber hover:bg-kx-surface-2 transition-colors duration-200">
        <div className="text-[11px] text-kx-text-2 uppercase tracking-wide font-medium">Monto convertido</div>
        <div>
          {cotLoading ? <Skeleton className="h-6 w-28 mb-1" /> :
            <div className="text-xl font-semibold text-kx-text tracking-tight tabular-nums mb-1">
              ${(cotStats?.montoConvertido ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })}
            </div>}
          <div className="text-[11.5px] text-kx-text-3">
            de ${(cotStats?.montoMes ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 0 })} cotizado
          </div>
        </div>
      </div>
    </div>
  );
}

export default KpisCotizaciones;
