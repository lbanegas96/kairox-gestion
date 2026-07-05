import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { movimientosService, CB_KEYS } from '@/services/cuentasBancariasService';
import { getTodayAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function MovimientoModal({ open, onClose, cuentas, empresaId, defaultCuentaId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState({
    cuenta_bancaria_id: '',
    fecha: getTodayAR(),
    descripcion: '',
    monto: '',
    tipo: 'egreso',
  });

  React.useEffect(() => {
    if (open) {
      setForm(p => ({
        ...p,
        cuenta_bancaria_id: defaultCuentaId || (cuentas[0]?.id ?? ''),
        fecha: getTodayAR(),
        descripcion: '',
        monto: '',
        tipo: 'egreso',
      }));
    }
  }, [open, defaultCuentaId, cuentas]);

  const nombreUsuario = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.email || null;

  const mutation = useMutation({
    mutationFn: (data) => movimientosService.create({
      empresa_id: empresaId,
      cuenta_bancaria_id: data.cuenta_bancaria_id,
      fecha: `${data.fecha}T12:00:00`,
      descripcion: data.descripcion,
      monto: parseNumberLocale(data.monto),
      tipo: data.tipo,
      origen: 'manual',
      created_by: user?.id ?? null,             // audit trail — quién registró
      created_by_nombre: nombreUsuario,         // snapshot inmutable del nombre
    }),
    onSuccess: () => {
      // Invalidar usando solo el prefijo para que matchee con cualquier queryKey
      // que tenga filters aplicados (CB_KEYS.movimientos arma [..., empresaId, filters]).
      qc.invalidateQueries({ queryKey: ['movimientos_bancarios', empresaId] });
      qc.invalidateQueries({ queryKey: CB_KEYS.movimientosSaldo(empresaId) }); // FIX-SALDO-REAL
      toast({ title: 'Movimiento registrado', className: 'bg-green-600 text-white' });
      onClose();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    // Validar con mensajes claros en vez de fallar silencioso
    if (!form.cuenta_bancaria_id) {
      toast({ title: 'Seleccioná una cuenta bancaria', variant: 'destructive' });
      return;
    }
    if (!form.descripcion?.trim()) {
      toast({ title: 'Ingresá una descripción', variant: 'destructive' });
      return;
    }
    const monto = parseNumberLocale(form.monto);
    if (!monto || monto <= 0) {
      toast({ title: 'Ingresá un monto mayor a cero', variant: 'destructive' });
      return;
    }
    mutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuevo movimiento</DialogTitle>
          <DialogDescription>Registrá manualmente un ingreso o egreso bancario.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <Label>Cuenta bancaria *</Label>
            <Select value={form.cuenta_bancaria_id} onValueChange={v => setForm(p => ({ ...p, cuenta_bancaria_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar cuenta" /></SelectTrigger>
              <SelectContent>
                {cuentas.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre} — {c.banco}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} required />
            </div>
            <div>
              <Label>Tipo *</Label>
              <Select value={form.tipo} onValueChange={v => setForm(p => ({ ...p, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ingreso">Ingreso</SelectItem>
                  <SelectItem value="egreso">Egreso</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Descripción *</Label>
            <Input value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="ej: Transferencia a proveedor" required />
          </div>
          <div>
            <Label>Monto *</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={form.monto}
              onChange={e => {
                // Solo dígitos, coma y punto
                const v = e.target.value.replace(/[^\d.,]/g, '');
                setForm(p => ({ ...p, monto: v }));
              }}
              placeholder="ej. 500.000 ó 500.000,50"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando...' : 'Registrar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default MovimientoModal;
