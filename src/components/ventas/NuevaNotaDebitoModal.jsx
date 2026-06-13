import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FileWarning, Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import ClienteSelector from '@/components/shared/ClienteSelector';

function parseMontoAR(str) {
  if (!str) return 0;
  // Permite "1.500,50" → 1500.50  o  "1500.50" → 1500.50
  const cleaned = String(str).trim().replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function NuevaNotaDebitoModal({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [clientes, setClientes]         = useState([]);
  const [clienteId, setClienteId]       = useState('');
  const [comprobantes, setComprobantes] = useState([]);
  const [comprobanteId, setComprobanteId] = useState('');
  const [concepto, setConcepto]         = useState('');
  const [montoRaw, setMontoRaw]         = useState('');
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    if (!isOpen || !user?.empresa_id) return;
    supabase
      .from('clientes')
      .select('id, nombre')
      .eq('empresa_id', user.empresa_id)
      .neq('activo', false)
      .order('nombre')
      .then(({ data }) => setClientes(data || []));
  }, [isOpen, user?.empresa_id]);

  // Cargar facturas del cliente seleccionado
  useEffect(() => {
    if (!clienteId || !user?.empresa_id) {
      setComprobantes([]);
      setComprobanteId('');
      return;
    }
    supabase
      .from('comprobantes')
      .select('id, numero_venta, total')
      .eq('empresa_id', user.empresa_id)
      .eq('cliente_id', clienteId)
      .eq('tipo', 'venta')
      .order('fecha', { ascending: false })
      .limit(50)
      .then(({ data }) => setComprobantes(data || []));
  }, [clienteId, user?.empresa_id]);

  const resetForm = () => {
    setClienteId('');
    setComprobanteId('');
    setConcepto('');
    setMontoRaw('');
    setComprobantes([]);
    setSaving(false);
  };

  useEffect(() => { if (!isOpen) resetForm(); }, [isOpen]);

  const handleConfirm = async () => {
    const monto = parseMontoAR(montoRaw);
    if (!clienteId)           { toast({ title: 'Seleccioná un cliente',   variant: 'destructive' }); return; }
    if (!concepto.trim())     { toast({ title: 'Ingresá un concepto',     variant: 'destructive' }); return; }
    if (!monto || monto <= 0) { toast({ title: 'Ingresá un monto válido', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('crear_nota_debito', {
        p_empresa_id:     user.empresa_id,
        p_user_id:        user.id,
        p_tipo:           'emitida',
        p_concepto:       concepto.trim(),
        p_monto:          monto,
        p_cliente_id:     clienteId,
        p_comprobante_id: comprobanteId || null,
      });
      if (error) throw error;
      toast({ title: `Nota de Débito ${data.numero_nd} registrada` });
      onSuccess?.(data);
      onClose();
    } catch (err) {
      toast({ title: err.message || 'Error al registrar la Nota de Débito', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md dark:bg-slate-950 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-white">
            <FileWarning className="h-5 w-5 text-amber-500" />
            Nueva Nota de Débito
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            Cargo adicional al cliente — diferencia de precio, intereses, etc.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Cliente */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium dark:text-slate-300">Cliente *</Label>
            <ClienteSelector
              clientes={clientes}
              value={clienteId}
              onChange={setClienteId}
              onClienteCreado={c => { setClientes(p => [...p, c]); setClienteId(c.id); }}
            />
          </div>

          {/* Factura relacionada (opcional, aparece solo si hay cliente) */}
          {clienteId && (
            <div className="space-y-1.5">
              <Label className="text-sm font-medium dark:text-slate-300">Factura relacionada (opcional)</Label>
              <select
                value={comprobanteId}
                onChange={e => setComprobanteId(e.target.value)}
                className="w-full h-9 rounded-md border border-kx-border bg-transparent px-3 text-sm dark:bg-slate-900 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[rgb(var(--kx-violet))]"
              >
                <option value="">Sin factura asociada</option>
                {comprobantes.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.numero_venta} — ${Number(c.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Concepto */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium dark:text-slate-300">Concepto *</Label>
            <Textarea
              placeholder="Diferencia de precio, intereses por mora, cargo adicional..."
              value={concepto}
              onChange={e => setConcepto(e.target.value)}
              className="resize-none h-16 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200 text-sm"
            />
          </div>

          {/* Monto */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium dark:text-slate-300">Monto *</Label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={montoRaw}
              onChange={e => setMontoRaw(e.target.value)}
              className="dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
            />
            <p className="text-xs text-kx-text-3">Punto = separador de miles, coma = decimal (ej: 1.500,00)</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={onClose} disabled={saving}
            className="dark:border-slate-700 dark:text-slate-300">
            Cancelar
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 text-white"
          >
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Registrando...</>
              : <><FileWarning className="h-4 w-4 mr-2" />Registrar Nota de Débito</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default NuevaNotaDebitoModal;
