import { ClipboardList, User, Calendar, Edit3, Truck, ArrowRight, Receipt, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDateAR } from '@/lib/dateUtils';
import { getEstado, EstadoBadge, ProgressoBadge } from './shared';

function TablaPedidos({
  filtered,
  loading,
  filterEstado,
  openNew,
  openEdit,
  onVerDetalle,
  handleAbrirGenerarEntrega,
  handleFacturarPedido,
  handleAvanzar,
  setCancelTarget,
}) {
  return (
    <Card className="dark:bg-kx-bg dark:border-kx-border overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-kx-surface-2 dark:bg-slate-900/60 border-b border-kx-border dark:border-kx-border">
            <tr>
              <th className="text-left p-4 font-semibold text-kx-text-2 dark:text-kx-text-2">Número</th>
              <th className="text-left p-4 font-semibold text-kx-text-2 dark:text-kx-text-2">Cliente</th>
              <th className="text-left p-4 font-semibold text-kx-text-2 dark:text-kx-text-2">Fecha</th>
              <th className="text-left p-4 font-semibold text-kx-text-2 dark:text-kx-text-2">Entrega</th>
              <th className="text-right p-4 font-semibold text-kx-text-2 dark:text-kx-text-2">Total</th>
              <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-kx-text-2">Progreso</th>
              <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-kx-text-2">Estado</th>
              <th className="text-center p-4 font-semibold text-kx-text-2 dark:text-kx-text-2">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="p-4">
                      <div className="h-4 bg-slate-200 dark:bg-kx-surface-2 rounded animate-pulse w-20" />
                    </td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-12 text-center text-kx-text-3 dark:text-kx-text-3">
                  <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">No hay pedidos{filterEstado !== 'Todos' ? ` en estado "${getEstado(filterEstado).label}"` : ''}</p>
                  <Button variant="link" onClick={openNew} className="mt-2 text-blue-500">
                    Crear el primer pedido
                  </Button>
                </td>
              </tr>
            ) : (
              filtered.map(pedido => {
                const e = getEstado(pedido.estado);
                const canEdit    = pedido.estado === 'borrador';
                const items      = pedido.pedido_items || [];
                const totalPed   = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
                const totalEnt   = items.reduce((s, i) => s + Number(i.cantidad_entregada || 0), 0);
                const hayPendiente = totalEnt < totalPed;
                const puedeEntrega = ['confirmado', 'en_preparacion'].includes(pedido.estado) && hayPendiente;
                const esParaFacturar = e.next === 'facturado';

                return (
                  <tr key={pedido.id}
                    className="hover:bg-kx-surface-2 dark:hover:bg-slate-900/40 transition-colors cursor-pointer"
                    onClick={() => onVerDetalle(pedido)}
                  >
                    <td className="p-4 font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {pedido.numero}
                    </td>
                    <td className="p-4 dark:text-kx-text">
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                        {pedido.cliente_nombre}
                      </div>
                    </td>
                    <td className="p-4 text-slate-500 dark:text-kx-text-2 text-xs">
                      {formatDateAR(pedido.fecha)}
                    </td>
                    <td className="p-4 text-slate-500 dark:text-kx-text-2 text-xs">
                      {pedido.fecha_entrega ? (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {formatDateAR(pedido.fecha_entrega)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="p-4 text-right font-mono font-bold dark:text-kx-text">
                      ${Number(pedido.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4 text-center">
                      <ProgressoBadge items={items} />
                    </td>
                    <td className="p-4 text-center">
                      <EstadoBadge estado={pedido.estado} />
                    </td>
                    <td className="p-4 text-center" onClick={ev => ev.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {canEdit && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-kx-text-2 hover:text-blue-600"
                            onClick={() => openEdit(pedido)} title="Editar">
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {puedeEntrega && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20"
                            onClick={(ev) => handleAbrirGenerarEntrega(pedido, ev)}
                            title="Generar Entrega"
                          >
                            <Truck className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {e.next && (
                          esParaFacturar ? (
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                              onClick={() => handleFacturarPedido(pedido)}
                              title="Facturar pedido"
                            >
                              <Receipt className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost" size="icon"
                              className="h-8 w-8 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                              onClick={() => handleAvanzar(pedido)}
                              title={`Avanzar → ${getEstado(e.next).label}`}
                            >
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          )
                        )}

                        {pedido.estado !== 'cancelado' && pedido.estado !== 'facturado' && (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            onClick={() => setCancelTarget(pedido)} title="Cancelar">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default TablaPedidos;
