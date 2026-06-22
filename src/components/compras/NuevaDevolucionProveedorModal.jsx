import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

function NuevaDevolucionProveedorModal({ isOpen, onClose, onSuccess, compra = null }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [items, setItems]                   = useState([]);
  const [cantidades, setCantidades]         = useState({});
  const [reingresaStock, setReingresaStock] = useState(true);
  const [compensacion, setCompensacion]     = useState('nota_credito');
  const [reembolsoEfectivo, setReembolsoEfectivo] = useState(false);
  const [motivo, setMotivo]                 = useState('');
  const [loadingItems, setLoadingItems]     = useState(false);
  const [saving, setSaving]                 = useState(false);

  // Cargar ítems de la compra
  useEffect(() => {
    if (!isOpen || !compra?.id || !user?.empresa_id) return;
    setLoadingItems(true);
    supabase
      .from('detalle_compras')
      .select('id, producto_id, cantidad, costo_unitario, cantidad_devuelta, productos(nombre)')
      .eq('compra_id', compra.id)
      .eq('empresa_id', user.empresa_id)
      .then(({ data }) => {
        const disponibles = (data || []).filter(
          i => Number(i.cantidad || 0) > Number(i.cantidad_devuelta || 0)
        );
        setItems(disponibles);
        const initCants = {};
        disponibles.forEach(i => {
          initCants[i.id] = Number(i.cantidad || 0) - Number(i.cantidad_devuelta || 0);
        });
        setCantidades(initCants);
        setLoadingItems(false);
      });
  }, [isOpen, compra?.id, user?.empresa_id]);

  // Reset al cerrar
  useEffect(() => {
    if (!isOpen) {
      setItems([]);
      setCantidades({});
      setReingresaStock(true);
      setCompensacion('nota_credito');
      setReembolsoEfectivo(false);
      setMotivo('');
      setSaving(false);
    }
  }, [isOpen]);

  const total = items.reduce((s, item) => {
    return s + Number(cantidades[item.id] || 0) * Number(item.costo_unitario || 0);
  }, 0);

  const handleConfirm = async () => {
    if (!compra?.id) {
      toast({ title: 'No hay factura de compra seleccionada', variant: 'destructive' });
      return;
    }

    const itemsToReturn = items
      .filter(i => Number(cantidades[i.id] || 0) > 0)
      .map(i => ({
        producto_id:         i.producto_id,
        cantidad:            Number(cantidades[i.id]),
        precio_unitario:     Number(i.costo_unitario),
        detalle_compra_id:   i.id,
      }));

    if (itemsToReturn.length === 0) {
      toast({ title: 'Ingresá al menos un ítem con cantidad mayor a 0', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('crear_devolucion', {
        p_empresa_id:         user.empresa_id,
        p_user_id:            user.id,
        p_tipo:               'proveedor',
        p_items:              itemsToReturn,
        p_compra_id:          compra.id,
        p_proveedor_id:       compra.proveedor_id || null,
        p_reingresa_stock:    reingresaStock,
        p_compensacion:       compensacion,
        p_reembolso_efectivo: reembolsoEfectivo,
        p_motivo:             motivo.trim() || null,
      });

      if (error) throw error;

      const msg = compensacion === 'nota_credito'
        ? `Devolución ${data.numero_devolucion} registrada — Nota de Débito ${data.numero_nc || ''} generada`
        : `Devolución ${data.numero_devolucion} registrada`;
      toast({ title: msg });
      onSuccess?.(data);
      onClose();
    } catch (error) {
      console.error('Devolución error:', error);

      let description = error.message;

      if (error.message?.toLowerCase().includes('stock insuficiente')) {
        description = 'Stock insuficiente para realizar la devolución. Verificá que los productos a devolver tengan stock disponible en el inventario.';
      }

      toast({ title: 'Error', description, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const tieneItems   = items.length > 0;
  const puedeGuardar = !saving && tieneItems && total > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <RotateCcw className="h-5 w-5 text-orange-500" />
            Devolución a Proveedor{compra ? ` — ${compra.numero_factura || 'S/N'}` : ''}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {compra?.proveedor_nombre
              ? `Proveedor: ${compra.proveedor_nombre}`
              : 'Registrar devolución sobre una compra'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Ítems */}
          {loadingItems ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-kx-text-3" />
            </div>
          ) : !tieneItems ? (
            <div className="flex items-center gap-2 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No hay ítems con saldo pendiente de devolución en esta factura.
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium dark:text-slate-300">Ítems a devolver</Label>
              <div className="border border-kx-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-kx-surface-2 dark:bg-kx-surface text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Producto</th>
                      <th className="text-center px-3 py-2 w-20">Comprado</th>
                      <th className="text-center px-3 py-2 w-20">Ya dev.</th>
                      <th className="text-center px-3 py-2 w-28">A devolver</th>
                      <th className="text-right px-3 py-2 w-28">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-kx-border">
                    {items.map(item => {
                      const maxDev = Number(item.cantidad || 0) - Number(item.cantidad_devuelta || 0);
                      const cant   = Number(cantidades[item.id] || 0);
                      return (
                        <tr key={item.id} className="dark:bg-slate-950/50">
                          <td className="px-3 py-2 font-medium dark:text-kx-text">
                            {item.productos?.nombre || '—'}
                          </td>
                          <td className="px-3 py-2 text-center text-slate-500">{item.cantidad}</td>
                          <td className="px-3 py-2 text-center text-slate-500">{item.cantidad_devuelta || 0}</td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              min="0"
                              max={maxDev}
                              step="1"
                              value={cantidades[item.id] ?? 0}
                              onChange={e => {
                                const v = Math.min(Math.max(0, parseInt(e.target.value, 10) || 0), maxDev);
                                setCantidades(p => ({ ...p, [item.id]: v }));
                              }}
                              className="w-20 text-center border border-kx-border rounded px-2 py-1 text-sm bg-transparent dark:text-kx-text focus:ring-1 focus:ring-[rgb(var(--kx-violet))] focus:outline-none"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-kx-text">
                            ${(cant * Number(item.costo_unitario || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-right text-sm font-semibold text-kx-text">
                Total: <span className="font-mono text-base">
                  ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
              </p>
            </div>
          )}

          {/* Reingreso de stock (descontar) */}
          <div className="flex items-start gap-3 p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg">
            <Checkbox
              id="reingresa-prov"
              checked={reingresaStock}
              onCheckedChange={setReingresaStock}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="reingresa-prov" className="cursor-pointer font-medium text-sm dark:text-kx-text">
                Descontar del stock
              </Label>
              <p className="text-xs text-kx-text-3 mt-0.5">
                {reingresaStock
                  ? 'El stock se reducirá (la mercadería sale del depósito porque vuelve al proveedor).'
                  : 'El stock no se modifica (ej: nunca llegó a entrar al depósito).'}
              </p>
            </div>
          </div>

          {/* Compensación */}
          <div className="space-y-2">
            <Label className="text-sm font-medium dark:text-slate-300">Compensación</Label>
            <RadioGroup value={compensacion} onValueChange={setCompensacion} className="space-y-2">
              {[
                {
                  value: 'nota_credito',
                  label: 'Nota de Débito a proveedor',
                  desc:  'Genera una ND que reduce lo que le debés al proveedor en cuenta corriente',
                },
                {
                  value: 'reemplazo',
                  label: 'Reemplazo',
                  desc:  'Registra la intención de reemplazo — la nueva recepción se crea manualmente',
                },
                {
                  value: 'pendiente',
                  label: 'Sin compensación por ahora',
                  desc:  'Solo registra la devolución; la compensación se define luego',
                },
              ].map(opt => (
                <div
                  key={opt.value}
                  className="flex items-start gap-3 p-3 border border-kx-border rounded-lg cursor-pointer hover:bg-kx-surface-2 transition-colors"
                  onClick={() => setCompensacion(opt.value)}
                >
                  <RadioGroupItem value={opt.value} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium dark:text-kx-text">{opt.label}</p>
                    <p className="text-xs text-kx-text-3">{opt.desc}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Reembolso en efectivo (solo con ND) */}
          {compensacion === 'nota_credito' && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <Checkbox
                id="reembolso-prov"
                checked={reembolsoEfectivo}
                onCheckedChange={setReembolsoEfectivo}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="reembolso-prov" className="cursor-pointer font-medium text-sm dark:text-kx-text">
                  Cobrar reembolso en efectivo ahora
                </Label>
                <p className="text-xs text-kx-text-3 mt-0.5">
                  {reembolsoEfectivo
                    ? 'Se registrará un ingreso de caja. Requiere caja abierta.'
                    : 'La ND ajustará el saldo de Cuenta Corriente del proveedor (recomendado).'}
                </p>
              </div>
            </div>
          )}

          {/* Motivo */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium dark:text-slate-300">Motivo (opcional)</Label>
            <Textarea
              placeholder="Producto defectuoso, error en el pedido, mercadería dañada..."
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className="resize-none h-16 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={onClose} disabled={saving}
            className="dark:border-kx-border dark:text-slate-300">
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!puedeGuardar}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Registrando...</>
              : <><RotateCcw className="h-4 w-4 mr-2" />Registrar Devolución</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaDevolucionProveedorModal;
