import { Loader2, X, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const fmt = (n) =>
  Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Modo Offline del POS — Fase 3. Una fila por venta/apertura de caja que
// todavía no llegó al servidor. 'conflicto' = el servidor la rechazó al
// sincronizar (ej. stock insuficiente re-validado, u otra caja ya abierta) —
// no se reintenta sola, necesita que el cajero la vea y decida.
function Fila({ item, tipo, onAnular }) {
  const esConflicto = item.estado === 'conflicto';
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs space-y-1.5 ${
      esConflicto
        ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
        : 'border-kx-border bg-kx-surface-2'
    }`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-kx-text">
          {tipo === 'venta' ? item.numero_provisorio : 'Apertura de caja'}
          {tipo === 'venta' && (
            <span className="text-kx-text-3 font-normal"> · ${fmt(item.payload?.p_total ?? 0)}</span>
          )}
        </span>
        {esConflicto ? (
          <span className="text-red-600 dark:text-red-400 flex items-center gap-1 flex-shrink-0">
            <AlertTriangle className="w-3 h-3" /> Conflicto
          </span>
        ) : (
          <span className="text-kx-text-3 flex items-center gap-1 flex-shrink-0">
            <Clock className="w-3 h-3" /> Esperando conexión
          </span>
        )}
      </div>

      {esConflicto && item.error && (
        <p className="text-red-600 dark:text-red-400">{item.error}</p>
      )}

      {/* Anular sólo aplica a ventas: nunca tocaron stock real (crear_venta
          nunca corrió del lado del servidor para ellas), así que anularlas
          es seguro — sólo revierte el descuento optimista del snapshot
          local. Una apertura de caja en conflicto (otra caja ya ganó) no
          tiene un "anular" seguro acá: las ventas que dependan de ella
          quedan pendientes hasta resolverlo a mano (ver CONTEXT.md). */}
      {esConflicto && tipo === 'venta' && (
        <Button
          size="sm" variant="outline"
          className="h-6 text-2xs border-red-300 text-red-600 dark:text-red-400 dark:border-red-800"
          onClick={() => onAnular(item)}
        >
          <X className="w-3 h-3 mr-1" /> Anular venta
        </Button>
      )}
    </div>
  );
}

function SyncConflictModal({
  open, onOpenChange, ventasPendientes = [], aperturasPendientes = [],
  sincronizando, onReintentar, onAnularVenta,
}) {
  // listarVentasPendientes/listarAperturasPendientes devuelven TODO el
  // historial de la empresa (incluye ya sincronizadas, para que el motor de
  // sync pueda resolver dependencias entre corridas) — acá sólo interesa lo
  // que sigue necesitando atención.
  const items = [
    ...aperturasPendientes.filter(a => a.estado !== 'sincronizada').map(a => ({ ...a, _tipo: 'apertura' })),
    ...ventasPendientes.filter(v => v.estado !== 'sincronizada').map(v => ({ ...v, _tipo: 'venta' })),
  ].sort((a, b) => a.creado_en.localeCompare(b.creado_en));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-kx-surface border-kx-border text-kx-text">
        <DialogHeader>
          <DialogTitle>Sincronización pendiente</DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            Se guardaron localmente y todavía no llegaron al servidor. Se sincronizan solas en
            cuanto vuelva la conexión, o probá "Reintentar ahora".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-80 overflow-y-auto py-2">
          {items.length === 0 ? (
            <p className="text-xs text-kx-text-3 text-center py-4">Nada pendiente.</p>
          ) : (
            items.map(item => (
              <Fila key={`${item._tipo}-${item.localId}`} item={item} tipo={item._tipo} onAnular={onAnularVenta} />
            ))
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-kx-border">
          <Button
            size="sm" variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-kx-border text-kx-text-2"
          >
            Cerrar
          </Button>
          <Button
            size="sm"
            onClick={onReintentar}
            disabled={sincronizando}
            className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white"
          >
            {sincronizando
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Sincronizando...</>
              : 'Reintentar ahora'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SyncConflictModal;
