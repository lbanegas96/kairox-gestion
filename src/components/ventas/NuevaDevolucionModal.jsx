import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Undo2, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ClienteSelector from '@/components/shared/ClienteSelector';

function NuevaDevolucionModal({ isOpen, onClose, onSuccess, comprobante = null }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [clientes, setClientes]                   = useState([]);
  const [clienteId, setClienteId]                 = useState('');
  const [comprobanteItems, setComprobanteItems]   = useState([]);
  const [cantidades, setCantidades]               = useState({});
  const [reingresaStock, setReingresaStock]       = useState(false);
  const [compensacion, setCompensacion]           = useState('nota_credito');
  const [reembolsoEfectivo, setReembolsoEfectivo] = useState(false);
  const [motivo, setMotivo]                       = useState('');
  const [loadingItems, setLoadingItems]           = useState(false);
  const [saving, setSaving]                       = useState(false);

  // Cargar clientes
  useEffect(() => {
    if (!isOpen || !user?.empresa_id) return;
    supabase
      .from('clientes')
      .select('id, nombre')
      .eq('empresa_id', user.empresa_id)
      .neq('activo', false)
      .order('nombre')
      .then(({ data }) => setClientes(data || []));
  }, [isOpen, user?.empresa_id]);

  // Cargar ítems del comprobante si viene pre-cargado
  useEffect(() => {
    if (!isOpen) return;
    if (comprobante?.id && user?.empresa_id) {
      setClienteId(comprobante.cliente_id || '');
      setLoadingItems(true);
      supabase
        .from('comprobante_items')
        .select('id, producto_id, cantidad, precio_unitario, subtotal, cantidad_entregada, cantidad_devuelta, productos(nombre)')
        .eq('comprobante_id', comprobante.id)
        .eq('empresa_id', user.empresa_id)
        .then(({ data }) => {
          const disponibles = (data || []).filter(
            i => Number(i.cantidad_entregada || 0) > Number(i.cantidad_devuelta || 0)
          );
          setComprobanteItems(disponibles);
          const initCants = {};
          disponibles.forEach(i => {
            initCants[i.id] = Number(i.cantidad_entregada || 0) - Number(i.cantidad_devuelta || 0);
          });
          setCantidades(initCants);
          setLoadingItems(false);
        });
    } else {
      setComprobanteItems([]);
      setCantidades({});
    }
  }, [isOpen, comprobante?.id, user?.empresa_id]);

  // Reset al cerrar
  useEffect(() => {
    if (!isOpen) {
      setClienteId('');
      setComprobanteItems([]);
      setCantidades({});
      setReingresaStock(false);
      setCompensacion('nota_credito');
      setReembolsoEfectivo(false);
      setMotivo('');
      setSaving(false);
    }
  }, [isOpen]);

  const total = comprobanteItems.reduce((s, item) => {
    return s + Number(cantidades[item.id] || 0) * Number(item.precio_unitario || 0);
  }, 0);

  const handleConfirm = async () => {
    const efectivoClienteId = clienteId || comprobante?.cliente_id || null;
    // Solo exigir cliente en modo standalone (sin comprobante de origen).
    // Si hay comprobante, una venta a Consumidor Final tiene cliente_id null y
    // la devolución debe seguir siendo posible.
    if (!comprobante && !efectivoClienteId) {
      toast({ title: 'Seleccioná un cliente', variant: 'destructive' });
      return;
    }

    const itemsToReturn = comprobanteItems
      .filter(i => Number(cantidades[i.id] || 0) > 0)
      .map(i => ({
        producto_id:         i.producto_id,
        cantidad:            Number(cantidades[i.id]),
        precio_unitario:     Number(i.precio_unitario),
        comprobante_item_id: i.id,
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
        p_tipo:               'cliente',
        p_items:              itemsToReturn,
        p_comprobante_id:     comprobante?.id  || null,
        p_cliente_id:         efectivoClienteId || null,
        p_reingresa_stock:    reingresaStock,
        p_compensacion:       compensacion,
        p_reembolso_efectivo: reembolsoEfectivo,
        p_motivo:             motivo.trim() || null,
      });

      if (error) throw error;

      const msg = compensacion === 'nota_credito'
        ? `Devolución ${data.numero_devolucion} registrada — NC ${data.numero_nc} generada`
        : `Devolución ${data.numero_devolucion} registrada`;
      toast({ title: msg });
      onSuccess?.(data);
      onClose();
    } catch (err) {
      toast({ title: err.message || 'Error al registrar la devolución', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const tieneItems  = comprobanteItems.length > 0;
  const esModoComp  = !!comprobante;
  const puedeGuardar = !saving && (!esModoComp || (tieneItems && total > 0));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-white">
            <Undo2 className="h-5 w-5 text-orange-500" />
            Nueva Devolución{comprobante ? ` — ${comprobante.numero_venta}` : ''}
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            {comprobante
              ? `Devolución de ${comprobante.cliente_nombre || 'Cliente'}`
              : 'Registrar devolución de cliente'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Cliente (modo standalone) */}
          {!comprobante && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium dark:text-slate-300">Cliente</Label>
              <ClienteSelector
                clientes={clientes}
                value={clienteId}
                onChange={setClienteId}
                onClienteCreado={c => { setClientes(p => [...p, c]); setClienteId(c.id); }}
              />
            </div>
          )}

          {/* Ítems */}
          {esModoComp && (
            loadingItems ? (
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
                    <thead className="bg-slate-50 dark:bg-slate-900 text-xs text-slate-500 uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Producto</th>
                        <th className="text-center px-3 py-2 w-20">Entregado</th>
                        <th className="text-center px-3 py-2 w-20">Ya dev.</th>
                        <th className="text-center px-3 py-2 w-28">A devolver</th>
                        <th className="text-right px-3 py-2 w-28">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-kx-border">
                      {comprobanteItems.map(item => {
                        const maxDev = Number(item.cantidad_entregada || 0) - Number(item.cantidad_devuelta || 0);
                        const cant   = Number(cantidades[item.id] || 0);
                        return (
                          <tr key={item.id} className="dark:bg-slate-950/50">
                            <td className="px-3 py-2 font-medium dark:text-slate-200">
                              {item.productos?.nombre || '—'}
                            </td>
                            <td className="px-3 py-2 text-center text-slate-500">{item.cantidad_entregada}</td>
                            <td className="px-3 py-2 text-center text-slate-500">{item.cantidad_devuelta}</td>
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
                                className="w-20 text-center border border-kx-border rounded px-2 py-1 text-sm bg-transparent dark:text-white focus:ring-1 focus:ring-[rgb(var(--kx-violet))] focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-kx-text">
                              ${(cant * Number(item.precio_unitario || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
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
            )
          )}

          {/* Reingreso de stock */}
          <div className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
            <Checkbox
              id="reingresa"
              checked={reingresaStock}
              onCheckedChange={setReingresaStock}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="reingresa" className="cursor-pointer font-medium text-sm dark:text-slate-200">
                Reingresar productos al stock
              </Label>
              <p className="text-xs text-kx-text-3 mt-0.5">
                {reingresaStock
                  ? 'El stock se incrementará y se registrará un movimiento de ingreso.'
                  : 'Los productos no se sumarán al inventario (ej: dañados o sin condición de reventa).'}
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
                  label: 'Nota de Crédito',
                  desc:  'Genera una NC que ajusta la Cuenta Corriente del cliente o permite reembolso en efectivo',
                },
                {
                  value: 'reemplazo',
                  label: 'Reemplazo',
                  desc:  'Registra la intención de reemplazo — la entrega de reemplazo se crea manualmente desde Entregas',
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
                    <p className="text-sm font-medium dark:text-slate-200">{opt.label}</p>
                    <p className="text-xs text-kx-text-3">{opt.desc}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Reembolso efectivo (solo con NC) */}
          {compensacion === 'nota_credito' && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <Checkbox
                id="reembolso"
                checked={reembolsoEfectivo}
                onCheckedChange={setReembolsoEfectivo}
                className="mt-0.5"
              />
              <div>
                <Label htmlFor="reembolso" className="cursor-pointer font-medium text-sm dark:text-slate-200">
                  Reembolsar en efectivo ahora
                </Label>
                <p className="text-xs text-kx-text-3 mt-0.5">
                  {reembolsoEfectivo
                    ? 'Se registrará un egreso de caja. Requiere caja abierta.'
                    : 'La NC ajustará el saldo de Cuenta Corriente del cliente (recomendado).'}
                </p>
              </div>
            </div>
          )}

          {/* Motivo */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium dark:text-slate-300">Motivo (opcional)</Label>
            <Textarea
              placeholder="Producto defectuoso, error en el pedido..."
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              className="resize-none h-16 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 text-sm"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={onClose} disabled={saving}
            className="dark:border-slate-700 dark:text-slate-300">
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!puedeGuardar}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Registrando...</>
              : <><Undo2 className="h-4 w-4 mr-2" />Registrar Devolución</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaDevolucionModal;
