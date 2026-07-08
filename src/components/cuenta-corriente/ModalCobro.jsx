import { Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseNumberLocale } from '@/lib/currencyUtils';

function ModalCobro({
  isPaymentDialogOpen, setIsPaymentDialogOpen,
  selectedClient,
  paymentData, setPaymentData,
  tcParalelo,
  isProcessingPayment,
  handleRegisterPayment,
}) {
  return (
    <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
      <DialogContent className="sm:max-w-[425px] bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
            <Banknote className="h-5 w-5" /> Registrar Cobro
          </DialogTitle>
          <DialogDescription>
            Registrar pago de <strong>{selectedClient?.nombre}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 bg-kx-surface-2 dark:bg-slate-800/50 rounded-lg border border-slate-100 dark:border-kx-border mb-2">
          <div className="flex justify-between items-center text-sm mb-1">
            <span className="text-slate-500">Deuda Actual:</span>
            <span className="font-bold text-red-600">${selectedClient?.saldo_actual?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
          </div>
          {tcParalelo.enabled && tcParalelo.tcHoy && Number(selectedClient?.saldo_actual) > 0 && (
            <div className="flex justify-between items-center text-xs text-kx-text-3">
              <span>Equivalente:</span>
              <span>≈ {(Number(selectedClient.saldo_actual) / tcParalelo.tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}</span>
            </div>
          )}
        </div>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="amount-list">Monto a Cobrar ($)</Label>
            <Input
              id="amount-list"
              type="text"
              inputMode="decimal"
              value={paymentData.monto}
              onChange={(e) => setPaymentData({ ...paymentData, monto: e.target.value })}
              placeholder="0,00"
              className="font-mono text-lg"
              autoFocus
            />
            {tcParalelo.enabled && tcParalelo.tcHoy && paymentData.monto && parseNumberLocale(paymentData.monto) > 0 && (
              <div className="text-xs text-kx-text-2 p-2 bg-kx-surface-2 rounded-lg border border-kx-border flex items-center justify-between">
                <span>
                  Equivalente: <span className="font-mono font-semibold text-kx-text">
                    {tcParalelo.calcParalelo(parseNumberLocale(paymentData.monto), 'ARS', 1)?.toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                  </span>
                </span>
                <span className="text-kx-text-3">TC: {tcParalelo.tcHoy.toLocaleString('es-AR')}</span>
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="method-list">Método de Pago</Label>
            <select
              id="method-list"
              className="flex h-10 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-bg px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              value={paymentData.metodo}
              onChange={(e) => setPaymentData({ ...paymentData, metodo: e.target.value })}
            >
              <option value="Efectivo">Efectivo</option>
              <option value="Transferencia">Transferencia</option>
              <option value="Tarjeta">Tarjeta Débito/Crédito</option>
              <option value="Cheque">Cheque</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="desc-list">Nota (Opcional)</Label>
            <Input
              id="desc-list"
              value={paymentData.nota}
              onChange={(e) => setPaymentData({ ...paymentData, nota: e.target.value })}
              placeholder="Ej: Pago parcial factura #123"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)} disabled={isProcessingPayment}>Cancelar</Button>
          <Button
            onClick={handleRegisterPayment}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={isProcessingPayment || !paymentData.monto || !(parseNumberLocale(paymentData.monto) > 0)}
          >
            {isProcessingPayment ? "Procesando..." : "Confirmar Cobro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalCobro;
