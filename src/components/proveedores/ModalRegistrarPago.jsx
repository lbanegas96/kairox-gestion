import { Banknote, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCaja } from '@/contexts/CajaContext';
import { parseNumberLocale } from '@/lib/currencyUtils';

// Espejo de ModalCobro.jsx (lado Ventas) para useRegistrarPago — extraído del
// modal "Registrar Pago" que vivía inline en ProveedoresSection.jsx, sin
// tocar su diseño (mismo layout compacto de 1 columna) para no meter una
// reforma visual no pedida: el pedido de Luciano (12/09) era poder abrirlo
// también desde el detalle de una Factura de Compra, no rediseñarlo.
function ModalRegistrarPago({
  isPaymentDialogOpen, setIsPaymentDialogOpen,
  selectedProveedor,
  paymentData, setPaymentData,
  formasPago = [],
  isProcessingPayment,
  handleRegisterPayment,
  facturasAbiertas = [],
  imputaciones = {}, setImputaciones,
  imputacionesFX = {}, setImputacionesFX,
  autoDistribuirFIFO,
}) {
  const { isSessionOpen } = useCaja();

  const formaPagoEsEfectivo = (formaId, metodoFallback) => {
    const forma = formasPago.find(f => f.id === formaId);
    return forma ? forma.tipo_instrumento === 'efectivo' : metodoFallback === 'Efectivo';
  };

  const montoPago = parseNumberLocale(paymentData.monto) || 0;
  const totalImputadoPago = facturasAbiertas.reduce((s, f) => {
    if (f.moneda && f.moneda !== 'ARS') {
      const fx = parseNumberLocale(imputacionesFX[f.compra_id] || '') || 0;
      return s + fx * (f.tipo_cambio_tasa || 0);
    }
    return s + (parseNumberLocale(imputaciones[f.compra_id] || '') || 0);
  }, 0);

  const forma = formasPago.find(f => f.id === paymentData.forma_pago_id);
  const REFERENCIA_LABEL = {
    transferencia: 'N° de operación / referencia',
    tarjeta_debito: 'N° de cupón / autorización',
    tarjeta_credito: 'N° de cupón / autorización',
    billetera: 'N° de operación',
  };
  const referenciaLabel = REFERENCIA_LABEL[forma?.tipo_instrumento];

  const cajaBloqueada = !isSessionOpen && formaPagoEsEfectivo(paymentData.forma_pago_id, paymentData.metodo);

  return (
    <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
      <DialogContent className="max-w-sm dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <Banknote className="w-4 h-4 text-green-600" /> Registrar Pago
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Pago a <strong className="text-kx-text">{selectedProveedor?.nombre}</strong>
            {selectedProveedor?.saldo_actual != null && (
              <> — Saldo actual: <span className="font-bold text-kx-red">
                ${Number(selectedProveedor.saldo_actual).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </span></>
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleRegisterPayment(); }} className="space-y-4">
          <div className="space-y-1">
            <Label className="dark:text-kx-text">Monto *</Label>
            <Input type="text" inputMode="decimal" value={paymentData.monto}
              onChange={e => setPaymentData(p => ({ ...p, monto: e.target.value }))}
              onFocus={e => e.target.select()}
              placeholder="0,00" autoFocus className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
          </div>
          <div className="space-y-1">
            <Label className="dark:text-kx-text">Método de pago *</Label>
            <select
              value={paymentData.forma_pago_id}
              onChange={e => {
                const f = formasPago.find(x => x.id === e.target.value);
                setPaymentData(p => ({ ...p, forma_pago_id: e.target.value, metodo: f?.nombre ?? 'Otro' }));
              }}
              className="w-full h-10 rounded-md border border-kx-border bg-kx-surface px-3 text-sm text-kx-text dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            >
              {formasPago.length === 0 && <option value="">Efectivo</option>}
              {formasPago.map(f => (
                <option key={f.id} value={f.id}>
                  {f.nombre}{f.tipo_instrumento === 'efectivo' ? ' (Caja)' : f.cuenta_bancaria_id ? ' (Bancos)' : ''}
                </option>
              ))}
            </select>
            <p className="text-2xs text-kx-text-3">Efectivo descuenta de la Caja; los demás, de la cuenta bancaria mapeada.</p>
            {cajaBloqueada && (
              <p className="text-xs text-red-500 font-medium flex items-center gap-1 dark:text-red-400">
                <AlertTriangle className="h-3 w-3" /> Caja cerrada: abrí la caja para pagar en efectivo, o elegí otra forma de pago.
              </p>
            )}
          </div>
          {referenciaLabel && (
            <div className="space-y-1">
              <Label className="dark:text-kx-text">{referenciaLabel}</Label>
              <Input value={paymentData.referencia_pago}
                onChange={e => setPaymentData(p => ({ ...p, referencia_pago: e.target.value }))}
                placeholder={referenciaLabel} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            </div>
          )}
          <div className="space-y-1">
            <Label className="dark:text-kx-text">Descripción</Label>
            <Input value={paymentData.descripcion}
              onChange={e => setPaymentData(p => ({ ...p, descripcion: e.target.value }))}
              placeholder="Nota opcional del pago..." className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
          </div>

          {facturasAbiertas.length > 0 && (
            <div className="grid gap-2 border-t border-kx-border pt-3">
              <div className="flex items-center justify-between">
                <Label className="dark:text-kx-text">Imputar a factura(s) (opcional)</Label>
                {montoPago > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => autoDistribuirFIFO(montoPago)}>
                    Auto (más vieja primero)
                  </Button>
                )}
              </div>
              <p className="text-xs text-kx-text-3">
                Si no imputás nada, el pago solo baja el saldo total del proveedor (como siempre).
              </p>
              <div className="border border-kx-border rounded-lg divide-y divide-kx-border max-h-48 overflow-y-auto">
                {facturasAbiertas.map(f => {
                  const esFX = !!(f.moneda && f.moneda !== 'ARS');
                  return (
                    <div key={f.compra_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="font-medium text-kx-text truncate">{f.numero_factura}</div>
                        <div className="text-xs text-kx-text-3">
                          Pendiente: ${Number(f.saldo_pendiente).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          {esFX && <span className="ml-1">({f.moneda})</span>}
                        </div>
                      </div>
                      {esFX ? (
                        <Input
                          type="text" inputMode="decimal" placeholder={`0,00 ${f.moneda}`}
                          value={imputacionesFX[f.compra_id] ?? ''}
                          onChange={(e) => setImputacionesFX(prev => ({ ...prev, [f.compra_id]: e.target.value }))}
                          className="w-28 h-8 text-right text-xs shrink-0"
                        />
                      ) : (
                        <Input
                          type="text" inputMode="decimal" placeholder="0,00"
                          value={imputaciones[f.compra_id] ?? ''}
                          onChange={(e) => setImputaciones(prev => ({ ...prev, [f.compra_id]: e.target.value }))}
                          className="w-28 h-8 text-right text-xs shrink-0"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className={`text-xs text-right ${totalImputadoPago > montoPago ? 'text-kx-red font-semibold' : 'text-kx-text-3'}`}>
                Imputado: ${totalImputadoPago.toLocaleString('es-AR', { minimumFractionDigits: 2 })} / ${montoPago.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setIsPaymentDialogOpen(false)} className="dark:border-kx-border dark:text-slate-300">Cancelar</Button>
            <Button type="submit" disabled={isProcessingPayment || totalImputadoPago > montoPago || cajaBloqueada} className="bg-green-600 hover:bg-green-700 text-white">
              {isProcessingPayment ? 'Guardando...' : 'Confirmar Pago'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ModalRegistrarPago;
