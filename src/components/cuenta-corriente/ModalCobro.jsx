import { Banknote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseNumberLocale } from '@/lib/currencyUtils';

// Rediseño 16/08 (ajuste de UX sobre Frente 5 de "Facturar Pedido"): mismo
// lenguaje visual denso (kx-*, h-8, grillas) que NuevaFacturaModal.jsx/
// FormNuevaCotizacion.jsx, en vez de los componentes shadcn por defecto que
// tenía este modal desde antes de esa tanda.
//
// Imputación por factura — estilo SAP "Cobro entrante": cada fila tiene un
// checkbox. Tildarlo precarga "Aplicar" con el saldo completo de la factura
// (podado al remanente del Monto a Cobrar si no alcanza); destildarlo lo
// limpia. Editar el monto a mano marca/destilda el checkbox solo en base al
// valor (bidireccional, igual que ya hacía autoDistribuirFIFO). Sin cambios
// de backend: el RPC registrar_cobro_cliente ya admite imputación parcial —
// si "Aplicar" queda por debajo del saldo, la factura sigue abierta por la
// diferencia (facturas_saldo_pendiente, mig.169).
function ModalCobro({
  isPaymentDialogOpen, setIsPaymentDialogOpen,
  selectedClient,
  paymentData, setPaymentData,
  formasPago = [],
  tcParalelo,
  isProcessingPayment,
  handleRegisterPayment,
  facturasAbiertas = [],
  imputaciones = {}, setImputaciones,
  imputacionesFX = {}, setImputacionesFX,
  autoDistribuirFIFO,
}) {
  const formaSeleccionada = formasPago.find(f => f.id === paymentData.forma_pago_id);
  const tipoInstrumento = formaSeleccionada?.tipo_instrumento;
  // Referencia por método (SAP-style: transferencia pide N° de operación,
  // tarjeta pide N° de cupón/autorización) — Efectivo no necesita nada.
  const REFERENCIA_LABEL = {
    transferencia: 'N° de operación / referencia',
    tarjeta_debito: 'N° de cupón / autorización',
    tarjeta_credito: 'N° de cupón / autorización',
    billetera: 'N° de operación',
  };
  const referenciaLabel = REFERENCIA_LABEL[tipoInstrumento];

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
  const fmt = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const toggleFactura = (f, checked) => {
    const esFX = !!(f.moneda && f.moneda !== 'ARS');
    if (!checked) {
      if (esFX) setImputacionesFX(prev => ({ ...prev, [f.comprobante_id]: '' }));
      else setImputaciones(prev => ({ ...prev, [f.comprobante_id]: '' }));
      return;
    }
    // Precarga el saldo completo, podado al remanente del monto a cobrar (solo
    // tiene sentido para ARS — FX se valida aparte, se precarga sin podar).
    if (esFX) {
      setImputacionesFX(prev => ({ ...prev, [f.comprobante_id]: String(f.saldo_pendiente) }));
      return;
    }
    const otrasImputadas = totalImputado - (parseNumberLocale(imputaciones[f.comprobante_id] || '') || 0);
    const remanente = Math.max(0, montoCobro - otrasImputadas);
    const aplicar = remanente > 0 ? Math.min(f.saldo_pendiente, remanente) : f.saldo_pendiente;
    setImputaciones(prev => ({ ...prev, [f.comprobante_id]: String(aplicar) }));
  };

  return (
    <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
      <DialogContent className="max-w-md bg-kx-surface border-kx-border text-kx-text">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-base font-bold">
            <Banknote className="h-5 w-5" /> Registrar Cobro
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            Registrar pago de <strong className="text-kx-text">{selectedClient?.nombre}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-kx-surface-2 rounded-lg border border-kx-border mb-1">
          <div className="flex justify-between items-center text-sm mb-1">
            <span className="text-kx-text-2">Deuda Actual:</span>
            <span className="font-bold text-kx-red tabular-nums">${fmt(selectedClient?.saldo_actual)}</span>
          </div>
          {tcParalelo.enabled && tcParalelo.tcHoy && Number(selectedClient?.saldo_actual) > 0 && (
            <div className="flex justify-between items-center text-xs text-kx-text-3">
              <span>Equivalente:</span>
              <span className="tabular-nums">≈ {fmt(Number(selectedClient.saldo_actual) / tcParalelo.tcHoy)} {tcParalelo.monedaParalela}</span>
            </div>
          )}
        </div>

        <div className="grid gap-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="amount-list" className="text-xs dark:text-kx-text">Monto a Cobrar ($)</Label>
            <Input
              id="amount-list"
              type="text"
              inputMode="decimal"
              value={paymentData.monto}
              onChange={(e) => setPaymentData({ ...paymentData, monto: e.target.value })}
              onFocus={(e) => e.target.select()}
              placeholder="0,00"
              className="font-mono text-lg h-10 dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
              autoFocus
            />
            {tcParalelo.enabled && tcParalelo.tcHoy && paymentData.monto && parseNumberLocale(paymentData.monto) > 0 && (
              <div className="text-xs text-kx-text-2 p-2 bg-kx-surface-2 rounded-lg border border-kx-border flex items-center justify-between">
                <span>
                  Equivalente: <span className="font-mono font-semibold text-kx-text">
                    {fmt(tcParalelo.calcParalelo(parseNumberLocale(paymentData.monto), 'ARS', 1))} {tcParalelo.monedaParalela}
                  </span>
                </span>
                <span className="text-kx-text-3">TC: {tcParalelo.tcHoy.toLocaleString('es-AR')}</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="method-list" className="text-xs dark:text-kx-text">Método de Pago</Label>
              <select
                id="method-list"
                className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={paymentData.forma_pago_id}
                onChange={(e) => {
                  const forma = formasPago.find(f => f.id === e.target.value);
                  setPaymentData({ ...paymentData, forma_pago_id: e.target.value, metodo: forma?.nombre ?? 'Otro' });
                }}
              >
                {formasPago.length === 0 && <option value="">Efectivo</option>}
                {formasPago.map(f => (
                  <option key={f.id} value={f.id}>{f.nombre}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="desc-list" className="text-xs dark:text-kx-text">Nota (Opcional)</Label>
              <Input
                id="desc-list"
                value={paymentData.nota}
                onChange={(e) => setPaymentData({ ...paymentData, nota: e.target.value })}
                placeholder="Ej: Pago parcial"
                className="h-8 text-sm dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
              />
            </div>
          </div>

          {referenciaLabel && (
            <div className="space-y-1">
              <Label htmlFor="referencia-list" className="text-xs dark:text-kx-text">{referenciaLabel}</Label>
              <Input
                id="referencia-list"
                value={paymentData.referencia_pago || ''}
                onChange={(e) => setPaymentData({ ...paymentData, referencia_pago: e.target.value })}
                placeholder={referenciaLabel}
                className="h-8 text-sm dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
              />
            </div>
          )}

          {facturasAbiertas.length > 0 && (
            <div className="space-y-1.5 border-t border-kx-border pt-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs dark:text-kx-text">Imputar a factura(s) (opcional)</Label>
                {montoCobro > 0 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => autoDistribuirFIFO(montoCobro)}
                    className="h-6 text-2xs dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
                    Auto (más vieja primero)
                  </Button>
                )}
              </div>
              <p className="text-2xs text-kx-text-3">
                Tildá una factura para aplicarle el cobro. Si aplicás menos que su saldo, queda
                abierta por la diferencia — igual que en SAP.
              </p>
              <div className="border border-kx-border rounded-lg divide-y divide-kx-border max-h-52 overflow-y-auto">
                {facturasAbiertas.map(f => {
                  const esFX = !!(f.moneda && f.moneda !== 'ARS');
                  const fxValue = parseNumberLocale(imputacionesFX[f.comprobante_id] || '') || 0;
                  const arsValue = parseNumberLocale(imputaciones[f.comprobante_id] || '') || 0;
                  const valorActual = esFX ? fxValue : arsValue;
                  const checked = valorActual > 0;
                  const tcHoy = f.tc_hoy || f.tipo_cambio_tasa || 0;
                  const esParcial = checked && valorActual < Number(f.saldo_pendiente) - 0.005;
                  const quedaPendiente = Number(f.saldo_pendiente) - valorActual;
                  const quedaPct = Number(f.saldo_pendiente) > 0 ? (quedaPendiente / Number(f.saldo_pendiente)) * 100 : 0;
                  return (
                    <div key={f.comprobante_id} className="flex items-start gap-2 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleFactura(f, e.target.checked)}
                        className="mt-1 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-kx-text truncate">{f.numero_venta}</div>
                        <div className="text-xs text-kx-text-3">
                          Pendiente: ${fmt(f.saldo_pendiente)}
                          {esFX && <span className="ml-1">({f.moneda})</span>}
                        </div>
                        {esFX && !f.tc_hoy && (
                          <div className="text-2xs text-amber-600 dark:text-amber-400">
                            Sin TC de hoy para {f.moneda} — se usará el TC de la factura
                          </div>
                        )}
                        {esParcial && (
                          <div className="text-2xs text-amber-600 dark:text-amber-400 mt-0.5">
                            Queda pendiente: ${fmt(quedaPendiente)} ({quedaPct.toFixed(0)}%)
                          </div>
                        )}
                      </div>
                      {esFX ? (
                        <div className="text-right shrink-0">
                          <Input
                            type="text" inputMode="decimal" placeholder={`0,00 ${f.moneda}`}
                            value={imputacionesFX[f.comprobante_id] ?? ''}
                            onChange={(e) => setImputacionesFX(prev => ({ ...prev, [f.comprobante_id]: e.target.value }))}
                            onFocus={(e) => e.target.select()}
                            className="w-28 h-8 text-right text-xs dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
                          />
                          {fxValue > 0 && tcHoy > 0 && (
                            <div className="text-2xs text-kx-text-3 mt-0.5">
                              ≈ ${fmt(fxValue * tcHoy)}
                            </div>
                          )}
                        </div>
                      ) : (
                        <Input
                          type="text" inputMode="decimal" placeholder="0,00"
                          value={imputaciones[f.comprobante_id] ?? ''}
                          onChange={(e) => setImputaciones(prev => ({ ...prev, [f.comprobante_id]: e.target.value }))}
                          onFocus={(e) => e.target.select()}
                          className="w-28 h-8 text-right text-xs shrink-0 dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className={`text-xs text-right tabular-nums ${totalImputado > montoCobro ? 'text-kx-red font-semibold' : 'text-kx-text-3'}`}>
                Imputado: ${fmt(totalImputado)} / ${fmt(montoCobro)}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)} disabled={isProcessingPayment}
            className="border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
            Cancelar
          </Button>
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
