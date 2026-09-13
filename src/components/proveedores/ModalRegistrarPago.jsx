import { Banknote, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCaja } from '@/contexts/CajaContext';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { PanelSeccion } from '@/components/shared/documento/DocumentoTabs';

// Rediseño 13/09 (pedido de Luciano viendo el modal chico: "aplicar la
// corrección de diseño que venimos aplicando, ajustar el tamaño como el de
// factura") — mismo shell que ModalCobro.jsx (lado Ventas): size="wide",
// cabecera en grilla, PanelSeccion para agrupar "Datos del pago" e "Imputar
// a factura(s)" en vez del formulario de una sola columna que tenía este
// modal desde que se extrajo de ProveedoresSection.jsx.
//
// Segundo pedido, mismo mensaje ("no entiendo los cálculos ni lo
// seleccionado"): cuando el pago se abre desde una Factura puntual
// (`facturaOrigenId`), esa fila se distingue del resto con una etiqueta y
// un borde propio — el resto de las facturas pendientes del proveedor
// quedan claramente marcadas como "además, opcional", no mezcladas sin
// jerarquía en la misma lista.
function ModalRegistrarPago({
  isPaymentDialogOpen, setIsPaymentDialogOpen,
  selectedProveedor,
  facturaOrigenId,
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

  const fmt = (n) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const montoPago = parseNumberLocale(paymentData.monto) || 0;
  const totalImputado = facturasAbiertas.reduce((s, f) => {
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

  // Ordena la factura de origen primero, para que sea lo primero que se ve
  // en la tabla aunque `facturasAbiertas` venga en otro orden.
  const facturasOrdenadas = facturaOrigenId
    ? [...facturasAbiertas].sort((a, b) => (a.compra_id === facturaOrigenId ? -1 : b.compra_id === facturaOrigenId ? 1 : 0))
    : facturasAbiertas;

  const toggleFactura = (f, checked) => {
    const esFX = !!(f.moneda && f.moneda !== 'ARS');
    if (!checked) {
      if (esFX) setImputacionesFX(prev => ({ ...prev, [f.compra_id]: '' }));
      else setImputaciones(prev => ({ ...prev, [f.compra_id]: '' }));
      return;
    }
    if (esFX) {
      setImputacionesFX(prev => ({ ...prev, [f.compra_id]: String(f.saldo_pendiente) }));
      return;
    }
    const otrasImputadas = totalImputado - (parseNumberLocale(imputaciones[f.compra_id] || '') || 0);
    const remanente = Math.max(0, montoPago - otrasImputadas);
    const aplicar = remanente > 0 ? Math.min(f.saldo_pendiente, remanente) : f.saldo_pendiente;
    setImputaciones(prev => ({ ...prev, [f.compra_id]: String(aplicar) }));
  };

  return (
    <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-kx-border dark:border-kx-border">
          <DialogTitle className="flex items-center gap-2 text-green-600 dark:text-green-400 text-base font-bold">
            <Banknote className="h-5 w-5" /> Registrar Pago
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-sm">
            Pago a <strong className="text-kx-text">{selectedProveedor?.nombre}</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* flex-col SIN overflow-y-auto acá — mismo criterio que ModalCobro:
            solo la tabla de "Imputar a factura(s)" (flex-1 más abajo) tiene
            su propio scroll interno. */}
        <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden px-6 py-4">
          {/* Cabecera en grilla — Proveedor / Saldo Actual / (si vino de una
              factura puntual) qué factura es esa, para que la preselección
              de más abajo se explique sola. */}
          <div className="shrink-0 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">Proveedor</span>
              <p className="mt-0.5 font-medium text-kx-text truncate">{selectedProveedor?.nombre || '—'}</p>
            </div>
            <div>
              <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">Saldo Actual</span>
              <p className="mt-0.5 font-bold text-kx-red tabular-nums">${fmt(selectedProveedor?.saldo_actual)}</p>
            </div>
            {facturaOrigenId && (
              <div>
                <span className="text-xs text-slate-500 dark:text-kx-text-2 uppercase tracking-wide">Pagando la factura</span>
                <p className="mt-0.5 font-medium text-kx-violet truncate">
                  {facturasAbiertas.find(f => f.compra_id === facturaOrigenId)?.numero_factura ?? '—'}
                </p>
              </div>
            )}
          </div>

          <PanelSeccion titulo="Datos del pago" className="shrink-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label htmlFor="pago-monto" className="text-xs dark:text-kx-text">Monto a Pagar ($)</Label>
                <Input
                  id="pago-monto"
                  type="text"
                  inputMode="decimal"
                  value={paymentData.monto}
                  onChange={e => setPaymentData(p => ({ ...p, monto: e.target.value }))}
                  onFocus={e => e.target.select()}
                  placeholder="0,00"
                  className="font-mono text-lg h-10 dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pago-metodo" className="text-xs dark:text-kx-text">Método de Pago</Label>
                <select
                  id="pago-metodo"
                  className="w-full h-10 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  value={paymentData.forma_pago_id}
                  onChange={e => {
                    const f = formasPago.find(x => x.id === e.target.value);
                    setPaymentData(p => ({ ...p, forma_pago_id: e.target.value, metodo: f?.nombre ?? 'Otro' }));
                  }}
                >
                  {formasPago.length === 0 && <option value="">Efectivo</option>}
                  {formasPago.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.nombre}{f.tipo_instrumento === 'efectivo' ? ' (Caja)' : f.cuenta_bancaria_id ? ' (Bancos)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="pago-nota" className="text-xs dark:text-kx-text">Nota (Opcional)</Label>
                <Input
                  id="pago-nota"
                  value={paymentData.descripcion}
                  onChange={e => setPaymentData(p => ({ ...p, descripcion: e.target.value }))}
                  placeholder="Ej: Pago parcial"
                  className="h-10 text-sm dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
                />
              </div>
            </div>

            {cajaBloqueada && (
              <p className="mt-3 text-xs text-red-500 font-medium flex items-center gap-1 dark:text-red-400">
                <AlertTriangle className="h-3 w-3" /> Caja cerrada: abrí la caja para pagar en efectivo, o elegí otra forma de pago.
              </p>
            )}

            {referenciaLabel && (
              <div className="mt-3 space-y-1 sm:w-1/2">
                <Label htmlFor="pago-referencia" className="text-xs dark:text-kx-text">{referenciaLabel}</Label>
                <Input
                  id="pago-referencia"
                  value={paymentData.referencia_pago || ''}
                  onChange={e => setPaymentData(p => ({ ...p, referencia_pago: e.target.value }))}
                  placeholder={referenciaLabel}
                  className="h-9 text-sm dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
                />
              </div>
            )}
          </PanelSeccion>

          {facturasAbiertas.length > 0 && (
            <PanelSeccion
              titulo="Imputar a factura(s) (opcional)"
              accion={montoPago > 0 && (
                <Button type="button" size="sm" variant="outline" onClick={() => autoDistribuirFIFO(montoPago)}
                  className="h-7 text-xs dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
                  Auto (más vieja primero)
                </Button>
              )}
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
            >
              <p className="shrink-0 text-xs text-kx-text-3 mb-3">
                {facturaOrigenId
                  ? 'La factura por la que entraste ya viene tildada con su saldo completo. Si tildás alguna más, el mismo pago también la cancela — es opcional.'
                  : 'Tildá una factura para aplicarle el pago. Si no tildás ninguna, el pago solo baja el saldo corrido del proveedor.'}
              </p>
              <div className="flex-1 min-h-0 border border-kx-border rounded-lg overflow-hidden">
                <div className="h-full overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/70 dark:bg-slate-800/50 sticky top-0">
                      <tr>
                        <th className="w-8 px-3 py-2"></th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-kx-text-2 uppercase">Factura</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-kx-text-2 uppercase">Pendiente</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-kx-text-2 uppercase w-36">Aplicar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-kx-border">
                      {facturasOrdenadas.map(f => {
                        const esOrigen = f.compra_id === facturaOrigenId;
                        const esFX = !!(f.moneda && f.moneda !== 'ARS');
                        const fxValue = parseNumberLocale(imputacionesFX[f.compra_id] || '') || 0;
                        const arsValue = parseNumberLocale(imputaciones[f.compra_id] || '') || 0;
                        const valorActual = esFX ? fxValue : arsValue;
                        const checked = valorActual > 0;
                        return (
                          <tr key={f.compra_id} className={esOrigen ? 'bg-kx-violet/5' : 'hover:bg-kx-surface-2/60 dark:hover:bg-slate-800/40 transition-colors'}>
                            <td className="px-3 py-2 align-top">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => toggleFactura(f, e.target.checked)}
                                className="mt-1"
                              />
                            </td>
                            <td className="px-3 py-2 align-top min-w-0">
                              <div className="font-medium text-kx-text truncate flex items-center gap-1.5">
                                {f.numero_factura}
                                {esFX && <span className="text-2xs text-kx-text-3">({f.moneda})</span>}
                                {esOrigen && (
                                  <span className="text-2xs font-semibold text-kx-violet bg-kx-violet/10 px-1.5 py-0.5 rounded-full shrink-0">
                                    la que estás pagando
                                  </span>
                                )}
                              </div>
                              {esFX && !f.tc_hoy && (
                                <div className="text-2xs text-amber-600 dark:text-amber-400 mt-0.5">
                                  Sin TC de hoy — se usará el TC de la factura
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right align-top font-mono text-kx-text-2">
                              ${fmt(f.saldo_pendiente)}
                            </td>
                            <td className="px-3 py-2 text-right align-top">
                              {esFX ? (
                                <Input
                                  type="text" inputMode="decimal" placeholder={`0,00 ${f.moneda}`}
                                  value={imputacionesFX[f.compra_id] ?? ''}
                                  onChange={(e) => setImputacionesFX(prev => ({ ...prev, [f.compra_id]: e.target.value }))}
                                  onFocus={(e) => e.target.select()}
                                  className="w-full h-8 text-right text-xs dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
                                />
                              ) : (
                                <Input
                                  type="text" inputMode="decimal" placeholder="0,00"
                                  value={imputaciones[f.compra_id] ?? ''}
                                  onChange={(e) => setImputaciones(prev => ({ ...prev, [f.compra_id]: e.target.value }))}
                                  onFocus={(e) => e.target.select()}
                                  className="w-full h-8 text-right text-xs dark:bg-kx-bg dark:border-kx-border dark:text-kx-text"
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className={`shrink-0 mt-2 text-xs text-right tabular-nums ${totalImputado > montoPago ? 'text-kx-red font-semibold' : 'text-kx-text-3'}`}>
                Imputado: ${fmt(totalImputado)} / ${fmt(montoPago)}
              </div>
            </PanelSeccion>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-kx-border dark:border-kx-border px-6 py-4">
          <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)} disabled={isProcessingPayment}
            className="border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
            Cancelar
          </Button>
          <Button
            onClick={handleRegisterPayment}
            className="bg-green-600 hover:bg-green-700 text-white"
            disabled={isProcessingPayment || !paymentData.monto || !(montoPago > 0) || totalImputado > montoPago || cajaBloqueada}
          >
            {isProcessingPayment ? 'Procesando...' : 'Confirmar Pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalRegistrarPago;
