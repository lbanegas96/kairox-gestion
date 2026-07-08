import { ShoppingBag, Truck, Receipt, AlertTriangle, BadgeCheck, Banknote, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/currencyUtils';
import { formatDateAR } from '@/lib/dateUtils';
import { ESTADOS, FACTURA_ESTADO_COLORS } from './shared';

function ModalDetalleOC({
  detalleId, setDetalleId,
  detalle, factura,
  pagarFacturaMutation,
  setDevolverOC, setGenRecepId,
  setFacturaModal, setFacturaForm,
}) {
  return (
    <Dialog open={!!detalleId} onOpenChange={() => setDetalleId(null)}>
      <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-indigo-500" />
            Orden de Compra {detalle?.numero}
          </DialogTitle>
        </DialogHeader>
        {detalle && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Proveedor</p>
                <p className="font-medium dark:text-kx-text">{detalle.proveedor_nombre ?? detalle.proveedores?.nombre ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Estado</p>
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>
                  {ESTADOS[detalle.estado]?.label}
                </span>
              </div>
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Forma de pago</p>
                <p className="dark:text-slate-300">{detalle.forma_pago}</p>
              </div>
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Entrega esperada</p>
                <p className="dark:text-slate-300">{detalle.fecha_entrega_esperada ? formatDateAR(detalle.fecha_entrega_esperada) : '—'}</p>
              </div>
            </div>

            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-kx-border dark:border-kx-border">
                  <th className="text-left py-2 text-xs text-kx-text-3">Producto</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">Pedido</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">Recibido</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">Costo unit.</th>
                  <th className="text-right py-2 text-xs text-kx-text-3">Subtotal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {(detalle.ordenes_compra_items ?? []).map(item => {
                  const progreso = item.cantidad_pedida > 0 ? (item.cantidad_recibida / item.cantidad_pedida) * 100 : 0;
                  return (
                    <tr key={item.id}>
                      <td className="py-2 dark:text-slate-300">{item.descripcion}</td>
                      <td className="py-2 text-right dark:text-slate-300">{item.cantidad_pedida} {item.unidad_medida}</td>
                      <td className="py-2 text-right">
                        <span className={`font-medium ${item.cantidad_recibida >= item.cantidad_pedida ? 'text-green-600 dark:text-green-400' : item.cantidad_recibida > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-kx-text-3'}`}>
                          {item.cantidad_recibida}
                        </span>
                        <div className="w-16 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mt-1 ml-auto">
                          <div className={`h-1 rounded-full ${progreso >= 100 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${Math.min(progreso, 100)}%` }} />
                        </div>
                      </td>
                      <td className="py-2 text-right dark:text-slate-300">{formatCurrency(item.costo_unitario, detalle.moneda ?? 'ARS')}</td>
                      <td className="py-2 text-right font-medium dark:text-kx-text">{formatCurrency(item.subtotal, detalle.moneda ?? 'ARS')}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-kx-border dark:border-kx-border">
                  <td colSpan={4} className="py-3 text-right font-bold dark:text-kx-text">TOTAL {detalle.moneda && detalle.moneda !== 'ARS' && <span className="text-xs font-normal text-kx-text-3 ml-1">({detalle.moneda} — tasa {detalle.tipo_cambio_tasa})</span>}</td>
                  <td className="py-3 text-right font-bold text-lg dark:text-kx-text">{formatCurrency(detalle.total, detalle.moneda ?? 'ARS')}</td>
                </tr>
              </tfoot>
            </table>

            {detalle.notas && (
              <div className="p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg text-sm text-kx-text-2 dark:text-kx-text-2">
                <span className="font-medium">Notas: </span>{detalle.notas}
              </div>
            )}

            {/* ── 3-Way Match ── */}
            {(() => {
              const totalOC = Number(detalle.total);
              const totalRecibido = (detalle.ordenes_compra_items ?? [])
                .reduce((s, i) => s + Number(i.cantidad_recibida) * Number(i.costo_unitario), 0);
              const totalFactura = factura ? Number(factura.monto_total) : null;
              const diff = totalFactura !== null ? Math.abs(totalFactura - totalRecibido) : null;
              const matchOk = diff !== null && diff < 0.01;
              const matchWarn = diff !== null && !matchOk && diff / (totalRecibido || 1) < 0.05;

              return (
                <div className="border border-kx-border dark:border-kx-border rounded-lg p-4 space-y-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-2">
                    <Receipt className="w-3.5 h-3.5" /> 3-Way Match
                  </p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                      <p className="text-xs text-kx-text-3 mb-1">Total OC</p>
                      <p className="font-bold text-sm dark:text-kx-text">{formatCurrency(totalOC, detalle.moneda ?? 'ARS')}</p>
                    </div>
                    <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                      <p className="text-xs text-kx-text-3 mb-1">Recibido</p>
                      <p className={`font-bold text-sm ${totalRecibido >= totalOC ? 'text-green-600 dark:text-green-400' : totalRecibido > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-kx-text-3'}`}>
                        {formatCurrency(totalRecibido, detalle.moneda ?? 'ARS')}
                      </p>
                    </div>
                    <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                      <p className="text-xs text-kx-text-3 mb-1">Factura</p>
                      {totalFactura !== null ? (
                        <p className={`font-bold text-sm ${matchOk ? 'text-green-600 dark:text-green-400' : matchWarn ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500'}`}>
                          {formatCurrency(totalFactura, detalle.moneda ?? 'ARS')}
                        </p>
                      ) : (
                        <p className="text-xs text-kx-text-3 italic">Sin factura</p>
                      )}
                    </div>
                  </div>

                  {totalFactura !== null && (
                    <div className={`p-2 rounded text-xs flex items-center gap-2 ${matchOk ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : matchWarn ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                      {matchOk ? <BadgeCheck className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                      {matchOk
                        ? 'Match perfecto — OC, recepción y factura coinciden.'
                        : `Diferencia de $${diff.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} entre recibido y factura.`}
                    </div>
                  )}

                  {factura ? (
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-kx-text-2">
                        <span className={`px-2 py-0.5 rounded font-medium ${FACTURA_ESTADO_COLORS[factura.estado]}`}>
                          {factura.estado.charAt(0).toUpperCase() + factura.estado.slice(1)}
                        </span>
                        <span>N° {factura.numero_factura}</span>
                        {factura.fecha_vencimiento && (
                          <span>· Vence: {formatDateAR(factura.fecha_vencimiento)}</span>
                        )}
                      </div>
                      {factura.estado === 'pendiente' && (
                        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"
                          onClick={() => pagarFacturaMutation.mutate(factura.id)}
                          disabled={pagarFacturaMutation.isPending}>
                          <Banknote className="w-3.5 h-3.5" /> Marcar pagada
                        </Button>
                      )}
                    </div>
                  ) : (
                    ['recibida_parcial', 'recibida'].includes(detalle.estado) && (
                      <Button size="sm" variant="outline" className="w-full gap-2 text-xs"
                        onClick={() => {
                          setFacturaForm({
                            numero_factura: '', fecha_factura: '',
                            fecha_vencimiento: '',
                            monto_total: totalRecibido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                            notas: ''
                          });
                          setFacturaModal(true);
                        }}>
                        <Receipt className="w-3.5 h-3.5" /> Registrar Factura del Proveedor
                      </Button>
                    )
                  )}
                </div>
              );
            })()}
          </div>
        )}
        <DialogFooter className="gap-2">
          {detalle && ['recibida', 'recibida_parcial'].includes(detalle.estado) && (
            <Button variant="outline" className="gap-2 text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-900/20"
              onClick={() => { setDetalleId(null); setDevolverOC(detalle); }}>
              <RotateCcw className="w-4 h-4" /> Devolver
            </Button>
          )}
          {detalle && ['enviada', 'recibida_parcial'].includes(detalle.estado) && (
            <Button className="bg-green-600 hover:bg-green-700 text-white gap-2"
              onClick={() => { setDetalleId(null); setGenRecepId(detalle.id); }}>
              <Truck className="w-4 h-4" /> Registrar Recepción
            </Button>
          )}
          <Button variant="outline" onClick={() => setDetalleId(null)} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleOC;
