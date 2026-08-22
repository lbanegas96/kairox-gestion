import { useState } from 'react';
import { Truck, Package, Download, Loader2, Send, FileOutput, Ban, Network, Receipt } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatDateAR } from '@/lib/dateUtils';
import DocumentFlow from '@/components/shared/DocumentFlow';
import MapaRelaciones from '@/components/shared/MapaRelaciones';

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

// Campo etiquetado de la cabecera — mismo formato que el detalle de Cotización.
function Campo({ label, children }) {
  return (
    <div>
      <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase tracking-wide">{label}</span>
      <p className="mt-0.5 truncate" title={typeof children === 'string' ? children : undefined}>{children}</p>
    </div>
  );
}

function ModalDetalleEntrega({
  entrega, onClose, onNavigate,
  onEmitirRemito, emitiendo,
  onDescargarRemito, generandoPdf,
  onCompartirWhatsApp,
  onAnular,
  onFacturar,
}) {
  const [mapaOpen, setMapaOpen] = useState(false);

  if (!entrega) return null;

  const items = entrega.entrega_items ?? [];
  const totalUnidades = items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
  // Facturable mientras no tenga factura propia y no esté anulada. Se factura a
  // través del pedido de origen (es el documento que tiene los precios — la
  // entrega solo mueve mercadería), así que sin pedido no hay nada que facturar:
  // esas son las entregas implícitas del POS, que ya nacen con su comprobante.
  const puedeFacturar = !entrega.comprobante_id && entrega.estado !== 'anulado' && !!entrega.pedido_id;
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
      {/* size="wide" — mismo shell que el resto de los documentos (hallazgo
          Luciano 22/08: antes cada uno traía su propio max-w). */}
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <Truck className="h-5 w-5 text-[rgb(var(--kx-violet))]" />
            Entrega {entrega.numero_entrega}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">Detalle completo de la entrega.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-6 py-4">
          {/* Cabecera en grilla — antes eran filas sueltas a lo alto y en pantalla
              completa quedaba medio modal vacío. Mismo criterio que el detalle de
              Cotización. Todo esto es info que ya traíamos y no se mostraba
              (documento y domicilio del cliente, CAI del remito, unidades). */}
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
              <span className="dark:text-slate-300">{formatDateAR(entrega.fecha)}</span>
            </Campo>
            <Campo label="Unidades entregadas">
              <span className="font-mono font-semibold dark:text-kx-text">
                {totalUnidades.toLocaleString('es-AR')}
              </span>
            </Campo>

            <Campo label="Cliente">
              <span className="font-medium dark:text-kx-text">{entrega.clientes?.nombre || 'Consumidor Final'}</span>
            </Campo>
            <Campo label="CUIT / DNI">
              <span className="font-mono dark:text-slate-300">{entrega.clientes?.documento || '—'}</span>
            </Campo>
            <Campo label="Domicilio">
              <span className="dark:text-slate-300">{entrega.clientes?.direccion || '—'}</span>
            </Campo>
            <Campo label="Pedido de origen">
              <span className="font-mono dark:text-slate-300">{entrega.pedidos?.numero || '—'}</span>
            </Campo>

            <Campo label="Remito">
              <span className="font-mono dark:text-slate-300">{entrega.numero_remito || 'Sin emitir'}</span>
            </Campo>
            <Campo label="CAI">
              <span className="font-mono dark:text-slate-300">{entrega.cai_remito_usado || '—'}</span>
            </Campo>
            <Campo label="Vto. CAI">
              <span className="dark:text-slate-300">
                {entrega.cai_remito_vencimiento_usado ? formatDateAR(entrega.cai_remito_vencimiento_usado) : '—'}
              </span>
            </Campo>
            <Campo label="Factura">
              <span className="font-mono dark:text-slate-300">
                {entrega.comprobantes?.numero_venta || 'Sin facturar'}
              </span>
            </Campo>
          </div>

          {entrega.observaciones && (
            <div className="bg-kx-surface-2 dark:bg-kx-surface rounded-lg p-3 text-sm text-kx-text-2 dark:text-kx-text-2">
              {entrega.observaciones}
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-2xs font-semibold text-kx-text-3 dark:text-kx-text-3 uppercase tracking-wider">
                Flujo del documento
              </p>
              <button
                type="button"
                onClick={() => setMapaOpen(true)}
                className="text-2xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
                title="Ver mapa de relaciones completo"
              >
                <Network className="w-3 h-3" /> Mapa de relaciones
              </button>
            </div>
            <DocumentFlow
              chips={flowChips}
              onNavigate={(tipo, id) => { onClose(); onNavigate?.(tipo, id); }}
            />
          </div>

          <MapaRelaciones
            open={mapaOpen}
            onOpenChange={setMapaOpen}
            entregaId={entrega.id}
            onNavigate={(tipo, id) => { setMapaOpen(false); onClose(); onNavigate?.(tipo, id); }}
          />

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

          {/* El número de remito ya se muestra arriba en la grilla — acá queda
              solo la acción, cuando todavía no se emitió. */}
          {!entrega.numero_remito && (
            <div className="flex justify-between items-center pt-1">
              <span className="text-sm text-kx-text-2">Remito</span>
              <Button
                size="sm" variant="outline"
                disabled={emitiendo}
                onClick={() => onEmitirRemito?.(entrega.id)}
                className="h-7 text-xs"
              >
                {emitiendo ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <FileOutput className="w-3 h-3 mr-1" />}
                Emitir remito
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-wrap gap-2 sm:justify-between border-t border-kx-border dark:border-kx-border px-6 py-4">
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
          <div className="flex gap-2 flex-wrap">
            {puedeFacturar && (
              <Button
                onClick={() => onFacturar?.(entrega)}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Receipt className="w-4 h-4 mr-2" /> Facturar Entrega
              </Button>
            )}
            {entrega.numero_remito && (
              <>
              <Button variant="outline" onClick={() => onCompartirWhatsApp?.(entrega)} className="dark:border-kx-border dark:text-slate-300">
                <Send className="w-4 h-4 mr-2" /> WhatsApp
              </Button>
              <Button onClick={() => onDescargarRemito?.(entrega)} disabled={generandoPdf} className="bg-blue-600 hover:bg-blue-700 text-white">
                {generandoPdf
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generando...</>
                  : <><Download className="w-4 h-4 mr-2" /> Descargar PDF</>
                }
              </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleEntrega;
