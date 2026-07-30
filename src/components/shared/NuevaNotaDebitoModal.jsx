import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, FilePlus, Plus, Trash2, Info } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { parseNumberLocale } from '@/lib/currencyUtils';
import ProveedorSelector from '@/components/shared/ProveedorSelector';
import { getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';

// ND recibida de Proveedor — ítems + IVA discriminado en `notas_debito_items`
// (mig.276), espejo de NuevaNDModal.jsx (Ventas). Sin AFIP: es el proveedor
// quien declara esta ND, nosotros solo la registramos financieramente — mismo
// criterio que NuevaNCProveedorModal.jsx.

const newItem = () => ({
  _id:          Math.random().toString(36).slice(2),
  producto_id:  null,
  descripcion:  '',
  cantidad:     1,
  precio_unit:  0,
  alicuota_iva: 21,
});

// precio_unit es SIEMPRE el precio final (IVA incluido) — mismo criterio que
// el resto de la app (ver NuevaNDModal.jsx).
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

/**
 * NuevaNotaDebitoModal — registra una ND recibida de un Proveedor vía la RPC
 * crear_nota_debito_proveedor (mig.276).
 * props:
 *   open, onOpenChange
 *   origen:  null | { entidadId, entidadNombre, docId, docNumero, docTotal, lockEntidad }
 *   onSuccess
 */
function NuevaNotaDebitoModal({ open, onOpenChange, origen = null, onSuccess }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [entidades, setEntidades]         = useState([]);
  const [entidadId, setEntidadId]         = useState('');
  const [comprobanteId, setComprobanteId] = useState('');
  const [concepto, setConcepto]           = useState('');
  const [items, setItems]                 = useState([newItem()]);
  const [saving, setSaving]               = useState(false);

  const lockEntidad = !!origen?.lockEntidad;

  // ── Carga de proveedores ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id || lockEntidad) return;
    supabase.from('proveedores').select('id, nombre')
      .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
      .then(({ data }) => setEntidades(data || []));
  }, [open, user?.empresa_id, lockEntidad]);

  // ── Preselección desde origen ────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (origen?.entidadId) setEntidadId(origen.entidadId);
    if (origen?.docId)     setComprobanteId(origen.docId);
  }, [open, origen?.entidadId, origen?.docId]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setEntidadId('');
      setComprobanteId('');
      setConcepto('');
      setItems([newItem()]);
      setSaving(false);
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
    if (!entidadId)       { toast({ title: 'Seleccioná un proveedor', variant: 'destructive' }); return; }
    if (!concepto.trim()) { toast({ title: 'Ingresá un concepto', variant: 'destructive' }); return; }
    const itemsValidos = items.filter(i => i.descripcion.trim() && Number(i.cantidad) > 0);
    if (itemsValidos.length === 0) {
      toast({ title: 'Agregá al menos un ítem con descripción', variant: 'destructive' });
      return;
    }
    if (total <= 0) {
      toast({ title: 'El total debe ser mayor a cero', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('crear_nota_debito_proveedor', {
        p_empresa_id:   user.empresa_id,
        p_user_id:      user.id,
        p_proveedor_id: entidadId,
        p_concepto:     concepto.trim(),
        p_items:        itemsValidos.map(i => ({
          producto_id:     i.producto_id || null,
          descripcion:     i.descripcion.trim(),
          cantidad:        Number(i.cantidad),
          precio_unitario: parseNumberLocale(i.precio_unit) || 0,
          alicuota_iva:    Number(i.alicuota_iva),
        })),
        p_compra_id: comprobanteId || null,
      });
      if (error) throw error;

      const numeroNd = data?.numero_nd || 'ND';

      asientosAutoService.crearAsientoNotaProveedor(user.empresa_id, user.id, {
        documentoId: data.nota_debito_id,
        tipo: 'nota_debito',
        total: data.total,
        neto: subtotalNeto,
        iva: totalIva,
        fecha: getTodayAR(),
        descripcion: `ND de proveedor ${numeroNd}`,
      }).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento ND proveedor (no crítico):', e.message);
        }
      });

      toast({ title: `Nota de Débito ${numeroNd} registrada` });
      onSuccess?.(data);
      onOpenChange(false);
    } catch (err) {
      toast({ title: err.message || 'Error al registrar la Nota de Débito', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl bg-kx-surface border-kx-border text-kx-text max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-kx-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <FilePlus className="w-5 h-5 text-kx-red" />
            {origen?.docNumero ? `ND de Proveedor sobre ${origen.docNumero}` : 'Nueva ND de Proveedor'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            El proveedor nos cobra un monto adicional — flete, diferencia de precio, etc.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 text-xs text-red-700 dark:text-red-400">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Esta ND <strong>aumenta la deuda con el proveedor</strong> en Cuenta Corriente.</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Proveedor *</Label>
              {lockEntidad ? (
                <div className="h-10 flex items-center px-3 rounded-md border border-kx-border bg-kx-surface-2 text-sm text-kx-text">
                  {origen?.entidadNombre || 'Proveedor'}
                </div>
              ) : (
                <ProveedorSelector
                  proveedores={entidades}
                  value={entidadId}
                  onChange={setEntidadId}
                  onProveedorCreado={p => { setEntidades(prev => [...prev, p]); setEntidadId(p.id); }}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Concepto *</Label>
              <Input
                placeholder="Flete adicional, diferencia de precio, recargo..."
                value={concepto}
                onChange={e => setConcepto(e.target.value)}
                className="h-10 text-sm bg-kx-surface border-kx-border text-kx-text"
              />
            </div>
          </div>

          {origen && (
            <div className="p-2.5 rounded-lg bg-kx-surface-2 border border-kx-border text-xs text-kx-text-2">
              Factura origen: <span className="font-mono font-semibold text-kx-text">{origen.docNumero || 'S/N'}</span>
              {origen.docTotal != null && (
                <span className="ml-2 text-kx-text-3">
                  · ${fmt(origen.docTotal)}
                </span>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-kx-text">Ítems a pagar</h3>
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
              <span className="tabular-nums text-kx-red">${fmt(total)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-kx-border shrink-0">
          <div className="flex gap-3 w-full justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}
              className="border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
              Cancelar
            </Button>
            <Button onClick={handleConfirmar} disabled={saving || total <= 0}
              className="bg-kx-red hover:opacity-90 text-white gap-2">
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin" />Registrando...</>
                : <><FilePlus className="h-4 w-4" />Registrar ND</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaNotaDebitoModal;
