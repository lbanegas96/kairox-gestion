import React, { useState } from 'react';
import { Plus, Check, Loader2 } from 'lucide-react';
import { planCuentasService } from '@/services/planCuentasService';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TIPO_LABEL } from './shared';

function ModalNuevaCuenta({ open, onClose, cuentasFlat, empresaId, onSuccess }) {
  const [form, setForm] = useState({
    codigo: '', nombre: '', tipo: 'activo',
    cuenta_padre_id: '', nivel: 1, permite_movimientos: true, activa: true,
  });
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!form.codigo || !form.nombre) {
      toast({ title: 'Completá código y nombre', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const padre = cuentasFlat.find((c) => c.id === form.cuenta_padre_id);
      await planCuentasService.createCuenta(empresaId, {
        ...form,
        nivel: padre ? padre.nivel + 1 : 1,
        cuenta_padre_id: form.cuenta_padre_id || null,
        tipo: padre ? padre.tipo : form.tipo,
      });
      toast({ title: 'Cuenta creada', className: 'bg-green-900 border-green-700 text-white' });
      onSuccess();
      onClose();
      setForm({ codigo: '', nombre: '', tipo: 'activo', cuenta_padre_id: '', nivel: 1, permite_movimientos: true, activa: true });
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const padre = cuentasFlat.find((c) => c.id === form.cuenta_padre_id);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Plus size={18} className="text-[#00D4FF]" /> Nueva Cuenta
          </DialogTitle>
          <DialogDescription>Creá una nueva cuenta contable dentro del plan.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-kx-text-3 text-xs">Código *</Label>
              <Input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })}
                className="bg-slate-800 border-slate-700" placeholder="ej: 1.1.6" />
            </div>
            <div className="space-y-1">
              <Label className="text-kx-text-3 text-xs">Tipo *</Label>
              <Select value={padre ? padre.tipo : form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v })} disabled={!!padre}>
                <SelectTrigger className="bg-slate-800 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {Object.entries(TIPO_LABEL).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-kx-text-3 text-xs">Nombre *</Label>
            <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              className="bg-slate-800 border-slate-700" placeholder="Nombre de la cuenta" />
          </div>

          <div className="space-y-1">
            <Label className="text-kx-text-3 text-xs">Cuenta padre (opcional)</Label>
            {/* Radix no permite SelectItem con value="" — usamos sentinel "__none__"
                y lo convertimos a null al setear el form. */}
            <Select
              value={form.cuenta_padre_id || '__none__'}
              onValueChange={(v) => setForm({ ...form, cuenta_padre_id: v === '__none__' ? null : v })}
            >
              <SelectTrigger className="bg-slate-800 border-slate-700">
                <SelectValue placeholder="Sin padre (cuenta raíz)" />
              </SelectTrigger>
              {/* position="popper" → se ancla al trigger en vez de tratar de alinear el item
                  seleccionado (default "item-aligned"), que clippea items arriba/abajo.
                  max-h-[400px] para que entren muchos items sin scroll automático. */}
              <SelectContent
                position="popper"
                sideOffset={4}
                className="bg-slate-800 border-slate-700 max-h-[400px] overflow-y-auto w-[var(--radix-select-trigger-width)]"
              >
                <SelectItem value="__none__">Sin padre (raíz)</SelectItem>
                {cuentasFlat.filter((c) => !c.permite_movimientos || c.nivel < 3).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.codigo} — {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.permite_movimientos}
                onChange={(e) => setForm({ ...form, permite_movimientos: e.target.checked })}
                className="w-4 h-4 rounded" />
              <span className="text-sm text-slate-300">Permite movimientos</span>
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-kx-text-3">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}
            className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
            {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Check size={14} className="mr-2" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevaCuenta;
