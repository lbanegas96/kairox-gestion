import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, FileMinus, Info } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { getNowAR } from '@/lib/dateUtils';
import ProveedorSelector from '@/components/shared/ProveedorSelector';

// Nota: NuevaDevolucionProveedorModal cubre el caso de devolución física con stock.
// Este modal es para NC financiera (el proveedor nos acredita sin devolución de mercadería).

const MOTIVOS_NC = [
  'Descuento comercial',
  'Corrección de precio',
  'Error de facturación',
  'Bonificación',
  'Ajuste de cuenta corriente',
  'Otro',
];

function parseMontoAR(str) {
  if (!str) return 0;
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.')) || 0;
}

function NuevaNCProveedorModal({ open, onOpenChange, compraOrigen = null, onSuccess }) {
  const { user }                          = useAuth();
  const { currentSession, isSessionOpen } = useCaja();
  const { toast }                         = useToast();

  const [proveedores, setProveedores]     = useState([]);
  const [proveedorId, setProveedorId]     = useState('');
  const [montoRaw, setMontoRaw]           = useState('');
  const [motivo, setMotivo]               = useState(MOTIVOS_NC[0]);
  const [motivoCustom, setMotivoCustom]   = useState('');
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
      if (compraOrigen.total) {
        setMontoRaw(String(Number(compraOrigen.total).toFixed(2)).replace('.', ','));
      }
    }
  }, [open, user?.empresa_id, compraOrigen?.id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setProveedorId('');
      setMontoRaw('');
      setMotivo(MOTIVOS_NC[0]);
      setMotivoCustom('');
      setReembolsoEfectivo(false);
    }
  }, [open]);

  // ── Confirmar ───────────────────────────────────────────────────────────────
  const handleConfirmar = async () => {
    const monto = parseMontoAR(montoRaw);
    const motivoFinal = motivo === 'Otro' ? motivoCustom.trim() : motivo;

    if (!proveedorId) {
      toast({ title: 'Seleccioná un proveedor', variant: 'destructive' });
      return;
    }
    if (!motivoFinal) {
      toast({ title: 'Ingresá un motivo para la NC', variant: 'destructive' });
      return;
    }
    if (!monto || monto <= 0) {
      toast({ title: 'Ingresá un monto válido', variant: 'destructive' });
      return;
    }
    if (reembolsoEfectivo && !isSessionOpen) {
      toast({ title: 'Abrí la caja para registrar el reembolso en efectivo', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const now        = getNowAR().toISOString();
      const descripcion = `NC recibida — ${motivoFinal}${compraOrigen?.numero_factura ? ` (Fac. ${compraOrigen.numero_factura})` : ''}`;

      // 1. INSERT cuenta_corriente_proveedores — NC reduce lo que les debemos
      await supabase.from('cuenta_corriente_proveedores').insert([{
        empresa_id:      user.empresa_id,
        user_id:         user.id,
        proveedor_id:    proveedorId,
        tipo:            'nota_credito',
        monto,
        descripcion,
        referencia_id:   compraOrigen?.id || null,
        referencia_tipo: 'nc_proveedor',
        fecha:           now,
      }]);

      // 2. Reembolso en efectivo — el proveedor nos devuelve plata (ingreso de caja)
      if (reembolsoEfectivo && isSessionOpen && currentSession?.id) {
        await supabase.from('movimientos_caja').insert([{
          empresa_id:     user.empresa_id,
          user_id:        user.id,
          caja_sesion_id: currentSession.id,
          tipo:           'ingreso',
          categoria:      'NC Proveedor',
          concepto:       descripcion,
          monto,
          metodo_pago:    'Efectivo',
          is_automatic:   true,
          fecha:          now,
        }]);
      }

      toast({ title: `NC de proveedor registrada — $${monto.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` });
      onSuccess?.({ monto, descripcion });
      onOpenChange(false);
    } catch (err) {
      console.error('[NuevaNCProveedor]', err);
      toast({ title: 'Error al registrar la NC', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-kx-surface border-kx-border text-kx-text">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileMinus className="w-5 h-5 text-kx-amber" />
            {compraOrigen
              ? `NC de Proveedor sobre ${compraOrigen.numero_factura || 'S/N'}`
              : 'Nueva NC de Proveedor'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            NC financiera recibida — reduce la deuda con el proveedor en Cuenta Corriente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Banner */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 text-xs text-amber-700 dark:text-amber-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Para devoluciones con movimiento de stock usá <strong>Devolver a Proveedor</strong>.
              Este modal es para ajustes financieros sin mercadería.
            </span>
          </div>

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
                  · Total original: ${Number(compraOrigen.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </span>
              )}
            </div>
          )}

          {/* Motivo */}
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

          {/* Monto */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-kx-text-2">Monto a acreditar *</Label>
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
              <p className="text-[10px] text-kx-text-3 mt-0.5">
                {reembolsoEfectivo
                  ? 'El proveedor nos devuelve el importe en efectivo. Requiere caja abierta.'
                  : 'El importe ajusta el saldo de Cuenta Corriente del proveedor (recomendado).'}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <div className="flex gap-3 w-full justify-between pt-2 border-t border-kx-border">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}
              className="border-kx-border text-kx-text-2">
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmar}
              disabled={loading}
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
