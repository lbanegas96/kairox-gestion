import { useState } from 'react';
import { FileMinus, FileWarning, Package, Network, Copy, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatDateAR } from '@/lib/dateUtils';
import DocumentFlow from '@/components/shared/DocumentFlow';
import MapaRelaciones from '@/components/shared/MapaRelaciones';
import MenuAccionesDocumento from '@/components/shared/documento/MenuAccionesDocumento';

const ALICUOTA_LABEL = { '21': '21%', '10.5': '10,5%', '0': '0%', exento: 'Exento', no_gravado: 'No gravado' };

/**
 * ModalDetalleNotaProveedor — detalle de una Nota de Crédito o Débito RECIBIDA
 * de un proveedor (13/09, pedido de Luciano: "aplicales un modal completo con
 * todas las funciones que correspondan" — antes estos documentos solo se veían
 * como fila de tabla con botones de texto, sin vista de detalle ni ítems).
 * Mismo shell que ModalDetalleDevolucion/ModalDetalleFacturaCompra — un solo
 * componente parametrizado por `tipo` en vez de duplicar el 90% del layout
 * entre NC y ND (misma cabecera, misma tabla de ítems, mismo footer).
 */
function ModalDetalleNotaProveedor({ nota, tipo, onClose, onNavigate, onDuplicar, onCancelar }) {
  const [mapaOpen, setMapaOpen] = useState(false);

  if (!nota) return null;

  const esCredito = tipo === 'credito';
  const numero = esCredito ? nota.numero_ncp : nota.numero_nd;
  const items = (esCredito ? nota.notas_credito_proveedor_items : nota.notas_debito_items) ?? [];
  const conceptoLabel = esCredito ? 'Motivo' : 'Concepto';
  const concepto = esCredito ? nota.motivo : nota.concepto;
  const cancelada = nota.estado === 'cancelada';
  const puedeCancelar = !cancelada && !(esCredito && nota.reembolso_efectivo);

  const flowChips = [
    ...(nota.compra_id
      ? [{ tipo: 'factura_compra', id: nota.compra_id, numero: nota.factura_compra?.numero_factura, active: false }]
      : []),
    { tipo: esCredito ? 'nota_credito' : 'nota_debito', id: nota.id, numero, active: true },
  ];

  return (
    <Dialog open={!!nota} onOpenChange={v => !v && onClose()}>
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            {esCredito ? <FileMinus className="h-5 w-5 text-kx-amber" /> : <FileWarning className="h-5 w-5 text-kx-amber" />}
            {esCredito ? 'Nota de Crédito' : 'Nota de Débito'} {numero}
            {cancelada && (
              <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-kx-text-2">
                Cancelada
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {esCredito ? 'Nota de crédito recibida de proveedor' : 'Nota de débito recibida de proveedor'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className={`grid grid-cols-2 ${esCredito ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 text-sm`}>
            <div>
              <p className="text-xs text-kx-text-3 uppercase mb-1">Proveedor</p>
              <p className="font-medium dark:text-kx-text">{nota.proveedores?.nombre || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-kx-text-3 uppercase mb-1">Fecha</p>
              <p className="dark:text-slate-300">{formatDateAR(nota.fecha + 'T00:00:00Z')}</p>
            </div>
            {esCredito && (
              <div>
                <p className="text-xs text-kx-text-3 uppercase mb-1">Cobro</p>
                <p className="dark:text-slate-300">{nota.reembolso_efectivo ? 'Efectivo' : 'Cta. Cte.'}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-kx-text-3 uppercase mb-1">Estado</p>
              <p className="dark:text-slate-300">{cancelada ? 'Cancelada' : 'Activa'}</p>
            </div>
          </div>

          {concepto && (
            <div className="bg-kx-surface-2 dark:bg-kx-surface rounded-lg p-3 text-sm text-kx-text-2 dark:text-kx-text-2">
              <span className="not-italic font-semibold text-xs text-kx-text-3 uppercase mr-1">{conceptoLabel}:</span>
              <span className="italic">{concepto}</span>
            </div>
          )}

          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-2xs font-semibold text-kx-text-3 dark:text-kx-text-3 uppercase tracking-wider">
                Flujo del documento
              </p>
              {nota.compra_id && (
                <button
                  type="button"
                  onClick={() => setMapaOpen(true)}
                  className="text-2xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
                  title="Ver mapa de relaciones completo"
                >
                  <Network className="w-3 h-3" /> Mapa de relaciones
                </button>
              )}
            </div>
            <DocumentFlow
              chips={flowChips}
              onNavigate={(t, id) => { onClose(); onNavigate?.(t, id); }}
            />
          </div>

          {nota.compra_id && (
            <MapaRelaciones
              open={mapaOpen}
              onOpenChange={setMapaOpen}
              compraId={nota.compra_id}
              onNavigate={(t, id) => { setMapaOpen(false); onClose(); onNavigate?.(t, id); }}
            />
          )}

          {items.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-kx-border dark:border-kx-border">
                  <th className="text-left pb-2 text-kx-text-2">Producto</th>
                  <th className="text-right pb-2 text-kx-text-2 w-16">Cant.</th>
                  <th className="text-center pb-2 text-kx-text-2 w-20">IVA</th>
                  <th className="text-right pb-2 text-kx-text-2 w-24">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800/50">
                    <td className="py-2 dark:text-kx-text">
                      <span className="flex items-center gap-1.5">
                        <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                        {item.productos?.nombre || item.descripcion || '—'}
                      </span>
                    </td>
                    <td className="py-2 text-right font-mono dark:text-kx-text">
                      {Number(item.cantidad).toLocaleString('es-AR')}
                    </td>
                    <td className="py-2 text-center text-xs text-kx-text-2">
                      {ALICUOTA_LABEL[item.alicuota_iva] || item.alicuota_iva || '—'}
                    </td>
                    <td className="py-2 text-right font-mono dark:text-kx-text">
                      ${Number(item.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {nota.iva_discriminado > 0.005 && (
                  <>
                    <tr>
                      <td colSpan={3} className="pt-2 text-right text-xs text-kx-text-2">Neto gravado</td>
                      <td className="pt-2 text-right text-xs text-kx-text-2 tabular-nums">
                        ${Number(nota.neto_gravado || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="text-right text-xs text-kx-text-2">IVA</td>
                      <td className="text-right text-xs text-kx-text-2 tabular-nums">
                        ${Number(nota.iva_discriminado || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  </>
                )}
                <tr>
                  <td colSpan={3} className="pt-2 text-right text-sm font-semibold text-kx-text-2">Total</td>
                  <td className="pt-2 text-right font-mono font-bold dark:text-kx-text">
                    ${Number(nota.monto).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <DialogFooter className="gap-2 flex-wrap sm:justify-between px-6 py-4 shrink-0 border-t border-kx-border dark:border-kx-border">
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={onClose} className="dark:border-kx-border dark:text-slate-300">
              Cerrar
            </Button>
            <MenuAccionesDocumento
              acciones={[
                onDuplicar && { label: 'Duplicar', icon: Copy, onClick: onDuplicar },
              ]}
            />
            {esCredito && nota.reembolso_efectivo && !cancelada && (
              <span className="text-2xs text-kx-text-3 italic">Cobrada en efectivo — no se puede cancelar desde acá</span>
            )}
          </div>
          {puedeCancelar && (
            <Button
              variant="outline"
              onClick={onCancelar}
              className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-900/20 gap-2"
            >
              <Ban className="w-4 h-4" /> Cancelar {esCredito ? 'NC' : 'ND'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleNotaProveedor;
