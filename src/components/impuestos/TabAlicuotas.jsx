import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Power, Sparkles, Percent, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR, formatDateAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';

export const PROVINCIAS_AR = [
  'Córdoba', 'Buenos Aires', 'CABA', 'Santa Fe', 'Mendoza',
  'Tucumán', 'Entre Ríos', 'Salta', 'Chaco', 'Corrientes',
  'Misiones', 'Santiago del Estero', 'San Juan', 'Jujuy',
  'Río Negro', 'Neuquén', 'Formosa', 'Chubut', 'San Luis',
  'Catamarca', 'La Rioja', 'La Pampa', 'Santa Cruz', 'Tierra del Fuego',
  'Nacional',
];

const ALICUOTAS_SUGERIDAS_CORDOBA = [
  { impuesto: 'IIBB',      jurisdiccion: 'Córdoba',  alicuota: 3.0, concepto: 'Régimen general - Comercio' },
  { impuesto: 'Ganancias', jurisdiccion: 'Nacional', alicuota: 2.0, concepto: 'Retención RG 830 - Régimen general' },
];

const IMPUESTOS = ['IIBB', 'Ganancias', 'SUSS', 'Otro'];

const emptyForm = {
  id: null,
  impuesto: 'IIBB',
  jurisdiccion: 'Córdoba',
  alicuota: '',
  concepto: '',
  vigencia_desde: getTodayAR(),
  vigencia_hasta: '',
};

