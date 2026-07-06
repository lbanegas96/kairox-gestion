import React from 'react';
import { Filter, X, Check, AlertTriangle, Eye, Edit, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/currencyUtils';
import { formatDateAR, formatTimeAR } from '@/lib/dateUtils';
import EstadoBadge from '@/components/ui/EstadoBadge';

function TabHistorialCompras({
  filters, setFilters,
  activeFiltersCount,
  clearFilters,
  proveedores,
  totalPeriodo,
  filteredCompras,
  loading,
  tcParalelo,
  compras,
  paginatedCompras,
  comprasTotalPages,
  comprasPage, setComprasPage,
  COMPRAS_PAGE_SIZE,
  setSelectedCompraId,
  setDetailsOpen,
  handleEditClick,
}) {
  return (
    <div className="mt-0 space-y-4">

      {/* ADVANCED FILTERS */}
      <div className="bg-kx-surface dark:bg-kx-surface p-5 rounded-xl border kairox-border shadow-sm space-y-4 dark:border-kx-border">
        <div className="flex justify-between items-center mb-2">
           <h3 className="font-semibold text-slate-700 dark:text-kx-text flex items-center gap-2">
             <Filter className="h-4 w-4" /> Filtros Avanzados
             {activeFiltersCount > 0 && <Badge variant="secondary" className="ml-1 px-1.5 h-5 min-w-[20px] dark:bg-kx-surface-2 dark:text-slate-300">{activeFiltersCount}</Badge>}
           </h3>
           {activeFiltersCount > 0 && (
             <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs text-slate-500 hover:text-red-500 dark:text-kx-text-2 dark:hover:text-red-400">
               <X className="h-3 w-3 mr-1" /> Limpiar filtros
             </Button>
           )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Desde</Label>
             <Input type="date" value={filters.dateStart} onChange={e => setFilters({...filters, dateStart: e.target.value})} className="h-9 kairox-input text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Hasta</Label>
             <Input type="date" value={filters.dateEnd} onChange={e => setFilters({...filters, dateEnd: e.target.value})} className="h-9 kairox-input text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Proveedor</Label>
             <select
               className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
               value={filters.proveedorId}
               onChange={e => setFilters({...filters, proveedorId: e.target.value})}
             >
               <option value="Todos">Todos</option>
               {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
             </select>
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Forma de Pago</Label>
             <select
               className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
               value={filters.paymentMethod}
               onChange={e => setFilters({...filters, paymentMethod: e.target.value})}
             >
               <option value="Todos">Todas</option>
               <option value="Efectivo">Efectivo</option>
               <option value="Transferencia">Transferencia</option>
               <option value="Tarjeta">Tarjeta</option>
               <option value="Cuenta Corriente">Cuenta Corriente</option>
             </select>
          </div>
          <div className="space-y-1">
             <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Estado</Label>
             <select
               className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
               value={filters.status}
               onChange={e => setFilters({...filters, status: e.target.value})}
             >
               <option value="Todos">Todos</option>
               <option value="pagada">Pagada</option>
               <option value="pendiente">Pendiente</option>
               <option value="parcial">Parcial</option>
             </select>
          </div>
        </div>
      </div>

      {/* SUMMARY CARD */}
      <Card className="p-4 bg-gradient-to-r from-blue-50 to-white dark:from-blue-900/10 dark:to-slate-900 border-blue-100 dark:border-blue-900/20">
         <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-600 dark:text-blue-400">
                <Check className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-kx-text-2 font-medium">Compras Filtradas</p>
                <p className="text-2xl font-bold text-kx-text dark:text-kx-text">{filteredCompras.length}</p>
              </div>
            </div>
            <div className="text-center sm:text-right border-t sm:border-t-0 sm:border-l border-blue-200 dark:border-kx-border pt-4 sm:pt-0 sm:pl-8 w-full sm:w-auto">
               <p className="text-sm text-slate-500 dark:text-kx-text-2 font-medium uppercase tracking-wider mb-1">Total Comprado</p>
               <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                 ${totalPeriodo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
               </p>
            </div>
         </div>
      </Card>

      {/* TABLE */}
      <div className="kairox-bg-card border kairox-border rounded-xl overflow-hidden shadow-sm dark:bg-kx-bg dark:border-kx-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b kairox-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
              <tr>
                <th className="p-4 w-40">Fecha</th>
                <th className="p-4 w-32">N° Factura</th>
                <th className="p-4">Proveedor</th>
                <th className="p-4 w-32">Forma Pago</th>
                <th className="p-4 w-28 text-center">Estado</th>
                <th className="p-4 w-32 text-right">Total</th>
                {tcParalelo.enabled && (
                  <th className="p-4 w-28 text-right text-kx-text-2">{tcParalelo.monedaParalela}</th>
                )}
                <th className="p-4 w-24 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-32" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                    <td className="p-4"><Skeleton className="h-6 w-16 mx-auto rounded-full" /></td>
                    <td className="p-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                    {tcParalelo.enabled && <td className="p-4"><Skeleton className="h-4 w-16 ml-auto" /></td>}
                    <td className="p-4"><Skeleton className="h-8 w-8 mx-auto" /></td>
                  </tr>
                ))
              ) : filteredCompras.length === 0 ? (
                <tr>
                  <td colSpan={tcParalelo.enabled ? 8 : 7} className="p-12 text-center text-slate-500 bg-slate-50/50 dark:bg-slate-900/20 dark:text-kx-text-2">
                    <div className="flex flex-col items-center gap-2">
                       <AlertTriangle className="h-10 w-10 text-slate-300" />
                       <p className="font-medium">
                         {compras.length === 0 ? "Sin compras registradas aún" : "No hay compras que coincidan con los filtros"}
                       </p>
                       {activeFiltersCount > 0 && (
                         <Button variant="link" onClick={clearFilters} className="text-blue-500 h-auto p-0">Limpiar filtros</Button>
                       )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedCompras.map(compra => (
                  <tr key={compra.id} className="group hover:bg-blue-50/50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => { setSelectedCompraId(compra.id); setDetailsOpen(true); }}>
                    <td className="p-4 text-kx-text-2 dark:text-slate-300 font-mono text-xs">
                      {formatDateAR(compra.fecha)} <span className="text-kx-text-3 ml-1">{formatTimeAR(compra.fecha)}</span>
                    </td>
                    <td className="p-4 text-slate-500 font-mono text-xs font-medium dark:text-kx-text-2">
                      {compra.numero_factura}
                    </td>
                    <td className="p-4 font-medium text-kx-text dark:text-kx-text">
                      {compra.proveedores?.nombre || '---'}
                    </td>
                    <td className="p-4 text-kx-text-2 dark:text-kx-text-2 text-xs font-medium uppercase tracking-wide">
                      {compra.forma_pago}
                    </td>
                    <td className="p-4 text-center">
                      <EstadoBadge estado={compra.estado_pago} />
                    </td>
                    <td className="p-4 text-right font-bold text-slate-700 dark:text-kx-text group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                      {formatCurrency(compra.total, compra.moneda ?? 'ARS')}
                      {compra.moneda && compra.moneda !== 'ARS' && (
                        <span className="text-xs text-kx-text-3 dark:text-kx-text-3 ml-1 font-normal">
                          (TC: {compra.tipo_cambio_tasa})
                        </span>
                      )}
                    </td>
                    {tcParalelo.enabled && (
                      <td className="p-4 text-right text-xs text-kx-text-2 tabular-nums">
                        {(() => {
                          if (compra.monto_paralelo) {
                            return `≈ ${Number(compra.monto_paralelo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
                          }
                          const calc = tcParalelo.calcParalelo(Number(compra.total), compra.moneda ?? 'ARS', Number(compra.tipo_cambio_tasa) || 1);
                          return calc !== null ? `≈ ${calc.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '—';
                        })()}
                      </td>
                    )}
                    <td className="p-4 text-center">
                      <div className="flex justify-center gap-1">
                         <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-kx-text-3 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full">
                           <Eye className="h-4 w-4" />
                         </Button>
                         <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-kx-text-3 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-full" onClick={(e) => handleEditClick(compra, e)}>
                           <Edit className="h-4 w-4" />
                         </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {/* PAGINATION */}
      {comprasTotalPages > 1 && (
        <div className="flex items-center justify-between px-2 pt-2">
          <p className="text-sm text-slate-500 dark:text-kx-text-2">
            Mostrando {(comprasPage - 1) * COMPRAS_PAGE_SIZE + 1}–{Math.min(comprasPage * COMPRAS_PAGE_SIZE, filteredCompras.length)} de {filteredCompras.length} compras
          </p>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setComprasPage(p => Math.max(1, p - 1))} disabled={comprasPage === 1} className="h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: comprasTotalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === comprasTotalPages || Math.abs(p - comprasPage) <= 1)
              .reduce((acc, p, idx, arr) => { if (idx > 0 && arr[idx - 1] !== p - 1) acc.push('...'); acc.push(p); return acc; }, [])
              .map((item, idx) =>
                item === '...' ? <span key={`e-${idx}`} className="px-2 text-kx-text-3">…</span> :
                <Button key={item} variant={comprasPage === item ? "default" : "outline"} size="sm" onClick={() => setComprasPage(item)} className="h-8 w-8 p-0">{item}</Button>
              )}
            <Button variant="outline" size="sm" onClick={() => setComprasPage(p => Math.min(comprasTotalPages, p + 1))} disabled={comprasPage === comprasTotalPages} className="h-8 w-8 p-0">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default TabHistorialCompras;
