import React, { useState, useMemo, useEffect } from 'react';
import {
  FileCheck, Plus, Loader2, AlertTriangle, Clock,
  CheckCircle2, RefreshCw, ArrowRightLeft, Eye,
} from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ─── Constants ────────────────────────────────────────────────────────────────

const BANCOS_AR = [
  'Banco Nación', 'Banco Provincia', 'Banco Galicia',
  'Banco Santander', 'BBVA', 'Banco ICBC', 'Banco Macro',
  'Banco Supervielle', 'Banco Patagonia', 'Banco Ciudad',
  'Banco Credicoop', 'Banco Hipotecario', 'Brubank',
];

const TRANSICIONES_TERCERO = {
  en_cartera: ['depositado', 'endosado', 'descontado', 'rechazado'],
  depositado:  ['cobrado', 'rechazado'],
  endosado:    ['cobrado', 'rechazado'],
  descontado:  ['cobrado', 'rechazado'],
};

const TRANSICIONES_PROPIO = {
  pendiente: ['entregado', 'rechazado'],
  entregado: ['cobrado', 'rechazado'],
};

const ESTADO_LABELS = {
  pendiente:  'Pendiente',
  entregado:  'Entregado',
  en_cartera: 'En cartera',
  depositado: 'Depositado',
  endosado:   'Endosado',
  descontado: 'Descontado',
  cobrado:    'Cobrado',
  rechazado:  'Rechazado',
};

