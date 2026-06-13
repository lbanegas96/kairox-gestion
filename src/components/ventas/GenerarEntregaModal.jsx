import React, { useState, useMemo } from 'react';
import { Truck, Check, Loader2, Package } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';

/**
 * GenerarEntregaModal — genera una entrega manual desde un pedido.
 * props:
 *   pedido:   objeto pedido con pedido_items[] ya cargados
 *   isOpen:   boolean
 *   onClose:  () => void
 *   onSuccess: (numeroEntrega) => void
 */
function GenerarEntregaModal({ pedido, isOpen, onClose, onSuccess }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // Cantidades a entregar, inicializadas en "pendiente" por ítem
  const [cantidades, setCantidades] = useState({});

  const itemsConPendiente = useMemo(() => {
    if (!pedido?.pedido_items) return [];
    return pedido.pedido_items
      .filter(it => it.producto_id) // solo items con producto
      .map(it => {
        const pedida    = Number(it.cantidad) || 0;
        const entregada = Number(it.cantidad_entregada) || 0;
        const pendiente = Math.max(0, pedida - entregada);
        return { ...it, pedida, entregada, pendiente };
      })
      .filter(it => it.pendiente > 0); // solo los que tienen pendiente
  }, [pedido]);

  // Inicializar cantidades cuando el modal abre
  React.useEffect(() => {
    if (!isOpen) return;
    const init = {};
    itemsConPendiente.forEach(it => { init[it.id] = it.pendiente; });
    setCantidades(init);
  }, [isOpen, pedido?.id]);

  const setCantidad = (itemId, val) => {
    const num = Math.max(0, Number(val) || 0);
    setCantidades(prev => ({ ...prev, [itemId]: num }));
  };

  const totalUnidades = Object.values(cantidades).reduce((s, v) => s + Number(v), 0);

  const handleConfirm = async () => {
    const itemsAEntregar = itemsConPendiente
      .map(it => ({
        pedido_item_id: it.id,
        producto_id:    it.producto_id,
        cantidad:       Number(cantidades[it.id] || 0),
      }))
      .filter(it => it.cantidad > 0);

    if (itemsAEntregar.length === 0) {
      toast({ title: 'Ingresá al menos una unidad a entregar', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('crear_entrega', {
        p_empresa_id: user.empresa_id,
        p_user_id:    user.id,
        p_pedido_id:  pedido.id,
        p_items:      itemsAEntregar,
      });
      if (error) throw error;

      const resultado = typeof data === 'string' ? JSON.parse(data) : data;
      const numeroEntrega = resultado?.numero_entrega || 'ENT-???';
      const totalEntregadas = itemsAEntregar.reduce((s, i) => s + i.cantidad, 0);

      toast({
        title: `Entrega ${numeroEntrega} generada`,
        description: `${totalEntregadas} unidad(es) en ${itemsAEntregar.length} ítem(s)`,
      });
      onSuccess(numeroEntrega);
      onClose();
    } catch (err) {
      toast({ title: 'Error al generar entrega', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  if (!pedido) return null;

  return (
    <Dialog open={isOpen} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg dark:bg-slate-950 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-white">
            <Truck className="h-5 w-5 text-[rgb(var(--kx-violet))]" />
            Generar Entrega — {pedido.numero}
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            Indicá la cantidad a entregar por ítem. El stock se descuenta al confirmar.
          </DialogDescription>
        </DialogHeader>

        {itemsConPendiente.length === 0 ? (
          <div className="py-8 text-center text-kx-text-2">
            <Check className="h-10 w-10 mx-auto mb-3 text-[rgb(var(--kx-green))]" />
            <p className="font-medium">Todos los ítems ya fueron entregados</p>
          </div>
        ) : (
          <div className="space-y-1 py-2">
            {/* Encabezados */}
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-kx-text-3 px-1 pb-1">
              <span className="col-span-5">Producto</span>
              <span className="col-span-2 text-center">Pedido</span>
              <span className="col-span-2 text-center">Entregado</span>
              <span className="col-span-3 text-center">A entregar</span>
            </div>

            {itemsConPendiente.map(it => (
              <div key={it.id} className="grid grid-cols-12 gap-2 items-center py-2 border-b border-kx-border last:border-0">
                <div className="col-span-5 flex items-center gap-2 text-sm text-kx-text">
                  <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                  <span className="truncate">{it.descripcion || it.producto_id}</span>
                </div>
                <div className="col-span-2 text-center text-sm text-kx-text-2">
                  {it.pedida}
                </div>
                <div className="col-span-2 text-center text-sm text-kx-text-2">
                  {it.entregada}
                </div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    min={0}
                    max={it.pendiente}
                    step={1}
                    value={cantidades[it.id] ?? it.pendiente}
                    onChange={e => setCantidad(it.id, e.target.value)}
                    className="h-8 text-sm text-center dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="dark:text-white dark:border-slate-700">
            Cancelar
          </Button>
          {itemsConPendiente.length > 0 && (
            <Button
              onClick={handleConfirm}
              disabled={saving || totalUnidades === 0}
              className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white"
            >
              {saving
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Truck className="h-4 w-4 mr-2" />
              }
              Confirmar entrega ({totalUnidades} u.)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GenerarEntregaModal;
