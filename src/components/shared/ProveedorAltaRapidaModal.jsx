import React, { useState } from 'react';
import { Truck, Loader2, Check } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';

function ProveedorAltaRapidaModal({ isOpen, onClose, onCreated }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ nombre: '', cuit: '', telefono: '', condicion_iva: 'responsable_inscripto' });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.nombre.trim()) {
      toast({ title: 'El nombre es obligatorio', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('proveedores')
        .insert([{
          empresa_id:    user.empresa_id,
          nombre:        form.nombre.trim(),
          cuit:          form.cuit.trim() || null,
          telefono:      form.telefono.trim() || null,
          condicion_iva: form.condicion_iva,
          activo:        true,
        }])
        .select()
        .single();
      if (error) throw error;
      toast({ title: `Proveedor "${data.nombre}" creado` });
      onCreated(data);
      onClose();
      setForm({ nombre: '', cuit: '', telefono: '', condicion_iva: 'responsable_inscripto' });
    } catch (err) {
      toast({ title: 'Error al crear proveedor', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm dark:bg-slate-950 dark:border-slate-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 dark:text-white">
            <Truck className="h-5 w-5 text-[rgb(var(--kx-violet))]" />
            Alta Rápida de Proveedor
          </DialogTitle>
          <DialogDescription className="dark:text-slate-400">
            Solo el nombre es requerido. Podés completar los datos después.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="dark:text-white">
              Nombre / Razón Social <span className="text-kx-red">*</span>
            </Label>
            <Input
              autoFocus
              placeholder="Ej: Distribuidora ABC S.A."
              value={form.nombre}
              onChange={e => set('nombre', e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              className="dark:bg-slate-900 dark:border-slate-700 dark:text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="dark:text-white">CUIT</Label>
              <Input
                placeholder="30-12345678-9"
                value={form.cuit}
                onChange={e => set('cuit', e.target.value)}
                className="dark:bg-slate-900 dark:border-slate-700 dark:text-white"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="dark:text-white">Teléfono</Label>
              <Input
                placeholder="+54 11..."
                value={form.telefono}
                onChange={e => set('telefono', e.target.value)}
                className="dark:bg-slate-900 dark:border-slate-700 dark:text-white"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="dark:text-white">Condición IVA</Label>
            <select
              value={form.condicion_iva}
              onChange={e => set('condicion_iva', e.target.value)}
              className="w-full h-10 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white px-3 text-sm"
            >
              <option value="responsable_inscripto">Responsable Inscripto</option>
              <option value="monotributista">Monotributista</option>
              <option value="exento">Exento</option>
              <option value="consumidor_final">Consumidor Final</option>
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="dark:text-white dark:border-slate-700">
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white"
          >
            {saving
              ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              : <Check className="h-4 w-4 mr-2" />
            }
            Crear proveedor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProveedorAltaRapidaModal;
