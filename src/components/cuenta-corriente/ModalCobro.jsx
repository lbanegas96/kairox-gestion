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
  facturasAbiertas = [],
  imputaciones = {}, setImputaciones,
  imputacionesFX = {}, setImputacionesFX,
  autoDistribuirFIFO,
}) {
  const montoCobro = parseNumberLocale(paymentData.monto) || 0;
  // El total imputado en pesos: filas ARS suman el monto tal cual; filas en
  // moneda extranjera se valorizan al TC de hoy (lo que realmente sale de la
  // caja), igual que hace el RPC para el guard "no supera el monto del cobro".
  const totalImputado = facturasAbiertas.reduce((s, f) => {
    if (f.moneda && f.moneda !== 'ARS') {
      const fx = parseNumberLocale(imputacionesFX[f.comprobante_id] || '') || 0;
      const tc = f.tc_hoy || f.tipo_cambio_tasa || 0;
      return s + fx * tc;
    }
    return s + (parseNumberLocale(imputaciones[f.comprobante_id] || '') || 0);
  }, 0);
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
            <span className="text-kx-text-2">Deuda Actual:</span>
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

          {facturasAbiertas.length > 0 && (
            <div className="grid gap-2 border-t border-kx-border pt-3">
              <div className="flex items-center justify-between">
                <Label>Imputar a factura(s) (opcional)</Label>
                {montoCobro > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => autoDistribuirFIFO(montoCobro)}>
                    Auto (más vieja primero)
                  </Button>
                )}
              </div>
              <p className="text-xs text-kx-text-3">
                Si no imputás nada, el cobro solo baja el saldo total del cliente (como siempre).
                Si imputás, esas facturas puntuales quedan marcadas como cobradas.
              </p>
              <div className="border border-kx-border rounded-lg divide-y divide-kx-border max-h-48 overflow-y-auto">
                {facturasAbiertas.map(f => {
                  const esFX = !!(f.moneda && f.moneda !== 'ARS');
                  const fxValue = parseNumberLocale(imputacionesFX[f.comprobante_id] || '') || 0;
                  const tcHoy = f.tc_hoy || f.tipo_cambio_tasa || 0;
                  return (
                    <div key={f.comprobante_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-kx-text truncate">{f.numero_venta}</div>
                        <div className="text-xs text-kx-text-3">
                          Pendiente: ${Number(f.saldo_pendiente).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          {esFX && <span className="ml-1">({f.moneda})</span>}
                        </div>
                        {esFX && !f.tc_hoy && (
                          <div className="text-2xs text-amber-600 dark:text-amber-400">
                            Sin TC de hoy para {f.moneda} — se usará el TC de la factura
                          </div>
                        )}
                      </div>
                      {esFX ? (
                        <div className="text-right shrink-0">
                          <Input
                            type="text" inputMode="decimal" placeholder={`0,00 ${f.moneda}`}
                            value={imputacionesFX[f.comprobante_id] ?? ''}
                            onChange={(e) => setImputacionesFX(prev => ({ ...prev, [f.comprobante_id]: e.target.value }))}
                            className="w-28 h-8 text-right text-xs"
                          />
                          {fxValue > 0 && tcHoy > 0 && (
                            <div className="text-2xs text-kx-text-3 mt-0.5">
                              ≈ ${(fxValue * tcHoy).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                            </div>
                          )}
                        </div>
                      ) : (
                        <Input
                          type="text" inputMode="decimal" placeholder="0,00"
                          value={imputaciones[f.comprobante_id] ?? ''}
                          onChange={(e) => setImputaciones(prev => ({ ...prev, [f.comprobante_id]: e.target.value }))}
                          className="w-28 h-8 text-right text-xs shrink-0"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className={`text-xs text-right ${totalImputado > montoCobro ? 'text-red-500 font-semibold' : 'text-kx-text-3'}`}>
                Imputado: ${totalImputado.toLocaleString('es-AR', { minimumFractionDigits: 2 })} / ${montoCobro.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)} disabled={isProcessingPayment}>Cancelar</Button>
          <Button
            onClick={handleRegisterPayment}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={isProcessingPayment || !paymentData.monto || !(parseNumberLocale(paymentData.monto) > 0) || totalImputado > montoCobro}
          >
            {isProcessingPayment ? "Procesando..." : "Confirmar Cobro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalCobro;
