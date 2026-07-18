import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CheckCircle2, XCircle, AlertTriangle, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { paymentRunService, PAYMENT_RUN_KEYS } from '@/services/paymentRunService';
import { PROV_KEYS } from '@/services/proveedoresService';
import { formatDateAR } from '@/lib/dateUtils';
import { formatCurrency } from '@/lib/currencyUtils';

function diasHasta(fechaISO) {
  if (!fechaISO) return null;
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const fecha = new Date(`${fechaISO}T00:00:00`);
  return Math.round((fecha - hoy) / 86400000);
}

function PaymentRunModal({ empresaId, formasPago, open, onOpenChange }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentSession } = useCaja();

  const [seleccion, setSeleccion] = useState({}); // { compra_id: true }
  const [search, setSearch] = useState('');
  const [formaPagoId, setFormaPagoId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [ejecutando, setEjecutando] = useState(false);
  const [resultados, setResultados] = useState(null); // null = todavía no se corrió el run

  const { data: facturas = [], isLoading } = useQuery({
    queryKey: PAYMENT_RUN_KEYS.pendientes(empresaId),
    queryFn: () => paymentRunService.getFacturasPendientes(empresaId),
    enabled: open && !!empresaId,
  });

  const facturasFiltradas = useMemo(() => {
    if (!search.trim()) return facturas;
    const s = search.trim().toLowerCase();
    return facturas.filter(f => f.proveedor_nombre.toLowerCase().includes(s) || f.numero_factura.toLowerCase().includes(s));
  }, [facturas, search]);

  const seleccionadas = facturas.filter(f => seleccion[f.compra_id]);
  const proveedoresSeleccionados = new Set(seleccionadas.map(f => f.proveedor_id));
  const totalSeleccionado = seleccionadas.reduce((s, f) => s + f.saldo_pendiente, 0);

  const resetState = () => {
    setSeleccion({});
    setSearch('');
    setDescripcion('');
    setResultados(null);
  };

  const handleOpenChange = (v) => {
    if (!v) resetState();
    onOpenChange(v);
  };

  const toggleFactura = (compraId, esFX) => {
    if (esFX) return;
    setSeleccion(prev => ({ ...prev, [compraId]: !prev[compraId] }));
  };

  const seleccionarVencidas = () => {
    const nuevo = {};
    for (const f of facturas) {
      if (f.moneda !== 'ARS') continue;
      const dias = diasHasta(f.fecha_vencimiento_estimada);
      if (dias !== null && dias <= 0) nuevo[f.compra_id] = true;
    }
    setSeleccion(nuevo);
  };

  const handleConfirmar = async () => {
    if (seleccionadas.length === 0) return;
    const forma = formasPago.find(f => f.id === formaPagoId);
    setEjecutando(true);
    try {
      const res = await paymentRunService.ejecutarPaymentRun({
        empresaId,
        userId: user.id,
        cajaSesionId: currentSession?.id ?? null,
        seleccion: seleccionadas.map(f => ({
          compra_id: f.compra_id,
          proveedor_id: f.proveedor_id,
          proveedor_nombre: f.proveedor_nombre,
          monto: f.saldo_pendiente,
        })),
        metodo: forma?.nombre ?? 'Otro',
        formaPagoId: formaPagoId || null,
        descripcion: descripcion || undefined,
      });
      setResultados(res);
      const exitosos = res.filter(r => r.ok).length;
      qc.invalidateQueries({ queryKey: PAYMENT_RUN_KEYS.pendientes(empresaId) });
      qc.invalidateQueries({ queryKey: ['proveedores', empresaId] });
      qc.invalidateQueries({ queryKey: ['proveedores_stats', empresaId] });
      for (const proveedorId of proveedoresSeleccionados) {
        qc.invalidateQueries({ queryKey: PROV_KEYS.cuentaCorriente(proveedorId) });
      }
      toast({
        title: exitosos === res.length ? `✓ ${exitosos} proveedores pagados` : `${exitosos} de ${res.length} proveedores pagados`,
        description: exitosos === res.length ? undefined : 'Revisá el detalle: algún pago no se pudo registrar.',
        className: exitosos === res.length ? 'bg-green-600 text-white' : undefined,
        variant: exitosos === res.length ? undefined : 'destructive',
      });
    } finally {
      setEjecutando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <Banknote className="w-5 h-5 text-indigo-600 dark:text-indigo-500" /> Pagar varias facturas
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Seleccioná facturas de distintos proveedores y confirmá el pago en un solo paso. Cada
            proveedor genera su propio movimiento y asiento — si uno falla, los demás se procesan igual.
          </DialogDescription>
        </DialogHeader>

        {resultados ? (
          <div className="space-y-3">
            {resultados.map(r => (
              <div key={r.proveedor_id} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-sm ${
                r.ok ? 'border-green-300/40 bg-green-500/10' : 'border-red-300/40 bg-red-500/10'
              }`}>
                <div className="flex items-center gap-2 min-w-0">
                  {r.ok ? <CheckCircle2 className="w-4 h-4 text-kx-green shrink-0" /> : <XCircle className="w-4 h-4 text-kx-red shrink-0" />}
                  <span className="font-medium text-kx-text truncate">{r.proveedor_nombre}</span>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono text-kx-text">{formatCurrency(r.monto)}</div>
                  {!r.ok && <div className="text-xs text-kx-red">{r.error}</div>}
                  {r.ok && r.asiento_generado === false && (
                    <div className="text-xs text-amber-600 dark:text-amber-400">Sin asiento (revisar Plan de Cuentas)</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-kx-text-3" /></div>
        ) : facturas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-kx-text-3">
            <Banknote className="w-12 h-12 opacity-30" />
            <p className="font-medium">No hay facturas de proveedores pendientes de pago</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Buscar por proveedor o N° de factura..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
              <Button type="button" size="sm" variant="outline" onClick={seleccionarVencidas} className="shrink-0 gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Seleccionar vencidas
              </Button>
            </div>

            <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden">
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="border-b dark:border-kx-border bg-slate-50/70 dark:bg-slate-800/50 sticky top-0">
                    <tr>
                      <th className="w-8 px-3 py-2"></th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-kx-text-2 uppercase">Proveedor</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-kx-text-2 uppercase">Factura</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-kx-text-2 uppercase">Vencimiento est.</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-kx-text-2 uppercase">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-slate-800">
                    {facturasFiltradas.map(f => {
                      const esFX = f.moneda !== 'ARS';
                      const dias = diasHasta(f.fecha_vencimiento_estimada);
                      const vencida = dias !== null && dias <= 0;
                      return (
                        <tr key={f.compra_id} className={`hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors ${esFX ? 'opacity-50' : ''}`}>
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={!!seleccion[f.compra_id]}
                              onCheckedChange={() => toggleFactura(f.compra_id, esFX)}
                              disabled={esFX}
                              title={esFX ? 'Moneda extranjera — pagar individualmente desde la ficha del proveedor' : undefined}
                            />
                          </td>
                          <td className="px-3 py-2 text-kx-text truncate max-w-[10rem]">{f.proveedor_nombre}</td>
                          <td className="px-3 py-2 font-mono text-xs text-kx-text-2">{f.numero_factura}</td>
                          <td className="px-3 py-2 text-center">
                            {f.fecha_vencimiento_estimada ? (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-2xs font-medium whitespace-nowrap ${
                                vencida
                                  ? 'text-amber-600 dark:text-amber-400 border-amber-400/30 bg-amber-500/10'
                                  : 'text-kx-text-3 border-kx-border bg-kx-surface-2'
                              }`}>
                                {vencida ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                                {formatDateAR(f.fecha_vencimiento_estimada)}
                              </span>
                            ) : <span className="text-xs text-kx-text-3">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-kx-text">
                            {formatCurrency(f.saldo_pendiente, f.moneda)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Forma de pago (aplica a todo el lote) *</Label>
                <select
                  value={formaPagoId}
                  onChange={e => setFormaPagoId(e.target.value)}
                  className="w-full h-10 rounded-md border border-kx-border bg-kx-surface px-3 text-sm text-kx-text dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                >
                  <option value="">Seleccionar...</option>
                  {formasPago.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.nombre}{f.tipo_instrumento === 'efectivo' ? ' (Caja)' : f.cuenta_bancaria_id ? ' (Bancos)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Descripción (opcional)</Label>
                <Input value={descripcion} onChange={e => setDescripcion(e.target.value)}
                  placeholder="Nota del lote de pagos..." className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          {!resultados && facturas.length > 0 && (
            <div className="text-sm text-kx-text-2">
              <span className="font-semibold text-kx-text">{proveedoresSeleccionados.size}</span> proveedor(es) ·{' '}
              <span className="font-semibold font-mono text-kx-text">{formatCurrency(totalSeleccionado)}</span>
            </div>
          )}
          <div className="flex gap-2 ml-auto">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} className="dark:border-kx-border dark:text-slate-300">
              {resultados ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!resultados && facturas.length > 0 && (
              <Button
                type="button"
                disabled={ejecutando || seleccionadas.length === 0 || !formaPagoId}
                onClick={handleConfirmar}
                className="bg-green-600 hover:bg-green-700 text-white gap-2"
              >
                {ejecutando && <RefreshCw className="w-4 h-4 animate-spin" />}
                Confirmar pago de {proveedoresSeleccionados.size || 0} proveedor(es)
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PaymentRunModal;
