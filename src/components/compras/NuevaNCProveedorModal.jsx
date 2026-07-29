import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Plus, Trash2, FileMinus, Info } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { parseNumberLocale } from '@/lib/currencyUtils';
import ProveedorSelector from '@/components/shared/ProveedorSelector';

// Nota: shared/NuevaDevolucionModal (tipo="proveedor") cubre el caso de devolución física con stock.
// Este modal es para NC financiera (el proveedor nos acredita sin devolución de mercadería).
// Ítems + IVA en notas_credito_proveedor_items (mig.277) — espejo de
// NuevaNCModal.jsx (Ventas). Sin AFIP: la declara el proveedor, no nosotros.

const MOTIVOS_NC = [
  'Descuento comercial',
  'Corrección de precio',
  'Error de facturación',
  'Bonificación',
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

function NuevaNCProveedorModal({ open, onOpenChange, compraOrigen = null, onSuccess }) {
  const { user }                          = useAuth();
  const { currentSession, isSessionOpen } = useCaja();
  const { toast }                         = useToast();

  const [proveedores, setProveedores]     = useState([]);
  const [proveedorId, setProveedorId]     = useState('');
  const [motivo, setMotivo]               = useState(MOTIVOS_NC[0]);
  const [motivoCustom, setMotivoCustom]   = useState('');
  const [items, setItems]                 = useState([newItem()]);
  const [reembolsoEfectivo, setReembolsoEfectivo] = useState(false);
  const [loading, setLoading]             = useState(false);

  const origenLocked = !!compraOrigen;

  // ── Carga al abrir ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id) return;

    if (!origenLocked) {
      supabase.from('proveedores').select('id, nombre')
        .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
        .then(({ data }) => setProveedores(data || []));
    }

    if (compraOrigen) {
      setProveedorId(compraOrigen.proveedor_id || '');
    }
  }, [open, user?.empresa_id, compraOrigen?.id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setProveedorId('');
      setMotivo(MOTIVOS_NC[0]);
      setMotivoCustom('');
      setItems([newItem()]);
      setReembolsoEfectivo(false);
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

  // ── Confirmar ───────────────────────────────────────────────────────────────
  const handleConfirmar = async () => {
    const motivoFinal = motivo === 'Otro' ? motivoCustom.trim() : motivo;

    if (!proveedorId) {
      toast({ title: 'Seleccioná un proveedor', variant: 'destructive' });
      return;
    }
    if (!motivoFinal) {
      toast({ title: 'Ingresá un motivo para la NC', variant: 'destructive' });
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
    if (reembolsoEfectivo && !isSessionOpen) {
      toast({ title: 'Abrí la caja para registrar el reembolso en efectivo', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('crear_nota_credito_proveedor', {
        p_empresa_id:         user.empresa_id,
        p_user_id:            user.id,
        p_proveedor_id:       proveedorId,
        p_motivo:             motivoFinal,
        p_items:              itemsValidos.map(i => ({
          producto_id:     i.producto_id || null,
          descripcion:     i.descripcion.trim(),
          cantidad:        Number(i.cantidad),
          precio_unitario: parseNumberLocale(i.precio_unit) || 0,
          alicuota_iva:    Number(i.alicuota_iva),
        })),
        p_compra_id:          compraOrigen?.id || null,
        p_reembolso_efectivo: reembolsoEfectivo,
        p_caja_sesion_id:     reembolsoEfectivo ? currentSession?.id ?? null : null,
      });
      if (error) throw error;

      toast({ title: `NC ${data.numero_ncp} de proveedor registrada — $${Number(data.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` });
      onSuccess?.(data);
      onOpenChange(false);
    } catch (err) {
      console.error('[NuevaNCProveedor]', err);
      toast({ title: 'Error al registrar la NC', description: err.message, variant: 'destructive' });
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
            {compraOrigen
              ? `NC de Proveedor sobre ${compraOrigen.numero_factura || 'S/N'}`
              : 'Nueva NC de Proveedor'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            NC financiera recibida — reduce la deuda con el proveedor en Cuenta Corriente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Banner */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 text-xs text-amber-700 dark:text-amber-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Para devoluciones con movimiento de stock usá <strong>Devolver a Proveedor</strong>.
              Este modal es para ajustes financieros sin mercadería.
            </span>
          </div>

          {/* Proveedor + Motivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Proveedor *</Label>
              {origenLocked ? (
                <div className="h-10 flex items-center px-3 rounded-md border border-kx-border bg-kx-surface-2 text-sm text-kx-text">
                  {compraOrigen?.proveedores?.nombre || compraOrigen?.proveedor_nombre || 'Proveedor'}
                </div>
              ) : (
                <ProveedorSelector
                  proveedores={proveedores}
                  value={proveedorId}
                  onChange={setProveedorId}
                  onProveedorCreado={p => { setProveedores(prev => [...prev, p]); setProveedorId(p.id); }}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Motivo *</Label>
              <select
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                className="w-full h-10 rounded-md border border-kx-border bg-kx-surface px-3 text-sm text-kx-text focus:outline-none focus:ring-1 focus:ring-[rgb(var(--kx-amber))]"
              >
                {MOTIVOS_NC.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {motivo === 'Otro' && (
                <Input
                  placeholder="Especificá el motivo..."
                  value={motivoCustom}
                  onChange={e => setMotivoCustom(e.target.value)}
                  className="mt-1.5 h-9 text-sm bg-kx-surface border-kx-border text-kx-text"
                />
              )}
            </div>
          </div>

          {/* Compra origen */}
          {compraOrigen && (
            <div className="p-2.5 rounded-lg bg-kx-surface-2 border border-kx-border text-xs text-kx-text-2">
              Factura origen: <span className="font-mono font-semibold text-kx-text">{compraOrigen.numero_factura || 'S/N'}</span>
              {compraOrigen.total && (
                <span className="ml-2 text-kx-text-3">
                  · Total original: ${fmt(compraOrigen.total)}
                </span>
              )}
            </div>
          )}

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

          {/* Reembolso efectivo */}
          <div className="flex items-start gap-3 p-3 bg-kx-surface-2 rounded-lg border border-kx-border">
            <Checkbox
              id="reembolso-nc-prov"
              checked={reembolsoEfectivo}
              onCheckedChange={setReembolsoEfectivo}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="reembolso-nc-prov" className="cursor-pointer font-medium text-sm text-kx-text">
                Cobrar reembolso en efectivo ahora
              </Label>
              <p className="text-2xs text-kx-text-3 mt-0.5">
                {reembolsoEfectivo
                  ? 'El proveedor nos devuelve el importe en efectivo. Requiere caja abierta.'
                  : 'El importe ajusta el saldo de Cuenta Corriente del proveedor (recomendado).'}
              </p>
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
              className="border-kx-border text-kx-text-2">
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmar}
              disabled={loading || total <= 0}
              className="bg-kx-amber hover:opacity-90 text-white gap-2"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrando...</>
                : <><FileMinus className="w-4 h-4" /> Registrar NC</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaNCProveedorModal;
