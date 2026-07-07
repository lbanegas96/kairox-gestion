import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Undo2, RotateCcw, Loader2, AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ClienteSelector from '@/components/shared/ClienteSelector';

const COMPENSACION_OPCIONES = (tipo) => ([
  {
    value: 'nota_credito',
    label: tipo === 'cliente' ? 'Nota de Crédito' : 'Nota de Crédito del proveedor',
    desc: tipo === 'cliente'
      ? 'Genera una NC que ajusta la Cuenta Corriente del cliente o permite reembolso en efectivo'
      : 'El proveedor te emite una NC que reduce lo que le debés en cuenta corriente',
  },
  {
    value: 'reemplazo',
    label: 'Reemplazo',
    desc: tipo === 'cliente'
      ? 'Registra la intención de reemplazo — la entrega de reemplazo se crea manualmente desde Entregas'
      : 'Registra la intención de reemplazo — la nueva recepción se crea manualmente',
  },
  {
    value: 'pendiente',
    label: 'Sin compensación por ahora',
    desc: 'Solo registra la devolución; la compensación se define luego',
  },
]);

// Config por tipo — la diferencia de negocio real: cliente permite modo standalone
// (sin origen, elige Cliente + reembolso en efectivo hacia afuera) y fetch-ea siempre
// desde comprobante_items; proveedor SIEMPRE requiere origen (compra u OC — nunca
// standalone) y puede fetch-ear desde 2 tablas distintas según de dónde venga.
const CONFIG = {
  cliente: {
    icon: Undo2,
    iconClass: 'text-orange-500',
    confirmClass: 'bg-orange-500 hover:bg-orange-600 text-white',
    rpcTipo: 'cliente',
    rpcEntidadParam: 'p_cliente_id',
    rpcDocParam: 'p_comprobante_id',
    itemIdParam: 'comprobante_item_id',
    columnaHecho: 'Entregado',
    reingresaLabel: 'Reingresar productos al stock',
    reingresaDescOn: 'El stock se incrementará y se registrará un movimiento de ingreso.',
    reingresaDescOff: 'Los productos no se sumarán al inventario (ej: dañados o sin condición de reventa).',
    reembolsoLabel: 'Reembolsar en efectivo ahora',
    reembolsoDescOn: 'Se registrará un egreso de caja. Requiere caja abierta.',
    reembolsoDescOff: 'La NC ajustará el saldo de Cuenta Corriente del cliente (recomendado).',
    reingresaDefault: false,
  },
  proveedor: {
    icon: RotateCcw,
    iconClass: 'text-orange-500',
    confirmClass: 'bg-orange-500 hover:bg-orange-600 text-white',
    rpcTipo: 'proveedor',
    rpcEntidadParam: 'p_proveedor_id',
    rpcDocParam: 'p_compra_id',
    itemIdParam: 'detalle_compra_id',
    columnaHecho: 'Comprado',
    reingresaLabel: 'Descontar del stock',
    reingresaDescOn: 'El stock se reducirá (la mercadería sale del depósito porque vuelve al proveedor).',
    reingresaDescOff: 'El stock no se modifica (ej: nunca llegó a entrar al depósito).',
    reembolsoLabel: 'Cobrar reembolso en efectivo ahora',
    reembolsoDescOn: 'Se registrará un ingreso de caja. Requiere caja abierta.',
    reembolsoDescOff: 'La ND ajustará el saldo de Cuenta Corriente del proveedor (recomendado).',
    reingresaDefault: true,
  },
};

