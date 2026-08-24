import { useQuery } from '@tanstack/react-query';
import { BookMarked, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
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

// Campo etiquetado — mismo componente/estilo que ya usan Entrega/OC/Factura.
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
 *
 * size="wide" — mismo shell que el resto de los documentos (hallazgo Luciano
 * 23/08: este modal seguía siendo un popup chico, `max-w-lg`, mientras
 * Entrega/OC/Factura ya usan el shell grande — pedido explícito: "que sea un
 * documento completo, no un popup").
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
      <DialogContent size="wide" className="bg-kx-surface border-kx-border text-kx-text">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-kx-border">
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-5 w-5 text-kx-blue" />
            {detalle ? `Asiento ${detalle.numero}` : 'Asiento contable'}
            {detalle && (
              <span className={`ml-2 text-2xs px-2 py-0.5 rounded-full border font-medium ${ESTADO_COLOR[detalle.estado]}`}>
                {detalle.estado}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>Líneas y detalle del asiento contable.</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="max-w-3xl mx-auto">
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
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Campo label="Fecha">{new Date(detalle.fecha + 'T12:00:00').toLocaleDateString('es-AR')}</Campo>
                  <Campo label="Origen">
                    {detalle.origen || 'manual'}
                    {origenNumero && <span className="text-kx-text-2"> — {origenNumero}</span>}
                  </Campo>
                  {detalle.centro_costo?.nombre && (
                    <Campo label="Centro de costo">{detalle.centro_costo.nombre}</Campo>
                  )}
                  {detalle.descripcion && (
                    <Campo label="Descripción" className="col-span-1 sm:col-span-3">{detalle.descripcion}</Campo>
                  )}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-kx-border">
                      <th className="text-left pb-2 text-kx-text-2">Cuenta</th>
                      <th className="text-right pb-2 text-kx-text-2 w-32">Debe</th>
                      <th className="text-right pb-2 text-kx-text-2 w-32">Haber</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.asientos_items?.map((item) => (
                      <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800/50">
                        <td className="py-2 text-kx-text">
                          <span className="font-mono text-kx-blue mr-2">{item.plan_cuentas?.codigo}</span>
                          {item.plan_cuentas?.nombre}
                          {item.descripcion && <span className="text-kx-text-2 ml-2">({item.descripcion})</span>}
                        </td>
                        <td className="py-2 text-right font-mono text-kx-text-2">{item.debe > 0 ? fmt(item.debe) : '—'}</td>
                        <td className="py-2 text-right font-mono text-kx-text-2">{item.haber > 0 ? fmt(item.haber) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-kx-border">
                      <td className="py-3 text-right font-bold text-kx-text">Total</td>
                      <td className="py-3 text-right font-mono font-bold text-kx-text">{fmt(detalle.total_debe)}</td>
                      <td className="py-3 text-right font-mono font-bold text-kx-text">{fmt(detalle.total_haber)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t border-kx-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="dark:border-kx-border dark:text-slate-300">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleAsiento;
