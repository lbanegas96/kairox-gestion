import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, FilePlus } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { getTodayAR, getNowAR } from '@/lib/dateUtils';
import ProveedorSelector from '@/components/shared/ProveedorSelector';

// ND de proveedor: el proveedor nos cobra más (flete, diferencia de precio, etc.)
// Usa la RPC crear_nota_debito con tipo='recibida' + INSERT manual en CC proveedores (HABER).

function parseMontoAR(str) {
  if (!str) return 0;
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.')) || 0;
}

function NuevaNDProveedorModal({ open, onOpenChange, compraOrigen = null, onSuccess }) {
  const { user }  = useAuth();
  const { toast } = useToast();

  const [proveedores, setProveedores]   = useState([]);
  const [proveedorId, setProveedorId]   = useState('');
  const [concepto, setConcepto]         = useState('');
  const [montoRaw, setMontoRaw]         = useState('');
  const [saving, setSaving]             = useState(false);

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
      setConcepto('');
      setMontoRaw('');
      setSaving(false);
    }
  }, [open]);

  // ── Confirmar ───────────────────────────────────────────────────────────────
  const handleConfirmar = async () => {
    const monto = parseMontoAR(montoRaw);

    if (!proveedorId) {
      toast({ title: 'Seleccioná un proveedor', variant: 'destructive' });
      return;
    }
    if (!concepto.trim()) {
      toast({ title: 'Ingresá un concepto para la ND', variant: 'destructive' });
      return;
    }
    if (!monto || monto <= 0) {
      toast({ title: 'Ingresá un monto válido', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      // 1. Crear notas_debito via RPC (tipo='recibida' — el proveedor nos cobra más)
      //    El RPC NO inserta CC para tipo='recibida', lo hacemos manualmente.
      const { data, error } = await supabase.rpc('crear_nota_debito', {
        p_empresa_id:     user.empresa_id,
        p_user_id:        user.id,
        p_tipo:           'recibida',
        p_concepto:       concepto.trim(),
        p_monto:          monto,
        p_proveedor_id:   proveedorId,
        p_compra_id:      compraOrigen?.id || null,
      });
      if (error) throw error;

      const now = getNowAR().toISOString();
      const numeroNd = data?.numero_nd || 'ND';

      // 2. INSERT cuenta_corriente_proveedores — ND aumenta lo que les debemos
      await supabase.from('cuenta_corriente_proveedores').insert([{
        empresa_id:      user.empresa_id,
        user_id:         user.id,
        proveedor_id:    proveedorId,
        tipo:            'nota_debito',
        monto,
        descripcion:     `ND ${numeroNd} recibida — ${concepto.trim()}`,
        referencia_id:   data?.nota_debito_id || null,
        referencia_tipo: 'nd_proveedor',
        fecha:           now,
      }]);

      toast({ title: `Nota de Débito ${numeroNd} registrada — el proveedor cobra $${monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })} adicionales` });
      onSuccess?.(data);
      onOpenChange(false);
    } catch (err) {
      console.error('[NuevaNDProveedor]', err);
      toast({ title: 'Error al registrar la ND', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-kx-surface border-kx-border text-kx-text">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FilePlus className="w-5 h-5 text-kx-red" />
            {compraOrigen
              ? `ND de Proveedor sobre ${compraOrigen.numero_factura || 'S/N'}`
              : 'Nueva ND de Proveedor'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            El proveedor nos cobra un monto adicional — flete, diferencia de precio, etc.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Proveedor */}
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

          {/* Compra origen */}
          {compraOrigen && (
            <div className="p-2.5 rounded-lg bg-kx-surface-2 border border-kx-border text-xs text-kx-text-2">
              Factura origen: <span className="font-mono font-semibold text-kx-text">{compraOrigen.numero_factura || 'S/N'}</span>
              {compraOrigen.total && (
                <span className="ml-2 text-kx-text-3">
                  · ${Number(compraOrigen.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>
          )}

          {/* Concepto */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-kx-text-2">Concepto *</Label>
            <Textarea
              placeholder="Flete adicional, diferencia de precio, recargo, intereses..."
              value={concepto}
              onChange={e => setConcepto(e.target.value)}
              className="resize-none h-16 bg-kx-surface border-kx-border text-kx-text text-sm"
            />
          </div>

          {/* Monto */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-kx-text-2">Monto adicional *</Label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={montoRaw}
              onChange={e => setMontoRaw(e.target.value)}
              className="bg-kx-surface border-kx-border text-kx-text font-mono"
            />
            <p className="text-[10px] text-kx-text-3">Punto = miles, coma = decimal (ej: 1.500,00)</p>
          </div>

          {/* Advertencia */}
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-900/30 text-xs text-red-700 dark:text-red-400">
            Esta ND <strong>aumenta la deuda</strong> con el proveedor en Cuenta Corriente.
          </div>
        </div>

        <DialogFooter>
          <div className="flex gap-3 w-full justify-between pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}
              className="border-kx-border text-kx-text-2">
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmar}
              disabled={saving}
              className="bg-red-500 hover:bg-red-600 text-white gap-2"
            >
              {saving
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrando...</>
                : <><FilePlus className="w-4 h-4" /> Registrar ND</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaNDProveedorModal;