// Fetch de ítems disponibles a devolver, según la fuente del origen.
async function fetchItems(tipo, origen, empresaId) {
  if (tipo === 'cliente') {
    const { data } = await supabase
      .from('comprobante_items')
      .select('id, producto_id, cantidad, precio_unitario, subtotal, cantidad_entregada, cantidad_devuelta, productos(nombre)')
      .eq('comprobante_id', origen.id)
      .eq('empresa_id', empresaId);
    return (data || [])
      .filter(i => Number(i.cantidad_entregada || 0) > Number(i.cantidad_devuelta || 0))
      .map(i => ({ ...i, hecha: Number(i.cantidad_entregada || 0), precio: Number(i.precio_unitario || 0), nombre: i.productos?.nombre }));
  }

  if (origen.fuente === 'compra') {
    const { data } = await supabase
      .from('detalle_compras')
      .select('id, producto_id, cantidad, costo_unitario, cantidad_devuelta, productos(nombre)')
      .eq('compra_id', origen.id)
      .eq('empresa_id', empresaId);
    return (data || [])
      .filter(i => Number(i.cantidad || 0) > Number(i.cantidad_devuelta || 0))
      .map(i => ({ ...i, hecha: Number(i.cantidad || 0), precio: Number(i.costo_unitario || 0), nombre: i.productos?.nombre }));
  }

  // fuente === 'oc'
  const { data } = await supabase
    .from('ordenes_compra_items')
    .select('id, producto_id, cantidad_pedida, cantidad_recibida, costo_unitario, cantidad_devuelta, productos(nombre)')
    .eq('orden_id', origen.id)
    .eq('empresa_id', empresaId);
  return (data || [])
    .map(i => ({ ...i, cantidad: Number(i.cantidad_recibida || i.cantidad_pedida || 0) }))
    .filter(i => i.cantidad > Number(i.cantidad_devuelta || 0))
    .map(i => ({ ...i, hecha: i.cantidad, precio: Number(i.costo_unitario || 0), nombre: i.productos?.nombre }));
}

/**
 * NuevaDevolucionModal — registra una devolución de Cliente o de Proveedor
 * vía la RPC compartida crear_devolucion.
 * props:
 *   tipo:     'cliente' | 'proveedor'
 *   isOpen, onClose, onSuccess
 *   origen:   cliente → comprobante { id, numero, entidadId, entidadNombre } | null (standalone)
 *             proveedor → { fuente: 'compra'|'oc', id, numero, entidadId, entidadNombre } (siempre requerido)
 */
