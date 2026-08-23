import { useQuery } from '@tanstack/react-query';
import { FileText, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/lib/customSupabaseClient';
import { asientosService, PLAN_CUENTAS_KEYS } from '@/services/planCuentasService';
import { ESTADO_COLOR, fmt } from '@/components/plan-cuentas/shared';

/**
 * Documentos origen resolubles a un número legible (chico #1 del hallazgo
 * de Luciano 22/08: "Origen: venta" no dice CUÁL venta). Solo cubre los
 * orígenes que van a `comprobantes` — compra/recuento/revalorización/ajuste
 * de stock quedan afuera a propósito (menos frecuentes, otra tabla cada
 * uno) — se puede sumar cuando haga falta.
 */
const ORIGEN_A_COMPROBANTE = new Set(['venta', 'nota_credito', 'nota_debito', 'cancelacion_venta']);

// Campo etiquetado — mismo componente/estilo que ya usan Entrega/OC/Factura
// (hallazgo Luciano 23/08: este modal seguía con su propio grid ad-hoc
// "Label: valor" en vez de las mayúsculas+tracking-wide del resto de los
// documentos). Local porque este modal es un "peek" liviano, no un
// documento completo — no amerita el shell tabulado de DocumentoTabs.
function Campo({ label, children, className = '' }) {
  return (
    <div className={className}>
      <span className="text-kx-text-3 text-xs uppercase tracking-wide">{label}</span>
      <div className="mt-0.5 text-sm text-kx-text">{children}</div>
    </div>
  );
}

/**
 * ModalDetalleAsiento — visor de un asiento contable puntual, reusado desde
 * cualquier documento del ERP (via VerAsientoButton) y desde
 * plan-cuentas/TabAsientos.jsx (única fuente de verdad para este UI, antes
 * vivía duplicado ahí adentro).
 *
 * Dos formas de uso:
 *  - `asiento`: el objeto ya cargado (TabAsientos lo trae de su propia lista,
 *    no hace falta refetchear).
 *  - `asientoId`: se busca acá con react-query (VerAsientoButton, que solo
 *    conoce el id).
 */
function ModalDetalleAsiento({ asiento: asientoProp = null, asientoId = null, open, onOpenChange }) {
  const { data: asientoFetched, isLoading } = useQuery({
    queryKey: PLAN_CUENTAS_KEYS.asiento(asientoId),
    queryFn: () => asientosService.getAsiento(asientoId),
    enabled: open && !asientoProp && !!asientoId,
  });

  const detalle = asientoProp ?? asientoFetched;

  const origenEsComprobante = !!detalle && ORIGEN_A_COMPROBANTE.has(detalle.origen) && !!detalle.origen_id;
  const { data: origenNumero } = useQuery({
    queryKey: ['asiento_origen_comprobante', detalle?.origen_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('comprobantes')
        .select('numero_venta')
        .eq('id', detalle.origen_id)
        .maybeSingle();
      return data?.numero_venta ?? null;
    },
    enabled: open && origenEsComprobante,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-2xl">
        <DialogHeader className="border-b border-kx-border pb-4">
          <DialogTitle className="flex items-center gap-2">
            <FileText size={16} className="text-kx-blue" />
            {detalle ? `Asiento ${detalle.numero}` : 'Asiento contable'}
            {detalle && (
              <span className={`ml-2 text-2xs px-2 py-0.5 rounded-full border font-medium ${ESTADO_COLOR[detalle.estado]}`}>
                {detalle.estado}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>Líneas y detalle del asiento contable.</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-10 text-kx-text-3">
            <Loader2 size={22} className="animate-spin" />
          </div>
        )}

        {!isLoading && !detalle && (
          <div className="py-8 text-center text-kx-text-2 text-sm">
            No se encontró el asiento.
          </div>
        )}

        {detalle && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Campo label="Fecha">{new Date(detalle.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</Campo>
              <Campo label="Origen">
                {detalle.origen || 'manual'}
                {origenNumero && <span className="text-kx-text-2"> — {origenNumero}</span>}
              </Campo>
              {detalle.centro_costo?.nombre && (
                <Campo label="Centro de costo">{detalle.centro_costo.nombre}</Campo>
              )}
              {detalle.descripcion && (
                <Campo label="Descripción" className="col-span-2 sm:col-span-3">{detalle.descripcion}</Campo>
              )}
            </div>
            <div className="rounded-lg border border-kx-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-kx-surface-2">
                  <tr>
                    <th className="px-3 py-2 text-left text-kx-text-3">Cuenta</th>
                    <th className="px-3 py-2 text-right text-kx-text-3">Debe</th>
                    <th className="px-3 py-2 text-right text-kx-text-3">Haber</th>
                  </tr>
                </thead>
                <tbody>
                  {detalle.asientos_items?.map((item) => (
                    <tr key={item.id} className="border-t border-kx-border">
                      <td className="px-3 py-1.5 text-kx-text-3">
                        <span className="font-mono text-kx-blue mr-2">{item.plan_cuentas?.codigo}</span>
                        {item.plan_cuentas?.nombre}
                        {item.descripcion && <span className="text-kx-text-2 ml-2">({item.descripcion})</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono text-kx-text-3">{item.debe > 0 ? fmt(item.debe) : '—'}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-kx-text-3">{item.haber > 0 ? fmt(item.haber) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-kx-surface-2/50">
                  <tr>
                    <td className="px-3 py-2 text-kx-text-3 font-medium">Total</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-kx-text">{fmt(detalle.total_debe)}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-kx-text">{fmt(detalle.total_haber)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleAsiento;
