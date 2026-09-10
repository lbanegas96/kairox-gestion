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
import { parseNumberLocale } from '@/lib/currencyUtils';

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
    idResultKey: 'entrega_id',
    numeroFallback: 'ENT-???',
    // Entrega SACA stock — a diferencia de Recepción, acá sí importa cuánto hay
    // disponible de verdad. Antes el modal precargaba "A entregar" con todo lo
    // pendiente del pedido sin mirar stock_actual, así que un ítem con pedido
    // pendiente pero 0 en stock aparecía con cantidad 1 lista para confirmar —
    // el RPC lo rechazaba recién al guardar (toast rojo "Stock insuficiente",
    // hallazgo Luciano 23/08, se sentía como un crash porque pasaba después de
    // cargar todo el resto del formulario).
    necesitaStock: true,
    fetchEntidad: async (id, empresaId) => {
      const { data, error } = await supabase
        .from('pedidos')
        .select('id, numero, pedido_items(id, producto_id, descripcion, cantidad, cantidad_entregada, productos(stock_actual))')
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
          stockDisponible: Number(it.productos?.stock_actual) || 0,
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
    idResultKey: 'recepcion_id',
    numeroFallback: 'REC-???',
    fetchEntidad: async (id, empresaId) => {
      const { data, error } = await supabase
        .from('ordenes_compra')
        .select(`
          id, numero,
          ordenes_compra_items(id, producto_id, descripcion, cantidad_pedida, cantidad_recibida,
            productos(nombre, unidad_compra_id, factor_conversion_compra, unidad_compra:unidades_medida!unidad_compra_id(descripcion)))
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
          unidad_compra_id: it.productos?.unidad_compra_id || null,
          factor_conversion_compra: Number(it.productos?.factor_conversion_compra) || 1,
          unidad_compra_descripcion: it.productos?.unidad_compra?.descripcion || null,
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
  // Hallazgo Luciano 10/09: al confirmar, el modal se cerraba entero de una —
  // no quedaba forma de ver qué se acababa de recibir/entregar sin ir a buscar
  // el documento a mano. `resultado` reemplaza el formulario por un resumen
  // (mismos ítems, cantidad confirmada) hasta que el usuario cierra a propósito.
  const [resultado, setResultado] = useState(null);
  // Campo temporal del conversor de unidad de compra (Caja/Docena/etc., mismo
  // patrón que CompraRapidaSection/TabNuevaCompra) — solo pre-carga `cantidades`,
  // no se envía al backend.
  const [packQtys, setPackQtys] = useState({});

  const isOpen = !!sourceId;

  useEffect(() => {
    setResultado(null);
    if (!sourceId || !user?.empresa_id) { setEntidad(null); return; }
    setLoadingEntidad(true);
    cfg.fetchEntidad(sourceId, user.empresa_id)
      .then(data => {
        setEntidad(data);
        const init = {};
        data.items.forEach(it => {
          const pendiente = Math.max(0, it.pedida - it.hecha);
          // Precarga con lo pendiente, pero nunca más de lo que hay disponible
          // de verdad — si no, un ítem sin stock aparece listo para confirmar
          // y el error recién sale al guardar (mensajeStock arriba lo explica).
          const tope = cfg.necesitaStock ? Math.min(pendiente, it.stockDisponible ?? Infinity) : pendiente;
          init[it.id] = Math.max(0, tope);
        });
        setCantidades(init);
        setPackQtys({});
      })
      .finally(() => setLoadingEntidad(false));
  }, [sourceId, user?.empresa_id, tipo]);

  const itemsConPendiente = useMemo(() => {
    if (!entidad?.items) return [];
    return entidad.items
      .filter(it => it.producto_id)
      .map(it => {
        const pendiente = Math.max(0, it.pedida - it.hecha);
        const maxEntregable = cfg.necesitaStock ? Math.min(pendiente, it.stockDisponible ?? Infinity) : pendiente;
        return { ...it, pendiente, maxEntregable };
      })
      .filter(it => it.pendiente > 0);
  }, [entidad]);

  const totalUnidades = Object.values(cantidades).reduce((s, v) => s + Number(v), 0);

  const setCantidad = (itemId, val, maxEntregable) => {
    const num = Math.max(0, Math.min(maxEntregable, Number(val) || 0));
    setCantidades(prev => ({ ...prev, [itemId]: num }));
  };

  const setPackQty = (itemId, val) => {
    setPackQtys(prev => ({ ...prev, [itemId]: val }));
  };

  // Convierte "3 Cajas" -> cantidad=36 (unidad de stock) usando el factor de
  // conversión configurado en el producto (mismo cálculo que Compra Rápida).
  const applyPackConversion = (item) => {
    const factor = Number(item.factor_conversion_compra) || 1;
    const packQty = parseNumberLocale(packQtys[item.id]);
    if (!packQty || packQty <= 0) return;
    setCantidad(item.id, packQty * factor, item.maxEntregable);
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

    // Resumen para la vista de confirmación — se arma ANTES de llamar al RPC
    // (con los datos que ya tenemos en pantalla), no depende de la respuesta.
    const resumenItems = itemsConPendiente
      .filter(it => Number(cantidades[it.id] || 0) > 0)
      .map(it => ({ id: it.id, nombre: it.nombre, cantidad: Number(cantidades[it.id] || 0) }));

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc(cfg.rpc, {
        p_empresa_id: user.empresa_id,
        p_user_id: user.id,
        [cfg.rpcIdParam]: sourceId,
        p_items: itemsAProcesar,
      });
      if (error) throw error;

      const rpcResult = typeof data === 'string' ? JSON.parse(data) : data;
      const numero = rpcResult?.[cfg.numeroResultKey] || cfg.numeroFallback;
      toast({
        title: `${cfg.tituloEntidad} ${numero} generada`,
        description: `${totalUnidades} unidad(es) en ${itemsAProcesar.length} ítem(s)`,
      });
      // El id va junto con el número para que quien lo llame pueda abrir el
      // documento recién generado (seguir la cadena, como en SAP B1) en vez de
      // dejar al usuario en el documento de origen. El modal ya NO se cierra
      // solo: se reemplaza por el resumen de lo confirmado (ver `resultado`),
      // así el usuario ve qué quedó registrado antes de decidir cerrar.
      onSuccess(numero, rpcResult?.[cfg.idResultKey] ?? null);
      setResultado({ numero, items: resumenItems });
    } catch (err) {
      toast({ title: `Error al generar ${cfg.tituloEntidad.toLowerCase()}`, description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const Icon = cfg.icon;

  return (
    <Dialog open={isOpen} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <Icon className="h-5 w-5 text-[rgb(var(--kx-violet))]" />
            Generar {cfg.tituloEntidad}{entidad?.numero ? ` — ${entidad.numero}` : ''}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {resultado
              ? `${cfg.tituloEntidad} confirmada. Esto fue lo que quedó registrado.`
              : <>Indicá la cantidad a {cfg.verboAccion} por ítem. {cfg.mensajeStock}</>}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="py-2">
            <div className="flex items-center gap-3 pb-4">
              <Check className="h-8 w-8 shrink-0 text-[rgb(var(--kx-green))]" />
              <div>
                <p className="font-semibold text-kx-text">{cfg.tituloEntidad} {resultado.numero} registrada</p>
                <p className="text-sm text-kx-text-2">{cfg.mensajeStock}</p>
              </div>
            </div>
            <div className="border border-kx-border rounded-lg divide-y divide-kx-border">
              {resultado.items.map(it => (
                <div key={it.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-kx-text truncate pr-2">{it.nombre}</span>
                  <span className="font-mono text-kx-text-2 shrink-0">{it.cantidad} u.</span>
                </div>
              ))}
            </div>
          </div>
        ) : loadingEntidad ? (
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
                <div className="col-span-5 flex flex-col gap-1 text-sm text-kx-text">
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-kx-text-3 shrink-0" />
                    <span className="truncate">{it.nombre}</span>
                  </div>
                  {/* Solo Entrega mira stock (necesitaStock) — Recepción no
                      tiene tope de disponibilidad, siempre suma. */}
                  {cfg.necesitaStock && it.stockDisponible < it.pendiente && (
                    <span className={`pl-5 text-2xs ${it.stockDisponible === 0 ? 'text-kx-red font-medium' : 'text-amber-600 dark:text-amber-400'}`}>
                      {it.stockDisponible === 0
                        ? 'Sin stock disponible'
                        : `Stock disponible: ${it.stockDisponible} (menos que lo pedido)`}
                    </span>
                  )}
                  {it.unidad_compra_id && (
                    <div className="flex items-center gap-1 text-2xs text-kx-text-3 pl-5">
                      <span>o en {it.unidad_compra_descripcion || 'unidad de compra'} (x{it.factor_conversion_compra}):</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="cant."
                        value={packQtys[it.id] ?? ''}
                        onChange={e => setPackQty(it.id, e.target.value)}
                        className="w-14 h-6 text-2xs px-1.5 dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => applyPackConversion(it)}
                        className="h-6 px-1.5 text-2xs"
                        title="Convertir a unidad de stock"
                      >
                        ↧
                      </Button>
                    </div>
                  )}
                </div>
                <div className="col-span-2 text-center text-sm text-kx-text-2">{it.pedida}</div>
                <div className="col-span-2 text-center text-sm text-kx-text-2">{it.hecha}</div>
                <div className="col-span-3">
                  <Input
                    type="number"
                    min={0}
                    max={it.maxEntregable}
                    step={1}
                    value={cantidades[it.id] ?? it.maxEntregable}
                    onChange={e => setCantidad(it.id, e.target.value, it.maxEntregable)}
                    disabled={cfg.necesitaStock && it.maxEntregable === 0}
                    className="h-8 text-sm text-center dark:bg-kx-surface dark:border-kx-border dark:text-kx-text disabled:opacity-50"
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {resultado ? (
            <Button onClick={onClose} className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white">
              Cerrar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} className="dark:text-kx-text dark:border-kx-border">
                {/* Sin ítems pendientes no hay nada que "cancelar" -- es una vista
                    informativa, "Cerrar" describe mejor lo que hace el botón. */}
                {!loadingEntidad && itemsConPendiente.length === 0 ? 'Cerrar' : 'Cancelar'}
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
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GenerarMovimientoModal;
