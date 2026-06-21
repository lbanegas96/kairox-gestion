import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, FileText, Info, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { getTodayAR, getNowAR, addDaysAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import ClienteSelector from '@/components/shared/ClienteSelector';

const ALICUOTAS = [
  { value: 0,    label: 'Exento 0%' },
  { value: 10.5, label: '10.5%'     },
  { value: 21,   label: '21%'       },
  { value: 27,   label: '27%'       },
];

const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cuenta Corriente'];
const TIPOS_DOC   = ['Ticket', 'Factura A', 'Factura B', 'Factura C'];

const newItem = () => ({
  _id:           Math.random().toString(36).slice(2),
  producto_id:   null,
  descripcion:   '',
  cantidad:      1,
  precio_unit:   0,
  descuento_pct: 0,
  alicuota_iva:  21,
});

const calcNeto = (item) => {
  const bruto = Number(item.cantidad) * (parseNumberLocale(item.precio_unit) || 0);
  const neto  = bruto * (1 - Number(item.descuento_pct) / 100);
  return isNaN(neto) ? 0 : neto;
};

function NuevaFacturaModal({ open, onOpenChange, comprobanteOrigen = null, onSuccess }) {
  const { user }                     = useAuth();
  const { currentSession, isSessionOpen } = useCaja();
  const { toast }                    = useToast();

  const [clientes, setClientes]           = useState([]);
  const [clienteId, setClienteId]         = useState('');
  const [fecha, setFecha]                 = useState(getTodayAR());
  const [tipoDoc, setTipoDoc]             = useState('Ticket');
  const [formaPago, setFormaPago]         = useState('Efectivo');
  const [items, setItems]                 = useState([newItem()]);
  const [loading, setLoading]             = useState(false);
  const [productosCache, setProductosCache] = useState([]);
  const [searchFocusId, setSearchFocusId] = useState(null);
  const [afipConfig, setAfipConfig]       = useState(null);

  // ── Carga de datos al abrir ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id) return;

    supabase.from('clientes').select('id, nombre, dias_credito')
      .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
      .then(({ data }) => setClientes(data || []));

    supabase.from('empresas')
      .select('usa_factura_electronica, condicion_iva, afip_cuit')
      .eq('id', user.empresa_id).single()
      .then(({ data: emp }) => {
        if (!emp?.usa_factura_electronica) return;
        supabase.from('puntos_venta').select('id, numero')
          .eq('empresa_id', user.empresa_id).eq('activo', true).limit(1).maybeSingle()
          .then(({ data: pv }) => { if (pv) setAfipConfig({ ...emp, punto_venta: pv }); });
      });

    // Pre-carga desde comprobante origen (flujo "Copiar a Factura")
    if (comprobanteOrigen?.id) {
      setClienteId(comprobanteOrigen.cliente_id || '');
      supabase.from('comprobante_items')
        .select('id, producto_id, cantidad, precio_unitario, alicuota_iva, productos(nombre)')
        .eq('comprobante_id', comprobanteOrigen.id)
        .eq('empresa_id', user.empresa_id)
        .then(({ data }) => {
          if (data?.length > 0) {
            setItems(data.map(i => ({
              _id:           Math.random().toString(36).slice(2),
              producto_id:   i.producto_id,
              descripcion:   i.productos?.nombre || '',
              cantidad:      Number(i.cantidad),
              precio_unit:   Number(i.precio_unitario),
              descuento_pct: 0,
              alicuota_iva:  Number(i.alicuota_iva ?? 21),
            })));
          }
        });
    }
  }, [open, user?.empresa_id, comprobanteOrigen?.id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setClienteId('');
      setFecha(getTodayAR());
      setTipoDoc('Ticket');
      setFormaPago('Efectivo');
      setItems([newItem()]);
      setSearchFocusId(null);
      setAfipConfig(null);
    }
  }, [open]);

  // ── Búsqueda de productos inline ────────────────────────────────────────────
  const loadProductos = async () => {
    if (productosCache.length > 0) return;
    const { data } = await supabase.from('productos')
      .select('id, nombre, precio_venta, alicuota_iva, stock_actual')
      .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre').limit(500);
    setProductosCache(data || []);
  };

  const getProductosFiltrados = (query) => {
    if (!query || query.length < 2) return [];
    return productosCache
      .filter(p => p.nombre.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 8);
  };

  const selectProducto = (rowId, producto) => {
    setItems(prev => prev.map(i =>
      i._id === rowId
        ? { ...i, producto_id: producto.id, descripcion: producto.nombre,
            precio_unit: Number(producto.precio_venta || 0),
            alicuota_iva: Number(producto.alicuota_iva ?? 21) }
        : i
    ));
    setSearchFocusId(null);
  };

  const updateItem = (id, field, value) => {
    setItems(prev => prev.map(i => i._id === id ? { ...i, [field]: value } : i));
  };
  const removeItem = (id) => setItems(prev => prev.filter(i => i._id !== id));
  const addItem    = ()   => setItems(prev => [...prev, newItem()]);

  // ── Cálculos ────────────────────────────────────────────────────────────────
  const subtotalNeto = useMemo(() => items.reduce((s, i) => s + calcNeto(i), 0), [items]);
  const totalIva     = useMemo(() =>
    items.reduce((s, i) => s + calcNeto(i) * Number(i.alicuota_iva) / 100, 0), [items]);
  const total        = subtotalNeto + totalIva;
  const isCC         = formaPago === 'Cuenta Corriente';

  // ── Generación de número correlativo ────────────────────────────────────────
  const generateNumero = async () => {
    const { data, error } = await supabase.rpc('obtener_proximo_numero', {
      p_empresa_id: user.empresa_id,
      p_tipo_documento: 'factura',
    });
    if (error) throw error;
    return data;
  };

  // ── Confirmar ───────────────────────────────────────────────────────────────
  const handleConfirmar = async () => {
    if (!clienteId && isCC) {
      toast({ title: 'Cliente requerido para Cuenta Corriente', variant: 'destructive' });
      return;
    }
    const itemsValidos = items.filter(i => i.descripcion.trim());
    if (itemsValidos.length === 0) {
      toast({ title: 'Agregá al menos un ítem con descripción', variant: 'destructive' });
      return;
    }
    if (total <= 0) {
      toast({ title: 'El total debe ser mayor a cero', variant: 'destructive' });
      return;
    }
    // Regla: solo cobros en Efectivo requieren caja abierta. Transferencia/Tarjeta/CC no.
    if (formaPago === 'Efectivo' && !isSessionOpen) {
      toast({ title: 'Abrí la caja para registrar el cobro en Efectivo', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const numero     = await generateNumero();
      const now        = getNowAR().toISOString();
      const clienteObj = clientes.find(c => c.id === clienteId);
      // Mismo criterio que la RPC crear_venta: vencimiento = fecha de venta + dias_credito
      // del cliente (0/null → vence el mismo día). Se calcula siempre, no solo en CC.
      const fechaVencimiento = addDaysAR(now, clienteObj?.dias_credito ?? 0);

      // Tipo de comprobante AFIP (A/B/C/E o null para Ticket).
      // Se guarda SIEMPRE, sin importar si AFIP está activo, para poder mostrarlo
      // en el historial aunque la factura sea no electrónica.
      const tipoAfipInsert = tipoDoc === 'Ticket' ? null : tipoDoc.replace('Factura ', '');

      // 1. INSERT comprobante — sin user_id (no existe en comprobantes)
      const { data: comp, error: compErr } = await supabase.from('comprobantes').insert([{
        empresa_id:            user.empresa_id,
        tenant_id:             user.empresa_id,
        numero_venta:          numero,
        fecha:                 now,
        cliente_id:            clienteId || null,
        cliente_nombre:        clienteObj?.nombre ?? 'Consumidor Final',
        total,
        neto_gravado:          subtotalNeto,
        iva_discriminado:      totalIva,
        forma_pago:            formaPago,
        estado_pago:           isCC ? 'pendiente' : 'pagada',
        moneda:                'ARS',
        tipo_cambio_tasa:      1,
        tipo:                  'venta',
        tipo_comprobante_afip: tipoAfipInsert,
        fecha_vencimiento:     fechaVencimiento,
      }]).select('id').single();
      if (compErr) throw compErr;

      // 2. INSERT comprobante_items — columnas en ESPAÑOL: producto_id, cantidad
      const { error: itemsErr } = await supabase.from('comprobante_items').insert(
        itemsValidos.map(i => ({
          comprobante_id:  comp.id,
          empresa_id:      user.empresa_id,
          producto_id:     i.producto_id || null,
          cantidad:        Number(i.cantidad),
          precio_unitario: parseNumberLocale(i.precio_unit) || 0,
          subtotal:        calcNeto(i),
          alicuota_iva:    String(i.alicuota_iva),
        }))
      );
      if (itemsErr) throw itemsErr;

      // 3. CC → DEBE en cuenta corriente (Open Item)
      if (isCC && clienteId) {
        await supabase.from('cuenta_corriente_movimientos').insert([{
          empresa_id:     user.empresa_id,
          user_id:        user.id,
          cliente_id:     clienteId,
          comprobante_id: comp.id,
          tipo:           'DEBE',
          monto:          total,
          descripcion:    `Factura ${numero}`,
          fecha:          now,
        }]);
      }

      // 4. Efectivo + caja abierta → movimientos_caja
      if (formaPago === 'Efectivo' && isSessionOpen && currentSession?.id) {
        await supabase.from('movimientos_caja').insert([{
          empresa_id:     user.empresa_id,
          user_id:        user.id,
          caja_sesion_id: currentSession.id,
          tipo:           'ingreso',
          categoria:      'Venta',
          concepto:       `Factura ${numero}`,
          monto:          total,
          metodo_pago:    'Efectivo',
          is_automatic:   true,
          fecha:          now,
        }]);
      }

      // 5. AFIP (fire & forget — no bloquea ni revierte)
      const afipActivo = afipConfig?.usa_factura_electronica && afipConfig?.punto_venta;
      if (afipActivo && tipoDoc !== 'Ticket') {
        const tipoAfip = tipoDoc.replace('Factura ', '');
        supabase.from('comprobantes').update({
          tipo_comprobante_afip: tipoAfip,
          punto_venta_id:        afipConfig.punto_venta.id,
          cae_estado:            'pendiente',
        }).eq('id', comp.id).then(() => {
          import('@/services/afipService').then(({ emitirCAE }) => {
            emitirCAE(comp.id)
              .then(r => { if (r.success) toast({ title: `✓ CAE emitido: ${r.cae}`, duration: 5000 }); })
              .catch(e => console.warn('[AFIP Factura]', e.message));
          });
        });
      }

      // 6. Asiento contable (fire & forget)
      asientosAutoService.crearAsientoVenta(user.empresa_id, user.id, {
        ventaId:     comp.id,
        total,
        fecha:       getTodayAR(),
        descripcion: `Factura ${numero}`,
        esCredito:   isCC,
      }).catch(e => console.warn('[Contabilidad Factura]', e.message));

      toast({ title: `Factura ${numero} creada correctamente` });
      onSuccess?.({ id: comp.id, numero_venta: numero, total });
      onOpenChange(false);
    } catch (err) {
      console.error('[NuevaFactura]', err);
      toast({ title: 'Error al crear factura', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl bg-kx-surface border-kx-border text-kx-text max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-kx-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <FileText className="w-5 h-5 text-kx-violet" />
            {comprobanteOrigen
              ? `Copiar a Factura — ${comprobanteOrigen.numero_venta}`
              : 'Nueva Factura de Venta'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            {comprobanteOrigen
              ? 'Ítems pre-cargados desde el comprobante origen. Revisá antes de confirmar.'
              : 'Factura financiera — no afecta stock. Para descontar stock usá el flujo Pedido → Entrega.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Banner informativo */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 text-xs text-blue-700 dark:text-blue-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Esta factura <strong>no afecta el inventario</strong>. Para descontar stock, usá el flujo{' '}
              Pedido → Entrega → Facturar lo entregado.
            </span>
          </div>

          {/* Sección 1: Datos básicos */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Cliente</Label>
              <ClienteSelector
                clientes={clientes}
                value={clienteId}
                onChange={setClienteId}
                onClienteCreado={c => { setClientes(p => [...p, c]); setClienteId(c.id); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Tipo de documento</Label>
              <select
                value={tipoDoc}
                onChange={e => setTipoDoc(e.target.value)}
                className="w-full h-10 rounded-md border border-kx-border bg-kx-surface px-3 text-sm text-kx-text focus:outline-none focus:ring-1 focus:ring-[rgb(var(--kx-violet))]"
              >
                {TIPOS_DOC.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Fecha</Label>
              <Input
                type="date" value={fecha}
                onChange={e => setFecha(e.target.value)}
                className="h-10 bg-kx-surface border-kx-border text-kx-text"
              />
            </div>
          </div>

          {/* Sección 2: Tabla de ítems */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-kx-text">Ítems</h3>
              <Button size="sm" variant="outline" onClick={addItem}
                className="h-7 gap-1 text-xs border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
                <Plus className="w-3.5 h-3.5" /> Agregar ítem
              </Button>
            </div>

            <div className="border border-kx-border rounded-xl overflow-visible">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 border-b border-kx-border">
                  <tr className="text-[11px] text-kx-text-2 font-semibold uppercase tracking-wide">
                    <th className="text-left px-3 py-2.5 w-[35%]">Descripción</th>
                    <th className="text-center px-3 py-2.5 w-14">Cant.</th>
                    <th className="text-right px-3 py-2.5 w-28">Precio Unit.</th>
                    <th className="text-center px-3 py-2.5 w-14">Desc%</th>
                    <th className="text-center px-3 py-2.5 w-24">IVA</th>
                    <th className="text-right px-3 py-2.5 w-28">Subtotal</th>
                    <th className="px-3 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-kx-border">
                  {items.map(item => {
                    const filtrados = getProductosFiltrados(item.descripcion);
                    return (
                      <tr key={item._id} className="hover:bg-kx-surface-2/50 transition-colors">
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <Input
                              placeholder="Descripción o buscar producto..."
                              value={item.descripcion}
                              onChange={e => {
                                updateItem(item._id, 'descripcion', e.target.value);
                                if (!item.producto_id) {/* clear producto badge */}
                              }}
                              onFocus={() => { setSearchFocusId(item._id); loadProductos(); }}
                              onBlur={() => setTimeout(() => setSearchFocusId(null), 200)}
                              className="h-8 text-xs bg-transparent border-kx-border text-kx-text pr-14"
                            />
                            <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              item.producto_id
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                : 'bg-kx-surface-2 text-kx-text-3'
                            }`}>
                              {item.producto_id ? 'PROD' : 'SERV'}
                            </span>
                            {searchFocusId === item._id && item.descripcion.length >= 2 && filtrados.length > 0 && (
                              <div className="absolute top-full left-0 z-50 w-72 bg-kx-surface border border-kx-border rounded-xl shadow-2xl mt-1 max-h-48 overflow-y-auto">
                                {filtrados.map(p => (
                                  <button
                                    key={p.id}
                                    className="w-full text-left px-3 py-2 text-xs text-kx-text hover:bg-kx-surface-2 transition-colors first:rounded-t-xl last:rounded-b-xl"
                                    onMouseDown={() => selectProducto(item._id, p)}
                                  >
                                    <div className="font-medium">{p.nombre}</div>
                                    <div className="text-kx-text-3">
                                      ${fmt(p.precio_venta)}
                                      {p.stock_actual !== undefined && (
                                        <span className="ml-2 text-kx-text-3">Stock: {p.stock_actual}</span>
                                      )}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number" min="1" step="1" value={item.cantidad}
                            onChange={e => updateItem(item._id, 'cantidad', e.target.value.replace(/[^\d]/g, ''))}
                            className="h-8 text-xs text-center bg-transparent border-kx-border text-kx-text w-full"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="text" inputMode="decimal" placeholder="0,00" value={item.precio_unit}
                            onChange={e => updateItem(item._id, 'precio_unit', e.target.value)}
                            className="h-8 text-xs text-right bg-transparent border-kx-border text-kx-text w-full"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number" min="0" max="100" step="0.01" value={item.descuento_pct}
                            onChange={e => updateItem(item._id, 'descuento_pct', e.target.value)}
                            className="h-8 text-xs text-center bg-transparent border-kx-border text-kx-text w-full"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={item.alicuota_iva}
                            onChange={e => updateItem(item._id, 'alicuota_iva', Number(e.target.value))}
                            className="w-full h-8 rounded-md border border-kx-border bg-kx-surface px-1.5 text-xs text-kx-text"
                          >
                            {ALICUOTAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs font-semibold text-kx-text tabular-nums">
                          ${fmt(calcNeto(item))}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {items.length > 1 && (
                            <Button size="icon" variant="ghost" onClick={() => removeItem(item._id)}
                              className="h-7 w-7 text-kx-text-3 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Sección 3 & 4: Totales + Pago */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Totales */}
            <div className="bg-kx-surface-2 rounded-xl border border-kx-border p-4 space-y-2 text-sm">
              <div className="flex justify-between text-kx-text-2">
                <span>Subtotal neto</span>
                <span className="tabular-nums">${fmt(subtotalNeto)}</span>
              </div>
              {totalIva > 0 && (
                <div className="flex justify-between text-kx-text-2">
                  <span>IVA</span>
                  <span className="tabular-nums">${fmt(totalIva)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base text-kx-text border-t border-kx-border pt-2 mt-2">
                <span>TOTAL</span>
                <span className="tabular-nums text-kx-green">${fmt(total)}</span>
              </div>
            </div>

            {/* Pago */}
            <div className="bg-kx-surface-2 rounded-xl border border-kx-border p-4 space-y-3">
              <Label className="text-xs font-medium text-kx-text-2 block">Forma de pago</Label>
              <div className="grid grid-cols-2 gap-2">
                {FORMAS_PAGO.map(fp => (
                  <button
                    key={fp}
                    type="button"
                    onClick={() => setFormaPago(fp)}
                    className={`p-2.5 rounded-lg border text-xs font-medium transition-all ${
                      formaPago === fp
                        ? 'border-[rgb(var(--kx-violet))] bg-[rgb(var(--kx-violet)/0.08)] text-[rgb(var(--kx-violet))]'
                        : 'border-kx-border text-kx-text-2 hover:bg-kx-surface hover:border-kx-text-3'
                    }`}
                  >
                    {fp}
                  </button>
                ))}
              </div>
              {isCC && (
                <div className="flex items-center gap-1.5 text-xs text-kx-amber">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Genera deuda en cuenta corriente del cliente
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-kx-border shrink-0">
          <div className="flex gap-3 w-full justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}
              className="border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
              Cancelar
            </Button>
            <Button onClick={handleConfirmar} disabled={loading || total <= 0}
              className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white gap-2">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando...</>
                : <><FileText className="w-4 h-4" /> Crear Factura</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaFacturaModal;
