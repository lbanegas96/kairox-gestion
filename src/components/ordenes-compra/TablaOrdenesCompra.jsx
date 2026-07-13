import { Search, ShoppingBag, Eye, XCircle, Send, Package, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/currencyUtils';
import { formatDateAR } from '@/lib/dateUtils';
import { ESTADOS } from './shared';

function TablaOrdenesCompra({
  search, setSearch,
  estadoFiltro, setEstadoFiltro,
  isLoading, filteredList,
  listData, page, setPage,
  setDetalleId, setGenRecepId, setDevolverOC,
  estadoMutation, cancelarMutation,
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-kx-text-3" />
          <Input placeholder="Buscar número o proveedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 dark:bg-kx-surface dark:border-kx-border" />
        </div>
        <select value={estadoFiltro} onChange={e => { setEstadoFiltro(e.target.value); setPage(1); }}
          className="h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface text-sm px-3 text-slate-700 dark:text-slate-300">
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
            <tr>
              <th className="p-4 text-left">N° OC</th>
              <th className="p-4 text-left">Proveedor</th>
              <th className="p-4 text-left">Fecha</th>
              <th className="p-4 text-left">Entrega esperada</th>
              <th className="p-4 text-left">Estado</th>
              <th className="p-4 text-right">Total</th>
              <th className="p-4 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? (
              <tr><td colSpan={7} className="p-10 text-center text-kx-text-3">Cargando...</td></tr>
            ) : filteredList.length === 0 ? (
              <tr><td colSpan={7} className="p-10 text-center text-kx-text-3">
                <div className="flex flex-col items-center gap-2">
                  <ShoppingBag className="w-8 h-8 opacity-30" />
                  <span>No hay órdenes de compra</span>
                </div>
              </td></tr>
            ) : filteredList.map(oc => {
              const cfg = ESTADOS[oc.estado] ?? ESTADOS.borrador;
              const Icon = cfg.icon;
              return (
                <tr key={oc.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="p-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">{oc.numero}</td>
                  <td className="p-4 font-medium text-slate-700 dark:text-kx-text">{oc.proveedor_nombre ?? oc.proveedores?.nombre ?? '—'}</td>
                  <td className="p-4 text-slate-500 dark:text-kx-text-2">{formatDateAR(oc.created_at)}</td>
                  <td className="p-4 text-slate-500 dark:text-kx-text-2">
                    {oc.fecha_entrega_esperada ? formatDateAR(oc.fecha_entrega_esperada) : '—'}
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                      <Icon className="w-3 h-3" /> {cfg.label}
                    </span>
                  </td>
                  <td className="p-4 text-right font-mono font-bold text-kx-text dark:text-kx-text">
                    {formatCurrency(oc.total, oc.moneda ?? 'ARS')}
                  </td>
                  <td className="p-4">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-indigo-500"
                        onClick={() => setDetalleId(oc.id)} title="Ver detalle">
                        <Eye className="w-3.5 h-3.5" />
                      </Button>

                      {oc.estado === 'borrador' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-600"
                          onClick={() => estadoMutation.mutate({ id: oc.id, estado: 'enviada' })} title="Marcar como enviada al proveedor">
                          <Send className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      {['enviada', 'recibida_parcial'].includes(oc.estado) && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-green-600"
                          onClick={() => setGenRecepId(oc.id)} title="Generar Recepción">
                          <Package className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      {['borrador', 'enviada'].includes(oc.estado) && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500"
                          onClick={() => cancelarMutation.mutate(oc.id)} title="Cancelar OC">
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      )}

                      {['recibida', 'recibida_parcial'].includes(oc.estado) && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-orange-500"
                          onClick={() => setDevolverOC(oc)} title="Devolver al proveedor">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {listData && listData.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
          <span className="text-sm text-kx-text-2">{page} / {listData.pages}</span>
          <Button variant="outline" size="sm" disabled={page >= listData.pages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
        </div>
      )}
    </div>
  );
}

export default TablaOrdenesCompra;
