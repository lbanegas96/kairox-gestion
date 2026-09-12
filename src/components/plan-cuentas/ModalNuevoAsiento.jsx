import { useState, useEffect } from 'react';
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
  // Hallazgo Luciano 11/09 (mismo patrón repetitivo, ver CONTEXT.md — 10/10,
  // el más sensible de los 10: esto es el asiento en sí, ni siquiera mostraba
  // las líneas Debe/Haber recién grabadas antes de cerrarse). `resultado`
  // reemplaza el formulario por las líneas confirmadas hasta que el usuario
  // cierra a propósito.
  const [resultado, setResultado] = useState(null);

  // Igual que Ajuste de Stock (ítem 3): sin esto, cerrar con Escape/click
  // afuera en vez del botón "Cerrar" dejaría `resultado` viejo mostrándose
  // la próxima vez que se abra el modal.
  useEffect(() => { if (!open) setResultado(null); }, [open]);

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
      await asientosService.createAsientoManual(empresaId, userId, form, items);
      toast({ title: 'Asiento creado', className: 'bg-green-900 border-green-700 text-white' });
      onSuccess();
      // No cierra el modal solo -- muestra las líneas Debe/Haber recién
      // grabadas hasta que el usuario cierra a propósito. Es el caso más
      // sensible de los 10: acá el resumen ES el asiento, no una referencia
      // a otro documento.
      setResultado({
        fecha: form.fecha,
        descripcion: form.descripcion,
        items: items.map((it) => {
          const cuenta = cuentasFlat.find((c) => c.id === it.cuenta_id);
          return { ...it, cuentaLabel: cuenta ? `${cuenta.codigo} — ${cuenta.nombre}` : it.cuenta_id };
        }),
      });
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
      <DialogContent className="bg-kx-surface border-kx-border text-kx-text max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <FileText size={18} className="text-kx-violet" /> Nuevo Asiento Contable
          </DialogTitle>
          <DialogDescription>
            {resultado ? 'Asiento confirmado. Estas son las líneas que quedaron registradas.' : 'Registrá un asiento manual con líneas de debe/haber balanceadas.'}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="py-2 space-y-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 shrink-0 text-kx-green" />
              <div>
                <p className="font-semibold text-kx-text">
                  Asiento del {resultado.fecha.split('-').reverse().join('/')} registrado
                </p>
                {resultado.descripcion && <p className="text-sm text-kx-text-3">{resultado.descripcion}</p>}
              </div>
            </div>
            <div className="rounded-lg border border-kx-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2">
                  <tr>
                    <th className="px-3 py-2 text-left text-kx-text-3 font-medium">Cuenta</th>
                    <th className="px-3 py-2 text-left text-kx-text-3 font-medium">Detalle</th>
                    <th className="px-3 py-2 text-right text-kx-text-3 font-medium w-28">Debe</th>
                    <th className="px-3 py-2 text-right text-kx-text-3 font-medium w-28">Haber</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.items.map((it, i) => (
                    <tr key={i} className="border-t border-kx-border">
                      <td className="px-3 py-1.5 text-xs text-kx-text">{it.cuentaLabel}</td>
                      <td className="px-3 py-1.5 text-xs text-kx-text-2">{it.descripcion || '—'}</td>
                      <td className="px-3 py-1.5 text-right text-xs font-mono text-kx-text">{it.debe > 0 ? fmt(it.debe) : '—'}</td>
                      <td className="px-3 py-1.5 text-right text-xs font-mono text-kx-text">{it.haber > 0 ? fmt(it.haber) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DialogFooter>
              <Button onClick={onClose} className="bg-kx-violet text-white hover:opacity-90 ml-auto">
                Cerrar
              </Button>
            </DialogFooter>
          </div>
        ) : (
        <>
        <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-kx-text-3 text-xs">Fecha *</Label>
              <Input type="date" value={form.fecha}
                onChange={(e) => setForm({ ...form, fecha: e.target.value })}
                className="bg-kx-surface-2 border-kx-border" />
            </div>
            <div className="space-y-1">
              <Label className="text-kx-text-3 text-xs">Descripción</Label>
              <Input value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
                className="bg-kx-surface-2 border-kx-border" placeholder="Concepto del asiento" />
            </div>
          </div>

          <div className="rounded-lg border border-kx-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-kx-surface-2">
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
                  <tr key={i} className="border-t border-kx-border">
                    <td className="px-2 py-1.5">
                      <select
                        value={l.cuenta_id}
                        onChange={(e) => updateLinea(i, 'cuenta_id', e.target.value)}
                        className="w-full bg-kx-surface-2 border border-kx-border rounded text-kx-text text-xs px-2 py-1.5 focus:outline-none focus:border-kx-violet"
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
                        className="bg-kx-surface-2 border-kx-border h-8 text-xs" placeholder="Detalle" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="text" inputMode="decimal" value={l.debe}
                        onChange={(e) => updateLinea(i, 'debe', e.target.value)}
                        className="bg-kx-surface-2 border-kx-border h-8 text-xs text-right" placeholder="0,00" />
                    </td>
                    <td className="px-2 py-1.5">
                      <Input type="text" inputMode="decimal" value={l.haber}
                        onChange={(e) => updateLinea(i, 'haber', e.target.value)}
                        className="bg-kx-surface-2 border-kx-border h-8 text-xs text-right" placeholder="0,00" />
                    </td>
                    <td className="px-1">
                      {lineas.length > 2 && (
                        <button onClick={() => setLineas((p) => p.filter((_, j) => j !== i))}
                          className="text-kx-text-2 hover:text-kx-red p-1">
                          <X size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-kx-surface-2/50">
                <tr>
                  <td colSpan={2} className="px-3 py-2">
                    <button onClick={() => setLineas((p) => [...p, emptyLinea()])}
                      className="text-kx-violet text-xs hover:underline flex items-center gap-1">
                      <Plus size={12} /> Agregar línea
                    </button>
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-mono font-bold ${cuadrado ? 'text-kx-green' : 'text-kx-text'}`}>
                    {fmt(totalDebe)}
                  </td>
                  <td className={`px-3 py-2 text-right text-xs font-mono font-bold ${cuadrado ? 'text-kx-green' : 'text-kx-text'}`}>
                    {fmt(totalHaber)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {!cuadrado && totalDebe > 0 && (
            <div className="flex items-center gap-2 text-xs text-kx-amber bg-kx-amber/10 border border-kx-amber/30 rounded-lg px-3 py-2">
              <AlertTriangle size={14} /> El asiento no cuadra — diferencia: {fmt(Math.abs(totalDebe - totalHaber))}
            </div>
          )}
          {cuadrado && (
            <div className="flex items-center gap-2 text-xs text-kx-green bg-kx-green/10 border border-kx-green/30 rounded-lg px-3 py-2">
              <CheckCircle2 size={14} /> El asiento cuadra correctamente
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-kx-text-3">Cancelar</Button>
          <Button onClick={handleSave} disabled={saving || !cuadrado}
            className="bg-kx-violet text-white hover:opacity-90">
            {saving ? <Loader2 size={14} className="animate-spin mr-2" /> : <Check size={14} className="mr-2" />}
            Crear Asiento
          </Button>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevoAsiento;
