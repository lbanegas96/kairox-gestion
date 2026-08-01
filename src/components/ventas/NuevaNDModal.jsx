import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, FileWarning, Info } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { determinarTipoComprobante } from '@/hooks/useAfipConfig';
import ClienteSelector from '@/components/shared/ClienteSelector';
import { getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';

const MOTIVOS_ND = [
  'Diferencia de precio',
  'Intereses por mora',
  'Flete adicional',
  'Cargo adicional',
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

// precio_unit es SIEMPRE el precio final (IVA incluido) — mismo criterio que
// Factura/NC (crear_venta). calcBruto = línea tal como se cobra; calcNetoIva
// la separa DIVIDIENDO por el factor, nunca sumando el IVA encima.
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 };
const calcBruto = (item) => {
  const c = Number(item.cantidad);
  const p = parseNumberLocale(item.precio_unit) || 0;
  if (!Number.isFinite(c) || !Number.isFinite(p)) return 0;
  return c * p;
};
const calcNetoIva = (item) => {
  const bruto  = calcBruto(item);
  const factor = FACTOR_IVA[String(item.alicuota_iva)] ?? 1;
  const neto   = bruto / factor;
  return { neto, iva: bruto - neto };
};

// comprobanteOrigen: { id, numero_venta, cliente_id, cliente_nombre,
//   tipo_comprobante_afip, referencia_cliente } — pre-carga desde "Copiar a ND"
// (HistorialVentas.jsx). Sin comprobanteOrigen: ND standalone — se elige
// cliente y, opcionalmente, una factura relacionada (solo trazabilidad, no
// afecta ningún saldo).
function NuevaNDModal({ open, onOpenChange, comprobanteOrigen = null, onSuccess }) {
  const { user }  = useAuth();
  const { toast } = useToast();

  const [clientes, setClientes]       = useState([]);
  const [clienteId, setClienteId]     = useState('');
  const [facturas, setFacturas]       = useState([]);
  const [facturaId, setFacturaId]     = useState('');
  const [motivoND, setMotivoND]       = useState(MOTIVOS_ND[0]);
  const [motivoCustom, setMotivoCustom] = useState('');
  const [referenciaCliente, setReferenciaCliente] = useState('');
  const [items, setItems]             = useState([newItem()]);
  const [loading, setLoading]         = useState(false);
  const [afipConfig, setAfipConfig]   = useState(null);
  // Relevancia fiscal (patrón SAP, mismo que Factura/NC) — tildado, esta ND
  // nunca se encola para CAE aunque AFIP esté activo.

  const origenLocked = !!comprobanteOrigen;

  // ── Carga de datos al abrir ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id) return;

    if (!origenLocked) {
      // condicion_iva se trae para poder derivar la letra AFIP de una ND
      // standalone (ver letraAfip en handleSubmit) — mismo dato que usa
      // NuevaVentaModal para decidir A/B/C.
      supabase.from('clientes').select('id, nombre, condicion_iva')
        .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
        .then(({ data }) => setClientes(data || []));
    }

    supabase.from('empresas')
      .select('usa_factura_electronica, condicion_iva, afip_cuit')
      .eq('id', user.empresa_id).single()
      .then(async ({ data: emp }) => {
        if (!emp?.usa_factura_electronica) return;
        // Punto de venta HEREDADO del comprobante origen (una ND ajusta un
        // documento concreto y sale por su misma serie). Standalone → el PdV por
        // defecto (mig.294). Antes había un `.limit(1)` sin ORDER BY ni filtro
        // de envia_arca, que podía resolver al PdV de remitos.
        const COLS = 'id, numero, nombre, envia_arca';
        let pv = null;
        if (comprobanteOrigen?.punto_venta_id) {
          const { data } = await supabase.from('puntos_venta').select(COLS)
            .eq('id', comprobanteOrigen.punto_venta_id).eq('empresa_id', user.empresa_id).maybeSingle();
          pv = data ?? null;
        }
        if (!pv) {
          const { data } = await supabase.from('puntos_venta').select(COLS)
            .eq('empresa_id', user.empresa_id).eq('activo', true).eq('es_default', true).maybeSingle();
          pv = data ?? null;
        }
        if (!pv) {
          const { data } = await supabase.from('puntos_venta').select(COLS)
            .eq('empresa_id', user.empresa_id).eq('activo', true).eq('envia_arca', true)
            .order('numero').limit(1).maybeSingle();
          pv = data ?? null;
        }
        if (pv) setAfipConfig({ ...emp, punto_venta: pv });
      });

    if (comprobanteOrigen) {
      setClienteId(comprobanteOrigen.cliente_id || '');
      setReferenciaCliente(comprobanteOrigen.referencia_cliente || '');
      setFacturaId(comprobanteOrigen.id || '');
    }
  }, [open, user?.empresa_id, comprobanteOrigen?.id]);

  // ── Standalone: cargar facturas del cliente elegido (solo trazabilidad) ─────
  useEffect(() => {
    if (origenLocked || !clienteId || !user?.empresa_id) {
      if (!origenLocked) setFacturas([]);
      return;
    }
    supabase.from('comprobantes').select('id, numero_venta, total')
      .eq('empresa_id', user.empresa_id).eq('cliente_id', clienteId).eq('tipo', 'venta')
      .order('fecha', { ascending: false }).limit(50)
      .then(({ data }) => setFacturas(data || []));
  }, [origenLocked, clienteId, user?.empresa_id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setClienteId('');
      setFacturaId('');
      setMotivoND(MOTIVOS_ND[0]);
      setMotivoCustom('');
      setReferenciaCliente('');
      setItems([newItem()]);
      setFacturas([]);
      setAfipConfig(null);
    }
  }, [open]);

  const updateItem = (id, field, value) =>
    setItems(prev => prev.map(i => {
      if (i._id !== id) return i;
      if (field === 'precio_unit') return { ...i, [field]: value };
      if (field === 'cantidad' || field === 'alicuota_iva') {
        return { ...i, [field]: value === '' ? '' : Number(value) };
      }
      return { ...i, [field]: value };
    }));
  const removeItem = (id) => setItems(prev => prev.filter(i => i._id !== id));
  const addItem    = ()   => setItems(prev => [...prev, newItem()]);

  const subtotalNeto = useMemo(() => items.reduce((s, i) => s + calcNetoIva(i).neto, 0), [items]);
  const totalIva     = useMemo(() => items.reduce((s, i) => s + calcNetoIva(i).iva, 0), [items]);
  const total         = useMemo(() => items.reduce((s, i) => s + calcBruto(i), 0), [items]);

  const handleConfirmar = async () => {
    const motivo = motivoND === 'Otro' ? motivoCustom.trim() : motivoND;
    if (!clienteId)  { toast({ title: 'Seleccioná un cliente', variant: 'destructive' }); return; }
    if (!motivo)      { toast({ title: 'Ingresá un motivo para la Nota de Débito', variant: 'destructive' }); return; }
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
      const clienteNombre = comprobanteOrigen?.cliente_nombre
        ?? clientes.find(c => c.id === clienteId)?.nombre
        ?? 'Consumidor Final';

      const { data, error } = await supabase.rpc('crear_nota_debito_cliente', {
        p_empresa_id:            user.empresa_id,
        p_user_id:               user.id,
        p_cliente_id:            clienteId,
        p_cliente_nombre:        clienteNombre,
        p_concepto:              motivo,
        p_items:                 itemsValidos.map(i => ({
          producto_id:     i.producto_id || null,
          descripcion:     i.descripcion.trim(),
          cantidad:        Number(i.cantidad),
          precio_unitario: parseNumberLocale(i.precio_unit) || 0,
          alicuota_iva:    Number(i.alicuota_iva),
        })),
        p_comprobante_origen_id: comprobanteOrigen?.id || facturaId || null,
        p_referencia_cliente:    referenciaCliente.trim() || null,
        p_punto_venta_id:        afipConfig?.punto_venta?.id ?? null,
      });
      if (error) throw error;

      // punto_venta_id ya quedó grabado por la RPC (mig.296). La relevancia la
      // define el PdV heredado (criterio unificado, mig.294) — acá sólo se
      // encola a ARCA cuando corresponde.
      if (afipConfig?.usa_factura_electronica && afipConfig?.punto_venta && afipConfig.punto_venta.envia_arca !== false) {
        // Letra del comprobante. Con origen se hereda (una ND ajusta un
        // documento concreto y debe compartir su letra). Sin origen se deriva
        // de la condición fiscal, igual que las ventas — acá había un 'B'
        // hardcodeado, y para un emisor Monotributo o Exento 'B' es una letra
        // que NO puede emitir (solo el RI emite A/B).
        const letraAfip =
          comprobanteOrigen?.tipo_comprobante_afip
          ?? determinarTipoComprobante(
               afipConfig.condicion_iva,
               clientes.find(c => c.id === clienteId)?.condicion_iva ?? 'CF',
             );
        const { error: afipQueueErr } = await supabase.from('comprobantes').update({
          tipo_comprobante_afip: letraAfip,
          cae_estado:            'pendiente',
        }).eq('id', data.comprobante_id);
        if (afipQueueErr) console.warn('[AFIP queue ND]', afipQueueErr.message);
      }

      asientosAutoService.crearAsientoNotaCliente(user.empresa_id, user.id, {
        comprobanteId: data.comprobante_id,
        tipo: 'nota_debito',
        total: data.total,
        neto: subtotalNeto,
        iva: totalIva,
        fecha: getTodayAR(),
        descripcion: `Nota de Débito ${data.numero_venta}`,
      }).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento ND (no crítico):', e.message);
        }
      });

      toast({ title: `Nota de Débito ${data.numero_venta} creada` });
      onSuccess?.({ id: data.comprobante_id, numero_venta: data.numero_venta, total: data.total });
      onOpenChange(false);
    } catch (err) {
      console.error('[NuevaND]', err);
      toast({ title: 'Error al crear ND', description: err.message, variant: 'destructive' });
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
            <FileWarning className="w-5 h-5 text-kx-amber" />
            {comprobanteOrigen
              ? `Nota de Débito sobre ${comprobanteOrigen.numero_venta}`
              : 'Nueva Nota de Débito'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            Cargo adicional al cliente — diferencia de precio, intereses, flete, etc.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 text-xs text-amber-700 dark:text-amber-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Esta ND <strong>aumenta la deuda del cliente</strong> en Cuenta Corriente.</span>
          </div>

          {/* Punto de venta — HEREDADO, no se elige (mig.294) */}
          {afipConfig?.punto_venta && (
            <div className={`flex items-start gap-2 p-3 rounded-lg border text-xs ${
              afipConfig.punto_venta.envia_arca === false
                ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                : 'bg-kx-surface-2 border-kx-border text-kx-text-2'
            }`}>
              <span>
                Se emite por <strong className="text-kx-text">
                  PdV {afipConfig.punto_venta.numero} · {afipConfig.punto_venta.nombre}
                </strong>
                {comprobanteOrigen ? ' (heredado del comprobante original)' : ' (punto de venta por defecto)'}.
                {afipConfig.punto_venta.envia_arca === false
                  ? ' Es un punto de venta interno: no se emite CAE ni se informa a ARCA.'
                  : ''}
              </span>
            </div>
          )}

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
              <Label className="text-xs font-medium text-kx-text-2">Motivo de la ND *</Label>
              <select
                value={motivoND}
                onChange={e => setMotivoND(e.target.value)}
                className="w-full h-10 rounded-md border border-kx-border bg-kx-surface px-3 text-sm text-kx-text focus:outline-none focus:ring-1 focus:ring-[rgb(var(--kx-amber))]"
              >
                {MOTIVOS_ND.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {motivoND === 'Otro' && (
                <Input
                  placeholder="Especificá el motivo..."
                  value={motivoCustom}
                  onChange={e => setMotivoCustom(e.target.value)}
                  className="mt-1.5 h-9 text-sm bg-kx-surface border-kx-border text-kx-text"
                />
              )}
            </div>
          </div>

          {!origenLocked && clienteId && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Factura relacionada (opcional)</Label>
              <select
                value={facturaId}
                onChange={e => setFacturaId(e.target.value)}
                className="w-full h-9 rounded-md border border-kx-border bg-transparent px-3 text-sm text-kx-text focus:outline-none focus:ring-1 focus:ring-[rgb(var(--kx-amber))]"
              >
                <option value="">Sin factura asociada</option>
                {facturas.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.numero_venta} — ${fmt(f.total)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-kx-text-2">N° de Referencia del Cliente (opcional)</Label>
            <Input
              placeholder="Ej. número de la factura o del reclamo del cliente"
              value={referenciaCliente}
              onChange={e => setReferenciaCliente(e.target.value)}
              className="h-9 text-sm bg-kx-surface border-kx-border text-kx-text"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-kx-text">Ítems a cobrar</h3>
              <Button size="sm" variant="outline" onClick={addItem}
                className="h-7 gap-1 text-xs border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
                <Plus className="w-3.5 h-3.5" /> Agregar ítem
              </Button>
            </div>

            <div className="border border-kx-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 border-b border-kx-border">
                  <tr className="text-2xs text-kx-text-2 font-semibold uppercase tracking-wide">
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
                          type="text" inputMode="decimal" placeholder="0,00" value={item.precio_unit}
                          onChange={e => updateItem(item._id, 'precio_unit', e.target.value)}
                          className="h-8 text-xs text-right bg-transparent border-kx-border text-kx-text"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right text-xs font-semibold text-kx-text tabular-nums">
                        ${fmt(calcBruto(item))}
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
              <span>TOTAL ND</span>
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
                : <><FileWarning className="w-4 h-4" /> Crear Nota de Débito</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaNDModal;
