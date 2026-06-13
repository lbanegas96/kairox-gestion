import React, { useState, useMemo, useEffect } from 'react';
import { Package, Check, Loader2 } from 'lucide-react';
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
 * GenerarRecepcionModal — genera una recepción desde una OC.
 * props:
 *   ocId:     string (id de la orden de compra) — si null, modal cerrado
 *   onClose:  () => void
 *   onSuccess:(numeroRecepcion: string) => void
 */
function GenerarRecepcionModal({ ocId, onClose, onSuccess }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving]     = useState(false);
  const [oc, setOc]             = useState(null);
  const [loadingOC, setLoadingOC] = useState(false);
  const [cantidades, setCantidades] = useState({});

  const isOpen = !!ocId;

  useEffect(() => {
    if (!ocId || !user?.empresa_id) { setOc(null); return; }
    setLoadingOC(true);
    supabase
      .from('ordenes_compra')
      .select(`
        id, numero, proveedor_id, proveedor_nombre,
        ordenes_compra_items(
          id, descripcion, producto_id, cantidad_pedida, cantidad_recibida,
          productos(nombre)
        )
      `)
      .eq('id', ocId)
      .eq('empresa_id', user.empresa_id)
      .single()
      .then(({ data }) => {
        setOc(data || null);
        const init = {};
        (data?.ordenes_compra_items ?? []).forEach(it => {
          const pendiente = Math.max(0, Number(it.cantidad_pedida) - Number(it.cantidad_recibida || 0));
          init[it.id] = pendiente;
        });
        setCantidades(init);
        setLoadingOC(false);
      });
  }, [ocId, user?.empresa_id]);

  const itemsConPendiente = useMemo(() => {
    if (!oc?.ordenes_compra_items) return [];
    return oc.ordenes_compra_items
      .filter(it => it.producto_id)
      .map(it => {
        const pedida    = Number(it.cantidad_pedida) || 0;
        const recibida  = Number(it.cantidad_recibida) || 0;
        const pendiente = Math.max(0, pedida - recibida);
        return { ...it, pedida, recibida, pendiente, nombre: it.productos?.nombre || it.descripcion };
      })
      .filter(it => it.pendiente > 0);
  }, [oc]);

  const totalUnidades = Object.values(cantidades).reduce((s, v) => s + Number(v), 0);

  const handleConfirm = async () => {
    const itemsARecibir = itemsConPendiente
      .map(it => ({
        orden_compra_item_id: it.id,
        producto_id:          it.producto_id,
        cantidad:             Number(cantidades[it.id] || 0),
      }))
      .filter(it => it.cantidad > 0);

    if (itemsARecibir.length === 0) {
      toast({ title: 'Ingresá al menos una unidad a recibir', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('crear_recepcion', {
        p_empresa_id:      user.empresa_id,
        p_user_id:         user.id,
        p_orden_compra_id: ocId,
        p_items:           itemsARecibir,
      });
      if (error) throw error;

      const resultado = typeof data === 'string' ? JSON.parse(data) : data;
      const numeroRecepcion = resultado?.numero_recepcion || 'REC-???';
      toast({
        title: `Recepción ${numeroRecepcion} generada`,
        description: `${totalUnidades} unidad(es) en ${itemsARecibir.length} ítem(s)`,
      });
      onSuccess(numeroRecepcion);
      onClose();
    } catch (err) {
      toast({ title: 'Error al generar recepción', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg dark:bg-slate-950 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-white">
            <Package className="h-5 w-5 text-[rgb(var(--kx-violet))]" />
            Generar Recepción{oc ? ` — ${oc.numero}` : ''}
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            Indicá la cantidad a recibir por ítem. El stock se incrementa al confirmar.
          </DialogDescription>
        </DialogHeader>

        {loadingOC ? (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-kx-text-3" />
          </div>
        ) : itemsConPendiente.length === 0 ? (
          <div className="py-8 text-center text-kx-text-2">
            <Check className="h-10 w-10 mx-auto mb-3 text-[rgb(var(--kx-green))]" />
            <p className="font-medium">Todos los ítems ya fueron recibidos</p>
          </div>
        ) : (
          <div className="space-y-1 py-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-kx-text-3 px-1 pb-1">
              <span className="col-span-5">Producto</span>
              <span className="col-span-2 text-center">Pedido</span>
              <span className="col-span-2 text-center">Recibido</span>
              <span className="col-span-3 text-center">A recibir</span>
            </div>

            {itemsConPendiente.map(it => (
              <div key={it.id} className="grid grid-cols-12 gap-2 items-center py-2 border-b border-kx-border last:border-0">
                <div className="col-span-5 flex items-center gap-2 text-sm text-kx-text">
                  <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                  <span className="truncate">{it.nombre}</span>
                </div>
                <div className="col-span-2 text-center text-sm text-kx-text-2">{it.pedida}</div>
                <div className="col-span-2 text-center text-sm text-kx-text-2">{it.recibida}</div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    min={0}
                    max={it.pendiente}
                    step={1}
                    value={cantidades[it.id] ?? it.pendiente}
                    onChange={e => {
                      const v = Math.max(0, Math.min(it.pendiente, Number(e.target.value) || 0));
                      setCantidades(prev => ({ ...prev, [it.id]: v }));
                    }}
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
          {!loadingOC && itemsConPendiente.length > 0 && (
            <Button
              onClick={handleConfirm}
              disabled={saving || totalUnidades === 0}
              className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white"
            >
              {saving
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Package className="h-4 w-4 mr-2" />
              }
              Confirmar recepción ({totalUnidades} u.)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GenerarRecepcionModal;
