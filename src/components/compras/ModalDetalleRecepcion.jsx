import { Package, Network, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatDateAR } from '@/lib/dateUtils';
import DocumentFlow from '@/components/shared/DocumentFlow';

const ORIGEN_LABELS = {
  implicita: { label: 'Compra Rápida', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  manual:    { label: 'Manual (OC)',   className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300' },
};

const ESTADO_LABELS = {
  recibido:  { label: 'Recibido',  className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  pendiente: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  parcial:   { label: 'Parcial',   className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
  anulado:   { label: 'Anulado',   className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
};

// Campo etiquetado de la cabecera — mismo formato que ModalDetalleEntrega.
function Campo({ label, children }) {
  return (
    <div>
      <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase tracking-wide">{label}</span>
      <p className="mt-0.5 truncate" title={typeof children === 'string' ? children : undefined}>{children}</p>
    </div>
  );
}

function ModalDetalleRecepcion({ recepcion, onClose, onVerMapa, onDuplicar }) {
  if (!recepcion) return null;

  const items = recepcion.recepcion_items ?? [];
  const totalUnidades = items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
  const estadoCfg = ESTADO_LABELS[recepcion.estado] || ESTADO_LABELS.pendiente;
  const origenCfg = ORIGEN_LABELS[recepcion.origen] || ORIGEN_LABELS.manual;

  const flowChips = [
    ...(recepcion.orden_compra_id ? [{ tipo: 'orden_compra', id: recepcion.orden_compra_id, numero: recepcion.ordenes_compra?.numero, active: false }] : []),
    { tipo: 'recepcion', id: recepcion.id, numero: recepcion.numero_recepcion, active: true },
    ...(recepcion.compra_id ? [{ tipo: 'factura_compra', id: recepcion.compra_id, numero: recepcion.compras?.numero_factura, active: false }] : []),
  ];

  return (
    <Dialog open={!!recepcion} onOpenChange={v => !v && onClose()}>
      {/* size="wide" — mismo shell que el resto de los documentos. Sin tabs de
          Logística/Remito (a diferencia de ModalDetalleEntrega): la Recepción
          no tiene domicilio de destino que congelar (siempre llega al mismo
          depósito) ni emite un documento propio con CAE/CAI — el remito lo
          emite el proveedor, no nosotros. Mismo shell plano que ModalDetalleOC. */}
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <Package className="h-5 w-5 text-[rgb(var(--kx-violet))]" />
            Recepción {recepcion.numero_recepcion}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">Detalle completo de la recepción.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-6 py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <Campo label="Estado">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${estadoCfg.className}`}>
                {estadoCfg.label}
              </span>
            </Campo>
            <Campo label="Origen">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${origenCfg.className}`}>
                {origenCfg.label}
              </span>
            </Campo>
            <Campo label="Fecha">
              <span className="dark:text-slate-300">{formatDateAR(recepcion.fecha)}</span>
            </Campo>
            <Campo label="Unidades recibidas">
              <span className="font-mono font-semibold dark:text-kx-text">
                {totalUnidades.toLocaleString('es-AR')}
              </span>
            </Campo>

            <Campo label="Proveedor">
              <span className="font-medium dark:text-kx-text">{recepcion.proveedores?.nombre || '—'}</span>
            </Campo>
            <Campo label="CUIT">
              <span className="font-mono dark:text-slate-300">{recepcion.proveedores?.cuit || '—'}</span>
            </Campo>
            <Campo label="OC de origen">
              <span className="font-mono dark:text-slate-300">{recepcion.ordenes_compra?.numero || '—'}</span>
            </Campo>
            <Campo label="Factura">
              <span className="font-mono dark:text-slate-300">
                {recepcion.compras?.numero_factura || 'Sin facturar'}
              </span>
            </Campo>
          </div>

          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-2xs font-semibold text-kx-text-3 dark:text-kx-text-3 uppercase tracking-wider">
                Flujo del documento
              </p>
              <button
                type="button"
                onClick={onVerMapa}
                className="text-2xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
                title="Ver mapa de relaciones completo"
              >
                <Network className="w-3 h-3" /> Mapa de relaciones
              </button>
            </div>
            <DocumentFlow chips={flowChips} />
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
        </div>

        <DialogFooter className="shrink-0 flex-wrap gap-2 sm:justify-between border-t border-kx-border dark:border-kx-border px-6 py-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
            <Button
              variant="outline"
              onClick={() => onDuplicar?.(recepcion)}
              className="dark:border-kx-border dark:text-slate-300"
            >
              <Copy className="w-4 h-4 mr-2" /> Duplicar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleRecepcion;
