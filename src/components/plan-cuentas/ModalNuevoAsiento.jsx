import React, { useState } from 'react';
import { Plus, Check, X, AlertTriangle, FileText, Loader2, CheckCircle2 } from 'lucide-react';
import { asientosService } from '@/services/planCuentasService';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { fmt } from './shared';

function ModalNuevoAsiento({ open, onClose, cuentasFlat, empresaId, userId, onSuccess }) {
  const emptyLinea = () => ({ cuenta_id: '', descripcion: '', debe: '', haber: '' });
  const [form, setForm] = useState({ fecha: new Date().toISOString().slice(0, 10), descripcion: '' });
  const [lineas, setLineas] = useState([emptyLinea(), emptyLinea()]);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const totalDebe  = lineas.reduce((s, l) => s + (parseNumberLocale(l.debe)  || 0), 0);
  const totalHaber = lineas.reduce((s, l) => s + (parseNumberLocale(l.haber) || 0), 0);
  const cuadrado   = Math.abs(totalDebe - totalHaber) < 0.001 && totalDebe > 0;

  const updateLinea = (i, field, value) => {
    setLineas((prev) => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  };

  const handleSave = async () => {
    if (!form.fecha) { toast({ title: 'Fecha requerida', variant: 'destructive' }); return; }
    if (!cuadrado) { toast({ title: 'El asiento no cuadra (Debe ≠ Haber)', variant: 'destructive' }); return; }
    const items = lineas.filter((l) => l.cuenta_id).map((l) => ({
      cuenta_id: l.cuenta_id,
      descripcion: l.descripcion || null,
      debe: parseNumberLocale(l.debe) || 0,
      haber: parseNumberLocale(l.haber) || 0,
    }));
    if (items.length < 2) { toast({ title: 'Mínimo 2 líneas con cuenta', variant: 'destructive' }); return; }

    setSaving(true);
    try {
      await asientosService.createAsiento(empresaId, userId, form, items);
      toast({ title: 'Asiento creado', className: 'bg-green-900 border-green-700 text-white' });
      onSuccess();
      onClose();
      setForm({ fecha: new Date().toISOString().slice(0, 10), descripcion: '' });
      setLineas([emptyLinea(), emptyLinea()]);
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const movibles = cuentasFlat.filter((c) => c.permite_movimientos && c.activa);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <FileText size={18} className="text-[#00D4FF]" /> Nuevo Asiento Contable
          </DialogTitle>
          <DialogDescription>Registrá un asiento manual con líneas de debe/haber balanceadas.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-kx-text-3 text-xs">Fecha *</Label>
              <Input type="date" value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                className="bg-slate-800 border-slate-700" />
            </div>
            <div className="space-y-1">
              <Label className="text-kx-text-3 text-xs">Descripción</Label>
              <Input value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                className="bg-slate-800 border-slate-700" placeholder="Concepto del asiento" />
            </div>
          </div>

          <div className="rounded-lg border border-slate-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-800">
                <tr>
                  <th className="px-3 py-2 text-left text-kx-text-3 font-medium">Cuenta</th>
                  <th className="px-3 py-2 text-left text-kx-text-3 font-medium">Detalle</th>
                  <th className="px-3 py-2 text-right text-kx-text-3 font-medium w-28">Debe</th>
                  <th className="px-3 py-2 text-right text-kx-text-3 font-medium w-28">Haber</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={i} className="border-t border-slate-800">
                    <td className="px-2 py-1.5">
                      <select
                        value={l.cuenta_id}
                        onChange={(e) => updateLinea(i, 'cuenta_id', e.target.value)}
                        className="w-full bg-slate-800 border border-slate-700 rounded text-white text-xs px-2 py-1.5 focus:outline-none focus:border-[#00D4FF]"
                      >
                        <option value="">— Seleccionar —</option>
                        {movibles.map((c) => (
                          <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input value={l.descripcion}
                        onChange={(e) => updateLinea(i, 'descripcion', e.target.value)}
                        className="bg-slate-800 border-slate-700 h-8 text-xs" placeholder="Detalle" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="text" inputMode="decimal" value={l.debe}
                        onChange={(e) => updateLinea(i, 'debe', e.target.value)}
                        className="bg-slate-800 border-slate-700 h-8 text-xs text-right" placeholder="0,00" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="text" inputMode="decimal" value={l.haber}
                        onChange={(e) => updateLinea(i, 'haber', e.target.value)}
                        className="bg-slate-800 border-slate-700 h-8 text-xs text-right" placeholder="0,00" />
                    </td>
                    <td className="px-1">
                      {lineas.length > 2 && (
                        <button onClick={() => setLineas((p) => p.filter((_, j) => j !== i))}
                          className="text-slate-500 hover:text-red-400 p-1">
                          <X size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-800/50">
                <tr>
                  <td colSpan={2} className="px-3 py-2">
                    <button onClick={() => setLineas((p) => [...p, emptyLinea()])}
                      className="text-[#00D4FF] text-xs hover:underline flex items-center gap-1">
                      <Plus size={12} /> Agregar línea
                    </button>
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-mono font-bold ${cuadrado ? 'text-green-400' : 'text-white'}`}>
                    {fmt(totalDebe)}
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-mono font-bold ${cuadrado ? 'text-green-400' : 'text-white'}`}>
                    {fmt(totalHaber)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {!cuadrado && totalDebe > 0 && (
            <div className="flex items-center gap-2 text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 rounded-lg px-3 py-2">
              <AlertTriangle size={14} /> El asiento no cuadra — diferencia: {fmt(Math.abs(totalDebe - totalHaber))}
            </div>
          )}
          {cuadrado && (
            <div className="flex items-center gap-2 text-xs text-green-400 bg-green-400/10 border border-green-400/30 rounded-lg px-3 py-2">
              <CheckCircle2 size={14} /> El asiento cuadra correctamente
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-kx-text-3">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !cuadrado}
            className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
            {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Check size={14} className="mr-2" />}
            Crear Asiento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevoAsiento;
