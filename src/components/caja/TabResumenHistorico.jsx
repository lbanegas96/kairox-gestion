import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateAR } from '@/lib/dateUtils';
import { formatAmount, getPeriodLabel } from './shared';

function TabResumenHistorico({
  reportPeriod, setReportPeriod,
  customDateRange, setCustomDateRange,
  lastUpdate,
  summaryData,
}) {
  return (
    <div className="space-y-6">
      <div className="kairox-bg-card p-4 rounded-xl border kairox-border text-center mb-4 dark:bg-kx-bg dark:border-kx-border">
        <p className="text-sm text-slate-500 dark:text-kx-text-2">Este resumen muestra datos históricos globales.</p>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 kairox-bg-card p-4 rounded-xl border kairox-border dark:bg-kx-bg dark:border-kx-border">
        <div className="flex flex-col gap-2 w-full md:w-auto">
           <div className="flex flex-wrap gap-2">
             {['today', 'thisWeek', 'thisMonth', 'last30', 'custom'].map((period) => (
               <Button key={period} variant={reportPeriod === period ? "default" : "outline"} size="sm" onClick={() => setReportPeriod(period)} className={reportPeriod === period ? 'bg-blue-600 text-white' : 'dark:text-slate-300 dark:border-kx-border dark:hover:bg-slate-800'}>
                 {getPeriodLabel(period)}
               </Button>
             ))}
           </div>
           {reportPeriod === 'custom' && (
             <div className="flex items-center gap-2 pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <Input type="date" value={customDateRange.start} onChange={e => setCustomDateRange(prev => ({...prev, start: e.target.value}))} className="h-8 kairox-input w-36 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
                  <Input type="date" value={customDateRange.end} onChange={e => setCustomDateRange(prev => ({...prev, end: e.target.value}))} className="h-8 kairox-input w-36 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
                </div>
             </div>
           )}
        </div>

        {lastUpdate && (<div className="text-xs text-slate-500 dark:text-kx-text-2 flex items-center gap-1"><Clock className="w-3 h-3"/> Act: {lastUpdate.toLocaleTimeString()}</div>)}
      </div>

       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
         <div className="kairox-bg-card border kairox-border p-5 rounded-xl dark:bg-kx-bg dark:border-kx-border">
            <div className="text-sm text-slate-500 dark:text-kx-text-2 mb-1">Ingresos</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">${Number(summaryData.ingresosPeriodo).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
         </div>
         <div className="kairox-bg-card border kairox-border p-5 rounded-xl dark:bg-kx-bg dark:border-kx-border">
            <div className="text-sm text-slate-500 dark:text-kx-text-2 mb-1">Egresos</div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">${Number(summaryData.egresosPeriodo).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
         </div>
         <div className="kairox-bg-card border kairox-border p-5 rounded-xl dark:bg-kx-bg dark:border-kx-border">
            <div className="text-sm text-slate-500 dark:text-kx-text-2 mb-1">Balance</div>
            <div className={`text-2xl font-bold ${summaryData.balancePeriodo >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>${Number(summaryData.balancePeriodo).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
         </div>
       </div>

       {summaryData.detailedMovements.length === 0 ? (
          <div className="text-center p-10 text-slate-500 dark:text-kx-text-2">No hay datos históricos para el periodo seleccionado.</div>
       ) : (
          <div className="kairox-bg-card border kairox-border rounded-xl p-6 dark:bg-kx-bg dark:border-kx-border">
            <h3 className="font-bold mb-4 dark:text-kx-text">Detalle Histórico</h3>
            <div className="overflow-x-auto">
               <table className="w-full text-sm">
                  <thead><tr><th className="text-left p-2 dark:text-kx-text-2">Fecha</th><th className="text-left p-2 dark:text-kx-text-2">Concepto</th><th className="text-right p-2 dark:text-kx-text-2">Monto</th></tr></thead>
                  <tbody>
                     {summaryData.detailedMovements.map(m => (
                        <tr key={m.id} className="border-t border-slate-100 dark:border-kx-border">
                           <td className="p-2 dark:text-slate-300">{formatDateAR(m.fecha)}</td>
                           <td className="p-2 dark:text-slate-300">{m.concepto}</td>
                           <td className={`p-2 text-right ${m.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{formatAmount(m.monto, m.tipo)}</td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
          </div>
       )}
    </div>
  );
}

export default TabResumenHistorico;
