import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Landmark, Save, Loader2, Plus, Pencil, Power, RefreshCw, MapPin,
  Calculator, CheckCircle2, AlertTriangle, History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR, formatDateAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import { PROVINCIAS_AR } from '@/components/impuestos/TabAlicuotas';

const fmtARS = (n) =>
  `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const emptyCoefForm = {
  id: null,
  jurisdiccion: 'Córdoba',
  coeficiente: '',
  vigencia_desde: getTodayAR(),
  vigencia_hasta: '',
};

function TabIIBB() {
  const { user } = useAuth();
  const { toast } = useToast();

  const todayStr = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  // ── Configuración: modalidad + jurisdicción ─────────────────────────────────
  const [config, setConfig] = useState({ modalidad_iibb: 'jurisdiccion_unica', jurisdiccion_iibb: '' });
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoadingConfig(true);
    const { data } = await supabase
      .from('empresas')
      .select('modalidad_iibb, jurisdiccion_iibb')
      .eq('id', user.empresa_id)
      .single();
    if (data) setConfig({ modalidad_iibb: data.modalidad_iibb ?? 'jurisdiccion_unica', jurisdiccion_iibb: data.jurisdiccion_iibb ?? '' });
    setLoadingConfig(false);
  }, [user?.empresa_id]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const guardarConfig = async () => {
    if (config.modalidad_iibb === 'jurisdiccion_unica' && !config.jurisdiccion_iibb.trim()) {
      toast({ title: 'Falta la jurisdicción', description: 'Elegí en qué provincia tributa IIBB.', variant: 'destructive' });
      return;
    }
    setSavingConfig(true);
    const { error } = await supabase
      .from('empresas')
      .update({
        modalidad_iibb: config.modalidad_iibb,
        jurisdiccion_iibb: config.modalidad_iibb === 'jurisdiccion_unica' ? config.jurisdiccion_iibb.trim() : null,
      })
      .eq('id', user.empresa_id);
    setSavingConfig(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Configuración guardada' });
  };

  // ── Coeficientes de Convenio Multilateral ───────────────────────────────────
  const [coeficientes, setCoeficientes] = useState([]);
  const [loadingCoef, setLoadingCoef] = useState(true);
  const [modalCoefOpen, setModalCoefOpen] = useState(false);
  const [coefForm, setCoefForm] = useState(emptyCoefForm);
  const [savingCoef, setSavingCoef] = useState(false);

  const fetchCoeficientes = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoadingCoef(true);
    const { data } = await supabase
      .from('iibb_coeficientes')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .order('jurisdiccion');
    setCoeficientes(data ?? []);
    setLoadingCoef(false);
  }, [user?.empresa_id]);

  useEffect(() => {
    if (config.modalidad_iibb === 'convenio_multilateral') fetchCoeficientes();
  }, [config.modalidad_iibb, fetchCoeficientes]);

  const sumaCoeficientesActivos = useMemo(() => {
    const hoy = getTodayAR();
    return coeficientes
      .filter(c => c.activo && c.vigencia_desde <= hoy && (!c.vigencia_hasta || c.vigencia_hasta >= hoy))
      .reduce((s, c) => s + Number(c.coeficiente), 0);
  }, [coeficientes]);

  const abrirNuevoCoef = () => { setCoefForm({ ...emptyCoefForm, vigencia_desde: getTodayAR() }); setModalCoefOpen(true); };
  const abrirEditarCoef = (c) => {
    setCoefForm({
      id: c.id, jurisdiccion: c.jurisdiccion, coeficiente: String(c.coeficiente),
      vigencia_desde: c.vigencia_desde, vigencia_hasta: c.vigencia_hasta ?? '',
    });
    setModalCoefOpen(true);
  };

  const guardarCoef = async () => {
    const coefNum = parseNumberLocale(coefForm.coeficiente);
    if (!coefForm.jurisdiccion.trim() || !coefNum || coefNum <= 0 || coefNum > 100) {
      toast({ title: 'Datos incompletos', description: 'Jurisdicción y coeficiente (0 a 100) son obligatorios.', variant: 'destructive' });
      return;
    }
    setSavingCoef(true);
    const payload = {
      empresa_id: user.empresa_id,
      jurisdiccion: coefForm.jurisdiccion.trim(),
      coeficiente: coefNum,
      vigencia_desde: coefForm.vigencia_desde,
      vigencia_hasta: coefForm.vigencia_hasta || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (coefForm.id) {
      ({ error } = await supabase.from('iibb_coeficientes').update(payload).eq('id', coefForm.id));
    } else {
      ({ error } = await supabase.from('iibb_coeficientes').insert(payload));
    }
    setSavingCoef(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: coefForm.id ? 'Coeficiente actualizado' : 'Coeficiente creado' });
    setModalCoefOpen(false);
    fetchCoeficientes();
  };

  const toggleActivoCoef = async (c) => {
    const { error } = await supabase
      .from('iibb_coeficientes')
      .update({ activo: !c.activo, updated_at: new Date().toISOString() })
      .eq('id', c.id);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    fetchCoeficientes();
  };

  // ── Liquidación del período ──────────────────────────────────────────────────
  const [periodoDesde, setPeriodoDesde] = useState(firstOfMonthStr);
  const [periodoHasta, setPeriodoHasta] = useState(todayStr);
  const [liquidacionActual, setLiquidacionActual] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);

  const [historial, setHistorial] = useState([]);
  const [loadingHistorial, setLoadingHistorial] = useState(true);

  const fetchHistorial = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoadingHistorial(true);
    const { data } = await supabase
      .from('iibb_liquidaciones')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .order('periodo_desde', { ascending: false })
      .limit(12);
    setHistorial(data ?? []);
    setLoadingHistorial(false);
  }, [user?.empresa_id]);

  useEffect(() => { fetchHistorial(); }, [fetchHistorial]);

  const generarLiquidacion = async () => {
    setGenerando(true);
    setLiquidacionActual(null);
    const { data, error } = await supabase.rpc('generar_liquidacion_iibb', {
      p_empresa_id: user.empresa_id,
      p_user_id: user.id,
      p_periodo_desde: periodoDesde,
      p_periodo_hasta: periodoHasta,
    });
    setGenerando(false);
    if (error) {
      toast({ title: 'No se pudo generar la liquidación', description: error.message, variant: 'destructive' });
      return;
    }
    setLiquidacionActual(data);
    fetchHistorial();
  };

  const confirmarLiquidacion = async (id) => {
    setConfirmando(true);
    const { data, error } = await supabase.rpc('confirmar_liquidacion_iibb', {
      p_empresa_id: user.empresa_id,
      p_user_id: user.id,
      p_liquidacion_id: id,
    });
    setConfirmando(false);
    if (error) {
      toast({ title: 'No se pudo confirmar', description: error.message, variant: 'destructive' });
      return;
    }
    if (data?.asiento_generado === false) {
      toast({
        title: 'Liquidación confirmada sin asiento contable',
        description: 'Se guardó la confirmación, pero no se generó el asiento (período cerrado o cuenta contable faltante). Revisar Plan de Cuentas.',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Liquidación confirmada', description: 'Se generó el asiento contable.' });
    }
    setLiquidacionActual(null);
    fetchHistorial();
  };

  return (
    <div className="space-y-6">
      {/* ── Configuración ── */}
      <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg mt-0.5">
            <Landmark className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Configuración de IIBB</h3>
            <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-0.5">
              Definí cómo tributa Ingresos Brutos esta empresa.
            </p>
          </div>
        </div>

        {loadingConfig ? (
          <div className="flex items-center gap-2 text-kx-text-3 py-4">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando configuración...
          </div>
        ) : (
          <div className="space-y-4 max-w-lg">
            <div className="space-y-1">
              <Label className="text-xs">Modalidad</Label>
              <Select value={config.modalidad_iibb} onValueChange={v => setConfig(c => ({ ...c, modalidad_iibb: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="jurisdiccion_unica">Jurisdicción única</SelectItem>
                  <SelectItem value="convenio_multilateral">Convenio Multilateral</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {config.modalidad_iibb === 'jurisdiccion_unica' ? (
              <div className="space-y-1">
                <Label className="text-xs">Jurisdicción (provincia)</Label>
                <Input value={config.jurisdiccion_iibb} onChange={e => setConfig(c => ({ ...c, jurisdiccion_iibb: e.target.value }))}
                  list="provincias-ar-iibb" placeholder="Córdoba" />
                <datalist id="provincias-ar-iibb">
                  {PROVINCIAS_AR.map(p => <option key={p} value={p} />)}
                </datalist>
                <p className="text-xs text-kx-text-3">
                  La alícuota de IIBB de esta jurisdicción se toma de la tabla de Alícuotas.
                </p>
              </div>
            ) : (
              <p className="text-xs text-kx-text-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                Cargá los coeficientes de distribución por jurisdicción abajo (los determina el contador vía DDJJ CM05 — el sistema solo los aplica).
              </p>
            )}

            <Button onClick={guardarConfig} disabled={savingConfig} className="bg-blue-600 hover:bg-blue-700 text-white">
              {savingConfig ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando...</> : <><Save className="mr-2 h-4 w-4" /> Guardar configuración</>}
            </Button>
          </div>
        )}
      </div>

      {/* ── Coeficientes de Convenio Multilateral ── */}
      {config.modalidad_iibb === 'convenio_multilateral' && (
        <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-kx-text-3" />
              <h3 className="font-semibold text-kx-text">Coeficientes de distribución</h3>
            </div>
            <Button size="sm" onClick={abrirNuevoCoef}>
              <Plus className="h-4 w-4 mr-1.5" /> Nuevo coeficiente
            </Button>
          </div>

          <div className={`flex items-center gap-2 text-sm rounded-lg p-3 mb-4 border ${
            Math.abs(sumaCoeficientesActivos - 100) > 0.01
              ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
              : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
          }`}>
            {Math.abs(sumaCoeficientesActivos - 100) > 0.01 ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            Coeficientes vigentes hoy suman <strong className="mx-1">{sumaCoeficientesActivos.toFixed(2)}%</strong>
            {Math.abs(sumaCoeficientesActivos - 100) > 0.01 ? '— deberían sumar 100% antes de liquidar.' : '— listo para liquidar.'}
          </div>

          {loadingCoef ? (
            <div className="flex items-center gap-2 text-kx-text-3 py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
            </div>
          ) : coeficientes.length === 0 ? (
            <p className="text-sm text-kx-text-3 py-4 text-center">No hay coeficientes cargados.</p>
          ) : (
            <div className="border border-kx-border rounded-xl overflow-hidden">
              {coeficientes.map(c => (
                <div key={c.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0">
                  <div className={`flex items-center gap-2 ${!c.activo ? 'opacity-40' : ''}`}>
                    <span className="text-sm font-medium text-kx-text">{c.jurisdiccion}</span>
                    <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{Number(c.coeficiente)}%</span>
                    <span className="text-xs text-kx-text-2">
                      {formatDateAR(c.vigencia_desde)}{c.vigencia_hasta ? ` → ${formatDateAR(c.vigencia_hasta)}` : ''}
                    </span>
                    {!c.activo && <Badge variant="outline" className="text-xs text-kx-text-2">Inactivo</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEditarCoef(c)}>
                      <Pencil className="h-4 w-4 text-kx-text-2" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleActivoCoef(c)} title={c.activo ? 'Desactivar' : 'Activar'}>
                      <Power className={`h-4 w-4 ${c.activo ? 'text-kx-red' : 'text-kx-green'}`} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Liquidación del período ── */}
      <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Calculator className="w-5 h-5 text-kx-text-3" />
            <div>
              <h3 className="font-semibold text-kx-text">Liquidar IIBB del período</h3>
              <p className="text-xs text-kx-text-2">Base imponible = ventas del período (misma base que la Posición IVA).</p>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-kx-text-2">Desde</Label>
              <Input type="date" value={periodoDesde} onChange={e => setPeriodoDesde(e.target.value)} className="h-9 w-36" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-kx-text-2">Hasta</Label>
              <Input type="date" value={periodoHasta} onChange={e => setPeriodoHasta(e.target.value)} className="h-9 w-36" />
            </div>
            <Button onClick={generarLiquidacion} disabled={generando} className="h-9 bg-blue-600 hover:bg-blue-700 text-white">
              {generando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Calcular'}
            </Button>
          </div>
        </div>

        {liquidacionActual && (
          <div className="space-y-3 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card className="p-4 dark:bg-kx-surface-2 dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">Base imponible</p>
                <p className="text-xl font-black text-kx-text mt-1 font-mono">{fmtARS(liquidacionActual.base_imponible_total)}</p>
              </Card>
              <Card className="p-4 dark:bg-kx-surface-2 dark:border-kx-border">
                <p className="text-xs text-kx-text-3 uppercase tracking-wide">IIBB a pagar</p>
                <p className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1 font-mono">{fmtARS(liquidacionActual.monto_total)}</p>
              </Card>
            </div>

            {liquidacionActual.detalle?.length > 1 && (
              <div className="border border-kx-border rounded-xl overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
                    <tr>
                      <th className="p-3">Jurisdicción</th>
                      <th className="p-3 text-right">Coef.</th>
                      <th className="p-3 text-right">Base</th>
                      <th className="p-3 text-right">Alícuota</th>
                      <th className="p-3 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {liquidacionActual.detalle.map((d, i) => (
                      <tr key={i}>
                        <td className="p-3">{d.jurisdiccion}</td>
                        <td className="p-3 text-right font-mono">{Number(d.coeficiente)}%</td>
                        <td className="p-3 text-right font-mono">{fmtARS(d.base_imponible)}</td>
                        <td className="p-3 text-right font-mono">{Number(d.alicuota)}%</td>
                        <td className="p-3 text-right font-mono font-semibold">{fmtARS(d.monto)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <Button onClick={() => confirmarLiquidacion(liquidacionActual.id)} disabled={confirmando} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {confirmando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirmando...</> : <><CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar y generar asiento</>}
            </Button>
          </div>
        )}

        {/* ── Historial ── */}
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2 text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
            <History className="h-3.5 w-3.5" /> Historial de liquidaciones
          </div>
          {loadingHistorial ? (
            <div className="flex items-center gap-2 text-kx-text-3 py-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Cargando...
            </div>
          ) : historial.length === 0 ? (
            <p className="text-sm text-kx-text-3 py-4 text-center">Sin liquidaciones generadas todavía.</p>
          ) : (
            <div className="border border-kx-border rounded-xl overflow-hidden">
              {historial.map(h => (
                <div key={h.id} className="flex items-center justify-between px-4 py-2.5 border-b border-kx-border last:border-0 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-kx-text">{formatDateAR(h.periodo_desde)} → {formatDateAR(h.periodo_hasta)}</span>
                    <span className="text-xs text-kx-text-2">{h.modalidad === 'convenio_multilateral' ? 'Convenio Multilateral' : 'Jurisdicción única'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-kx-text">{fmtARS(h.monto_total)}</span>
                    {h.estado === 'confirmada' ? (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0">Confirmada</Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">Borrador</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal nuevo/editar coeficiente */}
      <Dialog open={modalCoefOpen} onOpenChange={setModalCoefOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{coefForm.id ? 'Editar coeficiente' : 'Nuevo coeficiente'}</DialogTitle>
            <DialogDescription>Porcentaje de distribución de ingresos por jurisdicción (Convenio Multilateral).</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Jurisdicción</Label>
              <Input value={coefForm.jurisdiccion} onChange={e => setCoefForm(f => ({ ...f, jurisdiccion: e.target.value }))}
                list="provincias-ar-coef" placeholder="Córdoba" />
              <datalist id="provincias-ar-coef">
                {PROVINCIAS_AR.map(p => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Coeficiente %</Label>
              <Input value={coefForm.coeficiente} onChange={e => setCoefForm(f => ({ ...f, coeficiente: e.target.value }))}
                inputMode="decimal" placeholder="45,00" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Vigencia desde</Label>
                <Input type="date" value={coefForm.vigencia_desde} onChange={e => setCoefForm(f => ({ ...f, vigencia_desde: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vigencia hasta (opcional)</Label>
                <Input type="date" value={coefForm.vigencia_hasta} onChange={e => setCoefForm(f => ({ ...f, vigencia_hasta: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalCoefOpen(false)}>Cancelar</Button>
            <Button onClick={guardarCoef} disabled={savingCoef} className="bg-blue-600 hover:bg-blue-700 text-white">
              {savingCoef ? <RefreshCw className="h-4 w-4 animate-spin" /> : (coefForm.id ? 'Guardar' : 'Crear')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TabIIBB;
