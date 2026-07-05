import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { cuentasService, CB_KEYS } from '@/services/cuentasBancariasService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BANCOS_COMUNES } from './shared';

function CuentaModal({ open, onClose, cuenta, empresaId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [cuentasContables, setCuentasContables] = useState([]);
  const [form, setForm] = useState({
    nombre: '',
    banco: '',
    cbu_alias: '',
    moneda: 'ARS',
    plan_cuenta_id: '',
  });

  React.useEffect(() => {
    if (!open) return;
    setForm({
      nombre: cuenta?.nombre ?? '',
      banco: cuenta?.banco ?? '',
      cbu_alias: cuenta?.cbu_alias ?? '',
      moneda: cuenta?.moneda ?? 'ARS',
      plan_cuenta_id: cuenta?.plan_cuenta_id ?? '',
    });
    // Cargar cuentas contables de tipo activo para el selector
    // SECURITY-RLS-CROSS: RPC scoped id+codigo+nombre+tipo — Bancos no requiere permiso 'configuracion' (mig.135)
    supabase.rpc('listar_plan_cuentas_min')
      .then(({ data }) => setCuentasContables(
        (data ?? []).filter(pc => ['activo', 'patrimonioNeto'].includes(pc.tipo))
      ));
  }, [open, cuenta, empresaId]);

  const mutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        empresa_id: empresaId,
        nombre: data.nombre,
        banco: data.banco,
        cbu_alias: data.cbu_alias || null,
        moneda: data.moneda,
        plan_cuenta_id: data.plan_cuenta_id || null,
        activo: true,
      };
      if (cuenta) {
        await cuentasService.update(cuenta.id, payload);
      } else {
        await cuentasService.create(payload);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: CB_KEYS.cuentas(empresaId) });
      toast({ title: cuenta ? 'Cuenta actualizada' : 'Cuenta creada', className: 'bg-green-600 text-white' });
      onClose();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.nombre || !form.banco) return;
    mutation.mutate(form);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{cuenta ? 'Editar cuenta' : 'Nueva cuenta bancaria'}</DialogTitle>
          <DialogDescription>Completá los datos de la cuenta. El vínculo con el Plan de Cuentas permite generar asientos automáticos.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nombre de la cuenta *</Label>
              <Input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="ej: Ualá Personal, Galicia Cta. Cte." required />
            </div>
            <div className="col-span-2">
              <Label>Banco *</Label>
              <Select value={form.banco} onValueChange={v => setForm(p => ({ ...p, banco: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar banco" /></SelectTrigger>
                <SelectContent>
                  {BANCOS_COMUNES.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.banco === 'Otro' && (
                <Input className="mt-2" placeholder="Nombre del banco" onChange={e => setForm(p => ({ ...p, banco: e.target.value }))} />
              )}
            </div>
            <div>
              <Label>CBU / Alias</Label>
              <Input value={form.cbu_alias} onChange={e => setForm(p => ({ ...p, cbu_alias: e.target.value }))} placeholder="opcional" />
            </div>
            <div>
              <Label>Moneda</Label>
              <Select value={form.moneda} onValueChange={v => setForm(p => ({ ...p, moneda: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS (Pesos)</SelectItem>
                  <SelectItem value="USD">USD (Dólares)</SelectItem>
                  <SelectItem value="EUR">EUR (Euros)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Cuenta contable (Plan de Cuentas)</Label>
            <Select value={form.plan_cuenta_id || 'none'} onValueChange={v => setForm(p => ({ ...p, plan_cuenta_id: v === 'none' ? '' : v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Sin vincular" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin vincular</SelectItem>
                {cuentasContables.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-kx-text-3 mt-1">Vinculá esta cuenta bancaria a su cuenta contable para asientos automáticos (próximamente).</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Guardando...' : cuenta ? 'Guardar cambios' : 'Crear cuenta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default CuentaModal;
