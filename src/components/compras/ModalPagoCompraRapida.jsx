import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { supabase } from '@/lib/customSupabaseClient';
import { proveedoresService } from '@/services/proveedoresService';
import { parseNumberLocale } from '@/lib/currencyUtils';

// Mismo circuito que "Registrar Pago" de ProveedoresSection (registrar_pago_proveedor,
// mig.131/215) — acotado a UNA compra puntual recién creada, sin el selector de
// facturas abiertas/FIFO (acá siempre se imputa esta misma compra, completa o
// parcial). Pedido de Luciano (08/09): Compra Rápida marcaba "pagada" en silencio
// sin nunca tocar Caja/Bancos de verdad ni dejar elegir la forma de pago real —
// ahora, tras crearse, se ofrece este modal (si no se eligió "Cuenta Corriente")
// y recién ahí se resta de Caja/Bancos, con la misma RPC ya probada del lado
// Proveedores.
function ModalPagoCompraRapida({ open, onOpenChange, compra, onSuccess }) {
  const { user } = useAuth();
  const { currentSession } = useCaja();
  const { toast } = useToast();

  const { data: formasPago = [] } = useQuery({
    queryKey: ['formas_pago', user?.empresa_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('formas_pago')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.empresa_id && open,
  });

  const [monto, setMonto] = useState('');
  const [formaPagoId, setFormaPagoId] = useState('');
  const [referenciaPago, setReferenciaPago] = useState('');

  // Precarga al abrir: monto = total de la compra, forma de pago = la elegida
  // al crearla (mejor esfuerzo por nombre/tipo — el usuario la confirma o
  // cambia acá, es solo un punto de partida, no una decisión ya tomada).
  useEffect(() => {
    if (!open || !compra) return;
    setMonto(String(compra.total));
    setReferenciaPago('');
    if (formasPago.length === 0) return;
    const hint = (compra.formaPagoHint || '').toLowerCase();
    const match =
      formasPago.find(f => f.nombre.toLowerCase() === hint) ||
      (hint.includes('efectivo') && formasPago.find(f => f.tipo_instrumento === 'efectivo')) ||
      (hint.includes('transfer') && formasPago.find(f => f.tipo_instrumento === 'transferencia')) ||
      (hint.includes('tarjeta') && formasPago.find(f => f.tipo_instrumento?.startsWith('tarjeta')));
    setFormaPagoId(match?.id || formasPago[0]?.id || '');
  }, [open, compra, formasPago]);

  const pagoMutation = useMutation({
    mutationFn: () => {
      const montoNum = parseNumberLocale(monto);
      const forma = formasPago.find(f => f.id === formaPagoId);
      return proveedoresService.registrarPago(
        user.empresa_id,
        compra.proveedorId,
        compra.proveedorNombre,
        montoNum,
        forma?.nombre ?? 'Efectivo',
        `Pago compra ${compra.numeroFactura || 'S/N'}`,
        user.id,
        currentSession?.id ?? null,
        [{ compra_id: compra.id, monto: montoNum }],
        formaPagoId || null,
        referenciaPago || null,
      );
    },
    onSuccess: (data) => {
      toast({ title: 'Pago registrado ✓', className: 'bg-green-600 text-white' });
      if (data?.asiento_generado === false) {
        toast({
          title: 'Pago registrado sin asiento contable',
          description: 'El pago se guardó, pero no se generó el asiento (período cerrado o cuenta contable faltante). Revisar Plan de Cuentas.',
          variant: 'destructive',
        });
      }
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (e) => toast({ title: 'Error al registrar el pago', description: e.message, variant: 'destructive' }),
  });

  if (!compra) return null;

  const montoNum = parseNumberLocale(monto) || 0;
  const formaSeleccionada = formasPago.find(f => f.id === formaPagoId);
  const REFERENCIA_LABEL = {
    transferencia: 'N° de operación / referencia',
    tarjeta_debito: 'N° de cupón / autorización',
    tarjeta_credito: 'N° de cupón / autorización',
    billetera: 'N° de operación',
  };
  const labelReferencia = REFERENCIA_LABEL[formaSeleccionada?.tipo_instrumento];

  return (
    <Dialog open={open} onOpenChange={v => !pagoMutation.isPending && onOpenChange(v)}>
      <DialogContent className="max-w-sm dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text">Registrar Pago</DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Compra {compra.numeroFactura || 'S/N'} — {compra.proveedorNombre} — total{' '}
            <span className="font-bold text-kx-text">
              ${Number(compra.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </span>
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={e => { e.preventDefault(); if (montoNum > 0) pagoMutation.mutate(); }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <Label className="dark:text-kx-text">Monto a pagar *</Label>
            <Input
              type="text" inputMode="decimal" value={monto}
              onChange={e => setMonto(e.target.value)}
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
            {montoNum > 0 && montoNum < Number(compra.total) && (
              <p className="text-2xs text-kx-amber">
                Pago parcial — la compra queda "Parcial" hasta completar el resto.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="dark:text-kx-text">Método de pago *</Label>
            <select
              value={formaPagoId}
              onChange={e => setFormaPagoId(e.target.value)}
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
          </div>
          {labelReferencia && (
            <div className="space-y-1">
              <Label className="dark:text-kx-text">{labelReferencia}</Label>
              <Input
                value={referenciaPago}
                onChange={e => setReferenciaPago(e.target.value)}
                placeholder={labelReferencia}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
          )}
          <DialogFooter>
            <Button
              type="button" variant="outline" disabled={pagoMutation.isPending}
              onClick={() => onOpenChange(false)}
              className="dark:border-kx-border dark:text-slate-300"
            >
              Ahora no (queda pendiente)
            </Button>
            <Button
              type="submit" disabled={pagoMutation.isPending || montoNum <= 0}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {pagoMutation.isPending ? 'Guardando...' : 'Confirmar Pago'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default ModalPagoCompraRapida;
