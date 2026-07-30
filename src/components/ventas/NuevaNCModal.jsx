import { useState, useEffect, useMemo } from 'react';
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
import { parseNumberLocale } from '@/lib/currencyUtils';
import { determinarTipoComprobante } from '@/hooks/useAfipConfig';
import ClienteSelector from '@/components/shared/ClienteSelector';
import { getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';

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

// precio_unit es SIEMPRE el precio final (IVA incluido) — mismo criterio que
// crear_venta/NuevaFacturaModal. calcBruto = línea tal como se acredita;
// calcNetoIva la separa DIVIDIENDO por el factor, nunca sumando el IVA encima
// (bug real encontrado: NC generadas acá quedaban infladas ×(1+alícuota)).
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

// devolucionOrigen: { id, numero_devolucion, cliente_id, cliente_nombre,
//   comprobante_id, tipo_comprobante_afip, items: [{producto_id, descripcion,
//   cantidad, precio_unitario, alicuota_iva}] } — pre-carga desde una Devolución
// (mig.263/264): la Devolución ya no genera la NC sola, este es el botón
// "Generar Nota de Crédito" de su detalle. A diferencia de comprobanteOrigen
// (que re-lee TODOS los ítems de la factura), acá se listan los ítems de la
// propia Devolución — puede ser una devolución parcial con cantidades/alícuotas
// ya copiadas correctamente desde el origen.
function NuevaNCModal({ open, onOpenChange, comprobanteOrigen = null, devolucionOrigen = null, onSuccess }) {
  const { user }  = useAuth();
  const { toast } = useToast();

  const [clientes, setClientes]       = useState([]);
  const [clienteId, setClienteId]     = useState('');
  const [motivoNC, setMotivoNC]       = useState(MOTIVOS_NC[0]);
  const [motivoCustom, setMotivoCustom] = useState('');
  const [referenciaCliente, setReferenciaCliente] = useState('');
  const [items, setItems]             = useState([newItem()]);
  const [loading, setLoading]         = useState(false);
  const [afipConfig, setAfipConfig]   = useState(null);
  // Relevancia fiscal (patrón SAP, mismo que NuevaFacturaModal.jsx) — tildado,
  // esta NC nunca se encola para CAE aunque AFIP esté activo.
  const [noRelevanteFiscal, setNoRelevanteFiscal] = useState(false);

  const origenLocked = !!comprobanteOrigen || !!devolucionOrigen;

  // ── Carga de datos al abrir ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id) return;

    // Solo cargamos la lista de clientes cuando es standalone (sin origen fijo)
    if (!origenLocked) {
      // condicion_iva se trae para poder derivar la letra AFIP de una NC
      // standalone (ver letraAfip en handleSubmit) — mismo dato que usa
      // NuevaVentaModal para decidir A/B/C.
      supabase.from('clientes').select('id, nombre, condicion_iva')
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

    // Pre-cargar ítems desde la Devolución origen (sin re-leer la factura completa)
    if (devolucionOrigen) {
      setClienteId(devolucionOrigen.cliente_id || '');
      setReferenciaCliente(devolucionOrigen.referencia_cliente || '');
      setItems((devolucionOrigen.items || []).map(i => ({
        _id:          Math.random().toString(36).slice(2),
        producto_id:  i.producto_id,
        descripcion:  i.descripcion || '',
        cantidad:     Number(i.cantidad),
        precio_unit:  Number(i.precio_unitario),
        alicuota_iva: Number(i.alicuota_iva ?? 21),
      })));
      return;
    }

    // Pre-cargar ítems desde el comprobante origen
    if (comprobanteOrigen?.id) {
      setClienteId(comprobanteOrigen.cliente_id || '');
      setReferenciaCliente(comprobanteOrigen.referencia_cliente || '');
      supabase.from('comprobante_items')
        .select('id, producto_id, descripcion, cantidad, precio_unitario, alicuota_iva, productos(nombre)')
        .eq('comprobante_id', comprobanteOrigen.id)
        .eq('empresa_id', user.empresa_id)
        .then(({ data }) => {
          if (data?.length > 0) {
            setItems(data.map(i => ({
              _id:          Math.random().toString(36).slice(2),
              producto_id:  i.producto_id,
              descripcion:  i.descripcion || i.productos?.nombre || '',
              cantidad:     Number(i.cantidad),
              precio_unit:  Number(i.precio_unitario),
              alicuota_iva: Number(i.alicuota_iva ?? 21),
            })));
          }
        });
    }
  }, [open, user?.empresa_id, comprobanteOrigen?.id, devolucionOrigen?.id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setClienteId('');
      setMotivoNC(MOTIVOS_NC[0]);
      setMotivoCustom('');
      setReferenciaCliente('');
      setItems([newItem()]);
      setAfipConfig(null);
      setNoRelevanteFiscal(false);
    }
  }, [open]);

  const updateItem = (id, field, value) =>
    setItems(prev => prev.map(i => {
      if (i._id !== id) return i;
      // Monto: guardar el string crudo tal como lo tipea el usuario (formato es-AR,
      // ej "1.500,50") — se parsea con parseNumberLocale() recién al usar el valor.
      if (field === 'precio_unit') {
        return { ...i, [field]: value };
      }
      // Para campos numéricos no monetarios: si el value es string vacío o no parseable,
      // mantener 0 en vez de string. Esto evita que `Number("")` quede como NaN en cálculos.
      if (field === 'cantidad' || field === 'alicuota_iva') {
        return { ...i, [field]: value === '' ? '' : Number(value) };
      }
      return { ...i, [field]: value };
    }));
  const removeItem = (id) => setItems(prev => prev.filter(i => i._id !== id));
  const addItem    = ()   => setItems(prev => [...prev, newItem()]);

  // ── Cálculos ────────────────────────────────────────────────────────────────
  // total = suma de calcBruto (lo que realmente se acredita) — subtotalNeto e
  // totalIva son el desglose de ESE total, no un extra a sumarle encima.
  const subtotalNeto = useMemo(() => items.reduce((s, i) => s + calcNetoIva(i).neto, 0), [items]);
  const totalIva     = useMemo(() => items.reduce((s, i) => s + calcNetoIva(i).iva, 0), [items]);
  const total         = useMemo(() => items.reduce((s, i) => s + calcBruto(i), 0), [items]);

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
      // comprobante + comprobante_items + movimiento HABER en CC, todo atómico
      // en la RPC (evita el patrón "escrituras sueltas" — mig.140).
      const { data, error } = await supabase.rpc('crear_nota_credito', {
        p_empresa_id:            user.empresa_id,
        p_user_id:               user.id,
        p_cliente_id:            clienteId || null,
        p_cliente_nombre:        comprobanteOrigen?.cliente_nombre ?? devolucionOrigen?.cliente_nombre ?? 'Consumidor Final',
        p_motivo_nc:             motivo,
        p_items:                 itemsValidos.map(i => ({
          producto_id:     i.producto_id || null,
          cantidad:        Number(i.cantidad),
          precio_unitario: parseNumberLocale(i.precio_unit) || 0,
          alicuota_iva:    Number(i.alicuota_iva),
        })),
        p_comprobante_origen_id: comprobanteOrigen?.id || devolucionOrigen?.comprobante_id || null,
        p_devolucion_id:         devolucionOrigen?.id || null,
        p_referencia_cliente:    referenciaCliente.trim() || null,
      });
      if (error) throw error;

      // Relevancia fiscal (patrón SAP) — crear_nota_credito no acepta este campo
      // como parámetro (default relevante_fiscal=true en la tabla), se corrige acá
      // con un UPDATE de seguimiento antes de decidir si se encola para AFIP.
      if (noRelevanteFiscal) {
        const { error: relevanteErr } = await supabase.from('comprobantes')
          .update({ relevante_fiscal: false }).eq('id', data.comprobante_id);
        if (relevanteErr) console.warn('[relevante_fiscal NC]', relevanteErr.message);
      }

      // AFIP — encolar NC en facturas_pendientes_arca vía trigger (SAP async posting).
      // El UPDATE a cae_estado='pendiente' dispara fn_queue_factura_arca.
      if (afipConfig?.usa_factura_electronica && afipConfig?.punto_venta && !noRelevanteFiscal) {
        // Letra del comprobante. Con origen se hereda (una NC corrige un
        // documento concreto y debe compartir su letra). Sin origen se deriva
        // de la condición fiscal, igual que las ventas — acá había un 'B'
        // hardcodeado, y para un emisor Monotributo o Exento 'B' es una letra
        // que NO puede emitir (solo el RI emite A/B): una NC standalone de
        // Nalux (Exento) salía como NC-B en vez de NC-C.
        const letraAfip =
          comprobanteOrigen?.tipo_comprobante_afip
          ?? devolucionOrigen?.tipo_comprobante_afip
          ?? determinarTipoComprobante(
               afipConfig.condicion_iva,
               clientes.find(c => c.id === clienteId)?.condicion_iva ?? 'CF',
             );
        const { error: afipQueueErr } = await supabase.from('comprobantes').update({
          tipo_comprobante_afip: letraAfip,
          punto_venta_id:        afipConfig.punto_venta.id,
          cae_estado:            'pendiente',
        }).eq('id', data.comprobante_id);
        if (afipQueueErr) console.warn('[AFIP queue NC]', afipQueueErr.message);
      }

      // Asiento contable (no bloqueante) — reversa de venta.
      asientosAutoService.crearAsientoNotaCliente(user.empresa_id, user.id, {
        comprobanteId: data.comprobante_id,
        tipo: 'nota_credito',
        total: data.total,
        neto: subtotalNeto,
        iva: totalIva,
        fecha: getTodayAR(),
        descripcion: `Nota de Crédito ${data.numero_venta}`,
      }).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento NC (no crítico):', e.message);
        }
      });

      toast({ title: `Nota de Crédito ${data.numero_venta} creada` });
      onSuccess?.({ id: data.comprobante_id, numero_venta: data.numero_venta, total: data.total });
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
              : devolucionOrigen
                ? `Nota de Crédito sobre Devolución ${devolucionOrigen.numero_devolucion}`
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

          {/* Relevancia fiscal (patrón SAP) — solo tiene sentido si AFIP está activo */}
          {afipConfig?.usa_factura_electronica && (
            <label className="flex items-start gap-2 p-3 rounded-lg bg-kx-surface-2 border border-kx-border text-xs text-kx-text-2 cursor-pointer">
              <input
                type="checkbox"
                checked={noRelevanteFiscal}
                onChange={e => setNoRelevanteFiscal(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong className="text-kx-text">No relevante para AFIP</strong> — ajuste interno o
                corrección manual. Tildado, esta NC <strong>nunca</strong> se encola para emitir CAE
                ante ARCA, aunque la facturación electrónica esté activa.
              </span>
            </label>
          )}

          {/* Cliente + Motivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Cliente *</Label>
              {origenLocked ? (
                <div className="h-10 flex items-center px-3 rounded-md border border-kx-border bg-kx-surface-2 text-sm text-kx-text">
                  {comprobanteOrigen?.cliente_nombre ?? devolucionOrigen?.cliente_nombre ?? 'Consumidor Final'}
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

          {/* Referencia del cliente (SAP: "N° de referencia") — texto libre, opcional */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-kx-text-2">N° de Referencia del Cliente (opcional)</Label>
            <Input
              placeholder="Ej. número de la factura o del reclamo del cliente"
              value={referenciaCliente}
              onChange={e => setReferenciaCliente(e.target.value)}
              className="h-9 text-sm bg-kx-surface border-kx-border text-kx-text"
            />
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
