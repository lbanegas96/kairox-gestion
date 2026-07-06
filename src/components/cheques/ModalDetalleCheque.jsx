import React from 'react';
import { FileCheck, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { fmt, fmtDate, EstadoBadge } from './shared';

function ModalDetalleCheque({
  open, onOpenChange,
  chequeDetalle,
  historial,
  loadingHistorial,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck size={16} className="text-emerald-400" /> Detalle del cheque
          </DialogTitle>
          {chequeDetalle && (
            <DialogDescription>
              Cheque {chequeDetalle.numero} · {fmt(chequeDetalle.monto)}
            </DialogDescription>
          )}
        </DialogHeader>
        {chequeDetalle && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-kx-text-3 text-xs">Tipo</span>
                <p className="text-kx-text">{chequeDetalle.tipo === 'tercero' ? 'De tercero' : 'Propio'}</p>
              </div>
              <div>
                <span className="text-kx-text-3 text-xs">Banco</span>
                <p className="text-kx-text">{chequeDetalle.banco}</p>
              </div>
              <div>
                <span className="text-kx-text-3 text-xs">{chequeDetalle.tipo === 'tercero' ? 'Recibido de' : 'Entregado a'}</span>
                <p className="text-kx-text">{chequeDetalle.clientes?.nombre ?? chequeDetalle.proveedores?.nombre ?? '—'}</p>
              </div>
              <div>
                <span className="text-kx-text-3 text-xs">Vencimiento</span>
                <p className="text-kx-text">{fmtDate(chequeDetalle.fecha_vencimiento)}</p>
              </div>
              <div>
                <span className="text-kx-text-3 text-xs">Estado actual</span>
                <p className="mt-0.5"><EstadoBadge estado={chequeDetalle.estado} /></p>
              </div>
              <div>
                <span className="text-kx-text-3 text-xs">Monto</span>
                <p className="text-kx-text font-mono font-medium">{fmt(chequeDetalle.monto)}</p>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-medium text-kx-text-3 mb-2 uppercase tracking-wider">Historial de estados</h4>
              {loadingHistorial ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 size={16} className="animate-spin text-kx-text-3" />
                </div>
              ) : historial.length === 0 ? (
                <p className="text-xs text-kx-text-3 py-2">Sin registros de historial</p>
              ) : (
                <div className="space-y-0 relative">
                  <div className="absolute left-[7px] top-2 bottom-2 w-px bg-kx-border" />
                  {historial.map((h, i) => (
                    <div key={i} className="flex items-start gap-3 py-1.5 relative">
                      <div className={`w-[15px] h-[15px] rounded-full border-2 flex-shrink-0 z-10 ${
                        i === historial.length - 1
                          ? 'bg-emerald-500 border-emerald-400'
                          : 'bg-slate-700 border-slate-500'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {h.estado_anterior
                            ? <><EstadoBadge estado={h.estado_anterior} /> <span className="text-kx-text-3 text-xs">&rarr;</span> <EstadoBadge estado={h.estado_nuevo} /></>
                            : <EstadoBadge estado={h.estado_nuevo} />
                          }
                        </div>
                        <p className="text-[10px] text-kx-text-3 mt-0.5">
                          {new Date(h.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          {h.observacion && <span className="ml-2 text-kx-text-2">&mdash; {h.observacion}</span>}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}
            className="text-kx-text-3">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalDetalleCheque;