const ESTADO_COLOR = {
  pendiente:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
  entregado:  'bg-blue-500/10 text-blue-400 border-blue-500/30',
  en_cartera: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  depositado: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30',
  endosado:   'bg-purple-500/10 text-purple-400 border-purple-500/30',
  descontado: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
  cobrado:    'bg-green-500/10 text-green-400 border-green-500/30',
  rechazado:  'bg-red-500/10 text-red-400 border-red-500/30',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) =>
  `$ ${Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('es-AR') : '—';

const addDays = (dateStr, days) =>
  new Date(new Date(dateStr + 'T00:00:00Z').getTime() + days * 86400000)
    .toISOString().split('T')[0];

// ─── Empty form factories ─────────────────────────────────────────────────────

const emptyTerceroForm = () => ({
  numero: '', banco: '', monto: '',
  fecha_emision: getTodayAR(), fecha_vencimiento: '',
  cliente_id: '', comprobante_id: '', observaciones: '',
});

const emptyPropioForm = () => ({
  numero: '', banco: '', cuenta_bancaria_id: '', monto: '',
  fecha_emision: getTodayAR(), fecha_vencimiento: '',
  proveedor_id: '', compra_id: '', observaciones: '',
});

// ─── ChequesSection ───────────────────────────────────────────────────────────

export default function ChequesSection() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [cheques, setCheques]                     = useState([]);
  const [loading, setLoading]                     = useState(true);
  const [clientes, setClientes]                   = useState([]);
  const [proveedores, setProveedores]             = useState([]);
  const [cuentasBancarias, setCuentasBancarias]   = useState([]);
  const [comprobantesCliente, setComprobCli]      = useState([]);
  const [comprasProveedor, setComprasProv]        = useState([]);

  // Modals state
  const [showNuevoTercero, setShowNuevoTercero]   = useState(false);
  const [showNuevoPropio, setShowNuevoPropio]     = useState(false);
  const [showCambioEstado, setShowCambioEstado]   = useState(false);
  const [chequeACambiar, setChequeACambiar]       = useState(null);
  const [estadoNuevo, setEstadoNuevo]             = useState('');
  const [obsEstado, setObsEstado]                 = useState('');
  const [showDetalle, setShowDetalle]             = useState(false);
  const [chequeDetalle, setChequeDetalle]         = useState(null);
  const [historial, setHistorial]                 = useState([]);
  const [loadingHistorial, setLoadingHistorial]   = useState(false);

  // Forms
  const [terceroForm, setTerceroForm]   = useState(emptyTerceroForm());
  const [propioForm, setPropioForm]     = useState(emptyPropioForm());
  const [savingTercero, setSavingT]     = useState(false);
  const [savingPropio, setSavingP]      = useState(false);
  const [savingEstado, setSavingE]      = useState(false);

  // ── Data loading ──────────────────────────────────────────────────────────

  const fetchCheques = async () => {
    if (!user?.empresa_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('cheques')
        .select(`
          *,
          clientes(nombre),
          proveedores(nombre),
          cuentas_bancarias(nombre, banco)
        `)
        .eq('empresa_id', user.empresa_id)
        .order('fecha_vencimiento', { ascending: true });
      if (error) throw error;
      setCheques(data ?? []);
    } catch (e) {
      toast({ title: 'Error al cargar cheques', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const abrirDetalle = async (cheque) => {
    setChequeDetalle(cheque);
    setShowDetalle(true);
    setLoadingHistorial(true);
    try {
      const { data, error } = await supabase
        .from('cheques_historial')
        .select('estado_anterior, estado_nuevo, observacion, fecha')
        .eq('cheque_id', cheque.id)
        .order('fecha', { ascending: true });
      if (error) throw error;
      setHistorial(data ?? []);
    } catch (e) {
      toast({ title: 'Error al cargar historial', description: e.message, variant: 'destructive' });
      setHistorial([]);
    } finally {
      setLoadingHistorial(false);
    }
  };

  useEffect(() => {
    if (!user?.empresa_id) return;
    fetchCheques();
    Promise.all([
      supabase.from('clientes').select('id, nombre').eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre'),
      // SECURITY-RLS-CROSS: RPC scoped id+nombre — Cheques no requiere permiso 'compras' (mig.135)
      supabase.rpc('listar_proveedores_min'),
      supabase.from('cuentas_bancarias').select('id, nombre, banco').eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre'),
    ]).then(([{ data: cli }, { data: prov }, { data: ctas }]) => {
      setClientes(cli ?? []);
      setProveedores(prov ?? []);
      setCuentasBancarias(ctas ?? []);
    });
  }, [user?.empresa_id]);

  useEffect(() => {
    if (!terceroForm.cliente_id || !user?.empresa_id) { setComprobCli([]); return; }
    supabase
      .from('comprobantes').select('id, numero_venta, total')
      .eq('empresa_id', user.empresa_id).eq('cliente_id', terceroForm.cliente_id)
      .order('fecha', { ascending: false }).limit(50)
      .then(({ data }) => setComprobCli(data ?? []));
  }, [terceroForm.cliente_id, user?.empresa_id]);

  useEffect(() => {
    if (!propioForm.proveedor_id || !user?.empresa_id) { setComprasProv([]); return; }
    supabase
      .from('compras').select('id, numero_factura, total, fecha')
      .eq('empresa_id', user.empresa_id).eq('proveedor_id', propioForm.proveedor_id)
      .order('fecha', { ascending: false }).limit(50)
      .then(({ data }) => setComprasProv(data ?? []));
  }, [propioForm.proveedor_id, user?.empresa_id]);

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => {
    const hoy  = getTodayAR();
    const in7d = addDays(hoy, 7);
    const enCartera        = cheques.filter(c => c.tipo === 'tercero' && c.estado === 'en_cartera');
    const propiosPendientes = cheques.filter(c => c.tipo === 'propio' && ['pendiente', 'entregado'].includes(c.estado));
    const vencenPronto     = cheques.filter(c =>
      !['cobrado', 'rechazado'].includes(c.estado) &&
      c.fecha_vencimiento >= hoy && c.fecha_vencimiento <= in7d
    );
    const rechazados = cheques.filter(c => c.estado === 'rechazado');
    return {
      totalCartera:  enCartera.reduce((s, c) => s + Number(c.monto), 0),
      countCartera:  enCartera.length,
      totalPropios:  propiosPendientes.reduce((s, c) => s + Number(c.monto), 0),
      countPropios:  propiosPendientes.length,
      vencenPronto:  vencenPronto.length,
      rechazados:    rechazados.length,
    };
  }, [cheques]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const registrarHistorial = (chequeId, estadoAnterior, estadoNv, observacion) =>
    supabase.from('cheques_historial').insert([{
      cheque_id:       chequeId,
      empresa_id:      user.empresa_id,
      user_id:         user.id,
      estado_anterior: estadoAnterior,
      estado_nuevo:    estadoNv,
      observacion:     observacion || null,
    }]);

  const handleGuardarTercero = async () => {
    if (!terceroForm.numero || !terceroForm.banco || !terceroForm.monto || !terceroForm.fecha_vencimiento) {
      toast({ title: 'Completá número, banco, monto y fecha de vencimiento', variant: 'destructive' }); return;
    }
    const monto = parseNumberLocale(terceroForm.monto);
    if (isNaN(monto) || monto <= 0) {
      toast({ title: 'El monto debe ser mayor a 0', variant: 'destructive' }); return;
    }
    setSavingT(true);
    try {
      const { data, error } = await supabase.from('cheques').insert([{
        empresa_id:        user.empresa_id,
        user_id:           user.id,
        tipo:              'tercero',
        numero:            terceroForm.numero,
        banco:             terceroForm.banco,
        monto,
        fecha_emision:     terceroForm.fecha_emision,
        fecha_vencimiento: terceroForm.fecha_vencimiento,
        cliente_id:        terceroForm.cliente_id || null,
        comprobante_id:    terceroForm.comprobante_id || null,
        observaciones:     terceroForm.observaciones || null,
        estado:            'en_cartera',
      }]).select().single();
      if (error) throw error;
      await registrarHistorial(data.id, null, 'en_cartera', 'Registro inicial');
      toast({ title: 'Cheque registrado en cartera', className: 'bg-green-900 border-green-700 text-white' });
      setShowNuevoTercero(false);
      setTerceroForm(emptyTerceroForm());
      fetchCheques();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSavingT(false);
    }
  };

  const handleGuardarPropio = async () => {
    if (!propioForm.numero || !propioForm.banco || !propioForm.monto || !propioForm.fecha_vencimiento) {
      toast({ title: 'Completá número, banco, monto y fecha de vencimiento', variant: 'destructive' }); return;
    }
    const monto = parseNumberLocale(propioForm.monto);
    if (isNaN(monto) || monto <= 0) {
      toast({ title: 'El monto debe ser mayor a 0', variant: 'destructive' }); return;
    }
    setSavingP(true);
    try {
      const { data, error } = await supabase.from('cheques').insert([{
        empresa_id:         user.empresa_id,
        user_id:            user.id,
        tipo:               'propio',
        numero:             propioForm.numero,
        banco:              propioForm.banco,
        cuenta_bancaria_id: propioForm.cuenta_bancaria_id || null,
        monto,
        fecha_emision:      propioForm.fecha_emision,
        fecha_vencimiento:  propioForm.fecha_vencimiento,
        proveedor_id:       propioForm.proveedor_id || null,
        compra_id:          propioForm.compra_id || null,
        observaciones:      propioForm.observaciones || null,
        estado:             'pendiente',
      }]).select().single();
      if (error) throw error;
      await registrarHistorial(data.id, null, 'pendiente', 'Registro inicial');
      toast({ title: 'Cheque propio registrado', className: 'bg-green-900 border-green-700 text-white' });
      setShowNuevoPropio(false);
      setPropioForm(emptyPropioForm());
      fetchCheques();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSavingP(false);
    }
  };

  const handleCambiarEstado = async () => {
    if (!chequeACambiar || !estadoNuevo) return;
    setSavingE(true);
    try {
      const { error } = await supabase
        .from('cheques')
        .update({ estado: estadoNuevo, updated_at: new Date().toISOString() })
        .eq('id', chequeACambiar.id)
        .eq('empresa_id', user.empresa_id);
      if (error) throw error;
      await registrarHistorial(chequeACambiar.id, chequeACambiar.estado, estadoNuevo, obsEstado);
      toast({
        title: `Estado → ${ESTADO_LABELS[estadoNuevo]}`,
        className: 'bg-green-900 border-green-700 text-white',
      });
      setShowCambioEstado(false);
      setChequeACambiar(null);
      setEstadoNuevo('');
      setObsEstado('');
      fetchCheques();
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSavingE(false);
    }
  };

  const abrirCambioEstado = (cheque) => {
    const opciones = cheque.tipo === 'tercero'
      ? TRANSICIONES_TERCERO[cheque.estado]
      : TRANSICIONES_PROPIO[cheque.estado];
    if (!opciones?.length) return;
    setChequeACambiar(cheque);
    setEstadoNuevo(opciones[0]);
    setObsEstado('');
    setShowCambioEstado(true);
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const hoy  = getTodayAR();
  const in7d = addDays(hoy, 7);

  const renderFechaVto = (fecha, estado) => {
    if (!fecha) return '—';
    const activo   = !['cobrado', 'rechazado'].includes(estado);
    const vencido  = activo && fecha < hoy;
    const proximo  = activo && !vencido && fecha <= in7d;
    return (
      <span className={`flex items-center gap-1 font-mono text-xs whitespace-nowrap
        ${vencido ? 'text-red-400' : proximo ? 'text-amber-400' : 'text-slate-300'}`}>
        {(vencido || proximo) && <Clock size={11} className="flex-shrink-0" />}
        {fmtDate(fecha)}
        {vencido && <span className="text-[10px] font-medium">(vencido)</span>}
        {proximo && <span className="text-[10px] font-medium">(&lt;7d)</span>}
      </span>
    );
  };

  const renderBadge = (estado) => (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${ESTADO_COLOR[estado] ?? ''}`}>
      {ESTADO_LABELS[estado] ?? estado}
    </span>
  );

  const renderAcciones = (cheque) => {
    const opciones = cheque.tipo === 'tercero'
      ? TRANSICIONES_TERCERO[cheque.estado]
      : TRANSICIONES_PROPIO[cheque.estado];
    return (
      <div className="flex items-center justify-center gap-1">
        <button
          onClick={() => abrirDetalle(cheque)}
          className="px-2 py-1 text-xs rounded text-kx-text-3 hover:text-white hover:bg-kx-surface-2 border border-kx-border transition-colors flex items-center gap-1"
        >
          <Eye size={11} /> Ver
        </button>
        {opciones?.length > 0 && (
          <button
            onClick={() => abrirCambioEstado(cheque)}
            className="px-2 py-1 text-xs rounded text-[#00D4FF] hover:text-white hover:bg-[#00D4FF]/10 border border-[#00D4FF]/30 transition-colors flex items-center gap-1"
          >
            <ArrowRightLeft size={11} /> Mover
          </button>
        )}
      </div>
    );
  };

  const transicionesDisponibles = chequeACambiar
    ? (chequeACambiar.tipo === 'tercero'
        ? TRANSICIONES_TERCERO[chequeACambiar.estado]
        : TRANSICIONES_PROPIO[chequeACambiar.estado]) ?? []
    : [];

  const chequesTercero = cheques.filter(c => c.tipo === 'tercero');
  const chequesPropios = cheques.filter(c => c.tipo === 'propio');

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-kx-text flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg">
              <FileCheck size={18} className="text-white" />
            </div>
            Gestión de Cheques
          </h1>
          <p className="text-kx-text-3 text-sm mt-1">Cartera de terceros · Cheques propios</p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchCheques} disabled={loading}
          className="border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
          <RefreshCw size={14} className={`mr-1 ${loading ? 'animate-spin' : ''}`} /> Actualizar
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
        <div className="bg-kx-surface p-4 border-t-2 border-t-kx-green hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide mb-1">En Cartera</p>
          <p className="text-xl font-bold text-kx-text tabular-nums">{fmt(kpis.totalCartera)}</p>
          <p className="text-xs text-kx-green mt-1">
            {kpis.countCartera} cheque{kpis.countCartera !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-kx-surface p-4 border-t-2 border-t-kx-blue hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide mb-1">Propios Pendientes</p>
          <p className="text-xl font-bold text-kx-text tabular-nums">{fmt(kpis.totalPropios)}</p>
          <p className="text-xs text-kx-blue mt-1">
            {kpis.countPropios} cheque{kpis.countPropios !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-kx-surface p-4 border-t-2 border-t-kx-amber hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide mb-1">Vencen Esta Semana</p>
          <p className={`text-xl font-bold tabular-nums ${kpis.vencenPronto > 0 ? 'text-kx-amber' : 'text-kx-text'}`}>
            {kpis.vencenPronto}
          </p>
          <p className="text-xs text-kx-text-3 mt-1">próximos 7 días</p>
        </div>
        <div className="bg-kx-surface p-4 border-t-2 border-t-kx-red hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-[11px] text-kx-text-2 uppercase font-medium tracking-wide mb-1">Rechazados</p>
          <p className={`text-xl font-bold tabular-nums ${kpis.rechazados > 0 ? 'text-kx-red' : 'text-kx-text'}`}>
            {kpis.rechazados}
          </p>
          <p className="text-xs text-kx-text-3 mt-1">historial</p>
        </div>
      </div>

      {/* Tabs */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={32} className="animate-spin text-[#00D4FF]" />
        </div>
      ) : (
        <Tabs defaultValue="tercero" className="space-y-4">
          <TabsList className="bg-transparent p-0 gap-2">
            <TabsTrigger value="tercero"
              className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-kx-surface-2 text-kx-text-2 hover:bg-kx-surface-2 rounded-md px-4 py-2 gap-2">
              Cartera de Terceros
              {kpis.countCartera > 0 && (
                <span className="ml-1 bg-kx-surface border border-kx-border text-kx-text text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  {kpis.countCartera}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="propio"
              className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-kx-surface-2 text-kx-text-2 hover:bg-kx-surface-2 rounded-md px-4 py-2 gap-2">
              Cheques Propios
              {kpis.countPropios > 0 && (
                <span className="ml-1 bg-kx-surface border border-kx-border text-kx-text text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                  {kpis.countPropios}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Tab: Cartera de Terceros ── */}
          <TabsContent value="tercero" className="space-y-3">
            <div className="flex justify-end">
              <Button onClick={() => setShowNuevoTercero(true)} size="sm"
                className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
                <Plus size={14} className="mr-1" /> Registrar cheque recibido
              </Button>
            </div>
            <div className="rounded-2xl border border-kx-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 border-b border-kx-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Nro.</th>
                    <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Banco</th>
                    <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Recibido de</th>
                    <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Monto</th>
                    <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Vencimiento</th>
                    <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Estado</th>
                    <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {chequesTercero.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-kx-text-3">
                      No hay cheques de terceros registrados
                    </td></tr>
                  )}
                  {chequesTercero.map(c => (
                    <tr key={c.id} className={`border-t border-kx-border transition-colors
                      ${c.estado === 'rechazado' ? 'bg-red-500/5' : 'hover:bg-kx-surface-2'}`}>
                      <td className="px-4 py-3 font-mono text-xs text-kx-blue">{c.numero}</td>
                      <td className="px-4 py-3 text-kx-text-2 text-xs">{c.banco}</td>
                      <td className="px-4 py-3 text-kx-text">{c.clientes?.nombre ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-kx-text">{fmt(c.monto)}</td>
                      <td className="px-4 py-3">{renderFechaVto(c.fecha_vencimiento, c.estado)}</td>
                      <td className="px-4 py-3 text-center">{renderBadge(c.estado)}</td>
                      <td className="px-4 py-3 text-center">{renderAcciones(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* ── Tab: Cheques Propios ── */}
          <TabsContent value="propio" className="space-y-3">
            <div className="flex justify-end">
              <Button onClick={() => setShowNuevoPropio(true)} size="sm"
                className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
                <Plus size={14} className="mr-1" /> Registrar cheque emitido
              </Button>
            </div>
            <div className="rounded-2xl border border-kx-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 border-b border-kx-border">
                  <tr>
                    <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Nro.</th>
                    <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Banco / Cuenta</th>
                    <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Entregado a</th>
                    <th className="px-4 py-3 text-right text-kx-text-3 font-medium">Monto</th>
                    <th className="px-4 py-3 text-left text-kx-text-3 font-medium">Vencimiento</th>
                    <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Estado</th>
                    <th className="px-4 py-3 text-center text-kx-text-3 font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {chequesPropios.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-kx-text-3">
                      No hay cheques propios registrados
                    </td></tr>
                  )}
                  {chequesPropios.map(c => (
                    <tr key={c.id} className={`border-t border-kx-border transition-colors
                      ${c.estado === 'rechazado' ? 'bg-red-500/5' : 'hover:bg-kx-surface-2'}`}>
                      <td className="px-4 py-3 font-mono text-xs text-kx-blue">{c.numero}</td>
                      <td className="px-4 py-3 text-xs">
                        <div className="text-kx-text">{c.banco}</div>
                        {c.cuentas_bancarias && (
                          <div className="text-kx-text-3">{c.cuentas_bancarias.nombre}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-kx-text">{c.proveedores?.nombre ?? '—'}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-kx-text">{fmt(c.monto)}</td>
                      <td className="px-4 py-3">{renderFechaVto(c.fecha_vencimiento, c.estado)}</td>
                      <td className="px-4 py-3 text-center">{renderBadge(c.estado)}</td>
                      <td className="px-4 py-3 text-center">{renderAcciones(c)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* ── Modal: Nuevo cheque de tercero ── */}
      <Dialog open={showNuevoTercero} onOpenChange={setShowNuevoTercero}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus size={16} className="text-emerald-400" /> Registrar cheque recibido
            </DialogTitle>
            <DialogDescription>Cheque de tercero recibido como medio de pago de un cliente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-kx-text-3 text-xs">Número *</Label>
                <Input value={terceroForm.numero}
                  onChange={e => setTerceroForm(f => ({ ...f, numero: e.target.value }))}
                  placeholder="00001234" className="mt-1 bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-kx-text-3 text-xs">Banco emisor *</Label>
                <Input value={terceroForm.banco}
                  onChange={e => setTerceroForm(f => ({ ...f, banco: e.target.value }))}
                  list="bancos-tercero" placeholder="Banco Galicia"
                  className="mt-1 bg-slate-800 border-slate-700" />
                <datalist id="bancos-tercero">
                  {BANCOS_AR.map(b => <option key={b} value={b} />)}
                </datalist>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-kx-text-3 text-xs">Monto *</Label>
                <Input value={terceroForm.monto}
                  onChange={e => setTerceroForm(f => ({ ...f, monto: e.target.value }))}
                  placeholder="0,00" inputMode="decimal"
                  className="mt-1 bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-kx-text-3 text-xs">Fecha vencimiento *</Label>
                <Input type="date" value={terceroForm.fecha_vencimiento}
                  onChange={e => setTerceroForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                  className="mt-1 bg-slate-800 border-slate-700" />
              </div>
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Fecha emisión</Label>
              <Input type="date" value={terceroForm.fecha_emision}
                onChange={e => setTerceroForm(f => ({ ...f, fecha_emision: e.target.value }))}
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Cliente (opcional)</Label>
              <Select
                value={terceroForm.cliente_id || '__none__'}
                onValueChange={v => setTerceroForm(f => ({ ...f, cliente_id: v === '__none__' ? '' : v, comprobante_id: '' }))}
              >
                <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                  <SelectValue placeholder="Sin cliente" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                  <SelectItem value="__none__">Sin cliente</SelectItem>
                  {clientes.map(c => <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {terceroForm.cliente_id && comprobantesCliente.length > 0 && (
              <div>
                <Label className="text-kx-text-3 text-xs">Comprobante asociado (opcional)</Label>
                <Select
                  value={terceroForm.comprobante_id || '__none__'}
                  onValueChange={v => setTerceroForm(f => ({ ...f, comprobante_id: v === '__none__' ? '' : v }))}
                >
                  <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Sin comprobante" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                    <SelectItem value="__none__">Sin comprobante</SelectItem>
                    {comprobantesCliente.map(comp => (
                      <SelectItem key={comp.id} value={comp.id}>
                        {comp.numero_venta} — {fmt(comp.total)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-kx-text-3 text-xs">Observaciones</Label>
              <Input value={terceroForm.observaciones}
                onChange={e => setTerceroForm(f => ({ ...f, observaciones: e.target.value }))}
                placeholder="Opcional" className="mt-1 bg-slate-800 border-slate-700" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowNuevoTercero(false)} className="text-kx-text-3">
              Cancelar
            </Button>
            <Button onClick={handleGuardarTercero} disabled={savingTercero}
              className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {savingTercero ? <Loader2 size={14} className="animate-spin mr-2" /> : <CheckCircle2 size={14} className="mr-2" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Nuevo cheque propio ── */}
      <Dialog open={showNuevoPropio} onOpenChange={setShowNuevoPropio}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus size={16} className="text-blue-400" /> Registrar cheque propio emitido
            </DialogTitle>
            <DialogDescription>Cheque emitido por la empresa para pagar a un proveedor.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-kx-text-3 text-xs">Número *</Label>
                <Input value={propioForm.numero}
                  onChange={e => setPropioForm(f => ({ ...f, numero: e.target.value }))}
                  placeholder="00001234" className="mt-1 bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-kx-text-3 text-xs">Banco *</Label>
                <Input value={propioForm.banco}
                  onChange={e => setPropioForm(f => ({ ...f, banco: e.target.value }))}
                  list="bancos-propio" placeholder="Banco Nación"
                  className="mt-1 bg-slate-800 border-slate-700" />
                <datalist id="bancos-propio">
                  {BANCOS_AR.map(b => <option key={b} value={b} />)}
                </datalist>
              </div>
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Cuenta bancaria propia (opcional)</Label>
              <Select
                value={propioForm.cuenta_bancaria_id || '__none__'}
                onValueChange={v => setPropioForm(f => ({ ...f, cuenta_bancaria_id: v === '__none__' ? '' : v }))}
              >
                <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                  <SelectValue placeholder="Sin cuenta asociada" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                  <SelectItem value="__none__">Sin cuenta asociada</SelectItem>
                  {cuentasBancarias.map(cb => (
                    <SelectItem key={cb.id} value={cb.id}>{cb.nombre} — {cb.banco}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-kx-text-3 text-xs">Monto *</Label>
                <Input value={propioForm.monto}
                  onChange={e => setPropioForm(f => ({ ...f, monto: e.target.value }))}
                  placeholder="0,00" inputMode="decimal"
                  className="mt-1 bg-slate-800 border-slate-700" />
              </div>
              <div>
                <Label className="text-kx-text-3 text-xs">Fecha vencimiento *</Label>
                <Input type="date" value={propioForm.fecha_vencimiento}
                  onChange={e => setPropioForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                  className="mt-1 bg-slate-800 border-slate-700" />
              </div>
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Fecha emisión</Label>
              <Input type="date" value={propioForm.fecha_emision}
                onChange={e => setPropioForm(f => ({ ...f, fecha_emision: e.target.value }))}
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Proveedor (opcional)</Label>
              <Select
                value={propioForm.proveedor_id || '__none__'}
                onValueChange={v => setPropioForm(f => ({ ...f, proveedor_id: v === '__none__' ? '' : v, compra_id: '' }))}
              >
                <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                  <SelectValue placeholder="Sin proveedor" />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                  <SelectItem value="__none__">Sin proveedor</SelectItem>
                  {proveedores.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {propioForm.proveedor_id && comprasProveedor.length > 0 && (
              <div>
                <Label className="text-kx-text-3 text-xs">Compra asociada (opcional)</Label>
                <Select
                  value={propioForm.compra_id || '__none__'}
                  onValueChange={v => setPropioForm(f => ({ ...f, compra_id: v === '__none__' ? '' : v }))}
                >
                  <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                    <SelectValue placeholder="Sin compra" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700 max-h-56">
                    <SelectItem value="__none__">Sin compra</SelectItem>
                    {comprasProveedor.map(comp => (
                      <SelectItem key={comp.id} value={comp.id}>
                        {comp.numero_factura ?? 'S/N'} — {fmt(comp.total)} ({fmtDate(comp.fecha)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label className="text-kx-text-3 text-xs">Observaciones</Label>
              <Input value={propioForm.observaciones}
                onChange={e => setPropioForm(f => ({ ...f, observaciones: e.target.value }))}
                placeholder="Opcional" className="mt-1 bg-slate-800 border-slate-700" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setShowNuevoPropio(false)} className="text-kx-text-3">
              Cancelar
            </Button>
            <Button onClick={handleGuardarPropio} disabled={savingPropio}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              {savingPropio ? <Loader2 size={14} className="animate-spin mr-2" /> : <CheckCircle2 size={14} className="mr-2" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Detalle + Historial ── */}
      <Dialog open={showDetalle} onOpenChange={v => { if (!v) { setShowDetalle(false); setChequeDetalle(null); setHistorial([]); } }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCheck size={16} className="text-emerald-400" /> Detalle del cheque
            </DialogTitle>
            {chequeDetalle && (
              <DialogDescription>
                Cheque {chequeDetalle.numero} · {fmt(chequeDetalle.monto)}
              </DialogDescription>
            )}
          </DialogHeader>
          {chequeDetalle && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-kx-text-3 text-xs">Tipo</span>
                  <p className="text-kx-text">{chequeDetalle.tipo === 'tercero' ? 'De tercero' : 'Propio'}</p>
                </div>
                <div>
                  <span className="text-kx-text-3 text-xs">Banco</span>
                  <p className="text-kx-text">{chequeDetalle.banco}</p>
                </div>
                <div>
                  <span className="text-kx-text-3 text-xs">{chequeDetalle.tipo === 'tercero' ? 'Recibido de' : 'Entregado a'}</span>
                  <p className="text-kx-text">{chequeDetalle.clientes?.nombre ?? chequeDetalle.proveedores?.nombre ?? '—'}</p>
                </div>
                <div>
                  <span className="text-kx-text-3 text-xs">Vencimiento</span>
                  <p className="text-kx-text">{fmtDate(chequeDetalle.fecha_vencimiento)}</p>
                </div>
                <div>
                  <span className="text-kx-text-3 text-xs">Estado actual</span>
                  <p className="mt-0.5">{renderBadge(chequeDetalle.estado)}</p>
                </div>
                <div>
                  <span className="text-kx-text-3 text-xs">Monto</span>
                  <p className="text-kx-text font-mono font-medium">{fmt(chequeDetalle.monto)}</p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-medium text-kx-text-3 mb-2 uppercase tracking-wider">Historial de estados</h4>
                {loadingHistorial ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-kx-text-3" />
                  </div>
                ) : historial.length === 0 ? (
                  <p className="text-xs text-kx-text-3 py-2">Sin registros de historial</p>
                ) : (
                  <div className="space-y-0 relative">
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-kx-border" />
                    {historial.map((h, i) => (
                      <div key={i} className="flex items-start gap-3 py-1.5 relative">
                        <div className={`w-[15px] h-[15px] rounded-full border-2 flex-shrink-0 z-10 ${
                          i === historial.length - 1
                            ? 'bg-emerald-500 border-emerald-400'
                            : 'bg-slate-700 border-slate-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {h.estado_anterior
                              ? <>{renderBadge(h.estado_anterior)} <span className="text-kx-text-3 text-xs">&rarr;</span> {renderBadge(h.estado_nuevo)}</>
                              : renderBadge(h.estado_nuevo)
                            }
                          </div>
                          <p className="text-[10px] text-kx-text-3 mt-0.5">
                            {new Date(h.fecha).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {h.observacion && <span className="ml-2 text-kx-text-2">&mdash; {h.observacion}</span>}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setShowDetalle(false); setChequeDetalle(null); setHistorial([]); }}
              className="text-kx-text-3">
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal: Cambio de estado ── */}
      <Dialog
        open={showCambioEstado}
        onOpenChange={v => {
          if (savingEstado) return;
          setShowCambioEstado(v);
          if (!v) { setChequeACambiar(null); setEstadoNuevo(''); setObsEstado(''); }
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowRightLeft size={16} className="text-[#00D4FF]" /> Cambiar estado
            </DialogTitle>
            {chequeACambiar && (
              <DialogDescription>
                Cheque {chequeACambiar.numero} · {fmt(chequeACambiar.monto)}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 text-sm text-kx-text-3">
              <span>Estado actual:</span>
              {chequeACambiar && renderBadge(chequeACambiar.estado)}
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Nuevo estado *</Label>
              <Select value={estadoNuevo} onValueChange={setEstadoNuevo}>
                <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {transicionesDisponibles.map(e => (
                    <SelectItem key={e} value={e}>{ESTADO_LABELS[e]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-kx-text-3 text-xs">Observación (opcional)</Label>
              <Input value={obsEstado}
                onChange={e => setObsEstado(e.target.value)}
                placeholder="Ej: Depositado en Bco. Nación"
                className="mt-1 bg-slate-800 border-slate-700" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={savingEstado}
              onClick={() => { setShowCambioEstado(false); setChequeACambiar(null); setEstadoNuevo(''); setObsEstado(''); }}
              className="text-kx-text-3">
              Cancelar
            </Button>
            <Button onClick={handleCambiarEstado} disabled={savingEstado || !estadoNuevo}
              className="bg-[#00D4FF] text-black hover:bg-[#00bfe8]">
              {savingEstado
                ? <Loader2 size={14} className="animate-spin mr-2" />
                : <ArrowRightLeft size={14} className="mr-2" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
