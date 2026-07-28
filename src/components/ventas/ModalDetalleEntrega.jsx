import { useState } from 'react';
import { Truck, Package, Download, Loader2, Send, FileOutput, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatDateAR } from '@/lib/dateUtils';
import DocumentFlow from '@/components/shared/DocumentFlow';

const ORIGEN_LABELS = {
  implicita: { label: 'POS',    className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  manual:    { label: 'Manual', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
};

const ESTADO_LABELS = {
  entregado: { label: 'Entregado', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  pendiente: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  parcial:   { label: 'Parcial',   className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  anulado:   { label: 'Anulado',   className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
};

function ModalDetalleEntrega({
  entrega, onClose, onNavigate,
  onEmitirRemito, emitiendo,
  onDescargarRemito, generandoPdf,
  onCompartirWhatsApp,
  onAnular,
}) {
  if (!entrega) return null;

  const items = entrega.entrega_items ?? [];
  const estadoCfg = ESTADO_LABELS[entrega.estado] || ESTADO_LABELS.pendiente;
  const origenCfg = ORIGEN_LABELS[entrega.origen] || ORIGEN_LABELS.manual;

  const flowChips = [
    ...(entrega.pedido_id ? [{ tipo: 'pedido', id: entrega.pedido_id, numero: entrega.pedidos?.numero, active: false }] : []),
    { tipo: 'entrega', id: entrega.id, numero: entrega.numero_entrega, active: true },
    ...(entrega.comprobante_id ? [{ tipo: 'factura', id: entrega.comprobante_id, numero: entrega.comprobantes?.numero_venta, active: false }] : []),
  ];

  const puedeAnular = entrega.estado !== 'anulado' && !entrega.comprobante_id;

  return (
    <Dialog open={!!entrega} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <Truck className="h-5 w-5 text-[rgb(var(--kx-violet))]" />
            Entrega {entrega.numero_entrega}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">Detalle completo de la entrega.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-kx-text-2">Estado</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${estadoCfg.className}`}>
              {estadoCfg.label}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-kx-text-2">Origen</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${origenCfg.className}`}>
              {origenCfg.label}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-kx-text-2">Cliente</span>
            <span className="font-medium dark:text-kx-text">{entrega.clientes?.nombre || '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-kx-text-2">Fecha</span>
            <span className="text-sm dark:text-slate-300">{formatDateAR(entrega.fecha)}</span>
          </div>

          {entrega.observaciones && (
            <div className="bg-kx-surface-2 dark:bg-kx-surface rounded-lg p-3 text-sm text-kx-text-2 dark:text-kx-text-2">
              {entrega.observaciones}
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <p className="text-2xs font-semibold text-kx-text-3 dark:text-kx-text-3 uppercase tracking-wider">
              Flujo del documento
            </p>
            <DocumentFlow
              chips={flowChips}
              onNavigate={(tipo, id) => { onClose(); onNavigate?.(tipo, id); }}
            />
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-kx-border dark:border-kx-border">
                <th className="text-left pb-2 text-kx-text-2">Descripción</th>
                <th className="text-right pb-2 text-kx-text-2 w-20">Cantidad</th>
                <th className="text-right pb-2 text-kx-text-2 w-20">Unidad</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800/50">
                  <td className="py-2 dark:text-kx-text flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                    {item.productos?.nombre || item.producto_id}
                  </td>
                  <td className="py-2 text-right font-mono dark:text-kx-text">
                    {Number(item.cantidad).toLocaleString('es-AR')}
                  </td>
                  <td className="py-2 text-right text-kx-text-2 text-xs">
                    {item.productos?.unidad_medida ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-between items-center pt-1">
            <span className="text-sm text-kx-text-2">Remito</span>
            {entrega.numero_remito ? (
              <span className="font-mono text-sm text-kx-text" title={`CAI ${entrega.cai_remito_usado || '—'}`}>
                {entrega.numero_remito}
              </span>
            ) : (
              <Button
                size="sm" variant="outline"
                disabled={emitiendo}
                onClick={() => onEmitirRemito?.(entrega.id)}
                className="h-7 text-xs"
              >
                {emitiendo ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FileOutput className="w-3 h-3 mr-1" />}
                Emitir remito
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
            {puedeAnular && (
              <Button
                variant="outline"
                onClick={() => onAnular?.(entrega)}
                className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Ban className="w-4 h-4 mr-2" /> Anular
              </Button>
            )}
          </div>
          {entrega.numero_remito && (
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={() => onCompartirWhatsApp?.(entrega)} className="dark:border-kx-border dark:text-slate-300">
                <Send className="w-4 h-4 mr-2" /> WhatsApp
              </Button>
              <Button onClick={() => onDescargarRemito?.(entrega)} disabled={generandoPdf} className="bg-blue-600 hover:bg-blue-700 text-white">
                {generandoPdf
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generando...</>
                  : <><Download className="w-4 h-4 mr-2" /> Descargar PDF</>
                }
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleEntrega;
