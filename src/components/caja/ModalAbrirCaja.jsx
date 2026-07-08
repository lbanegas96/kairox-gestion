import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';

function ModalAbrirCaja({
  open, onOpenChange,
  saldoInicialInput, setSaldoInicialInput,
  isProcessingSession,
  onConfirmar,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md kairox-bg-card kairox-text-primary p-6 dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text">Abrir Caja</DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Inicia una nueva sesión de caja. Ingresa el monto inicial en efectivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Saldo Inicial ($)</Label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={saldoInicialInput}
              onChange={(e) => setSaldoInicialInput(e.target.value)}
              className="text-lg font-bold dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} className="dark:text-kx-text dark:border-kx-border dark:hover:bg-slate-800">Cancelar</Button>
          <Button onClick={onConfirmar} disabled={isProcessingSession} className="bg-green-600 hover:bg-green-700 text-white">
            {isProcessingSession ? "Abriendo..." : "Confirmar Apertura"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalAbrirCaja;
