import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt, Network, FileMinus, FilePlus, Undo2, Copy, Ban, History, Code2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { formatDateAR, getTodayAR } from '@/lib/dateUtils';
import { comprasService } from '@/services/comprasService';
import { asientosAutoService } from '@/services/planCuentasService';
import VerAsientoButton from '@/components/shared/VerAsientoButton';
import MenuAccionesDocumento from '@/components/shared/documento/MenuAccionesDocumento';
import HistorialCambiosDialog from '@/components/shared/documento/HistorialCambiosDialog';

// Fase 2 (15/08): antes Factura de Compra era el único documento sin un modal
// de detalle propio — una fila que se expandía inline en la tabla, sin totales
// ni acceso al Mapa de Relaciones. Mismo formato grande que el resto
// (Cotización/Pedido/OC/Entrega).
//
// Mismo criterio que precio_unitario en Cotización/Pedido/OC: costo_unitario
// acá es NETO (sin IVA) — a diferencia de Ventas, no hay que dividir por el
// factor de la alícuota, el neto ya está guardado directo.
const ALICUOTA_LABEL = { '21': '21%', '10.5': '10.5%', '0': '0%', exento: 'Exento', no_gravado: 'No gravado' };

const ESTADO_LABELS = {
  pagada:    { label: 'Pagada',    className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  pendiente: { label: 'Pendiente', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  anulada:   { label: 'Anulada',   className: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' },
};

// Campos de cabecera que vale la pena mostrar en el historial si cambiaron —
// mismo criterio que CAMPOS_HISTORIAL en ModalDetalleOC.jsx.
const CAMPOS_HISTORIAL = {
  proveedor_id: 'Proveedor', forma_pago: 'Forma de pago', numero_factura: 'N° Factura',
  total: 'Total', estado_pago: 'Estado', observaciones: 'Observaciones',
};

function ModalDetalleFacturaCompra({
  compra, onClose, onOpenMapa,
  onCopiarNc, onCopiarNd, onDevolver, onDuplicar, onCancelado,
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showHistorial, setShowHistorial] = useState(false);
  const [verCrudoId, setVerCrudoId] = useState(null);
  const [showCancelarConfirm, setShowCancelarConfirm] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [cancelando, setCancelando] = useState(false);

  const { data: historial = [] } = useQuery({
    queryKey: ['compra_historial', compra?.id],
    queryFn: () => comprasService.getHistorial(compra.id),
    enabled: !!compra?.id && showHistorial,
  });

  if (!compra) return null;

  const puedeCancelar = compra.estado_pago !== 'anulada';

  const handleCancelarCompra = async () => {
    setCancelando(true);
    try {
      const data = await comprasService.cancelar(user.empresa_id, user.id, compra.id, motivoCancelacion.trim() || null);
      asientosAutoService.crearAsientoReversaCompra(user.empresa_id, user.id, {
        compraId: compra.id,
        numeroFactura: data?.numero_factura ?? compra.numero_factura,
        fecha: getTodayAR(),
      }).catch(e => console.warn('[Contabilidad] reversa compra:', e.message));

      toast({
        title: `Factura ${compra.numero_factura || 'S/N'} anulada`,
        description: 'Se revirtió el stock, la caja (si hubo) y la cuenta corriente del proveedor.',
      });
      setShowCancelarConfirm(false);
      setMotivoCancelacion('');
      onCancelado?.();
      onClose();
    } catch (err) {
      toast({ title: 'No se pudo anular la factura', description: err.message, variant: 'destructive' });
    } finally {
      setCancelando(false);
    }
  };

  const items = compra.detalle_compras ?? [];
  const estadoCfg = ESTADO_LABELS[compra.estado_pago] || ESTADO_LABELS.pendiente;
  const simbolo = compra.moneda && compra.moneda !== 'ARS' ? `${compra.moneda} ` : '$';
  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Precio de lista sin ningún descuento (ni línea ni global) — mismo criterio
  // que Cotización/Pedido/OC, para poder mostrar "Descuento" como línea propia.
  const subtotalListaSinDescuentos = items.reduce((s, i) => s + Number(i.cantidad) * Number(i.costo_unitario), 0);
  const subtotalConDescLinea = items.reduce((s, i) => s + Number(i.subtotal), 0);
  const descuentoTotal = subtotalListaSinDescuentos - Number(compra.total) + Number(compra.iva_discriminado ?? 0);
  // Neto/IVA siempre visibles en Compras — como comprador RI siempre importa el
  // IVA Crédito Fiscal, sin condicionarlo a ninguna letra (mismo criterio que
  // ya usa NuevaFacturaProveedorModal.jsx / ModalDetalleOC.jsx).
  const neto = Number(compra.neto_gravado ?? subtotalConDescLinea);
  const iva  = Number(compra.iva_discriminado ?? 0);

  return (
    <Dialog open={!!compra} onOpenChange={v => !v && onClose()}>
      {/* size="wide" — mismo shell que el resto (hallazgo Luciano 22/08, antes max-w-4xl propio). */}
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <Receipt className="w-5 h-5 text-kx-blue" />
            Factura de Proveedor {compra.numero_factura || 'S/N'}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">Detalle completo de la factura.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-kx-text-3 uppercase mb-1">Proveedor</p>
              <p className="font-medium dark:text-kx-text">{compra.proveedores?.nombre ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-kx-text-3 uppercase mb-1">Estado</p>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${estadoCfg.className}`}>
                {estadoCfg.label}
              </span>
            </div>
            <div>
              <p className="text-xs text-kx-text-3 uppercase mb-1">Fecha</p>
              <p className="dark:text-slate-300">{formatDateAR(compra.fecha)}</p>
            </div>
            <div>
              <p className="text-xs text-kx-text-3 uppercase mb-1">Forma de pago</p>
              <p className="dark:text-slate-300">{compra.forma_pago ?? '—'}</p>
            </div>
          </div>

          {/* Mismo gap que tenían Cotización/OC hasta ayer: sin acceso al Mapa de
              Relaciones desde el propio detalle. Se agrega directo acá. */}
          {(onOpenMapa || compra.asiento_id) && (
            <div className="flex items-center justify-end gap-3">
              <VerAsientoButton asientoId={compra.asiento_id} />
              {onOpenMapa && (
                <button
                  type="button"
                  onClick={() => onOpenMapa(compra.id)}
                  className="text-2xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
                  title="Ver mapa de relaciones completo"
                >
                  <Network className="w-3 h-3" /> Mapa de relaciones
                </button>
              )}
            </div>
          )}

          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-kx-border dark:border-kx-border">
                <th className="text-left py-2 text-xs text-kx-text-3">Producto</th>
                <th className="text-right py-2 text-xs text-kx-text-3">Cant.</th>
                <th className="text-right py-2 text-xs text-kx-text-3">Costo unit.</th>
                <th className="text-right py-2 text-xs text-kx-text-3">Desc%</th>
                <th className="text-right py-2 text-xs text-kx-text-3">IVA</th>
                <th className="text-right py-2 text-xs text-kx-text-3">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map(item => (
                <tr key={item.id}>
                  <td className="py-2 dark:text-slate-300">{item.productos?.nombre ?? '—'}</td>
                  <td className="py-2 text-right dark:text-slate-300">{Number(item.cantidad).toLocaleString('es-AR')}</td>
                  <td className="py-2 text-right dark:text-slate-300">{simbolo}{fmt(item.costo_unitario)}</td>
                  <td className="py-2 text-right text-kx-text-3 text-xs">{Number(item.descuento_item) > 0 ? `${item.descuento_item}%` : '—'}</td>
                  <td className="py-2 text-right text-kx-text-3 text-xs">{ALICUOTA_LABEL[item.alicuota_iva] ?? '21%'}</td>
                  <td className="py-2 text-right font-medium dark:text-kx-text">{simbolo}{fmt(item.subtotal)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-kx-text-3 text-xs">
                    Sin ítems de catálogo — ver observaciones (servicios sin producto asociado).
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              {descuentoTotal > 0.005 && (
                <>
                  <tr>
                    <td colSpan={5} className="pt-3 text-right text-xs text-kx-text-3">Subtotal</td>
                    <td className="pt-3 text-right text-xs text-kx-text-3">{simbolo}{fmt(subtotalListaSinDescuentos)}</td>
                  </tr>
                  <tr>
                    <td colSpan={5} className="text-right text-xs text-kx-red">
                      Descuento{compra.descuento_global_pct > 0 ? ` (incl. ${compra.descuento_global_pct}% global)` : ''}
                    </td>
                    <td className="text-right text-xs text-kx-red">-{simbolo}{fmt(descuentoTotal)}</td>
                  </tr>
                </>
              )}
              <tr>
                <td colSpan={5} className="pt-1 text-right text-xs text-kx-text-3">Neto gravado</td>
                <td className="pt-1 text-right text-xs text-kx-text-3">{simbolo}{fmt(neto)}</td>
              </tr>
              <tr>
                <td colSpan={5} className="text-right text-xs text-kx-text-3">IVA</td>
                <td className="text-right text-xs text-kx-text-3">{simbolo}{fmt(iva)}</td>
              </tr>
            </tfoot>
          </table>

          {compra.observaciones && (
            <div className="p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg text-sm text-kx-text-2 dark:text-kx-text-2">
              <span className="font-medium">Observaciones: </span>{compra.observaciones}
            </div>
          )}
        </div>

        {/* TOTAL clavado acá arriba (29/08, hallazgo Luciano: "todo lo que es
            total tiene que quedar fijo en el footer, ya que es un dato de
            tipo cabecera") — deja de estar en el tfoot de la grilla, que
            ahora solo se ve al scrollear. */}
        <div className="shrink-0 flex items-center justify-between px-6 pt-3 border-t border-kx-border dark:border-kx-border">
          <span className="text-sm font-semibold text-kx-text-2 dark:text-kx-text-2">TOTAL</span>
          <span className="font-mono font-bold text-lg dark:text-kx-text">{simbolo}{fmt(compra.total)}</span>
        </div>

        <DialogFooter className="gap-2 flex-wrap px-6 py-4 shrink-0 border-t-0">
          <Button variant="outline" onClick={onClose} className="dark:border-kx-border dark:text-slate-300">
            Cerrar
          </Button>
          {/* Duplicar/Historial — pedido de Luciano (23/08): disponible pero no
              a mano del resto de las acciones. Mismo criterio en Cotización/
              OC/Pedido. Historial nuevo (mig.391, Fase 2 paridad Compras). */}
          <MenuAccionesDocumento
            acciones={[
              onDuplicar && { label: 'Duplicar', icon: Copy, onClick: () => onDuplicar(compra) },
              { label: 'Historial de cambios', icon: History, onClick: () => setShowHistorial(true) },
            ]}
          />
          {onCopiarNc && (
            <Button variant="outline" onClick={() => onCopiarNc(compra)} className="gap-2 dark:border-kx-border dark:text-slate-300">
              <FileMinus className="w-4 h-4 text-kx-amber" /> Copiar a NC
            </Button>
          )}
          {onCopiarNd && (
            <Button variant="outline" onClick={() => onCopiarNd(compra)} className="gap-2 dark:border-kx-border dark:text-slate-300">
              <FilePlus className="w-4 h-4 text-kx-red" /> Copiar a ND
            </Button>
          )}
          {onDevolver && compra.estado_pago !== 'anulada' && (
            <Button
              variant="outline"
              onClick={() => onDevolver(compra)}
              className="gap-2 border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-900/20"
            >
              <Undo2 className="w-4 h-4" /> Devolver a proveedor
            </Button>
          )}
          {/* Anular Factura — mig.391, Fase 2 de PLAN_PARIDAD_COMPRAS.md.
              Simétrica a "Cancelar Factura" del lado ventas (SaleDetailModal.jsx). */}
          {puedeCancelar && (
            <Button
              variant="outline"
              onClick={() => setShowCancelarConfirm(true)}
              className="gap-2 border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Ban className="w-4 h-4" /> Anular Factura
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={showCancelarConfirm} onOpenChange={v => { if (!cancelando) { setShowCancelarConfirm(v); if (!v) setMotivoCancelacion(''); } }}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-kx-text">
              ¿Anular Factura {compra.numero_factura || 'S/N'}?
            </AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              Se repone el stock recibido, se revierte el pago en caja (si lo hubo) y la deuda en
              Cuenta Corriente del proveedor (si la hay). Queda un registro completo de la
              reversión — nada se borra. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={motivoCancelacion}
            onChange={e => setMotivoCancelacion(e.target.value)}
            placeholder="Motivo (opcional) — ej. error de carga, factura duplicada..."
            className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelando} className="dark:text-kx-text dark:border-kx-border">Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelarCompra} disabled={cancelando} className="bg-red-600 hover:bg-red-700 text-white">
              {cancelando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
              Sí, anular factura
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <HistorialCambiosDialog open={showHistorial} onOpenChange={setShowHistorial}>
        {historial.length === 0 && (
          <p className="text-kx-text-3 py-2">Sin cambios registrados todavía.</p>
        )}
        {historial.map(entry => (
          <HistorialItemCompra key={`${entry.tabla}-${entry.id}`} entry={entry}
            verCrudo={verCrudoId === `${entry.tabla}-${entry.id}`}
            onToggleCrudo={() => setVerCrudoId(v => v === `${entry.tabla}-${entry.id}` ? null : `${entry.tabla}-${entry.id}`)}
          />
        ))}
      </HistorialCambiosDialog>
    </Dialog>
  );
}

// Traduce una fila cruda de audit_log a algo legible — mismo patrón que
// HistorialItem en ModalDetalleOC.jsx/ModalDetalleCotizacion.jsx.
function HistorialItemCompra({ entry, verCrudo, onToggleCrudo }) {
  const fecha = new Date(entry.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });

  const resumen = (() => {
    if (entry.tabla === 'detalle_compras') {
      const item = entry.new_data ?? entry.old_data;
      if (entry.operacion === 'INSERT') return `Ítem agregado (x${item?.cantidad ?? '?'})`;
      if (entry.operacion === 'DELETE') return `Ítem quitado`;
      return `Ítem modificado`;
    }
    if (entry.operacion === 'INSERT') return 'Factura registrada';
    if (entry.operacion === 'DELETE') return 'Factura eliminada';
    const cambios = Object.entries(CAMPOS_HISTORIAL)
      .filter(([campo]) => JSON.stringify(entry.old_data?.[campo]) !== JSON.stringify(entry.new_data?.[campo]))
      .map(([campo, label]) => {
        const antes = entry.old_data?.[campo];
        const despues = entry.new_data?.[campo];
        const fmtVal = (v) => {
          if (v == null || v === '') return '—';
          if (campo === 'estado_pago') return ESTADO_LABELS[v]?.label ?? v;
          if (campo === 'total') return `$${Number(v).toLocaleString('es-AR')}`;
          return String(v);
        };
        return `${label}: ${fmtVal(antes)} → ${fmtVal(despues)}`;
      });
    return cambios.length > 0 ? cambios.join(' · ') : 'Cambio sin campos relevantes visibles';
  })();

  return (
    <div className="border-b border-kx-border dark:border-kx-border last:border-0 pb-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-kx-text-2 dark:text-kx-text-2">{resumen}</span>
        <span className="text-kx-text-3 whitespace-nowrap">{fecha}</span>
      </div>
      <button type="button" onClick={onToggleCrudo} className="text-kx-text-3 hover:text-kx-text flex items-center gap-1 mt-0.5">
        <Code2 className="w-3 h-3" /> {verCrudo ? 'Ocultar detalle técnico' : 'Ver detalle técnico'}
      </button>
      {verCrudo && (
        <pre className="mt-1 p-2 bg-kx-surface-2 dark:bg-slate-900 rounded text-[10px] overflow-x-auto text-kx-text-2">
          {JSON.stringify({ old: entry.old_data, new: entry.new_data }, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default ModalDetalleFacturaCompra;
