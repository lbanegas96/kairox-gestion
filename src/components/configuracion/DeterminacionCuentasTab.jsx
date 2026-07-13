import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Scale, Plus, Pencil, Trash2, Info, ArrowRight, Landmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { determinacionService, DET_KEYS } from '@/services/determinacionCuentasService';

const ORIGENES = [
  { v: '*', label: 'Cualquier origen' },
  { v: 'mercadopago', label: 'Mercado Pago' },
  { v: 'uala', label: 'Ualá' },
  { v: 'manual', label: 'Manual' },
  { v: 'csv', label: 'Importado CSV' },
];
const TIPOS = [
  { v: '*', label: 'Ingreso y Egreso' },
  { v: 'ingreso', label: 'Solo Ingreso' },
  { v: 'egreso', label: 'Solo Egreso' },
];

const label = (arr, v) => arr.find(x => x.v === v)?.label ?? v;

function ReglaModal({ open, onClose, regla, empresaId, cuentasContables, cuentasBancarias }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    origen: '*', tipo: '*', subtipo: '', cuenta_bancaria_id: '', cuenta_contable_id: '', prioridad: 100, descripcion: '',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      origen: regla?.origen ?? '*',
      tipo: regla?.tipo ?? '*',
      subtipo: regla?.subtipo ?? '',
      cuenta_bancaria_id: regla?.cuenta_bancaria_id ?? '',
      cuenta_contable_id: regla?.cuenta_contable_id ?? '',
      prioridad: regla?.prioridad ?? 100,
      descripcion: regla?.descripcion ?? '',
    });
  }, [open, regla]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        empresa_id: empresaId,
        origen: form.origen,
        tipo: form.tipo,
        subtipo: form.subtipo?.trim() || null,
        cuenta_bancaria_id: form.cuenta_bancaria_id || null,
        cuenta_contable_id: form.cuenta_contable_id,
        prioridad: Number(form.prioridad) || 100,
        descripcion: form.descripcion?.trim() || null,
      };
      if (regla) await determinacionService.update(regla.id, payload);
      else await determinacionService.create(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DET_KEYS.reglas(empresaId) });
      toast({ title: regla ? 'Regla actualizada' : 'Regla creada', className: 'bg-green-600 text-white' });
      onClose();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.cuenta_contable_id) {
      toast({ title: 'Seleccioná la cuenta contable de contrapartida', variant: 'destructive' });
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{regla ? 'Editar regla de determinación' : 'Nueva regla de determinación'}</DialogTitle>
          <DialogDescription>
            Definí qué cuenta contable imputa la contrapartida de un movimiento bancario según su origen y tipo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Origen del movimiento</Label>
              <Select value={form.origen} onValueChange={v => setForm(p => ({ ...p, origen: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{ORIGENES.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.tipo} onValueChange={v => setForm(p => ({ ...p, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TIPOS.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Subtipo <span className="text-kx-text-3 font-normal">(opcional)</span></Label>
              <Input value={form.subtipo} onChange={e => setForm(p => ({ ...p, subtipo: e.target.value }))}
                placeholder="ej. comision, transferencia, qr" />
              <p className="text-[11px] text-kx-text-3 mt-1">Vacío = aplica a cualquier subtipo.</p>
            </div>
            <div>
              <Label>Cuenta bancaria <span className="text-kx-text-3 font-normal">(opcional)</span></Label>
              <Select value={form.cuenta_bancaria_id || 'todas'} onValueChange={v => setForm(p => ({ ...p, cuenta_bancaria_id: v === 'todas' ? '' : v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las cuentas</SelectItem>
                  {cuentasBancarias.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Cuenta contable de contrapartida <span className="text-red-400">*</span></Label>
            <Select value={form.cuenta_contable_id} onValueChange={v => setForm(p => ({ ...p, cuenta_contable_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Seleccionar cuenta del plan…" /></SelectTrigger>
              <SelectContent>
                {cuentasContables.map(c => <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nombre}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-kx-text-3 mt-1">El lado del banco lo pone la cuenta contable vinculada a la cuenta bancaria.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Prioridad</Label>
              <Input type="number" value={form.prioridad} onChange={e => setForm(p => ({ ...p, prioridad: e.target.value }))} />
              <p className="text-[11px] text-kx-text-3 mt-1">Menor = se evalúa antes (ante empates).</p>
            </div>
            <div>
              <Label>Nota <span className="text-kx-text-3 font-normal">(opcional)</span></Label>
              <Input value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} placeholder="referencia interna" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Guardando…' : regla ? 'Guardar' : 'Crear regla'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeterminacionCuentasTab({ empresaId }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [modal, setModal] = useState({ open: false, regla: null });

  const { data: reglas = [], isLoading } = useQuery({
    queryKey: DET_KEYS.reglas(empresaId),
    queryFn: () => determinacionService.getAll(empresaId),
    enabled: !!empresaId,
  });

  const { data: cuentasContables = [] } = useQuery({
    queryKey: ['plan_cuentas_mov', empresaId],
    queryFn: async () => {
      const { data } = await supabase
        .from('plan_cuentas')
        .select('id, codigo, nombre, tipo')
        .eq('empresa_id', empresaId).eq('activa', true).eq('permite_movimientos', true)
        .order('codigo');
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: cuentasBancarias = [] } = useQuery({
    queryKey: ['cuentas_banc_det', empresaId],
    queryFn: async () => {
      const { data } = await supabase
        .from('cuentas_bancarias').select('id, nombre, plan_cuenta_id')
        .eq('empresa_id', empresaId).eq('activo', true).order('nombre');
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const delMut = useMutation({
    mutationFn: (id) => determinacionService.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: DET_KEYS.reglas(empresaId) });
      toast({ title: 'Regla eliminada' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const bancosSinCuenta = cuentasBancarias.filter(c => !c.plan_cuenta_id);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Encabezado explicativo */}
      <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center shrink-0">
            <Scale className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Determinación de Cuentas de Mayor</h3>
            <p className="text-sm text-kx-text-2 mt-1">
              Definí qué cuenta contable imputa cada movimiento bancario, para poder generar sus asientos
              automáticamente (inspirado en el <span className="font-medium">account determination</span> de SAP).
              El lado del banco sale de la cuenta contable vinculada a cada cuenta bancaria; acá se define
              la <span className="font-medium">contrapartida</span>.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2 text-xs text-kx-text-2 bg-kx-surface-2 border border-kx-border rounded-lg p-3">
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-kx-blue" />
          <span>
            Reglá de resolución: se elige la regla <b>más específica</b> que matchee (cuenta bancaria &gt; subtipo &gt;
            origen &gt; tipo). Creá una regla comodín (<Badge variant="outline" className="text-[10px]">Cualquier origen</Badge> +
            <Badge variant="outline" className="text-[10px] ml-1">Ingreso y Egreso</Badge>) apuntando a una cuenta
            <b> "a clasificar"</b> como red de seguridad.
          </span>
        </div>

        {bancosSinCuenta.length > 0 && (
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
            <Landmark className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Estas cuentas bancarias no tienen cuenta contable vinculada (no se podrán contabilizar hasta vincularlas
              en Bancos → Editar cuenta): <b>{bancosSinCuenta.map(c => c.nombre).join(', ')}</b>
            </span>
          </div>
        )}
      </div>

      {/* Tabla de reglas */}
      <div className="kairox-bg-card border kairox-border rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b kairox-border">
          <h4 className="font-semibold text-kx-text">Reglas ({reglas.length})</h4>
          <Button size="sm" onClick={() => setModal({ open: true, regla: null })}>
            <Plus className="w-4 h-4 mr-1" /> Nueva regla
          </Button>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-kx-text-3">Cargando…</div>
        ) : reglas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-2 text-kx-text-3">
            <Scale className="w-10 h-10 opacity-30" />
            <p className="text-sm font-medium">Sin reglas configuradas</p>
            <p className="text-xs text-center max-w-sm">Creá tu primera regla para poder contabilizar los movimientos de Bancos.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50/70 dark:bg-slate-800/50 border-b kairox-border">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-kx-text-2 uppercase">Cuándo (origen · tipo · subtipo · cuenta)</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-kx-text-2 uppercase">Imputa a</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-kx-text-2 uppercase">Prioridad</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-800">
                {reglas.map(r => (
                  <tr key={r.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className="text-[11px]">{label(ORIGENES, r.origen)}</Badge>
                        <Badge variant="outline" className="text-[11px]">{label(TIPOS, r.tipo)}</Badge>
                        {r.subtipo && <Badge variant="outline" className="text-[11px]">{r.subtipo}</Badge>}
                        {r.cuentas_bancarias?.nombre && <Badge variant="outline" className="text-[11px]">{r.cuentas_bancarias.nombre}</Badge>}
                      </div>
                      {r.descripcion && <p className="text-[11px] text-kx-text-3 mt-1">{r.descripcion}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-kx-text">
                        <ArrowRight className="w-3.5 h-3.5 text-kx-text-3" />
                        {r.plan_cuentas ? `${r.plan_cuentas.codigo} — ${r.plan_cuentas.nombre}` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-kx-text-2 tabular-nums">{r.prioridad}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setModal({ open: true, regla: r })}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600" onClick={() => delMut.mutate(r.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ReglaModal
        open={modal.open}
        onClose={() => setModal({ open: false, regla: null })}
        regla={modal.regla}
        empresaId={empresaId}
        cuentasContables={cuentasContables}
        cuentasBancarias={cuentasBancarias}
      />
    </div>
  );
}

export default DeterminacionCuentasTab;
