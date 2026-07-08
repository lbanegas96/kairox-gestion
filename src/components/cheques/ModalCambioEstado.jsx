import { ArrowRightLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fmt, ESTADO_LABELS, EstadoBadge } from './shared';

function ModalCambioEstado({
  open, onOpenChange,
  chequeACambiar,
  estadoNuevo, setEstadoNuevo,
  obsEstado, setObsEstado,
  savingEstado,
  transicionesDisponibles,
  onConfirmar,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft size={16} className="text-[#00D4FF]" /> Cambiar estado
          </DialogTitle>
          {chequeACambiar && (
            <DialogDescription>
              Cheque {chequeACambiar.numero} · {fmt(chequeACambiar.monto)}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="flex items-center gap-2 text-sm text-kx-text-3">
            <span>Estado actual:</span>
            {chequeACambiar && <EstadoBadge estado={chequeACambiar.estado} />}
          </div>
          <div>
            <Label className="text-kx-text-3 text-xs">Nuevo estado *</Label>
            <Select value={estadoNuevo} onValueChange={setEstadoNuevo}>
              <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-slate-800 border-slate-700">
                {transicionesDisponibles.map(e => (
                  <SelectItem key={e} value={e}>{ESTADO_LABELS[e]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-kx-text-3 text-xs">Observación (opcional)</Label>
            <Input value={obsEstado}
              onChange={e => setObsEstado(e.target.value)}
              placeholder="Ej: Depositado en Bco. Nación"
              className="mt-1 bg-slate-800 border-slate-700" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" disabled={savingEstado}
            onClick={() => onOpenChange(false)}
            className="text-kx-text-3">
            Cancelar
          </Button>
          <Button onClick={onConfirmar} disabled={savingEstado || !estadoNuevo}
            className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
            {savingEstado
              ? <Loader2 size={14} className="animate-spin mr-2" />
              : <ArrowRightLeft size={14} className="mr-2" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalCambioEstado;
