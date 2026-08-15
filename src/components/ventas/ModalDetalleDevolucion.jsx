import { useState } from 'react';
import { Undo2, RotateCcw, Package, FileMinus, Repeat, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { formatDateAR } from '@/lib/dateUtils';
import DocumentFlow from '@/components/shared/DocumentFlow';
import MapaRelaciones from '@/components/shared/MapaRelaciones';

const ALICUOTA_LABEL = { '21': '21%', '10.5': '10,5%', '0': '0%', exento: 'Exento', no_gravado: 'No gravado' };
// Fase 4 (15/08): desglose Neto/IVA — mismo criterio que SaleDetailModal.jsx
// (calculado desde los ítems, siempre visible cuando hay IVA, sin gating por letra).
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 };

const COMPENSACION_CFG = {
  nota_credito: { label: 'Nota de Crédito', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  reemplazo:    { label: 'Reemplazo',       className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  pendiente:    { label: 'Sin compensar',   className: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-kx-text-2' },
};

/**
 * ModalDetalleDevolucion — detalle de una Devolución (cliente o proveedor).
 * La generación de NC ya no es automática (mig.263/264): este modal expone la
 * acción "Generar Nota de Crédito" cuando todavía no tiene una, y delega la
 * apertura del modal de NC correspondiente (cliente/proveedor) al padre.
 */
function ModalDetalleDevolucion({ devolucion, onClose, onNavigate, onGenerarNC, onMarcarReemplazo }) {
  const [mapaOpen, setMapaOpen] = useState(false);

  if (!devolucion) return null;

  const esCliente = devolucion.tipo === 'cliente';
  const items = devolucion.devolucion_items ?? [];
  const total = items.reduce((s, i) => s + Number(i.subtotal || 0), 0);
  const neto  = items.reduce((s, i) => {
    const factor = FACTOR_IVA[String(i.alicuota_iva)] ?? 1;
    return s + Number(i.subtotal || 0) / factor;
  }, 0);
  const iva = total - neto;
  const entidadNombre = esCliente ? devolucion.clientes?.nombre : devolucion.proveedores?.nombre;
  const compCfg = COMPENSACION_CFG[devolucion.compensacion] || COMPENSACION_CFG.pendiente;

  const flowChips = [
    ...(esCliente && devolucion.comprobante_id
      ? [{ tipo: 'factura', id: devolucion.comprobante_id, numero: devolucion.factura_origen?.numero_venta, active: false }]
      : []),
    { tipo: 'devolucion', id: devolucion.id, numero: devolucion.numero_devolucion, active: true },
    ...(esCliente && devolucion.nota_credito_id
      ? [{ tipo: 'nota_credito', id: devolucion.nota_credito_id, numero: devolucion.nota_credito?.numero_venta, active: false }]
      : []),
  ];

  const puedeGenerarNC = esCliente
    ? !devolucion.nota_credito_id
    : devolucion.compensacion !== 'nota_credito';
  const puedeMarcarReemplazo = devolucion.compensacion === 'pendiente';

  return (
    <Dialog open={!!devolucion} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            {esCliente ? <Undo2 className="h-5 w-5 text-kx-amber" /> : <RotateCcw className="h-5 w-5 text-kx-amber" />}
            Devolución {devolucion.numero_devolucion}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {esCliente ? 'Devolución de cliente' : 'Devolución a proveedor'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-kx-text-2">{esCliente ? 'Cliente' : 'Proveedor'}</span>
            <span className="font-medium dark:text-kx-text">{entidadNombre || '—'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-kx-text-2">Fecha</span>
            <span className="text-sm dark:text-slate-300">{formatDateAR(devolucion.fecha + 'T00:00:00Z')}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-kx-text-2">{esCliente ? 'Reingresó a stock' : 'Descontado de stock'}</span>
            <span className="text-sm dark:text-slate-300">{devolucion.reingresa_stock ? 'Sí' : 'No'}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-kx-text-2">Compensación</span>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${compCfg.className}`}>
              {compCfg.label}
            </span>
          </div>

          {devolucion.motivo && (
            <div className="bg-kx-surface-2 dark:bg-kx-surface rounded-lg p-3 text-sm text-kx-text-2 dark:text-kx-text-2 italic">
              {devolucion.motivo}
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
            devolucionId={devolucion.id}
            onNavigate={(tipo, id) => { setMapaOpen(false); onClose(); onNavigate?.(tipo, id); }}
          />

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
                      {item.productos?.nombre || '—'}
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
              {iva > 0.005 && (
                <>
                  <tr>
                    <td colSpan={3} className="pt-2 text-right text-xs text-kx-text-2">Neto gravado</td>
                    <td className="pt-2 text-right text-xs text-kx-text-2 tabular-nums">
                      ${neto.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="text-right text-xs text-kx-text-2">IVA</td>
                    <td className="text-right text-xs text-kx-text-2 tabular-nums">
                      ${iva.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={3} className="pt-2 text-right text-sm font-semibold text-kx-text-2">Total</td>
                <td className="pt-2 text-right font-mono font-bold dark:text-kx-text">
                  ${total.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          <Button variant="outline" onClick={onClose} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
          <div className="flex gap-2 flex-wrap">
            {puedeMarcarReemplazo && (
              <Button variant="outline" onClick={() => onMarcarReemplazo?.(devolucion)}
                className="dark:border-kx-border dark:text-slate-300">
                <Repeat className="w-4 h-4 mr-2" /> Marcar como Reemplazo
              </Button>
            )}
            {puedeGenerarNC && (
              <Button onClick={() => onGenerarNC?.(devolucion)} className="bg-kx-amber hover:opacity-90 text-white">
                <FileMinus className="w-4 h-4 mr-2" /> Generar Nota de Crédito
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleDevolucion;
