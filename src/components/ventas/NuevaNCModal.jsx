import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, FileMinus, Info } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { getTodayAR, getNowAR } from '@/lib/dateUtils';
import ClienteSelector from '@/components/shared/ClienteSelector';

const MOTIVOS_NC = [
  'Bonificación comercial',
  'Descuento por devolución',
  'Corrección de precio',
  'Error de facturación',
  'Ajuste de cuenta corriente',
  'Otro',
];

const newItem = () => ({
  _id:          Math.random().toString(36).slice(2),
  producto_id:  null,
  descripcion:  '',
  cantidad:     1,
  precio_unit:  0,
  alicuota_iva: 21,
});

const calcNeto = (item) => {
  const c = Number(item.cantidad);
  const p = Number(item.precio_unit);
  if (!Number.isFinite(c) || !Number.isFinite(p)) return 0;
  return c * p;
};

function NuevaNCModal({ open, onOpenChange, comprobanteOrigen = null, onSuccess }) {
  const { user }  = useAuth();
  const { toast } = useToast();

  const [clientes, setClientes]       = useState([]);
  const [clienteId, setClienteId]     = useState('');
  const [motivoNC, setMotivoNC]       = useState(MOTIVOS_NC[0]);
  const [motivoCustom, setMotivoCustom] = useState('');
  const [items, setItems]             = useState([newItem()]);
  const [loading, setLoading]         = useState(false);
  const [afipConfig, setAfipConfig]   = useState(null);

  const origenLocked = !!comprobanteOrigen;

  // ── Carga de datos al abrir ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id) return;

    // Solo cargamos la lista de clientes cuando es standalone (sin origen fijo)
    if (!origenLocked) {
      supabase.from('clientes').select('id, nombre')
        .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
        .then(({ data }) => setClientes(data || []));
    }

    // AFIP config (fire & forget — no bloquea el formulario)
    supabase.from('empresas')
      .select('usa_factura_electronica, condicion_iva, afip_cuit')
      .eq('id', user.empresa_id).single()
      .then(({ data: emp }) => {
        if (!emp?.usa_factura_electronica) return;
        supabase.from('puntos_venta').select('id')
          .eq('empresa_id', user.empresa_id).eq('activo', true).limit(1).maybeSingle()
          .then(({ data: pv }) => { if (pv) setAfipConfig({ ...emp, punto_venta: pv }); });
      });

    // Pre-cargar ítems desde el comprobante origen
    if (comprobanteOrigen?.id) {
      setClienteId(comprobanteOrigen.cliente_id || '');
      supabase.from('comprobante_items')
        .select('id, producto_id, cantidad, precio_unitario, alicuota_iva, productos(nombre)')
        .eq('comprobante_id', comprobanteOrigen.id)
        .eq('empresa_id', user.empresa_id)
        .then(({ data }) => {
          if (data?.length > 0) {
            setItems(data.map(i => ({
              _id:          Math.random().toString(36).slice(2),
              producto_id:  i.producto_id,
              descripcion:  i.productos?.nombre || '',
              cantidad:     Number(i.cantidad),
              precio_unit:  Number(i.precio_unitario),
              alicuota_iva: Number(i.alicuota_iva ?? 21),
            })));
          }
        });
    }
  }, [open, user?.empresa_id, comprobanteOrigen?.id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setClienteId('');
      setMotivoNC(MOTIVOS_NC[0]);
      setMotivoCustom('');
      setItems([newItem()]);
      setAfipConfig(null);
    }
  }, [open]);

  const updateItem = (id, field, value) =>
    setItems(prev => prev.map(i => {
      if (i._id !== id) return i;
      // Para campos numéricos: si el value es string vacío o no parseable, mantener 0
      // en vez de string. Esto evita que `Number("")` quede como NaN en cálculos.
      if (field === 'cantidad' || field === 'precio_unit' || field === 'alicuota_iva') {
        return { ...i, [field]: value === '' ? '' : Number(value) };
      }
      return { ...i, [field]: value };
    }));
  const removeItem = (id) => setItems(prev => prev.filter(i => i._id !== id));
  const addItem    = ()   => setItems(prev => [...prev, newItem()]);

  // ── Cálculos ────────────────────────────────────────────────────────────────
  const subtotalNeto = useMemo(() => items.reduce((s, i) => s + calcNeto(i), 0), [items]);
  const totalIva     = useMemo(() =>
    items.reduce((s, i) => s + calcNeto(i) * Number(i.alicuota_iva) / 100, 0), [items]);
  const total = subtotalNeto + totalIva;

  // ── Número correlativo NC ───────────────────────────────────────────────────
  const generateNCNumber = async () => {
    const todayStr = getTodayAR().replace(/-/g, '');
    const prefix   = `NC-${todayStr}`;
    const { data } = await supabase.from('comprobantes').select('numero_venta')
      .eq('empresa_id', user.empresa_id).ilike('numero_venta', `${prefix}-%`)
      .order('numero_venta', { ascending: false }).limit(1);
    const seq = data?.length > 0
      ? (parseInt(data[0].numero_venta.split('-').pop()) || 0) + 1
      : 1;
    return `${prefix}-${String(seq).padStart(3, '0')}`;
  };

  // ── Confirmar ───────────────────────────────────────────────────────────────
  const handleConfirmar = async () => {
    const motivo = motivoNC === 'Otro' ? motivoCustom.trim() : motivoNC;
    if (!motivo) {
      toast({ title: 'Ingresá un motivo para la Nota de Crédito', variant: 'destructive' });
      return;
    }
    const itemsValidos = items.filter(i => i.descripcion.trim() && Number(i.cantidad) > 0);
    if (itemsValidos.length === 0) {
      toast({ title: 'Agregá al menos un ítem con descripción', variant: 'destructive' });
      return;
    }
    if (total <= 0) {
      toast({ title: 'El total debe ser mayor a cero', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const numero = await generateNCNumber();
      const now    = getNowAR().toISOString();

      // 1. INSERT comprobante nota_credito
      const { data: comp, error: compErr } = await supabase.from('comprobantes').insert([{
        empresa_id:            user.empresa_id,
        tenant_id:             user.empresa_id,
        numero_venta:          numero,
        fecha:                 now,
        cliente_id:            clienteId || null,
        cliente_nombre:        comprobanteOrigen?.cliente_nombre ?? 'Consumidor Final',
        total,
        neto_gravado:          subtotalNeto,
        iva_discriminado:      totalIva,
        forma_pago:            'Nota de Crédito',
        estado_pago:           'pagada',
        moneda:                'ARS',
        tipo_cambio_tasa:      1,
        tipo:                  'nota_credito',
        comprobante_origen_id: comprobanteOrigen?.id || null,
        motivo_nc:             motivo,
      }]).select('id').single();
      if (compErr) throw compErr;

      // 2. INSERT comprobante_items — columnas en ESPAÑOL: producto_id, cantidad
      const { error: itemsErr } = await supabase.from('comprobante_items').insert(
        itemsValidos.map(i => ({
          comprobante_id:  comp.id,
          empresa_id:      user.empresa_id,
          producto_id:     i.producto_id || null,
          cantidad:        Number(i.cantidad),
          precio_unitario: Number(i.precio_unit),
          subtotal:        calcNeto(i),
          alicuota_iva:    String(i.alicuota_iva),
        }))
      );
      if (itemsErr) throw itemsErr;

      // 3. HABER en CC — reduce deuda del cliente
      if (clienteId) {
        await supabase.from('cuenta_corriente_movimientos').insert([{
          empresa_id:     user.empresa_id,
          user_id:        user.id,
          cliente_id:     clienteId,
          comprobante_id: comp.id,
          tipo:           'HABER',
          monto:          total,
          descripcion:    `NC ${numero} — ${motivo}`,
          fecha:          now,
        }]);
      }

      // 4. AFIP (fire & forget — las NC también se reportan a AFIP)
      if (afipConfig?.usa_factura_electronica && afipConfig?.punto_venta) {
        supabase.from('comprobantes').update({
          tipo_comprobante_afip: comprobanteOrigen?.tipo_comprobante_afip ?? 'B',
          punto_venta_id:        afipConfig.punto_venta.id,
          cae_estado:            'pendiente',
        }).eq('id', comp.id).then(() => {
          import('@/services/afipService').then(({ emitirCAE }) => {
            emitirCAE(comp.id)
              .then(r => { if (r.success) toast({ title: `✓ CAE NC emitido: ${r.cae}` }); })
              .catch(e => console.warn('[AFIP NC]', e.message));
          });
        });
      }

      toast({ title: `Nota de Crédito ${numero} creada` });
      onSuccess?.({ id: comp.id, numero_venta: numero, total });
      onOpenChange(false);
    } catch (err) {
      console.error('[NuevaNC]', err);
      toast({ title: 'Error al crear NC', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-kx-surface border-kx-border text-kx-text max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-kx-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <FileMinus className="w-5 h-5 text-kx-amber" />
            {comprobanteOrigen
              ? `Nota de Crédito sobre ${comprobanteOrigen.numero_venta}`
              : 'Nueva Nota de Crédito'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            NC aislada — ajuste financiero sin devolución de mercadería
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Banner */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 text-xs text-amber-700 dark:text-amber-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Esta NC <strong>reduce la deuda del cliente</strong> en Cuenta Corriente.
              Si además necesitás devolver mercadería al stock, usá el módulo Devoluciones.
            </span>
          </div>

          {/* Cliente + Motivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Cliente *</Label>
              {origenLocked ? (
                <div className="h-10 flex items-center px-3 rounded-md border border-kx-border bg-kx-surface-2 text-sm text-kx-text">
                  {comprobanteOrigen?.cliente_nombre ?? 'Consumidor Final'}
                </div>
              ) : (
                <ClienteSelector
                  clientes={clientes}
                  value={clienteId}
                  onChange={setClienteId}
                  onClienteCreado={c => { setClientes(p => [...p, c]); setClienteId(c.id); }}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Motivo de la NC *</Label>
              <select
                value={motivoNC}
                onChange={e => setMotivoNC(e.target.value)}
                className="w-full h-10 rounded-md border border-kx-border bg-kx-surface px-3 text-sm text-kx-text focus:outline-none focus:ring-1 focus:ring-[rgb(var(--kx-amber))]"
              >
                {MOTIVOS_NC.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {motivoNC === 'Otro' && (
                <Input
                  placeholder="Especificá el motivo..."
                  value={motivoCustom}
                  onChange={e => setMotivoCustom(e.target.value)}
                  className="mt-1.5 h-9 text-sm bg-kx-surface border-kx-border text-kx-text"
                />
              )}
            </div>
          </div>

          {/* Tabla de ítems */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-kx-text">Ítems a acreditar</h3>
              <Button size="sm" variant="outline" onClick={addItem}
                className="h-7 gap-1 text-xs border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
                <Plus className="w-3.5 h-3.5" /> Agregar ítem
              </Button>
            </div>

            <div className="border border-kx-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 border-b border-kx-border">
                  <tr className="text-[11px] text-kx-text-2 font-semibold uppercase tracking-wide">
                    <th className="text-left px-3 py-2.5">Descripción</th>
                    <th className="text-center px-3 py-2.5 w-20">Cant.</th>
                    <th className="text-right px-3 py-2.5 w-32">Precio Unit.</th>
                    <th className="text-right px-3 py-2.5 w-28">Subtotal</th>
                    <th className="px-3 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-kx-border">
                  {items.map(item => (
                    <tr key={item._id} className="hover:bg-kx-surface-2/50 transition-colors">
                      <td className="px-2 py-1.5">
                        <Input
                          value={item.descripcion}
                          onChange={e => updateItem(item._id, 'descripcion', e.target.value)}
                          placeholder="Descripción del ítem"
                          className="h-8 text-xs bg-transparent border-kx-border text-kx-text"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number" min="1" step="1" value={item.cantidad}
                          onChange={e => updateItem(item._id, 'cantidad', e.target.value.replace(/[^\d]/g, ''))}
                          className="h-8 text-xs text-center bg-transparent border-kx-border text-kx-text"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number" min="0" step="0.01" value={item.precio_unit}
                          onChange={e => updateItem(item._id, 'precio_unit', e.target.value)}
                          className="h-8 text-xs text-right bg-transparent border-kx-border text-kx-text"
                        />
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Total */}
          <div className="max-w-xs ml-auto bg-kx-surface-2 rounded-xl border border-kx-border p-4 space-y-2 text-sm">
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
            <div className="flex justify-between font-black text-base text-kx-text border-t border-kx-border pt-2">
              <span>TOTAL NC</span>
              <span className="tabular-nums text-kx-amber">${fmt(total)}</span>
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
              className="bg-kx-amber hover:opacity-90 text-white gap-2">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Creando...</>
                : <><FileMinus className="w-4 h-4" /> Crear Nota de Crédito</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaNCModal;
