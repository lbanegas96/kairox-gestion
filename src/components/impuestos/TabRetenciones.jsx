import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Trash2, Download, RefreshCw, FileDown, Calendar, AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR, formatDateAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import { PROVINCIAS_AR } from '@/components/impuestos/TabAlicuotas';

const fmtARS = (n) =>
  `$${Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const impuestoBadge = (imp) => {
  const colors = {
    IIBB: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    Ganancias: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    SUSS: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    IVA: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    Otro: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300',
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colors[imp] ?? colors.Otro}`}>{imp}</span>;
};

// ════════════════════════════════════════════════════════════════════════════
// Sub-tab: Retenciones Sufridas (registro manual)
// ════════════════════════════════════════════════════════════════════════════
function SubTabSufridas() {
  const { user } = useAuth();
  const { toast } = useToast();

  const todayStr = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  const [fechaDesde, setFechaDesde] = useState(firstOfMonthStr);
  const [fechaHasta, setFechaHasta] = useState(todayStr);
  const [sufridas, setSufridas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    id: null, impuesto: 'IIBB', jurisdiccion: 'Córdoba', monto: '',
    alicuota_aplicada: '', fecha: todayStr, contraparte_nombre: '',
    contraparte_cuit: '', numero_certificado: '', observaciones: '',
  };
  const [form, setForm] = useState(emptyForm);

  const fetchSufridas = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('retenciones')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .eq('tipo', 'sufrida')
      .gte('fecha', fechaDesde)
      .lte('fecha', fechaHasta)
      .order('fecha', { ascending: false });
    setSufridas(data ?? []);
    setLoading(false);
  }, [user?.empresa_id, fechaDesde, fechaHasta]);

  useEffect(() => { fetchSufridas(); }, [fetchSufridas]);

  const kpis = useMemo(() => {
    const porImpuesto = {};
    sufridas.forEach(r => { porImpuesto[r.impuesto] = (porImpuesto[r.impuesto] ?? 0) + Number(r.monto); });
    return {
      totalIIBB: porImpuesto['IIBB'] ?? 0,
      totalGanancias: porImpuesto['Ganancias'] ?? 0,
      totalGeneral: sufridas.reduce((s, r) => s + Number(r.monto), 0),
      cantidad: sufridas.length,
    };
  }, [sufridas]);

  const abrirNueva = () => { setForm({ ...emptyForm, fecha: getTodayAR() }); setModalOpen(true); };
  const abrirEditar = (r) => {
    setForm({
      id: r.id, impuesto: r.impuesto, jurisdiccion: r.jurisdiccion, monto: String(r.monto),
      alicuota_aplicada: r.alicuota_aplicada != null ? String(r.alicuota_aplicada) : '',
      fecha: r.fecha, contraparte_nombre: r.contraparte_nombre, contraparte_cuit: r.contraparte_cuit ?? '',
      numero_certificado: r.numero_certificado ?? '', observaciones: r.observaciones ?? '',
    });
    setModalOpen(true);
  };

  const guardar = async () => {
    const montoNum = parseNumberLocale(form.monto);
    if (!form.contraparte_nombre.trim() || !montoNum || montoNum <= 0) {
      toast({ title: 'Datos incompletos', description: 'Quién retuvo y el monto (> 0) son obligatorios.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const payload = {
      empresa_id: user.empresa_id,
      user_id: user.id,
      tipo: 'sufrida',
      impuesto: form.impuesto,
      jurisdiccion: form.jurisdiccion.trim() || 'Córdoba',
      monto: montoNum,
      alicuota_aplicada: form.alicuota_aplicada ? parseNumberLocale(form.alicuota_aplicada) : null,
      fecha: form.fecha,
      contraparte_nombre: form.contraparte_nombre.trim(),
      contraparte_cuit: form.contraparte_cuit.trim() || null,
      numero_certificado: form.numero_certificado.trim() || null,
      observaciones: form.observaciones.trim() || null,
    };
    let error;
    if (form.id) ({ error } = await supabase.from('retenciones').update(payload).eq('id', form.id));
    else ({ error } = await supabase.from('retenciones').insert(payload));
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: form.id ? 'Retención actualizada' : 'Retención registrada' });
    setModalOpen(false);
    fetchSufridas();
  };

  const eliminar = async (r) => {
    const { error } = await supabase.from('retenciones').delete().eq('id', r.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchSufridas();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-kx-text-2">Desde</Label>
            <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} className="h-9 w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-kx-text-2">Hasta</Label>
            <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} className="h-9 w-36" />
          </div>
        </div>
        <Button onClick={abrirNueva} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-1.5" /> Nueva retención sufrida
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
          <p className="text-xs text-kx-text-3 uppercase tracking-wide">IIBB retenido</p>
          <p className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 font-mono">{fmtARS(kpis.totalIIBB)}</p>
        </Card>
        <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
          <p className="text-xs text-kx-text-3 uppercase tracking-wide">Ganancias retenido</p>
          <p className="text-2xl font-black text-violet-600 dark:text-violet-400 mt-1 font-mono">{fmtARS(kpis.totalGanancias)}</p>
        </Card>
        <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
          <p className="text-xs text-kx-text-3 uppercase tracking-wide">Total crédito fiscal</p>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 font-mono">{fmtARS(kpis.totalGeneral)}</p>
          <p className="text-xs text-kx-text-3 mt-1">{kpis.cantidad} retención(es)</p>
        </Card>
      </div>

      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 flex items-start gap-2">
        <AlertCircle className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0" />
        <p className="text-xs text-blue-800 dark:text-blue-400">
          Registrá acá las retenciones que te practicaron tus clientes. Se acumulan como crédito fiscal
          para tu DDJJ mensual. Importación de archivos ARBA — próximamente.
        </p>
      </div>

      <div className="bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border dark:border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
              <tr>
                <th className="p-4 w-28">Fecha</th>
                <th className="p-4 w-24">Impuesto</th>
                <th className="p-4">Jurisdicción</th>
                <th className="p-4">Retenido por</th>
                <th className="p-4 text-right w-32">Monto</th>
                <th className="p-4 w-32">Certificado</th>
                <th className="p-4 text-right w-24">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-kx-text-3"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></td></tr>
              ) : sufridas.length === 0 ? (
                <tr><td colSpan={7} className="p-10 text-center text-slate-500 dark:text-kx-text-2">Sin retenciones sufridas en el período</td></tr>
              ) : (
                sufridas.map(r => (
                  <tr key={r.id} className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 text-xs text-slate-500 dark:text-kx-text-2">{formatDateAR(r.fecha)}</td>
                    <td className="p-4">{impuestoBadge(r.impuesto)}</td>
                    <td className="p-4 text-kx-text-2 dark:text-slate-300">{r.jurisdiccion}</td>
                    <td className="p-4">
                      <p className="font-medium text-kx-text dark:text-kx-text">{r.contraparte_nombre}</p>
                      {r.contraparte_cuit && <p className="text-xs text-kx-text-3 font-mono">{r.contraparte_cuit}</p>}
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-700 dark:text-kx-text">{fmtARS(r.monto)}</td>
                    <td className="p-4 text-xs text-slate-500 dark:text-kx-text-2">{r.numero_certificado || '—'}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => abrirEditar(r)}>
                          <FileDown className="h-4 w-4 text-kx-text-3 rotate-180" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => eliminar(r)}>
                          <Trash2 className="h-4 w-4 text-red-400" />
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

      {/* Modal nueva/editar sufrida */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar retención sufrida' : 'Nueva retención sufrida'}</DialogTitle>
            <DialogDescription>Retención que te practicó un cliente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Impuesto</Label>
                <Select value={form.impuesto} onValueChange={v => setForm(f => ({ ...f, impuesto: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['IIBB', 'Ganancias', 'SUSS', 'Otro'].map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Jurisdicción</Label>
                <Input value={form.jurisdiccion} onChange={e => setForm(f => ({ ...f, jurisdiccion: e.target.value }))} list="prov-suf" />
                <datalist id="prov-suf">{PROVINCIAS_AR.map(p => <option key={p} value={p} />)}</datalist>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Monto retenido</Label>
                <Input value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} inputMode="decimal" placeholder="1.500,00" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alícuota % (opcional)</Label>
                <Input value={form.alicuota_aplicada} onChange={e => setForm(f => ({ ...f, alicuota_aplicada: e.target.value }))} inputMode="decimal" placeholder="3,00" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Fecha</Label>
                <Input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nro. certificado</Label>
                <Input value={form.numero_certificado} onChange={e => setForm(f => ({ ...f, numero_certificado: e.target.value }))} placeholder="El que figura en el certificado" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Retenido por (cliente)</Label>
                <Input value={form.contraparte_nombre} onChange={e => setForm(f => ({ ...f, contraparte_nombre: e.target.value }))} placeholder="Nombre del cliente" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CUIT (opcional)</Label>
                <Input value={form.contraparte_cuit} onChange={e => setForm(f => ({ ...f, contraparte_cuit: e.target.value }))} placeholder="30-12345678-9" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Observaciones (opcional)</Label>
              <Textarea value={form.observaciones} onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : (form.id ? 'Guardar' : 'Registrar')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sub-tab: Retenciones Practicadas (con cálculo automático + certificado PDF)
// ════════════════════════════════════════════════════════════════════════════
function SubTabPracticadas() {
  const { user } = useAuth();
  const { toast } = useToast();

  const todayStr = getTodayAR();
  const firstOfMonthStr = todayStr.slice(0, 7) + '-01';

  const [practicadas, setPracticadas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proveedores, setProveedores] = useState([]);
  const [comprasProv, setComprasProv] = useState([]);
  const [empresaData, setEmpresaData] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingId, setDownloadingId] = useState(null);

  const emptyForm = {
    proveedor_id: '', compra_id: '', impuesto: 'IIBB', jurisdiccion: 'Córdoba',
    monto_base: '', alicuota_aplicada: '', monto: '', fecha: todayStr,
  };
  const [form, setForm] = useState(emptyForm);

  const fetchPracticadas = useCallback(async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('retenciones')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .eq('tipo', 'practicada')
      .order('fecha', { ascending: false });
    setPracticadas(data ?? []);
    setLoading(false);
  }, [user?.empresa_id]);

  useEffect(() => { fetchPracticadas(); }, [fetchPracticadas]);

  // Proveedores + datos de empresa (para el PDF) al montar.
  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('proveedores')
      .select('id, nombre, razon_social, cuit')
      .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre')
      .then(({ data }) => setProveedores(data ?? []));
    supabase.from('empresas')
      .select('nombre, afip_cuit, condicion_iva')
      .eq('id', user.empresa_id).single()
      .then(({ data }) => setEmpresaData(data ?? null));
  }, [user?.empresa_id]);

  // Compras del proveedor seleccionado (reactivo).
  useEffect(() => {
    if (!form.proveedor_id) { setComprasProv([]); return; }
    supabase.from('compras')
      .select('id, numero_factura, fecha, total')
      .eq('empresa_id', user.empresa_id)
      .eq('proveedor_id', form.proveedor_id)
      .order('fecha', { ascending: false })
      .then(({ data }) => setComprasProv(data ?? []));
  }, [form.proveedor_id, user?.empresa_id]);

  const mesActual = useMemo(() => practicadas.filter(r => r.fecha >= firstOfMonthStr && r.fecha <= todayStr), [practicadas, firstOfMonthStr, todayStr]);

  const kpis = useMemo(() => ({
    totalDepositar: mesActual.reduce((s, r) => s + Number(r.monto), 0),
    cantidad: mesActual.length,
  }), [mesActual]);

  // Próximo vencimiento de depósito: día 15 del mes siguiente (genérico).
  const proximoVto = useMemo(() => {
    const d = new Date(todayStr + 'T00:00:00Z');
    const y = d.getUTCMonth() === 11 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
    const m = (d.getUTCMonth() + 1) % 12;
    return new Date(Date.UTC(y, m, 15)).toISOString().slice(0, 10);
  }, [todayStr]);

  const buscarAlicuota = async (impuesto, jurisdiccion) => {
    const hoy = getTodayAR();
    const { data } = await supabase
      .from('alicuotas_impuestos')
      .select('alicuota')
      .eq('empresa_id', user.empresa_id)
      .eq('impuesto', impuesto)
      .eq('jurisdiccion', jurisdiccion)
      .eq('activo', true)
      .lte('vigencia_desde', hoy)
      .or(`vigencia_hasta.is.null,vigencia_hasta.gte.${hoy}`)
      .order('vigencia_desde', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.alicuota ?? null;
  };

  const abrirNueva = () => { setForm({ ...emptyForm, fecha: getTodayAR() }); setModalOpen(true); };

  // Recalcular monto al cambiar base o alícuota.
  // Devuelve el resultado en formato es-AR (coma decimal) para que el parser estricto lo acepte.
  const recalcMonto = (base, alic) => {
    const b = parseNumberLocale(base);
    const a = parseNumberLocale(alic);
    if (b && a) return (b * a / 100).toFixed(2).replace('.', ',');
    return '';
  };

  const onChangeProveedorOImpuesto = async (patch) => {
    const next = { ...form, ...patch };
    // Pre-cargar alícuota desde alicuotas_impuestos.
    const alic = await buscarAlicuota(next.impuesto, next.jurisdiccion);
    if (alic != null) {
      next.alicuota_aplicada = String(Number(alic));
      next.monto = recalcMonto(next.monto_base, next.alicuota_aplicada);
    }
    setForm(next);
  };

  const guardar = async () => {
    const montoNum = parseNumberLocale(form.monto);
    if (!form.proveedor_id || !montoNum || montoNum <= 0) {
      toast({ title: 'Datos incompletos', description: 'Proveedor y monto retenido (> 0) son obligatorios.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const prov = proveedores.find(p => p.id === form.proveedor_id);
    // Número de certificado + insert en una sola transacción (RPC atómica) —
    // evita que 2 retenciones registradas casi al mismo tiempo reciban el
    // mismo número (antes: count() en el cliente, sin lock).
    const { data, error } = await supabase.rpc('registrar_retencion_practicada', {
      p_empresa_id: user.empresa_id,
      p_user_id: user.id,
      p_impuesto: form.impuesto,
      p_jurisdiccion: form.jurisdiccion.trim() || 'Córdoba',
      p_monto: montoNum,
      p_alicuota_aplicada: form.alicuota_aplicada ? parseNumberLocale(form.alicuota_aplicada) : null,
      p_fecha: form.fecha,
      p_contraparte_nombre: prov?.razon_social || prov?.nombre || 'Proveedor',
      p_contraparte_cuit: prov?.cuit ?? null,
      p_compra_id: form.compra_id || null,
      p_observaciones: form.monto_base ? `Base: ${fmtARS(parseNumberLocale(form.monto_base))}` : null,
    });
    setSaving(false);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    toast({ title: 'Retención registrada', description: `Certificado ${data.numero_certificado} generado.` });
    setModalOpen(false);
    fetchPracticadas();
  };

  const eliminar = async (r) => {
    const { error } = await supabase.from('retenciones').delete().eq('id', r.id);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    fetchPracticadas();
  };

  const descargarPDF = async (r) => {
    setDownloadingId(r.id);
    try {
      // Import dinámico (code-split) — no infla el bundle principal.
      const [{ pdf }, { CertificadoRetencionPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/impuestos/pdf/CertificadoRetencionPDF'),
      ]);
      const blob = await pdf(<CertificadoRetencionPDF retencion={r} empresaData={empresaData} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `certificado_${r.numero_certificado ?? r.id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: 'Error al generar PDF', description: err.message, variant: 'destructive' });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-kx-text">Retenciones practicadas</h3>
          <p className="text-sm text-slate-500 dark:text-kx-text-2">Retenciones que le hacés a tus proveedores y debés depositar.</p>
        </div>
        <Button onClick={abrirNueva} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-1.5" /> Nueva retención practicada
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
          <p className="text-xs text-kx-text-3 uppercase tracking-wide">A depositar (mes)</p>
          <p className="text-2xl font-black text-rose-600 dark:text-rose-400 mt-1 font-mono">{fmtARS(kpis.totalDepositar)}</p>
        </Card>
        <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
          <p className="text-xs text-kx-text-3 uppercase tracking-wide">Certificados (mes)</p>
          <p className="text-2xl font-black text-kx-text dark:text-kx-text mt-1">{kpis.cantidad}</p>
        </Card>
        <Card className="p-4 dark:bg-kx-surface dark:border-kx-border">
          <div className="flex items-center gap-2 text-xs text-kx-text-3 uppercase tracking-wide">
            <Calendar className="h-4 w-4 text-amber-500" /> Próximo vencimiento
          </div>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{formatDateAR(proximoVto)}</p>
          <p className="text-xs text-kx-text-3 mt-1">estimado (verificar calendario)</p>
        </Card>
      </div>

      <div className="bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b border-kx-border dark:border-kx-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
              <tr>
                <th className="p-4 w-28">Fecha</th>
                <th className="p-4 w-24">Impuesto</th>
                <th className="p-4">Proveedor</th>
                <th className="p-4 text-right w-32">Monto retenido</th>
                <th className="p-4 w-32">Certificado</th>
                <th className="p-4 text-right w-32">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr><td colSpan={6} className="p-8 text-center text-kx-text-3"><RefreshCw className="h-5 w-5 animate-spin mx-auto" /></td></tr>
              ) : practicadas.length === 0 ? (
                <tr><td colSpan={6} className="p-10 text-center text-slate-500 dark:text-kx-text-2">Sin retenciones practicadas</td></tr>
              ) : (
                practicadas.map(r => (
                  <tr key={r.id} className="hover:bg-blue-50/40 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-4 text-xs text-slate-500 dark:text-kx-text-2">{formatDateAR(r.fecha)}</td>
                    <td className="p-4">{impuestoBadge(r.impuesto)}</td>
                    <td className="p-4">
                      <p className="font-medium text-kx-text dark:text-kx-text">{r.contraparte_nombre}</p>
                      {r.contraparte_cuit && <p className="text-xs text-kx-text-3 font-mono">{r.contraparte_cuit}</p>}
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-700 dark:text-kx-text">{fmtARS(r.monto)}</td>
                    <td className="p-4 text-xs font-mono text-slate-500 dark:text-kx-text-2">{r.numero_certificado || '—'}</td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="outline" size="sm" className="h-8" onClick={() => descargarPDF(r)} disabled={downloadingId === r.id}>
                          {downloadingId === r.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                          PDF
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => eliminar(r)}>
                          <Trash2 className="h-4 w-4 text-red-400" />
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

      {/* Modal nueva practicada */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Nueva retención practicada</DialogTitle>
            <DialogDescription>Se genera un certificado para el proveedor.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Proveedor</Label>
              <Select value={form.proveedor_id} onValueChange={v => onChangeProveedorOImpuesto({ proveedor_id: v, compra_id: '' })}>
                <SelectTrigger><SelectValue placeholder="Elegí un proveedor" /></SelectTrigger>
                <SelectContent>
                  {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.razon_social || p.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {comprasProv.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Compra de referencia (opcional)</Label>
                <Select value={form.compra_id || '__none__'} onValueChange={v => setForm(f => ({ ...f, compra_id: v === '__none__' ? '' : v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sin compra asociada</SelectItem>
                    {comprasProv.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {(c.numero_factura || 'S/N')} · {formatDateAR(c.fecha)} · {fmtARS(c.total)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Impuesto</Label>
                <Select value={form.impuesto} onValueChange={v => onChangeProveedorOImpuesto({ impuesto: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['IIBB', 'Ganancias'].map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Jurisdicción</Label>
                <Input value={form.jurisdiccion} onChange={e => setForm(f => ({ ...f, jurisdiccion: e.target.value }))}
                  onBlur={() => onChangeProveedorOImpuesto({})} list="prov-prac" />
                <datalist id="prov-prac">{PROVINCIAS_AR.map(p => <option key={p} value={p} />)}</datalist>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Base imponible</Label>
                <Input value={form.monto_base} inputMode="decimal" placeholder="100.000,00"
                  onChange={e => setForm(f => ({ ...f, monto_base: e.target.value, monto: recalcMonto(e.target.value, f.alicuota_aplicada) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alícuota %</Label>
                <Input value={form.alicuota_aplicada} inputMode="decimal" placeholder="3,00"
                  onChange={e => setForm(f => ({ ...f, alicuota_aplicada: e.target.value, monto: recalcMonto(f.monto_base, e.target.value) }))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Monto retenido</Label>
                <Input value={form.monto} inputMode="decimal" placeholder="3.000,00"
                  onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
              </div>
            </div>
            <p className="text-xs text-kx-text-3">
              La alícuota se pre-carga desde <strong>Alícuotas</strong> si hay una vigente. El monto se calcula
              automáticamente (base × alícuota) pero podés ajustarlo manualmente.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Fecha</Label>
              <Input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} className="w-44" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={guardar} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Registrar y generar certificado'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
function TabRetenciones() {
  return (
    <Tabs defaultValue="sufridas" className="w-full">
      <TabsList>
        <TabsTrigger value="sufridas">Retenciones Sufridas</TabsTrigger>
        <TabsTrigger value="practicadas">Retenciones Practicadas</TabsTrigger>
      </TabsList>
      <TabsContent value="sufridas" className="mt-4"><SubTabSufridas /></TabsContent>
      <TabsContent value="practicadas" className="mt-4"><SubTabPracticadas /></TabsContent>
    </Tabs>
  );
}

export default TabRetenciones;
