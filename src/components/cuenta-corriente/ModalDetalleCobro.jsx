import { useState, useEffect } from 'react';
import { Banknote, Loader2, Ban, Printer, ExternalLink } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { formatDateTimeAR } from '@/lib/dateUtils';
import { printElementById } from '@/lib/printRecibo';
import { getEmpresaParaPDF } from '@/lib/empresaUtils';
import ReciboPago from '@/components/shared/ReciboPago';

// "Comprobante de Pago" — detalle de un Cobro como documento propio, mismo
// nivel que SaleDetailModal/ModalDetalleEntrega (29/08, pedido de Luciano:
// "quiero lo mismo con el pago" que con la Factura — se levanta al crearse,
// queda abierto hasta cerrarlo con Escape, y reabrirlo desde el Mapa de
// Relaciones vuelve a llamar a este mismo modal para revisarlo o
// cancelarlo). Un cobro es una transacción financiera confirmada — igual
// que Factura/NC/ND, nunca se edita en el lugar: "modificarlo" es cancelar
// (documento de reversa, nunca se borra el rastro) y cargar uno nuevo bien.
function ModalDetalleCobro({ movimientoId, open, onOpenChange, onUpdate, onNavigate, onCancelar }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [cobro, setCobro] = useState(null);
  const [imputaciones, setImputaciones] = useState([]);
  const [empresaData, setEmpresaData] = useState({});
  const [showCancelarConfirm, setShowCancelarConfirm] = useState(false);
  const [motivoCancelacion, setMotivoCancelacion] = useState('');
  const [cancelando, setCancelando] = useState(false);

  useEffect(() => {
    if (open && movimientoId) {
      fetchCobro();
    } else {
      setCobro(null);
      setImputaciones([]);
      setShowCancelarConfirm(false);
      setMotivoCancelacion('');
      setCancelando(false);
    }
  }, [open, movimientoId]);

  const fetchCobro = async () => {
    setLoading(true);
    try {
      const { data: mov, error } = await supabase
        .from('cuenta_corriente_movimientos')
        .select('id, cliente_id, monto, fecha, descripcion, metodo_cobro, referencia_pago, estado, clientes(nombre)')
        .eq('id', movimientoId)
        .single();
      if (error) throw error;
      setCobro(mov);

      const { data: imps } = await supabase
        .from('cuenta_corriente_imputaciones')
        .select('monto, comprobantes(numero_venta, numero_afip, tipo_comprobante_afip)')
        .eq('cobro_movimiento_id', movimientoId);
      setImputaciones(imps ?? []);

      if (user?.empresa_id) {
        const emp = await getEmpresaParaPDF(user.empresa_id);
        setEmpresaData(emp ?? {});
      }
    } catch (error) {
      console.error('Error loading cobro:', error);
      toast({ title: 'Error', description: 'No se pudo cargar el detalle del cobro.', variant: 'destructive' });
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Recibo propio (no el `lastRecibo` del hook de creación) — este modal
  // también se reabre para cobros viejos, así que arma el comprobante
  // imprimible con lo que acaba de leer, no con un estado de sesión que
  // podría no corresponder a este cobro.
  const recibo = cobro ? {
    tipo: 'cobro',
    movimientoId: cobro.id,
    fecha: cobro.fecha,
    contraparteNombre: cobro.clientes?.nombre,
    monto: cobro.monto,
    metodo: cobro.metodo_cobro,
    referenciaPago: cobro.referencia_pago,
    nota: cobro.descripcion,
    imputaciones: imputaciones.map(imp => ({
      // Condicionar en numero_afip, no en tipo_comprobante_afip: una empresa
      // sin AFIP (cae_estado siempre 'no_aplica') igual tiene letra asignada
      // (tipo_comprobante_afip='B', por ej.) pero numero_afip queda NULL para
      // siempre — con la condición vieja mostraba literal "B null" en vez de
      // caer al numero_venta interno (hallazgo 31/08, Ferretería NADIA).
      numero: imp.comprobantes?.numero_afip
        ? `${imp.comprobantes.tipo_comprobante_afip || ''} ${imp.comprobantes.numero_afip}`.trim()
        : imp.comprobantes?.numero_venta || '—',
      monto: imp.monto,
    })),
    empresa: empresaData,
  } : null;

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={v => { if (!cancelando) onOpenChange(v); }}>
      <DialogContent size="medium" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-base font-bold">
            <Banknote className="h-5 w-5" /> Comprobante de Pago
            {loading && <Loader2 className="h-4 w-4 animate-spin text-kx-text-3" />}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-sm">
            {cobro && <>Cobro de <strong className="text-kx-text">{cobro.clientes?.nombre || 'Cliente'}</strong>{cobro.fecha && ` — ${formatDateTimeAR(cobro.fecha)}`}</>}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <Loader2 className="h-8 w-8 animate-spin text-kx-blue" />
          </div>
        ) : cobro ? (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-6 py-4">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                cobro.estado === 'cancelado'
                  ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              }`}>
                {cobro.estado === 'cancelado' ? 'Cancelado' : 'Confirmado'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">Monto</span>
                <p className="mt-0.5 font-bold text-lg text-kx-text tabular-nums">${fmt(cobro.monto)}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">Método de Pago</span>
                <p className="mt-0.5 text-kx-text">{cobro.metodo_cobro || '—'}</p>
              </div>
              <div>
                <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">Fecha</span>
                <p className="mt-0.5 text-kx-text">{formatDateTimeAR(cobro.fecha)}</p>
              </div>
              {cobro.referencia_pago && (
                <div>
                  <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">Referencia</span>
                  <p className="mt-0.5 font-mono text-kx-text">{cobro.referencia_pago}</p>
                </div>
              )}
              {cobro.descripcion && (
                <div className="col-span-2 sm:col-span-3">
                  <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">Nota</span>
                  <p className="mt-0.5 text-kx-text">{cobro.descripcion}</p>
                </div>
              )}
            </div>

            {imputaciones.length > 0 && (
              <div className="border-t border-kx-border pt-3">
                <p className="text-2xs font-semibold text-kx-text-3 uppercase tracking-wider mb-2">
                  Facturas imputadas
                </p>
                <div className="border border-kx-border rounded-lg divide-y divide-kx-border">
                  {imputaciones.map((imp, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="font-mono text-kx-text">
                        {imp.comprobantes?.numero_afip
                          ? `${imp.comprobantes.tipo_comprobante_afip || ''} ${imp.comprobantes.numero_afip}`.trim()
                          : imp.comprobantes?.numero_venta || '—'}
                      </span>
                      <span className="font-mono tabular-nums text-kx-text-2">${fmt(imp.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {onNavigate && cobro.cliente_id && (
              <button
                type="button"
                onClick={() => onNavigate(cobro.cliente_id)}
                className="text-xs text-kx-violet hover:opacity-80 font-medium flex items-center gap-1"
              >
                <ExternalLink className="w-3 h-3" /> Ver Cuenta Corriente del cliente
              </button>
            )}
          </div>
        ) : null}

        <DialogFooter className="shrink-0 flex-wrap gap-2 sm:justify-between border-t border-kx-border dark:border-kx-border px-6 py-4">
          <div>
            {cobro?.estado === 'confirmado' && (
              <Button
                variant="outline"
                onClick={() => setShowCancelarConfirm(true)}
                className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                <Ban className="w-4 h-4 mr-2" /> Cancelar Cobro
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={cancelando}
              className="dark:text-kx-text dark:border-kx-border dark:hover:bg-slate-800">
              Cerrar (Esc)
            </Button>
            <Button onClick={() => printElementById('kx-recibo-print')} className="bg-blue-600 hover:bg-blue-700 text-white">
              <Printer className="w-4 h-4 mr-2" /> Imprimir
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={showCancelarConfirm} onOpenChange={v => { if (!cancelando) { setShowCancelarConfirm(v); if (!v) setMotivoCancelacion(''); } }}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-kx-text">¿Cancelar este cobro?</AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              Se revierte el ingreso en caja y la deuda del cliente vuelve a subir en las facturas que este
              cobro tenía imputadas. Queda un registro completo de la reversión — nada se borra. Esta acción
              no se puede deshacer; si te equivocaste al cargarlo, cancelalo y registralo de nuevo bien.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={motivoCancelacion}
            onChange={e => setMotivoCancelacion(e.target.value)}
            placeholder="Motivo (opcional) — ej. monto mal cargado, cliente equivocado..."
            className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            rows={2}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelando} className="dark:text-kx-text dark:border-kx-border">Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setCancelando(true);
                try {
                  await onCancelar?.(cobro.id, motivoCancelacion);
                  setShowCancelarConfirm(false);
                  setMotivoCancelacion('');
                  await fetchCobro();
                  onUpdate?.();
                } finally {
                  setCancelando(false);
                }
              }}
              disabled={cancelando}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {cancelando ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
              Sí, cancelar cobro
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReciboPago recibo={recibo} />
    </Dialog>
  );
}

export default ModalDetalleCobro;