function NuevaDevolucionModal({ tipo, isOpen, onClose, onSuccess, origen = null }) {
  const cfg = CONFIG[tipo];
  const { user } = useAuth();
  const { toast } = useToast();

  const [clientes, setClientes]                   = useState([]);
  const [clienteId, setClienteId]                 = useState('');
  const [items, setItems]                         = useState([]);
  const [cantidades, setCantidades]               = useState({});
  const [reingresaStock, setReingresaStock]       = useState(cfg.reingresaDefault);
  const [compensacion, setCompensacion]           = useState('nota_credito');
  const [reembolsoEfectivo, setReembolsoEfectivo] = useState(false);
  const [motivo, setMotivo]                       = useState('');
  const [loadingItems, setLoadingItems]           = useState(false);
  const [saving, setSaving]                       = useState(false);

  // Cliente: cargar maestro de clientes (solo modo standalone)
  useEffect(() => {
    if (tipo !== 'cliente' || !isOpen || !user?.empresa_id) return;
    supabase.from('clientes').select('id, nombre')
      .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
      .then(({ data }) => setClientes(data || []));
  }, [tipo, isOpen, user?.empresa_id]);

  // Cargar ítems disponibles a devolver
  useEffect(() => {
    if (!isOpen || !user?.empresa_id) return;
    if (tipo === 'cliente') {
      setClienteId(origen?.entidadId || '');
      if (!origen?.id) { setItems([]); setCantidades({}); return; }
    } else if (!origen?.id) {
      setItems([]); setCantidades({});
      return;
    }

    setLoadingItems(true);
    fetchItems(tipo, origen, user.empresa_id).then(disponibles => {
      setItems(disponibles);
      const initCants = {};
      disponibles.forEach(i => { initCants[i.id] = i.hecha - Number(i.cantidad_devuelta || 0); });
      setCantidades(initCants);
      setLoadingItems(false);
    });
  }, [tipo, isOpen, origen?.id, origen?.fuente, user?.empresa_id]);

  // Reset al cerrar
  useEffect(() => {
    if (!isOpen) {
      setClienteId('');
      setItems([]);
      setCantidades({});
      setReingresaStock(cfg.reingresaDefault);
      setCompensacion('nota_credito');
      setReembolsoEfectivo(false);
      setMotivo('');
      setSaving(false);
    }
  }, [isOpen]);

  const total = items.reduce((s, item) => s + Number(cantidades[item.id] || 0) * item.precio, 0);

  const handleConfirm = async () => {
    const efectivoEntidadId = tipo === 'cliente' ? (clienteId || origen?.entidadId || null) : origen?.entidadId;

    if (tipo === 'cliente' && !origen && !efectivoEntidadId) {
      toast({ title: 'Seleccioná un cliente', variant: 'destructive' });
      return;
    }
    if (tipo === 'proveedor' && !origen?.id) {
      toast({ title: 'No hay compra u OC seleccionada', variant: 'destructive' });
      return;
    }

    const itemsToReturn = items
      .filter(i => Number(cantidades[i.id] || 0) > 0)
      .map(i => ({
        producto_id:     i.producto_id,
        cantidad:        Number(cantidades[i.id]),
        precio_unitario: i.precio,
        ...(tipo === 'proveedor' && origen.fuente === 'compra' ? { [cfg.itemIdParam]: i.id } : {}),
        ...(tipo === 'cliente' ? { [cfg.itemIdParam]: i.id } : {}),
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
        p_tipo:               cfg.rpcTipo,
        p_items:              itemsToReturn,
        [cfg.rpcEntidadParam]: efectivoEntidadId || null,
        [cfg.rpcDocParam]:     tipo === 'proveedor' && origen.fuente === 'compra' ? origen.id : (tipo === 'cliente' ? origen?.id || null : null),
        p_reingresa_stock:    reingresaStock,
        p_compensacion:       compensacion,
        p_reembolso_efectivo: reembolsoEfectivo,
        p_motivo:             motivo.trim() || null,
      });
      if (error) throw error;

      // Si viene de una OC, actualizar cantidad_devuelta (no lo hace la RPC en ese caso)
      if (tipo === 'proveedor' && origen.fuente === 'oc' && data) {
        for (const item of itemsToReturn) {
          const ocItem = items.find(i => i.producto_id === item.producto_id);
          if (ocItem) {
            await supabase.from('ordenes_compra_items')
              .update({ cantidad_devuelta: Number(ocItem.cantidad_devuelta || 0) + item.cantidad })
              .eq('id', ocItem.id).eq('empresa_id', user.empresa_id);
          }
        }
      }

      const msg = compensacion === 'nota_credito'
        ? `Devolución ${data.numero_devolucion} registrada — Nota de Crédito ${data.numero_nc || ''} generada`
        : `Devolución ${data.numero_devolucion} registrada`;
      toast({ title: msg });
      onSuccess?.(data);
      onClose();
    } catch (err) {
      console.error('[NuevaDevolucion]', err);
      if (tipo === 'proveedor') {
        let description = err.message;
        if (err.message?.toLowerCase().includes('stock insuficiente')) {
          description = 'Stock insuficiente para realizar la devolución. Verificá que los productos a devolver tengan stock disponible en el inventario.';
        }
        toast({ title: 'Error', description, variant: 'destructive' });
      } else {
        toast({ title: err.message || 'Error al registrar la devolución', variant: 'destructive' });
      }
    } finally {
      setSaving(false);
    }
  };

  const esModoComp   = tipo === 'proveedor' ? true : !!origen;
  const tieneItems   = items.length > 0;
  const puedeGuardar = !saving && (tipo === 'cliente' && !esModoComp ? true : tieneItems && total > 0);
  const Icon = cfg.icon;

  const tituloOrigen = tipo === 'cliente'
    ? (origen ? `Nueva Devolución — ${origen.numero}` : 'Nueva Devolución')
    : `Devolución a Proveedor${origen?.numero ? ` — ${origen.fuente === 'oc' ? `OC ${origen.numero}` : origen.numero}` : ''}`;

  const descripcion = tipo === 'cliente'
    ? (origen ? `Devolución de ${origen.entidadNombre || 'Cliente'}` : 'Registrar devolución de cliente')
    : (origen?.entidadNombre ? `Proveedor: ${origen.entidadNombre}` : 'Registrar devolución');

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-kx-text">
            <Icon className={`h-5 w-5 ${cfg.iconClass}`} />
            {tituloOrigen}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {descripcion}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Cliente (modo standalone) */}
          {tipo === 'cliente' && !origen && (
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
                No hay ítems con saldo pendiente de devolución{tipo === 'cliente' ? ' en esta factura' : ''}.
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm font-medium dark:text-slate-300">Ítems a devolver</Label>
                <div className="border border-kx-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-kx-surface-2 dark:bg-kx-surface text-xs text-slate-500 uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Producto</th>
                        <th className="text-center px-3 py-2 w-20">{cfg.columnaHecho}</th>
                        <th className="text-center px-3 py-2 w-20">Ya dev.</th>
                        <th className="text-center px-3 py-2 w-28">A devolver</th>
                        <th className="text-right px-3 py-2 w-28">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-kx-border">
                      {items.map(item => {
                        const maxDev = item.hecha - Number(item.cantidad_devuelta || 0);
                        const cant   = Number(cantidades[item.id] || 0);
                        return (
                          <tr key={item.id} className="dark:bg-slate-950/50">
                            <td className="px-3 py-2 font-medium dark:text-kx-text">{item.nombre || '—'}</td>
                            <td className="px-3 py-2 text-center text-slate-500">{item.hecha}</td>
                            <td className="px-3 py-2 text-center text-slate-500">{item.cantidad_devuelta || 0}</td>
                            <td className="px-3 py-2 text-center">
                              <input
                                type="number" min="0" max={maxDev} step="1"
                                value={cantidades[item.id] ?? 0}
                                onChange={e => {
                                  const v = Math.min(Math.max(0, parseInt(e.target.value, 10) || 0), maxDev);
                                  setCantidades(p => ({ ...p, [item.id]: v }));
                                }}
                                className="w-20 text-center border border-kx-border rounded px-2 py-1 text-sm bg-transparent dark:text-kx-text focus:ring-1 focus:ring-[rgb(var(--kx-violet))] focus:outline-none"
                              />
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-kx-text">
                              ${(cant * item.precio).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
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

          {/* Reingreso / descuento de stock */}
          <div className="flex items-start gap-3 p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg">
            <Checkbox id="reingresa" checked={reingresaStock} onCheckedChange={setReingresaStock} className="mt-0.5" />
            <div>
              <Label htmlFor="reingresa" className="cursor-pointer font-medium text-sm dark:text-kx-text">
                {cfg.reingresaLabel}
              </Label>
              <p className="text-xs text-kx-text-3 mt-0.5">
                {reingresaStock ? cfg.reingresaDescOn : cfg.reingresaDescOff}
              </p>
            </div>
          </div>

          {/* Compensación */}
          <div className="space-y-2">
            <Label className="text-sm font-medium dark:text-slate-300">Compensación</Label>
            <RadioGroup value={compensacion} onValueChange={setCompensacion} className="space-y-2">
              {COMPENSACION_OPCIONES(tipo).map(opt => (
                <div key={opt.value}
                  className="flex items-start gap-3 p-3 border border-kx-border rounded-lg cursor-pointer hover:bg-kx-surface-2 transition-colors"
                  onClick={() => setCompensacion(opt.value)}>
                  <RadioGroupItem value={opt.value} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium dark:text-kx-text">{opt.label}</p>
                    <p className="text-xs text-kx-text-3">{opt.desc}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
          </div>

          {/* Reembolso efectivo (solo con NC) */}
          {compensacion === 'nota_credito' && (
            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <Checkbox id="reembolso" checked={reembolsoEfectivo} onCheckedChange={setReembolsoEfectivo} className="mt-0.5" />
              <div>
                <Label htmlFor="reembolso" className="cursor-pointer font-medium text-sm dark:text-kx-text">
                  {cfg.reembolsoLabel}
                </Label>
                <p className="text-xs text-kx-text-3 mt-0.5">
                  {reembolsoEfectivo ? cfg.reembolsoDescOn : cfg.reembolsoDescOff}
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
          <Button variant="outline" onClick={onClose} disabled={saving} className="dark:border-kx-border dark:text-slate-300">
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!puedeGuardar} className={cfg.confirmClass}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Registrando...</>
              : <><Icon className="h-4 w-4 mr-2" />Registrar Devolución</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaDevolucionModal;
