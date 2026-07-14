import { useState, useMemo, useEffect } from 'react';
import { FileCheck, RefreshCw, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TRANSICIONES_TERCERO, TRANSICIONES_PROPIO, ESTADO_LABELS, fmt, addDays, emptyTerceroForm, emptyPropioForm } from '@/components/cheques/shared';
import ModalNuevoChequeTercero from '@/components/cheques/ModalNuevoChequeTercero';
import ModalNuevoChequePropio from '@/components/cheques/ModalNuevoChequePropio';
import ModalDetalleCheque from '@/components/cheques/ModalDetalleCheque';
import ModalCambioEstado from '@/components/cheques/ModalCambioEstado';
import TabCarteraTerceros from '@/components/cheques/TabCarteraTerceros';
import TabChequesPropios from '@/components/cheques/TabChequesPropios';

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
  const [proveedorEndosoId, setProveedorEndosoId] = useState('');
  const [cuentaBancariaCobroId, setCuentaBancariaCobroId] = useState('');
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
      // Cheque + historial inicial en una sola transacción (RPC atómica).
      const { error } = await supabase.rpc('crear_cheque_tercero', {
        p_empresa_id:        user.empresa_id,
        p_user_id:           user.id,
        p_numero:            terceroForm.numero,
        p_banco:             terceroForm.banco,
        p_monto:             monto,
        p_fecha_emision:     terceroForm.fecha_emision,
        p_fecha_vencimiento: terceroForm.fecha_vencimiento,
        p_cliente_id:        terceroForm.cliente_id || null,
        p_comprobante_id:    terceroForm.comprobante_id || null,
        p_observaciones:     terceroForm.observaciones || null,
      });
      if (error) throw error;
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
      // Cheque + historial inicial en una sola transacción (RPC atómica).
      const { error } = await supabase.rpc('crear_cheque_propio', {
        p_empresa_id:         user.empresa_id,
        p_user_id:            user.id,
        p_numero:             propioForm.numero,
        p_banco:              propioForm.banco,
        p_monto:              monto,
        p_fecha_emision:      propioForm.fecha_emision,
        p_fecha_vencimiento:  propioForm.fecha_vencimiento,
        p_cuenta_bancaria_id: propioForm.cuenta_bancaria_id || null,
        p_proveedor_id:       propioForm.proveedor_id || null,
        p_compra_id:          propioForm.compra_id || null,
        p_observaciones:      propioForm.observaciones || null,
      });
      if (error) throw error;
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
    // El endoso requiere elegir a qué proveedor se le entrega el cheque —
    // sin esto el trigger fn_asiento_cheque_tercero (mig.166) no genera el
    // asiento (no-op silencioso si proveedor_id sigue null).
    if (estadoNuevo === 'endosado' && !proveedorEndosoId) {
      toast({ title: 'Elegí un proveedor para el endoso', variant: 'destructive' });
      return;
    }
    // Cheque de tercero cobrado: necesitamos saber a qué cuenta se depositó para
    // que el movimiento aparezca en Bancos/conciliación (mig.182).
    if (estadoNuevo === 'cobrado' && chequeACambiar.tipo === 'tercero' && !cuentaBancariaCobroId) {
      toast({ title: 'Elegí a qué cuenta bancaria se depositó', variant: 'destructive' });
      return;
    }
    setSavingE(true);
    try {
      // Cambio de estado + historial en una sola transacción (RPC atómica).
      const { error } = await supabase.rpc('cambiar_estado_cheque', {
        p_cheque_id:    chequeACambiar.id,
        p_user_id:      user.id,
        p_estado_nuevo: estadoNuevo,
        p_observacion:  obsEstado || null,
        p_proveedor_endoso_id: estadoNuevo === 'endosado' ? proveedorEndosoId : null,
        p_cuenta_bancaria_id: (estadoNuevo === 'cobrado' && chequeACambiar.tipo === 'tercero') ? cuentaBancariaCobroId : null,
      });
      if (error) throw error;
      toast({
        title: `Estado → ${ESTADO_LABELS[estadoNuevo]}`,
        className: 'bg-green-900 border-green-700 text-white',
      });
      setShowCambioEstado(false);
      setChequeACambiar(null);
      setEstadoNuevo('');
      setObsEstado('');
      setProveedorEndosoId('');
      setCuentaBancariaCobroId('');
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
    setProveedorEndosoId('');
    setCuentaBancariaCobroId('');
    setShowCambioEstado(true);
  };

  // ── Derived data for children ─────────────────────────────────────────────

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
          <p className="text-2xs text-kx-text-2 uppercase font-medium tracking-wide mb-1">En Cartera</p>
          <p className="text-xl font-bold text-kx-text tabular-nums">{fmt(kpis.totalCartera)}</p>
          <p className="text-xs text-kx-green mt-1">
            {kpis.countCartera} cheque{kpis.countCartera !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-kx-surface p-4 border-t-2 border-t-kx-blue hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-2xs text-kx-text-2 uppercase font-medium tracking-wide mb-1">Propios Pendientes</p>
          <p className="text-xl font-bold text-kx-text tabular-nums">{fmt(kpis.totalPropios)}</p>
          <p className="text-xs text-kx-blue mt-1">
            {kpis.countPropios} cheque{kpis.countPropios !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="bg-kx-surface p-4 border-t-2 border-t-kx-amber hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-2xs text-kx-text-2 uppercase font-medium tracking-wide mb-1">Vencen Esta Semana</p>
          <p className={`text-xl font-bold tabular-nums ${kpis.vencenPronto > 0 ? 'text-kx-amber' : 'text-kx-text'}`}>
            {kpis.vencenPronto}
          </p>
          <p className="text-xs text-kx-text-3 mt-1">próximos 7 días</p>
        </div>
        <div className="bg-kx-surface p-4 border-t-2 border-t-kx-red hover:bg-kx-surface-2 transition-colors duration-200">
          <p className="text-2xs text-kx-text-2 uppercase font-medium tracking-wide mb-1">Rechazados</p>
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
                <span className="ml-1 bg-kx-surface border border-kx-border text-kx-text text-2xs px-1.5 py-0.5 rounded-full font-bold">
                  {kpis.countCartera}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="propio"
              className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-kx-surface-2 text-kx-text-2 hover:bg-kx-surface-2 rounded-md px-4 py-2 gap-2">
              Cheques Propios
              {kpis.countPropios > 0 && (
                <span className="ml-1 bg-kx-surface border border-kx-border text-kx-text text-2xs px-1.5 py-0.5 rounded-full font-bold">
                  {kpis.countPropios}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Tab: Cartera de Terceros ── */}
          <TabsContent value="tercero" className="space-y-3">
            <TabCarteraTerceros
              cheques={chequesTercero}
              onNuevo={() => setShowNuevoTercero(true)}
              onVerDetalle={abrirDetalle}
              onCambiarEstado={abrirCambioEstado}
            />
          </TabsContent>

          {/* ── Tab: Cheques Propios ── */}
          <TabsContent value="propio" className="space-y-3">
            <TabChequesPropios
              cheques={chequesPropios}
              onNuevo={() => setShowNuevoPropio(true)}
              onVerDetalle={abrirDetalle}
              onCambiarEstado={abrirCambioEstado}
            />
          </TabsContent>
        </Tabs>
      )}

      {/* ── Modal: Nuevo cheque de tercero ── */}
      <ModalNuevoChequeTercero
        open={showNuevoTercero} onOpenChange={setShowNuevoTercero}
        terceroForm={terceroForm} setTerceroForm={setTerceroForm}
        clientes={clientes}
        comprobantesCliente={comprobantesCliente}
        savingTercero={savingTercero}
        onGuardar={handleGuardarTercero}
      />

      {/* ── Modal: Nuevo cheque propio ── */}
      <ModalNuevoChequePropio
        open={showNuevoPropio} onOpenChange={setShowNuevoPropio}
        propioForm={propioForm} setPropioForm={setPropioForm}
        proveedores={proveedores}
        cuentasBancarias={cuentasBancarias}
        comprasProveedor={comprasProveedor}
        savingPropio={savingPropio}
        onGuardar={handleGuardarPropio}
      />

      {/* ── Modal: Detalle + Historial ── */}
      <ModalDetalleCheque
        open={showDetalle}
        onOpenChange={v => { if (!v) { setShowDetalle(false); setChequeDetalle(null); setHistorial([]); } }}
        chequeDetalle={chequeDetalle}
        historial={historial}
        loadingHistorial={loadingHistorial}
      />

      {/* ── Modal: Cambio de estado ── */}
      <ModalCambioEstado
        open={showCambioEstado}
        onOpenChange={v => {
          if (savingEstado) return;
          setShowCambioEstado(v);
          if (!v) { setChequeACambiar(null); setEstadoNuevo(''); setObsEstado(''); setProveedorEndosoId(''); setCuentaBancariaCobroId(''); }
        }}
        chequeACambiar={chequeACambiar}
        estadoNuevo={estadoNuevo} setEstadoNuevo={setEstadoNuevo}
        obsEstado={obsEstado} setObsEstado={setObsEstado}
        proveedores={proveedores}
        proveedorEndosoId={proveedorEndosoId} setProveedorEndosoId={setProveedorEndosoId}
        cuentasBancarias={cuentasBancarias}
        cuentaBancariaCobroId={cuentaBancariaCobroId} setCuentaBancariaCobroId={setCuentaBancariaCobroId}
        savingEstado={savingEstado}
        transicionesDisponibles={transicionesDisponibles}
        onConfirmar={handleCambiarEstado}
      />
    </div>
  );
}