function TabAlicuotas() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [alicuotas, setAlicuotas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchAlicuotas = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('alicuotas_impuestos')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .order('impuesto')
      .order('jurisdiccion');
    if (!error) setAlicuotas(data ?? []);
    setLoading(false);
  }, [user?.empresa_id]);

  useEffect(() => { fetchAlicuotas(); }, [fetchAlicuotas]);

  const sinDatos = !loading && alicuotas.length === 0;

  const cargarSugeridas = async () => {
    const rows = ALICUOTAS_SUGERIDAS_CORDOBA.map(a => ({
      empresa_id: user.empresa_id,
      impuesto: a.impuesto,
      jurisdiccion: a.jurisdiccion,
      alicuota: a.alicuota,
      concepto: a.concepto,
      fuente: 'manual',
    }));
    const { error } = await supabase.from('alicuotas_impuestos').insert(rows);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Alícuotas cargadas', description: 'Podés editarlas o borrarlas según tu situación.' });
    fetchAlicuotas();
  };

  const abrirNueva = () => { setForm({ ...emptyForm, vigencia_desde: getTodayAR() }); setModalOpen(true); };
  const abrirEditar = (a) => {
    setForm({
      id: a.id,
      impuesto: a.impuesto,
      jurisdiccion: a.jurisdiccion,
      alicuota: String(a.alicuota),
      concepto: a.concepto ?? '',
      vigencia_desde: a.vigencia_desde,
      vigencia_hasta: a.vigencia_hasta ?? '',
    });
    setModalOpen(true);
  };

  const rangoInvalido = !!(form.vigencia_hasta && form.vigencia_desde && form.vigencia_hasta < form.vigencia_desde);

  const guardar = async () => {
    const alicuotaNum = parseNumberLocale(form.alicuota);
    if (!form.jurisdiccion.trim() || !alicuotaNum || alicuotaNum <= 0) {
      toast({ title: 'Datos incompletos', description: 'Jurisdicción y alícuota (> 0) son obligatorios.', variant: 'destructive' });
      return;
    }
    if (rangoInvalido) {
      toast({ title: 'Rango de vigencia inválido', description: 'La fecha de fin no puede ser anterior a la fecha de inicio.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      empresa_id: user.empresa_id,
      impuesto: form.impuesto,
      jurisdiccion: form.jurisdiccion.trim(),
      alicuota: alicuotaNum,
      concepto: form.concepto.trim() || null,
      vigencia_desde: form.vigencia_desde,
      vigencia_hasta: form.vigencia_hasta || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (form.id) {
      ({ error } = await supabase.from('alicuotas_impuestos').update(payload).eq('id', form.id));
    } else {
      ({ error } = await supabase.from('alicuotas_impuestos').insert(payload));
    }
    setSaving(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: form.id ? 'Alícuota actualizada' : 'Alícuota creada' });
    setModalOpen(false);
    fetchAlicuotas();
  };

  const toggleActivo = async (a) => {
    const { error } = await supabase
      .from('alicuotas_impuestos')
      .update({ activo: !a.activo, updated_at: new Date().toISOString() })
      .eq('id', a.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    fetchAlicuotas();
  };

  const fuenteBadge = (fuente) => {
    if (fuente === 'manual')
      return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300">Manual</span>;
    return <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
      {fuente === 'padron_arba' ? 'Padrón ARBA' : 'Padrón AGIP'}
    </span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Alícuotas de impuestos</h3>
          <p className="text-sm text-slate-500 dark:text-kx-text-2">IIBB, Ganancias y otros — usadas para calcular retenciones a proveedores.</p>
        </div>
        <Button onClick={abrirNueva} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-1.5" /> Nueva alícuota
        </Button>
      </div>

      {sinDatos && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-center justify-between gap-4">
          <div className="flex items-start gap-2">
            <Sparkles className="h-5 w-5 text-kx-amber flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">No tenés alícuotas cargadas</p>
              <p className="text-xs text-amber-700 dark:text-amber-400">Podés empezar con un set sugerido para Córdoba y editarlo después.</p>
            </div>
          </div>
          <Button variant="outline" onClick={cargarSugeridas} className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300 whitespace-nowrap">
            Cargar alícuotas sugeridas de Córdoba
          </Button>
        </div>
      )}

      <div className="bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border dark:border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
              <tr>
                <th className="p-4">Impuesto</th>
                <th className="p-4">Jurisdicción</th>
                <th className="p-4 text-right">Alícuota %</th>
                <th className="p-4">Concepto</th>
                <th className="p-4">Vigencia</th>
                <th className="p-4 text-center">Fuente</th>
                <th className="p-4 text-center">Activo</th>
                <th className="p-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={8} className="p-8 text-center text-kx-text-3"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></td></tr>
              ) : alicuotas.length === 0 ? (
                <tr><td colSpan={8} className="p-10 text-center text-slate-500 dark:text-kx-text-2">
                  <Percent className="h-8 w-8 mx-auto mb-2 opacity-20" />Sin alícuotas cargadas
                </td></tr>
              ) : (
                alicuotas.map(a => (
                  <tr key={a.id} className={`hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors ${!a.activo ? 'opacity-50' : ''}`}>
                    <td className="p-4 font-semibold text-kx-text dark:text-kx-text">{a.impuesto}</td>
                    <td className="p-4 text-kx-text-2 dark:text-slate-300">{a.jurisdiccion}</td>
                    <td className="p-4 text-right font-mono font-bold text-blue-600 dark:text-blue-400">{Number(a.alicuota)}%</td>
                    <td className="p-4 text-xs text-slate-500 dark:text-kx-text-2">{a.concepto || '—'}</td>
                    <td className="p-4 text-xs text-slate-500 dark:text-kx-text-2">
                      {formatDateAR(a.vigencia_desde)}{a.vigencia_hasta ? ` → ${formatDateAR(a.vigencia_hasta)}` : ''}
                    </td>
                    <td className="p-4 text-center">{fuenteBadge(a.fuente)}</td>
                    <td className="p-4 text-center">
                      {(() => {
                        if (!a.activo) {
                          return <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Inactiva</span>;
                        }
                        const hoy = getTodayAR();
                        const vencida = a.vigencia_hasta && a.vigencia_hasta < hoy;
                        if (vencida) {
                          return <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" title={`Vigencia terminó el ${formatDateAR(a.vigencia_hasta)}`}>Vencida</span>;
                        }
                        return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Activa</span>;
                      })()}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEditar(a)}>
                          <Pencil className="h-4 w-4 text-kx-text-2" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleActivo(a)} title={a.activo ? 'Desactivar' : 'Activar'}>
                          <Power className={`h-4 w-4 ${a.activo ? 'text-kx-red' : 'text-kx-green'}`} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
        <p className="text-sm text-blue-800 dark:text-blue-400">
          💡 Estas alícuotas se usan para calcular automáticamente las retenciones al pagar a proveedores.
          Próximamente: actualización automática desde el padrón de ARBA.
        </p>
      </div>

      {/* Modal nueva/editar alícuota */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar alícuota' : 'Nueva alícuota'}</DialogTitle>
            <DialogDescription>Definí el porcentaje del impuesto por jurisdicción.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Impuesto</Label>
                <Select value={form.impuesto} onValueChange={v => setForm(f => ({ ...f, impuesto: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IMPUESTOS.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alícuota %</Label>
                <Input value={form.alicuota} onChange={e => setForm(f => ({ ...f, alicuota: e.target.value }))}
                  inputMode="decimal" placeholder="3,00" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Jurisdicción</Label>
              <Input value={form.jurisdiccion} onChange={e => setForm(f => ({ ...f, jurisdiccion: e.target.value }))}
                list="provincias-ar" placeholder="Córdoba" />
              <datalist id="provincias-ar">
                {PROVINCIAS_AR.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Concepto (opcional)</Label>
              <Textarea value={form.concepto} onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))}
                rows={2} placeholder="Régimen general - Comercio" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Vigencia desde</Label>
                <Input type="date" value={form.vigencia_desde} onChange={e => setForm(f => ({ ...f, vigencia_desde: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vigencia hasta (opcional)</Label>
                <Input type="date" value={form.vigencia_hasta} onChange={e => setForm(f => ({ ...f, vigencia_hasta: e.target.value }))}
                  className={rangoInvalido ? 'border-red-500 focus-visible:ring-red-500' : ''} />
              </div>
            </div>
            {rangoInvalido && (
              <p className="text-xs text-red-600 dark:text-red-400">
                La fecha de fin no puede ser anterior a la fecha de inicio.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving || rangoInvalido} className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : (form.id ? 'Guardar' : 'Crear')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TabAlicuotas;
