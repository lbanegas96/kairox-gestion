import { Loader2, CheckCircle, XCircle, Clock, AlertTriangle, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const fmt = (n) =>
  Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const mmss = (s) => {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
};

/**
 * Modal de cobro por QR MercadoPago en el mostrador.
 *
 * No se cierra con Escape ni clickeando afuera a propósito (`onInteractOutside`
 * / `onEscapeKeyDown` bloqueados mientras se espera el pago): la venta ya existe
 * en estado `pendiente` y tiene stock descontado, así que salir sin cancelar
 * dejaría un comprobante colgado. La única salida mientras se espera es
 * "Cancelar cobro", que revierte todo. (Si igual se cierra el navegador, el cron
 * `expirar_qrs_vencidos` lo limpia al vencer — mig.306.)
 */
export default function ModalCobroQR({ open, estado, qrDataUrl, datos, error, segundosRestantes, onCancelar, onCerrar, cancelando }) {
  const esperando = estado === 'esperando';
  const creando   = estado === 'creando';

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-[420px]"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => { if (esperando || creando) e.preventDefault(); }}
        hideCloseButton={esperando || creando}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-kx-text-2" />
            Cobro con QR MercadoPago
          </DialogTitle>
          <DialogDescription>
            {datos?.numero_venta
              ? <>Venta <span className="font-mono">{datos.numero_venta}</span> · <span className="font-semibold text-kx-text">${fmt(datos.total)}</span></>
              : 'Generando el código de pago…'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Generando ───────────────────────────────────────────────── */}
        {creando && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-kx-text-3" />
            <p className="text-sm text-kx-text-2">Creando la venta y pidiendo el QR a MercadoPago…</p>
          </div>
        )}

        {/* ── Esperando el pago ───────────────────────────────────────── */}
        {esperando && (
          <div className="flex flex-col items-center gap-4 py-2">
            {qrDataUrl && (
              <div className="bg-white p-3 rounded-xl border border-kx-border">
                <img src={qrDataUrl} alt="Código QR de MercadoPago para pagar la venta" className="w-56 h-56" />
              </div>
            )}

            <p className="text-sm text-kx-text-2 text-center">
              Pedile al cliente que lo escanee con la app de <strong>MercadoPago</strong>.
            </p>

            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-kx-text-3" />
              <span className="text-kx-text-2">Esperando confirmación del pago…</span>
            </div>

            {segundosRestantes != null && (
              <div className={`flex items-center gap-1.5 text-xs font-medium ${segundosRestantes <= 60 ? 'text-kx-amber' : 'text-kx-text-3'}`}>
                <Clock className="w-3.5 h-3.5" />
                {segundosRestantes > 0
                  ? <>El código vence en <span className="tabular-nums font-semibold">{mmss(segundosRestantes)}</span></>
                  : 'El código venció — cancelá el cobro para liberar el stock'}
              </div>
            )}

            <p className="text-2xs text-kx-text-3 text-center max-w-[300px]">
              La confirmación puede demorar hasta un minuto. No cierres esta ventana:
              la venta ya está reservada y el stock descontado.
            </p>
          </div>
        )}

        {/* ── Pagado ──────────────────────────────────────────────────── */}
        {estado === 'pagado' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <CheckCircle className="w-14 h-14 text-kx-green" />
            <p className="text-lg font-semibold text-kx-text">¡Pago acreditado!</p>
            <p className="text-sm text-kx-text-2 text-center">
              La venta <span className="font-mono">{datos?.numero_venta}</span> quedó registrada por{' '}
              <span className="font-semibold">${fmt(datos?.total)}</span>.
            </p>
          </div>
        )}

        {/* ── Cancelado / expirado ────────────────────────────────────── */}
        {(estado === 'cancelado' || estado === 'expirado') && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <XCircle className="w-12 h-12 text-kx-text-3" />
            <p className="text-base font-semibold text-kx-text">
              {estado === 'cancelado' ? 'Cobro cancelado' : 'El código venció'}
            </p>
            <p className="text-sm text-kx-text-2 text-center">
              La venta se anuló y el stock volvió al inventario.
            </p>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {estado === 'error' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <AlertTriangle className="w-12 h-12 text-kx-red" />
            <p className="text-base font-semibold text-kx-text">No se pudo generar el QR</p>
            <p className="text-sm text-kx-text-2 text-center break-words">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {esperando ? (
            <Button variant="outline" onClick={onCancelar} disabled={cancelando}>
              {cancelando ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Cancelar cobro
            </Button>
          ) : (
            <Button onClick={onCerrar} disabled={creando}>
              {estado === 'pagado' ? 'Listo' : 'Cerrar'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
