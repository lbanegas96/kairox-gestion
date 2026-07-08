import { useState, useEffect, useMemo } from 'react';
import { Truck, Package, Check, Loader2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';

// Config por tipo — única fuente de las diferencias de negocio entre
// "Entrega" (ventas, sobre un Pedido) y "Recepción" (compras, sobre una OC).
const CONFIG = {
  entrega: {
    icon: Truck,
    tituloEntidad: 'Entrega',
    verboAccion: 'entregar',
    columnaHecho: 'Entregado',
    mensajeVacio: 'Todos los ítems ya fueron entregados',
    mensajeStock: 'El stock se descuenta al confirmar.',
    rpc: 'crear_entrega',
    rpcIdParam: 'p_pedido_id',
    itemIdParam: 'pedido_item_id',
    numeroResultKey: 'numero_entrega',
    numeroFallback: 'ENT-???',
    fetchEntidad: async (id, empresaId) => {
      const { data, error } = await supabase
        .from('pedidos')
        .select('id, numero, pedido_items(id, producto_id, descripcion, cantidad, cantidad_entregada)')
        .eq('id', id)
        .eq('empresa_id', empresaId)
        .single();
      if (error) throw error;
      return {
        numero: data?.numero,
        items: (data?.pedido_items ?? []).map(it => ({
          id: it.id,
          producto_id: it.producto_id,
          nombre: it.descripcion,
          pedida: Number(it.cantidad) || 0,
          hecha: Number(it.cantidad_entregada) || 0,
        })),
      };
    },
  },
  recepcion: {
    icon: Package,
    tituloEntidad: 'Recepción',
    verboAccion: 'recibir',
    columnaHecho: 'Recibido',
    mensajeVacio: 'Todos los ítems ya fueron recibidos',
    mensajeStock: 'El stock se incrementa al confirmar.',
    rpc: 'crear_recepcion',
    rpcIdParam: 'p_orden_compra_id',
    itemIdParam: 'orden_compra_item_id',
    numeroResultKey: 'numero_recepcion',
    numeroFallback: 'REC-???',
    fetchEntidad: async (id, empresaId) => {
      const { data, error } = await supabase
        .from('ordenes_compra')
        .select(`
          id, numero,
          ordenes_compra_items(id, producto_id, descripcion, cantidad_pedida, cantidad_recibida, productos(nombre))
        `)
        .eq('id', id)
        .eq('empresa_id', empresaId)
        .single();
      if (error) throw error;
      return {
        numero: data?.numero,
        items: (data?.ordenes_compra_items ?? []).map(it => ({
          id: it.id,
          producto_id: it.producto_id,
          nombre: it.productos?.nombre || it.descripcion,
          pedida: Number(it.cantidad_pedida) || 0,
          hecha: Number(it.cantidad_recibida) || 0,
        })),
      };
    },
  },
};

/**
 * GenerarMovimientoModal — genera una Entrega (venta) o Recepción (compra)
 * a partir de un Pedido/OC, fetch-eando siempre el estado fresco de los ítems.
 * props:
 *   tipo:      'entrega' | 'recepcion'
 *   sourceId:  id del pedido o de la orden de compra — si null, modal cerrado
 *   onClose:   () => void
 *   onSuccess: (numero: string) => void
 */
function GenerarMovimientoModal({ tipo, sourceId, onClose, onSuccess }) {
  const cfg = CONFIG[tipo];
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [loadingEntidad, setLoadingEntidad] = useState(false);
  const [entidad, setEntidad] = useState(null);
  const [cantidades, setCantidades] = useState({});

  const isOpen = !!sourceId;

  useEffect(() => {
    if (!sourceId || !user?.empresa_id) { setEntidad(null); return; }
    setLoadingEntidad(true);
    cfg.fetchEntidad(sourceId, user.empresa_id)
      .then(data => {
        setEntidad(data);
        const init = {};
        data.items.forEach(it => { init[it.id] = Math.max(0, it.pedida - it.hecha); });
        setCantidades(init);
      })
      .finally(() => setLoadingEntidad(false));
  }, [sourceId, user?.empresa_id, tipo]);

  const itemsConPendiente = useMemo(() => {
    if (!entidad?.items) return [];
    return entidad.items
      .filter(it => it.producto_id)
      .map(it => ({ ...it, pendiente: Math.max(0, it.pedida - it.hecha) }))
      .filter(it => it.pendiente > 0);
  }, [entidad]);

  const totalUnidades = Object.values(cantidades).reduce((s, v) => s + Number(v), 0);

  const setCantidad = (itemId, val, pendiente) => {
    const num = Math.max(0, Math.min(pendiente, Number(val) || 0));
    setCantidades(prev => ({ ...prev, [itemId]: num }));
  };

  const handleConfirm = async () => {
    const itemsAProcesar = itemsConPendiente
      .map(it => ({
        [cfg.itemIdParam]: it.id,
        producto_id: it.producto_id,
        cantidad: Number(cantidades[it.id] || 0),
      }))
      .filter(it => it.cantidad > 0);

    if (itemsAProcesar.length === 0) {
      toast({ title: `Ingresá al menos una unidad a ${cfg.verboAccion}`, variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc(cfg.rpc, {
        p_empresa_id: user.empresa_id,
        p_user_id: user.id,
        [cfg.rpcIdParam]: sourceId,
        p_items: itemsAProcesar,
      });
      if (error) throw error;

      const resultado = typeof data === 'string' ? JSON.parse(data) : data;
      const numero = resultado?.[cfg.numeroResultKey] || cfg.numeroFallback;
      toast({
        title: `${cfg.tituloEntidad} ${numero} generada`,
        description: `${totalUnidades} unidad(es) en ${itemsAProcesar.length} ítem(s)`,
      });
      onSuccess(numero);
      onClose();
    } catch (err) {
      toast({ title: `Error al generar ${cfg.tituloEntidad.toLowerCase()}`, description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const Icon = cfg.icon;

  return (
    <Dialog open={isOpen} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <Icon className="h-5 w-5 text-[rgb(var(--kx-violet))]" />
            Generar {cfg.tituloEntidad}{entidad?.numero ? ` — ${entidad.numero}` : ''}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Indicá la cantidad a {cfg.verboAccion} por ítem. {cfg.mensajeStock}
          </DialogDescription>
        </DialogHeader>

        {loadingEntidad ? (
          <div className="py-10 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-kx-text-3" />
          </div>
        ) : itemsConPendiente.length === 0 ? (
          <div className="py-8 text-center text-kx-text-2">
            <Check className="h-10 w-10 mx-auto mb-3 text-[rgb(var(--kx-green))]" />
            <p className="font-medium">{cfg.mensajeVacio}</p>
          </div>
        ) : (
          <div className="space-y-1 py-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-kx-text-3 px-1 pb-1">
              <span className="col-span-5">Producto</span>
              <span className="col-span-2 text-center">Pedido</span>
              <span className="col-span-2 text-center">{cfg.columnaHecho}</span>
              <span className="col-span-3 text-center">A {cfg.verboAccion}</span>
            </div>

            {itemsConPendiente.map(it => (
              <div key={it.id} className="grid grid-cols-12 gap-2 items-center py-2 border-b border-kx-border last:border-0">
                <div className="col-span-5 flex items-center gap-2 text-sm text-kx-text">
                  <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                  <span className="truncate">{it.nombre}</span>
                </div>
                <div className="col-span-2 text-center text-sm text-kx-text-2">{it.pedida}</div>
                <div className="col-span-2 text-center text-sm text-kx-text-2">{it.hecha}</div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    min={0}
                    max={it.pendiente}
                    step={1}
                    value={cantidades[it.id] ?? it.pendiente}
                    onChange={e => setCantidad(it.id, e.target.value, it.pendiente)}
                    className="h-8 text-sm text-center dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="dark:text-kx-text dark:border-kx-border">
            Cancelar
          </Button>
          {!loadingEntidad && itemsConPendiente.length > 0 && (
            <Button
              onClick={handleConfirm}
              disabled={saving || totalUnidades === 0}
              className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Icon className="h-4 w-4 mr-2" />}
              Confirmar {cfg.tituloEntidad.toLowerCase()} ({totalUnidades} u.)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GenerarMovimientoModal;
