import React from 'react';
import { FileText, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatDateAR } from '@/lib/dateUtils';
import { ESTADOS } from './shared';

function ModalDetalleCotizacion({ viewId, setViewId, detalle }) {
  return (
    <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
      <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-500" />
            Cotización {detalle?.numero}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">Detalle y líneas de la cotización.</DialogDescription>
        </DialogHeader>
        {detalle && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Cliente</span>
                <p className="font-medium dark:text-kx-text">{detalle.cliente_nombre ?? detalle.clientes?.nombre ?? '—'}</p>
              </div>
              <div>
                <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Estado</span>
                <p><span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>{ESTADOS[detalle.estado]?.label}</span></p>
              </div>
              <div>
                <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Condiciones</span>
                <p className="dark:text-slate-300">{detalle.condiciones_pago ?? '—'}</p>
              </div>
              <div>
                <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Vence</span>
                <p className="dark:text-slate-300">{detalle.fecha_vencimiento ? formatDateAR(detalle.fecha_vencimiento) : '—'}</p>
              </div>
            </div>

            {(() => {
              const tc = Number(detalle.tipo_cambio_tasa) || 1;
              const esExtranjera = detalle.moneda && detalle.moneda !== 'ARS' && tc > 0;
              const conv = esExtranjera ? (n) => Number(n) / tc : (n) => Number(n);
              const fmt = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              const monedaDisp = esExtranjera ? detalle.moneda : 'ARS';
              const simbolo = esExtranjera ? `${detalle.moneda} ` : '$';
              return (
                <table className="w-full text-sm border-collapse">
                  <thead><tr className="border-b border-kx-border dark:border-kx-border">
                    <th className="text-left py-2 text-xs text-kx-text-3">Descripción</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Cant.</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Precio ({monedaDisp})</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Subtotal ({monedaDisp})</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(detalle.cotizacion_items ?? []).map(item => (
                      <tr key={item.id}>
                        <td className="py-2 dark:text-slate-300">{item.descripcion}</td>
                        <td className="py-2 text-right dark:text-slate-300">{item.cantidad} {item.unidad_medida}</td>
                        <td className="py-2 text-right dark:text-slate-300">{simbolo}{fmt(conv(item.precio_unitario))}</td>
                        <td className="py-2 text-right font-medium dark:text-kx-text">{simbolo}{fmt(conv(item.subtotal))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-kx-border dark:border-kx-border">
                      <td colSpan={3} className="py-3 text-right font-bold dark:text-kx-text">TOTAL</td>
                      <td className="py-3 text-right font-bold text-lg dark:text-kx-text">{simbolo}{fmt(conv(detalle.total))}</td>
                    </tr>
                    {esExtranjera && (
                      <>
                        <tr className="text-xs text-slate-500 dark:text-kx-text-2">
                          <td colSpan={3} className="py-1 text-right">Tipo de cambio</td>
                          <td className="py-1 text-right">1 {detalle.moneda} = ${fmt(tc)}</td>
                        </tr>
                        <tr className="text-xs text-slate-500 dark:text-kx-text-2">
                          <td colSpan={3} className="py-1 text-right">Equivale a</td>
                          <td className="py-1 text-right">${fmt(Number(detalle.total))} ARS</td>
                        </tr>
                      </>
                    )}
                  </tfoot>
                </table>
              );
            })()}

            {detalle.notas && (
              <div className="p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg text-sm text-kx-text-2 dark:text-kx-text-2">
                <span className="font-medium">Notas: </span>{detalle.notas}
              </div>
            )}
            {detalle.estado === 'convertida' && detalle.comprobante_id && (
              <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800 text-sm text-purple-700 dark:text-purple-300">
                <CheckCircle className="w-4 h-4 flex-shrink-0" />
                <span>Esta cotización fue convertida en venta. Comprobante ID: <span className="font-mono text-xs">{detalle.comprobante_id}</span></span>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setViewId(null)} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleCotizacion;
