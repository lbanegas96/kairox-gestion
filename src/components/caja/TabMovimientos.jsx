import React from 'react';
import { Search, Bot, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTimeAR } from '@/lib/dateUtils';
import { formatAmount } from './shared';

function SortIcon({ column, sortConfig }) {
  if (sortConfig.key !== column) return <ArrowUpDown className="ml-2 h-4 w-4 text-kx-text-3" />;
  return sortConfig.direction === 'asc'
    ? <ArrowUp className="ml-2 h-4 w-4 text-blue-600 dark:text-[#00D4FF]" />
    : <ArrowDown className="ml-2 h-4 w-4 text-blue-600 dark:text-[#00D4FF]" />;
}

function TabMovimientos({
  filters, setFilters,
  sortedMovimientos,
  loading,
  tcParalelo,
  sortConfig,
  handleSort,
  handleRequestDelete,
}) {
  return (
    <div className="space-y-4">
      <div className="kairox-bg-card border kairox-border p-4 rounded-xl grid grid-cols-1 md:grid-cols-4 gap-4 items-end shadow-sm">
        <div className="space-y-2">
          <Label className="dark:text-kx-text">Desde</Label>
          <Input type="date" value={filters.dateStart} onChange={e => setFilters({...filters, dateStart: e.target.value})} className="kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
        </div>
        <div className="space-y-2">
          <Label className="dark:text-kx-text">Hasta</Label>
          <Input type="date" value={filters.dateEnd} onChange={e => setFilters({...filters, dateEnd: e.target.value})} className="kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
        </div>
        <div className="space-y-2">
          <Label className="dark:text-kx-text">Tipo</Label>
          <select className="w-full h-10 rounded-md kairox-input pl-3 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-[#00D4FF] dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" value={filters.type} onChange={e => setFilters({...filters, type: e.target.value})}>
            <option value="Todos">Todos</option>
            <option value="Ingreso">Ingresos</option>
            <option value="Egreso">Egresos</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label className="dark:text-kx-text">Buscar Concepto</Label>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500"/>
            <Input placeholder="Buscar..." value={filters.search} onChange={e => setFilters({...filters, search: e.target.value})} className="pl-9 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>
          </div>
        </div>
      </div>

      <div className="kairox-bg-card border kairox-border rounded-xl overflow-hidden shadow-lg">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="kairox-table-header text-xs uppercase tracking-wider border-b kairox-border dark:bg-slate-900/50 dark:text-slate-300">
              <tr>
                <th className="p-4 w-[15%] cursor-pointer hover:text-blue-600 transition-colors" onClick={() => handleSort('fecha')}>
                  <div className="flex items-center">Hora <SortIcon column="fecha" sortConfig={sortConfig} /></div>
                </th>
                <th className="p-4 w-[10%]">Tipo</th>
                <th className="p-4 w-[12%]">Categoría</th>
                <th className="p-4 w-[20%]">Concepto</th>
                <th className="p-4 w-[10%]">Pago</th>
                <th className="p-4 w-[13%] text-right cursor-pointer hover:text-blue-600 transition-colors" onClick={() => handleSort('monto')}>
                   <div className="flex items-center justify-end">Monto <SortIcon column="monto" sortConfig={sortConfig} /></div>
                </th>
                {tcParalelo.enabled && (
                  <th className="p-4 w-[10%] text-right text-kx-text-2">{tcParalelo.monedaParalela}</th>
                )}
                <th className="p-4 w-[5%] text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={tcParalelo.enabled ? 8 : 7} className="p-8 text-center text-slate-500">Cargando movimientos...</td></tr>
              ) : sortedMovimientos.length === 0 ? (
                <tr><td colSpan={tcParalelo.enabled ? 8 : 7} className="p-8 text-center text-slate-500">No se encontraron movimientos</td></tr>
              ) : (
                sortedMovimientos.map((m) => (
                  <tr key={m.id} className="kairox-table-row group h-[60px] hover:bg-kx-surface-2 dark:hover:bg-slate-800/50">
                    <td className="p-4 align-middle font-mono whitespace-nowrap">
                        <span className="font-bold kairox-text-primary dark:text-kx-text">
                          {formatDateTimeAR(m.fecha)}
                        </span>
                    </td>
                    <td className="p-4 align-middle">
                      {m.tipo === 'ingreso' ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-green-500/10 text-green-600 border border-green-500/20 dark:bg-green-500/20 dark:text-green-400">INGRESO</span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-red-500/10 text-red-600 border border-red-500/20 dark:bg-red-500/20 dark:text-red-400">EGRESO</span>
                      )}
                    </td>
                    <td className="p-4 align-middle font-medium kairox-text-primary text-xs dark:text-slate-300">{m.categoria}</td>
                    <td className="p-4 align-middle kairox-text-primary dark:text-kx-text">
                      <div className="flex items-center gap-2">
                        {m.is_automatic && (
                          <div title="Automático" className="p-0.5 bg-blue-500/10 rounded text-blue-500 shrink-0 dark:bg-blue-500/20 dark:text-blue-400"><Bot className="w-3 h-3" /></div>
                        )}
                        <span className="truncate max-w-[200px]" title={m.concepto}>{m.concepto}</span>
                      </div>
                    </td>
                    <td className="p-4 align-middle text-xs text-slate-500 dark:text-kx-text-2">{m.metodo_pago || '-'}</td>
                    <td className={`p-4 align-middle text-right font-bold font-mono ${m.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {formatAmount(m.monto, m.tipo)}
                    </td>
                    {tcParalelo.enabled && (
                      <td className="p-4 align-middle text-right text-xs text-kx-text-2 tabular-nums">
                        {(() => {
                          if (m.monto_paralelo) {
                            return `≈ ${Number(m.monto_paralelo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
                          }
                          const calc = tcParalelo.calcParalelo(Number(m.monto), 'ARS', 1);
                          return calc !== null ? `≈ ${calc.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '—';
                        })()}
                      </td>
                    )}
                    <td className="p-4 align-middle text-center">
                       {!m.is_automatic && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500 dark:hover:text-red-400 dark:hover:bg-red-900/20" onClick={() => handleRequestDelete(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                       )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default TabMovimientos;
