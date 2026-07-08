import { Search, Eye, Trash2, CheckCircle, XCircle, Send, ShoppingCart, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatCurrency } from '@/lib/currencyUtils';
import { formatDateAR } from '@/lib/dateUtils';
import { ESTADOS } from './shared';

function TablaCotizaciones({
  search, setSearch,
  estadoFiltro, setEstadoFiltro, setPage,
  isLoading, filteredData,
  listData, page,
  setViewId, estadoMutation, deleteMutation,
  handleConvertirClick, onNavigateToSale,
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-kx-text-3" />
          <Input placeholder="Buscar número o cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 dark:bg-kx-surface dark:border-kx-border" />
        </div>
        <select
          value={estadoFiltro}
          onChange={e => { setEstadoFiltro(e.target.value); setPage(1); }}
          className="h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface text-sm px-3 text-slate-700 dark:text-slate-300"
        >
          <option value="">Todos los estados</option>
          {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
            <tr>
              <th className="p-4 text-left">Número</th>
              <th className="p-4 text-left">Cliente</th>
              <th className="p-4 text-left">Fecha</th>
              <th className="p-4 text-left">Vence</th>
              <th className="p-4 text-left">Estado</th>
              <th className="p-4 text-right">Total</th>
              <th className="p-4 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? (
              <tr><td colSpan={7} className="p-8 text-center text-kx-text-3">Cargando...</td></tr>
            ) : filteredData.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-kx-text-3">No hay cotizaciones</td></tr>
            ) : filteredData.map(cot => (
              <tr key={cot.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40">
                <td className="p-4 font-mono font-semibold text-blue-600 dark:text-blue-400">{cot.numero}</td>
                <td className="p-4 text-slate-700 dark:text-slate-300">{cot.cliente_nombre ?? cot.clientes?.nombre ?? '—'}</td>
                <td className="p-4 text-slate-500 dark:text-kx-text-2">{formatDateAR(cot.created_at)}</td>
                <td className="p-4 text-slate-500 dark:text-kx-text-2">
                  {cot.fecha_vencimiento ? formatDateAR(cot.fecha_vencimiento) : '—'}
                </td>
                <td className="p-4">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[cot.estado]?.color}`}>
                    {ESTADOS[cot.estado]?.label ?? cot.estado}
                  </span>
                </td>
                <td className="p-4 text-right font-mono font-bold text-kx-text dark:text-kx-text">
                  {(() => {
                    const tc = Number(cot.tipo_cambio_tasa) || 1;
                    const esExt = cot.moneda && cot.moneda !== 'ARS' && tc > 0;
                    const valor = esExt ? Number(cot.total) / tc : Number(cot.total);
                    return formatCurrency(valor, cot.moneda ?? 'ARS');
                  })()}
                </td>
                <td className="p-4">
                  <div className="flex items-center justify-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-500" onClick={() => setViewId(cot.id)} title="Ver detalle">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    {cot.estado === 'borrador' && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-600" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'enviada' })} title="Marcar como enviada">
                        <Send className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {cot.estado === 'enviada' && (
                      <>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-green-600" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'aprobada' })} title="Aprobar">
                          <CheckCircle className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'rechazada' })} title="Rechazar">
                          <XCircle className="w-3.5 h-3.5" />
                        </Button>
                      </>
                    )}
                    {['aprobada', 'enviada'].includes(cot.estado) && (
                      <Button
                        variant="ghost" size="icon"
                        className="h-7 w-7 text-kx-text-3 hover:text-purple-600"
                        onClick={() => handleConvertirClick(cot)}
                        title="Convertir en Venta"
                      >
                        <ShoppingCart className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {cot.estado === 'convertida' && cot.comprobante_id && (
                      <button
                        type="button"
                        onClick={() => onNavigateToSale?.(cot.comprobante_id)}
                        className="text-xs text-purple-500 hover:text-purple-400 font-medium flex items-center gap-1 hover:underline cursor-pointer"
                        title="Ver venta generada"
                      >
                        <ExternalLink className="w-3 h-3" /> Venta
                      </button>
                    )}
                    {['borrador', 'rechazada'].includes(cot.estado) && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500" onClick={() => deleteMutation.mutate(cot.id)} title="Eliminar">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {listData && listData.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
          <span className="text-sm text-slate-500">{page} / {listData.pages}</span>
          <Button variant="outline" size="sm" disabled={page >= listData.pages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
        </div>
      )}
    </div>
  );
}

export default TablaCotizaciones;
