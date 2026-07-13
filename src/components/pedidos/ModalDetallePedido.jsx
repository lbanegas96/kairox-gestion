import { FileText, Check, Truck, ArrowRight, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { formatDateAR } from '@/lib/dateUtils';
import DocumentFlow from '@/components/shared/DocumentFlow';
import { getEstado, EstadoBadge } from './shared';

function ModalDetallePedido({
  isDetailOpen, setIsDetailOpen,
  detailPedido, setDetailPedido,
  entregasDetalle,
  loadingEntregas,
  onNavigate,
  handleAbrirGenerarEntrega,
  handleFacturarPedido,
  handleAvanzar,
}) {
  return (
    <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
      <DialogContent className="max-w-lg dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        {detailPedido && (() => {
          const e          = getEstado(detailPedido.estado);
          const items      = detailPedido.pedido_items || [];
          const totalPed   = items.reduce((s, i) => s + Number(i.cantidad || 0), 0);
          const totalEnt   = items.reduce((s, i) => s + Number(i.cantidad_entregada || 0), 0);
          const estaCompleto = totalPed > 0 && totalEnt >= totalPed;
          const estaParcial  = totalEnt > 0 && totalEnt < totalPed;
          const puedeEntrega = ['confirmado', 'en_preparacion'].includes(detailPedido.estado) && totalEnt < totalPed;

          const entregaConFactura = entregasDetalle.find(ent => ent.comprobante_id);
          const flowChips = [
            { tipo: 'pedido', id: detailPedido.id, numero: detailPedido.numero, active: true },
            ...entregasDetalle.map(ent => ({
              tipo: 'entrega',
              id: ent.id,
              numero: ent.numero_entrega,
              active: false,
            })),
            ...(entregaConFactura ? [{
              tipo: 'factura',
              id: entregaConFactura.comprobante_id,
              numero: entregaConFactura.comprobantes?.numero_venta,
              active: false,
            }] : []),
          ];

          return (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
                  <FileText className="h-5 w-5 text-blue-500" />
                  Pedido {detailPedido.numero}
                </DialogTitle>
                <DialogDescription className="dark:text-kx-text-2">
                  Detalle completo del pedido
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-kx-text-2">Estado</span>
                  <div className="flex items-center gap-2">
                    <EstadoBadge estado={detailPedido.estado} />
                  </div>
                </div>

                {totalPed > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-kx-text-2">Entrega</span>
                    {estaCompleto ? (
                      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-semibold">
                        <Check className="h-3 w-3" /> Completo ({totalEnt}/{totalPed} u.)
                      </span>
                    ) : estaParcial ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-semibold">
                        Parcial {totalEnt}/{totalPed} u.
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-kx-surface-2 dark:text-kx-text-2">
                        Sin entregar
                      </span>
                    )}
                  </div>
                )}

                <div className="flex justify-between items-center">
                  <span className="text-sm text-kx-text-2">Cliente</span>
                  <span className="font-medium dark:text-kx-text">{detailPedido.cliente_nombre}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-kx-text-2">Fecha</span>
                  <span className="text-sm dark:text-slate-300">{formatDateAR(detailPedido.fecha)}</span>
                </div>
                {detailPedido.fecha_entrega && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-kx-text-2">Fecha entrega</span>
                    <span className="text-sm dark:text-slate-300">{formatDateAR(detailPedido.fecha_entrega)}</span>
                  </div>
                )}
                {detailPedido.notas && (
                  <div className="bg-kx-surface-2 dark:bg-kx-surface rounded-lg p-3 text-sm text-kx-text-2 dark:text-kx-text-2">
                    {detailPedido.notas}
                  </div>
                )}

                <div className="space-y-1.5 pt-1">
                  <p className="text-[10px] font-semibold text-kx-text-3 dark:text-kx-text-3 uppercase tracking-wider">
                    Flujo del documento
                  </p>
                  {loadingEntregas ? (
                    <div className="h-5 bg-slate-100 dark:bg-kx-surface-2 rounded-full animate-pulse w-40" />
                  ) : (
                    <DocumentFlow chips={flowChips} onNavigate={(tipo, id) => {
                      if (tipo === 'pedido') return;
                      setDetailPedido(null);
                      onNavigate?.(tipo, id);
                    }} />
                  )}
                </div>

                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-kx-border dark:border-kx-border">
                      <th className="text-left pb-2 text-kx-text-2">Descripción</th>
                      <th className="text-center pb-2 text-kx-text-2 w-14">Pedido</th>
                      <th className="text-center pb-2 text-kx-text-2 w-14">Entregado</th>
                      <th className="text-right pb-2 text-kx-text-2">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => {
                      const ent = Number(it.cantidad_entregada || 0);
                      const ped = Number(it.cantidad || 0);
                      const precio = Number(it.precio_unitario || 0);
                      const subEntregado = ent * precio;
                      const completo = ent >= ped && ped > 0;
                      return (
                        <tr key={it.id} className="border-b border-slate-100 dark:border-slate-800/50">
                          <td className="py-2 dark:text-kx-text">{it.descripcion}</td>
                          <td className="py-2 text-center text-kx-text-2">{ped}</td>
                          <td className={`py-2 text-center font-medium ${completo ? 'text-green-600 dark:text-green-400' : ent > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-kx-text-3'}`}>
                            {ent}
                          </td>
                          <td className="py-2 text-right font-mono dark:text-kx-text">
                            ${subEntregado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="text-right font-bold text-lg dark:text-kx-text">
                  Total entregado: ${items.reduce((s, it) => s + (Number(it.cantidad_entregada || 0) * Number(it.precio_unitario || 0)), 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  <div className="text-xs font-normal text-kx-text-3">
                    Total pedido: ${Number(detailPedido.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {puedeEntrega && (
                    <Button
                      variant="outline"
                      className="w-full border-violet-300 text-violet-700 hover:bg-violet-50 dark:border-violet-700 dark:text-violet-300"
                      onClick={() => handleAbrirGenerarEntrega(detailPedido)}
                    >
                      <Truck className="h-4 w-4 mr-2" />
                      Generar Entrega
                    </Button>
                  )}

                  {e.next && (
                    e.next === 'facturado' ? (
                      <Button
                        className="w-full bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => handleFacturarPedido(detailPedido)}
                      >
                        <Receipt className="h-4 w-4 mr-2" />
                        Facturar Pedido
                      </Button>
                    ) : (
                      <Button
                        className="w-full bg-green-600 hover:bg-green-700 text-white"
                        onClick={() => { handleAvanzar(detailPedido); setIsDetailOpen(false); }}
                      >
                        <ArrowRight className="h-4 w-4 mr-2" />
                        Avanzar a {getEstado(e.next).label}
                      </Button>
                    )
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetallePedido;
