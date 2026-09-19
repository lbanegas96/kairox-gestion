import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Plus, Search, Edit, Eye, UserX, UserCheck,
  DollarSign, FileText, ShoppingBag, Banknote, RefreshCw, Clock, FileDown, Loader2,
} from 'lucide-react';
import PaymentRunModal from '@/components/proveedores/PaymentRunModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { proveedoresService, PROV_KEYS } from '@/services/proveedoresService';
import { supabase } from '@/lib/customSupabaseClient';
import { formatDateAR, getNowAR } from '@/lib/dateUtils';
import TabAntiguedad from '@/components/cuenta-corriente/TabAntiguedad';
import { imprimirEstadoCuentaProveedor } from '@/lib/imprimirEstadoCuentaProveedor';
import { useRegistrarPago } from '@/hooks/useRegistrarPago';
import ModalRegistrarPago from '@/components/proveedores/ModalRegistrarPago';

// ─── Constantes ───────────────────────────────────────────────────────────────
const CONDICIONES_IVA = ['RI', 'Monotributo', 'Exento', 'CF', 'No Categorizado'];
const CONDICIONES_PAGO = ['contado', '30 días', '60 días', '90 días', 'personalizado'];
const TIPOS_MOV = {
  compra:      { label: 'Compra',       color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  pago:        { label: 'Pago',         color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  nota_credito:{ label: 'Nota Crédito', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  nota_debito: { label: 'Nota Débito',  color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  ajuste:      { label: 'Ajuste',       color: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300' },
};
const EMPTY_FORM = {
  nombre: '', razon_social: '', cuit: '', condicion_iva: 'RI',
  telefono: '', email: '', direccion: '', localidad: '', provincia: 'Buenos Aires', codigo_postal: '',
  condicion_pago: 'contado', plazo_pago_dias: 0, notas: '', activo: true,
};

// ─── Componente principal ────────────────────────────────────────────────────
function ProveedoresSection({ initialProveedorId } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;
  const isAdmin = user?.role === 'admin';

  const [search, setSearch]         = useState('');
  const [filtroActivo, setFiltro]   = useState('activos');
  const [page, setPage]             = useState(1);
  const [formOpen, setFormOpen]     = useState(false);
  const [editando, setEditando]     = useState(null);   // proveedor a editar
  const [form, setForm]             = useState({ ...EMPTY_FORM });
  // Drill-down desde Reportería (Cartera de Proveedores) — detalleId ya se
  // fetchea por id solo (proveedoresService.getById), no hace falta esperar
  // a que la lista cargue para abrir la ficha.
  const [detalleId, setDetalleId]   = useState(initialProveedorId || null);
  const [runOpen, setRunOpen]       = useState(false);
  // Fase 3 de PLAN_PARIDAD_COMPRAS.md (04/09) — filtros de fecha + PDF de
  // Estado de Cuenta, mismo criterio que ClientDetailModal.jsx del lado clientes.
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [descargandoPDF, setDescargandoPDF] = useState(false);

  const activoFilter = filtroActivo === 'activos' ? true : filtroActivo === 'inactivos' ? false : undefined;

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: listData, isLoading } = useQuery({
    queryKey: PROV_KEYS.list(empresaId, { search, activo: activoFilter, page }),
    queryFn: () => proveedoresService.getAll(empresaId, { search, activo: activoFilter, page }),
    enabled: !!empresaId,
  });

  const { data: stats } = useQuery({
    queryKey: ['proveedores_stats', empresaId],
    queryFn: () => proveedoresService.getStats(empresaId),
    enabled: !!empresaId,
  });

  // Formas de pago (maestro configurable en ConfiguracionSection → Finanzas) — reemplaza
  // la lista hardcodeada que tenía el modal de pago.
  const { data: formasPago = [] } = useQuery({
    queryKey: ['formas_pago', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('formas_pago')
        .select('*')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('nombre');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: detalle } = useQuery({
    queryKey: PROV_KEYS.detail(detalleId),
    queryFn: () => proveedoresService.getById(detalleId),
    enabled: !!detalleId,
  });

  const { data: cuentaCorriente = [] } = useQuery({
    queryKey: PROV_KEYS.cuentaCorriente(detalleId, fechaDesde, fechaHasta),
    queryFn: () => proveedoresService.getCuentaCorriente(detalleId, empresaId, { fechaDesde, fechaHasta }),
    enabled: !!detalleId,
  });

  const { data: historialOC = [] } = useQuery({
    queryKey: PROV_KEYS.historial(detalleId),
    queryFn: () => proveedoresService.getHistorialOC(detalleId, empresaId),
    enabled: !!detalleId,
  });

  const saldo = (cuentaCorriente).reduce((acc, m) => {
    if (m.tipo === 'compra' || m.tipo === 'nota_debito')  return acc + Number(m.monto);
    if (m.tipo === 'pago'   || m.tipo === 'nota_credito') return acc - Number(m.monto);
    return acc;
  }, 0);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['proveedores', empresaId] });
    qc.invalidateQueries({ queryKey: ['proveedores_stats', empresaId] });
    // PROV_KEYS.detail() usa la clave singular 'proveedor' (no 'proveedores') —
    // mismo bug encontrado y corregido en CotizacionesSection/OrdenesCompraSection:
    // sin esto, el detalle de proveedor abierto no se refresca tras editar/activar.
    qc.invalidateQueries({ queryKey: ['proveedor'] });
  }, [qc, empresaId]);

  // "Registrar Pago" (12/09) -- extraído a useRegistrarPago para que también
  // pueda abrirse desde el detalle de una Factura de Compra (mismo criterio
  // que useRegistrarCobro del lado Ventas). onSuccess invalida lo mismo que
  // invalidaba pagoMutation antes de la extracción.
  const pago = useRegistrarPago(() => {
    invalidate();
    qc.invalidateQueries({ queryKey: PROV_KEYS.cuentaCorriente(detalleId) });
  });

  const saveMutation = useMutation({
    mutationFn: (data) => editando
      ? proveedoresService.update(editando.id, data)
      : proveedoresService.create(empresaId, data),
    onSuccess: () => {
      invalidate();
      toast({ title: editando ? 'Proveedor actualizado ✓' : 'Proveedor creado ✓', className: 'bg-green-600 text-white' });
      setFormOpen(false);
      setEditando(null);
      setForm({ ...EMPTY_FORM });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, activo }) => proveedoresService.toggleActivo(id, activo),
    onSuccess: () => { invalidate(); toast({ title: 'Estado actualizado ✓' }); },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // Migration 181/183: regenera el asiento de un pago que quedó sin generarlo (período
  // cerrado en su momento, cuenta faltante, o una colisión de numeración concurrente
  // ya corregida) — usa la diferencia de cambio ya calculada al momento del pago. El RPC
  // rechaza (con guard propio) filas que en realidad son cheques propios entregados.
  const puedeRegenerarAsientoCxp = (mov) => mov.tipo === 'pago' && !mov.asiento_id && !mov.cheque_id;

  const handleRegenerarAsientoCxp = async (movimientoId) => {
    const { error } = await supabase.rpc('regenerar_asiento_cxp', {
      p_movimiento_id: movimientoId,
      p_user_id: user.id,
    });
    if (error) {
      toast({ title: 'No se pudo regenerar el asiento', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Asiento regenerado', className: 'bg-emerald-600 text-white border-none' });
    invalidate();
    qc.invalidateQueries({ queryKey: PROV_KEYS.cuentaCorriente(detalleId) });
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openCrear = () => { setEditando(null); setForm({ ...EMPTY_FORM }); setFormOpen(true); };
  const openEditar = (prov) => {
    setEditando(prov);
    // Sanitizar nulls de la DB → inputs controlados requieren strings, no null
    const sanitized = Object.fromEntries(
      Object.entries(prov || {}).map(([k, v]) => [k, v ?? ''])
    );
    setForm({ ...EMPTY_FORM, ...sanitized });
    setFormOpen(true);
  };

  const handleSave = (e) => {
    e.preventDefault();
    if (!form.nombre.trim()) return toast({ title: 'El nombre es requerido', variant: 'destructive' });
    saveMutation.mutate({ ...form, plazo_pago_dias: Number(form.plazo_pago_dias) || 0 });
  };

  const handleDescargarPDFProveedor = async () => {
    setDescargandoPDF(true);
    try {
      await imprimirEstadoCuentaProveedor({
        proveedorId: detalleId,
        empresaId,
        fechaDesde: fechaDesde || null,
        fechaHasta: fechaHasta || null,
      });
    } catch (error) {
      toast({ title: 'No se pudo generar el PDF', description: error.message, variant: 'destructive' });
    } finally {
      setDescargandoPDF(false);
    }
  };

  const proveedores = listData?.data ?? [];

  // ── Aging report (antigüedad de deuda) — mig.314, hallazgo #2 de la auditoría
  // contable: este reporte ya existía para Clientes (TabAntiguedad.jsx) pero no
  // tenía equivalente del lado de Proveedores. Mismo criterio: reconcilia contra
  // el saldo real de `cuenta_corriente_proveedores` (proveedores no tiene columna
  // saldo_actual, a diferencia de clientes) para no sobreestimar deuda si hubo
  // pagos a cuenta sin imputar a una compra puntual.
  const [activeTab, setActiveTab]         = useState('proveedores');
  const [agingProvData, setAgingProvData] = useState([]);
  const [agingLoading, setAgingLoading]   = useState(false);

  const fetchAgingProveedores = useCallback(async () => {
    if (!empresaId) return;
    setAgingLoading(true);
    try {
      const { data: comprasPendientes, error } = await supabase
        .from('compras_saldo_pendiente')
        .select('compra_id, proveedor_id, saldo_pendiente')
        .eq('empresa_id', empresaId)
        .gt('saldo_pendiente', 0);
      if (error) throw error;
      if (!comprasPendientes?.length) { setAgingProvData([]); return; }

      const compraIds    = comprasPendientes.map(c => c.compra_id);
      const proveedorIds = [...new Set(comprasPendientes.map(c => c.proveedor_id))];
      const [
        { data: comprasInfo, error: comprasInfoError },
        { data: proveedoresInfo, error: proveedoresInfoError },
        { data: ccpMovs, error: ccpMovsError },
      ] = await Promise.all([
        supabase.from('compras').select('id, numero_factura, fecha').in('id', compraIds),
        supabase.from('proveedores').select('id, nombre').in('id', proveedorIds),
        // proveedores no tiene columna saldo_actual (a diferencia de clientes) —
        // el saldo real se deriva sumando cuenta_corriente_proveedores, igual que
        // proveedoresService.getSaldoProveedor, pero en un solo query para todos.
        supabase.from('cuenta_corriente_proveedores').select('proveedor_id, tipo, monto').eq('empresa_id', empresaId).in('proveedor_id', proveedorIds),
      ]);
      if (comprasInfoError) throw comprasInfoError;
      if (proveedoresInfoError) throw proveedoresInfoError;
      if (ccpMovsError) throw ccpMovsError;

      const compraInfoPorId = Object.fromEntries((comprasInfo || []).map(c => [c.id, c]));
      const provPorId       = Object.fromEntries((proveedoresInfo || []).map(p => [p.id, p]));

      const saldoRealPorProv = {};
      (ccpMovs || []).forEach(m => {
        const delta = (m.tipo === 'compra' || m.tipo === 'nota_debito') ? Number(m.monto)
                    : (m.tipo === 'pago'   || m.tipo === 'nota_credito') ? -Number(m.monto)
                    : 0;
        saldoRealPorProv[m.proveedor_id] = (saldoRealPorProv[m.proveedor_id] || 0) + delta;
      });

      // Un pago a cuenta sin imputar a una compra puntual reduce el saldo real sin
      // cancelar ninguna compra abierta específica — reconciliamos igual que
      // Clientes para que la suma por proveedor nunca sobreestime la deuda real.
      const sumaRawPorProv = {};
      comprasPendientes.forEach(c => {
        sumaRawPorProv[c.proveedor_id] = (sumaRawPorProv[c.proveedor_id] || 0) + Number(c.saldo_pendiente);
      });

      const now = getNowAR();
      const result = comprasPendientes.map(c => {
        const info  = compraInfoPorId[c.compra_id];
        const fecha = info?.fecha;
        const dias  = fecha ? Math.floor((now - new Date(fecha)) / 86400000) : 0;
        let banda, color;
        if (dias <= 30)      { banda = '0–30 días';  color = 'green'; }
        else if (dias <= 60) { banda = '31–60 días'; color = 'yellow'; }
        else if (dias <= 90) { banda = '61–90 días'; color = 'orange'; }
        else                 { banda = '+90 días';   color = 'red'; }

        let monto = Number(c.saldo_pendiente);
        const saldoReal = saldoRealPorProv[c.proveedor_id];
        const sumaRaw    = sumaRawPorProv[c.proveedor_id];
        if (saldoReal !== undefined) {
          if (saldoReal <= 0) {
            monto = 0;
          } else if (sumaRaw > 0 && Math.abs(sumaRaw - saldoReal) > 0.01) {
            monto = Math.round(monto * (saldoReal / sumaRaw) * 100) / 100;
          }
        }

        return {
          comprobante_id: c.compra_id,
          numero_venta:   info?.numero_factura || 'S/N',
          fecha,
          total:          monto,
          cliente_id:     c.proveedor_id,
          cliente_nombre: provPorId[c.proveedor_id]?.nombre || '—',
          dias, banda, color,
        };
      }).filter(c => c.total > 0.01);

      setAgingProvData(result.sort((a, b) => b.dias - a.dias));
    } catch (err) {
      console.error('Error aging proveedores:', err);
      toast({ title: 'Error', description: 'No se pudo calcular la antigüedad.', variant: 'destructive' });
    } finally {
      setAgingLoading(false);
    }
  }, [empresaId, toast]);

  useEffect(() => {
    if (activeTab === 'antigüedad') fetchAgingProveedores();
  }, [activeTab, fetchAgingProveedores]);

  const agingProvBandas = useMemo(() => {
    const bandas = {
      '0–30 días':  { monto: 0, count: 0, color: 'green' },
      '31–60 días': { monto: 0, count: 0, color: 'yellow' },
      '61–90 días': { monto: 0, count: 0, color: 'orange' },
      '+90 días':   { monto: 0, count: 0, color: 'red' },
    };
    for (const comp of agingProvData) {
      if (bandas[comp.banda]) {
        bandas[comp.banda].monto += comp.total;
        bandas[comp.banda].count += 1;
      }
    }
    return bandas;
  }, [agingProvData]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Truck className="w-6 h-6 text-indigo-600 dark:text-indigo-500" /> Proveedores
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">Gestión de proveedores y cuenta corriente</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setRunOpen(true)} variant="outline" className="gap-2 dark:border-kx-border dark:text-slate-300">
            <Banknote className="w-4 h-4" /> Pagar varias facturas
          </Button>
          <Button onClick={openCrear} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
            <Plus className="w-4 h-4" /> Nuevo Proveedor
          </Button>
        </div>
      </div>

      {/* ── Tabs: Proveedores / Antigüedad ───────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-transparent p-0 gap-2 flex justify-start">
          <TabsTrigger value="proveedores" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <Truck className="w-4 h-4 mr-2" /> Proveedores
          </TabsTrigger>
          <TabsTrigger value="antigüedad" className="data-[state=active]:bg-indigo-600 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface text-slate-500 dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md px-4 py-2">
            <Clock className="w-4 h-4 mr-2" /> Antigüedad de Deuda
          </TabsTrigger>
        </TabsList>

        <TabsContent value="proveedores" className="space-y-6 mt-4">
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Total', value: stats?.total ?? 0, icon: Truck, color: 'text-indigo-600 dark:text-indigo-500' },
              { label: 'Activos', value: stats?.activos ?? 0, icon: UserCheck, color: 'text-kx-green' },
              { label: 'Deuda Total', value: `$${(stats?.deudaTotal ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-kx-red' },
            ].map(({ label, value, icon: Icon, color }) => (
              <Card key={label} className="dark:bg-kx-bg dark:border-kx-border">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-slate-100 dark:bg-kx-surface-2 ${color}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 dark:text-kx-text-2">{label}</p>
                    <p className="text-xl font-bold dark:text-kx-text">{value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filtros */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-kx-text-3" />
              <Input placeholder="Buscar por nombre..." value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="pl-9 dark:bg-kx-surface dark:border-kx-border" />
            </div>
            <select value={filtroActivo} onChange={e => { setFiltro(e.target.value); setPage(1); }}
              className="h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface text-sm px-3 text-slate-700 dark:text-slate-300">
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </select>
          </div>

          {/* Tabla */}
          <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
                <tr>
                  <th className="p-4 text-left">Proveedor</th>
                  <th className="p-4 text-left">CUIT</th>
                  <th className="p-4 text-left">Condición</th>
                  <th className="p-4 text-left">Pago</th>
                  <th className="p-4 text-left">Contacto</th>
                  <th className="p-4 text-center">Estado</th>
                  <th className="p-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-kx-text-3">Cargando...</td></tr>
                ) : proveedores.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-kx-text-3">No hay proveedores</td></tr>
                ) : proveedores.map(prov => (
                  <tr key={prov.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-slate-900 dark:text-kx-text">{prov.nombre}</div>
                      {prov.razon_social && <div className="text-xs text-kx-text-3">{prov.razon_social}</div>}
                    </td>
                    <td className="p-4 font-mono text-kx-text-2 dark:text-slate-300">{prov.cuit || '—'}</td>
                    <td className="p-4 text-slate-500 dark:text-kx-text-2">{prov.condicion_iva}</td>
                    <td className="p-4 text-slate-500 dark:text-kx-text-2">{prov.condicion_pago}</td>
                    <td className="p-4 text-slate-500 dark:text-kx-text-2">
                      {prov.telefono || prov.email ? (
                        <div className="text-xs">
                          {prov.telefono && <div>{prov.telefono}</div>}
                          {prov.email && <div className="text-kx-text-3">{prov.email}</div>}
                        </div>
                      ) : '—'}
                    </td>
                    <td className="p-4 text-center">
                      <Badge variant={prov.activo ? 'default' : 'secondary'}
                        className={prov.activo ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : ''}>
                        {prov.activo ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-indigo-600 dark:hover:text-indigo-500"
                          onClick={() => setDetalleId(prov.id)} title="Ver detalle">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-kx-blue"
                          onClick={() => openEditar(prov)} title="Editar">
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        {isAdmin && (
                          <Button variant="ghost" size="icon"
                            className={`h-7 w-7 ${prov.activo ? 'text-kx-text-3 hover:text-kx-red' : 'text-kx-text-3 hover:text-kx-green'}`}
                            onClick={() => toggleMutation.mutate({ id: prov.id, activo: !prov.activo })}
                            title={prov.activo ? 'Inactivar' : 'Reactivar'}>
                            {prov.activo ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {listData && listData.pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
              <span className="text-sm text-kx-text-2">{page} / {listData.pages}</span>
              <Button variant="outline" size="sm" disabled={page >= listData.pages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="antigüedad" className="mt-4">
          <TabAntiguedad
            agingBandas={agingProvBandas} agingLoading={agingLoading} agingData={agingProvData}
            tcParalelo={{ enabled: false }}
            entityLabel="Proveedor"
            onVerDetalle={(prov) => { setDetalleId(prov.id); setActiveTab('proveedores'); }}
          />
        </TabsContent>
      </Tabs>

      {/* ── Modal Crear / Editar ────────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) { setEditando(null); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text">{editando ? 'Editar Proveedor' : 'Nuevo Proveedor'}</DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">Completá la ficha del proveedor.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Nombre *</Label>
                <Input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre comercial" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" required />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Razón Social</Label>
                <Input value={form.razon_social} onChange={e => setForm(f => ({ ...f, razon_social: e.target.value }))}
                  placeholder="Razón social legal" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">CUIT</Label>
                <Input value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))}
                  placeholder="XX-XXXXXXXX-X" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Condición IVA</Label>
                <select value={form.condicion_iva} onChange={e => setForm(f => ({ ...f, condicion_iva: e.target.value }))}
                  className="w-full h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm text-slate-700 dark:text-slate-300">
                  {CONDICIONES_IVA.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Teléfono</Label>
                <Input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="+54 11 XXXX-XXXX" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="contacto@proveedor.com" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="dark:text-kx-text">Dirección</Label>
                <Input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                  placeholder="Calle, número, piso" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Localidad</Label>
                <Input value={form.localidad} onChange={e => setForm(f => ({ ...f, localidad: e.target.value }))}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Provincia</Label>
                <Input value={form.provincia} onChange={e => setForm(f => ({ ...f, provincia: e.target.value }))}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              {/* CP — mig.345 (item 7): empareja el domicilio de proveedores con
                  el de clientes, que ahora también tiene los 4 campos. */}
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Código Postal</Label>
                <Input value={form.codigo_postal} onChange={e => setForm(f => ({ ...f, codigo_postal: e.target.value }))}
                  placeholder="B1878" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Condición de Pago</Label>
                <select value={form.condicion_pago} onChange={e => setForm(f => ({ ...f, condicion_pago: e.target.value }))}
                  className="w-full h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm text-slate-700 dark:text-slate-300">
                  {CONDICIONES_PAGO.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="dark:text-kx-text">Plazo de pago (días)</Label>
                <Input type="number" min="0" value={form.plazo_pago_dias}
                  onChange={e => setForm(f => ({ ...f, plazo_pago_dias: e.target.value }))}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="dark:text-kx-text">Notas</Label>
                <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Observaciones internas" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} className="dark:border-kx-border dark:text-slate-300">Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {saveMutation.isPending ? 'Guardando...' : editando ? 'Actualizar' : 'Crear Proveedor'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Panel Detalle ────────────────────────────────────────────────────── */}
      <Dialog open={!!detalleId} onOpenChange={(o) => { if (!o) { setDetalleId(null); setFechaDesde(''); setFechaHasta(''); } }}>
        <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-kx-border dark:border-kx-border">
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <Truck className="w-5 h-5 text-indigo-600 dark:text-indigo-500" /> {detalle?.nombre}
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              {detalle?.cuit ? `CUIT: ${detalle.cuit} · ` : ''}{detalle?.condicion_iva} · {detalle?.condicion_pago}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="cuentaCorriente" className="flex flex-1 flex-col overflow-hidden min-h-0 px-6">
            <TabsList className="bg-transparent gap-2 shrink-0 pt-4">
              <TabsTrigger value="cuentaCorriente" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface rounded-md px-4 py-2 text-slate-500 dark:text-kx-text-2">
                <Banknote className="w-4 h-4 mr-2" /> Cuenta Corriente
              </TabsTrigger>
              <TabsTrigger value="historial" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface rounded-md px-4 py-2 text-slate-500 dark:text-kx-text-2">
                <ShoppingBag className="w-4 h-4 mr-2" /> Historial OC
              </TabsTrigger>
              <TabsTrigger value="ficha" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface rounded-md px-4 py-2 text-slate-500 dark:text-kx-text-2">
                <FileText className="w-4 h-4 mr-2" /> Ficha
              </TabsTrigger>
            </TabsList>

            {/* Tab: Cuenta Corriente */}
            <TabsContent value="cuentaCorriente" className="flex-1 min-h-0 overflow-y-auto space-y-4 mt-4 pb-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="p-3 rounded-lg bg-kx-surface-2 dark:bg-kx-surface border border-kx-border dark:border-kx-border">
                  <p className="text-xs text-kx-text-3 uppercase">Saldo Deuda</p>
                  <p className={`text-2xl font-bold font-mono ${saldo > 0 ? 'text-kx-red' : 'text-kx-green'}`}>
                    ${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-kx-text-3 mt-0.5">{saldo > 0 ? 'Deuda pendiente' : saldo < 0 ? 'Saldo a favor' : 'Sin deuda'}</p>
                </div>
                <Button onClick={() => pago.openPaymentDialog({ id: detalleId, nombre: detalle?.nombre, saldo_actual: saldo }, null)} className="bg-green-600 hover:bg-green-700 text-white gap-2">
                  <Banknote className="w-4 h-4" /> Registrar Pago
                </Button>
              </div>

              {/* Filtros de fecha + PDF — Fase 3 de PLAN_PARIDAD_COMPRAS.md (04/09),
                  mismo patrón que ClientDetailModal.jsx del lado clientes. */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h4 className="font-semibold text-slate-700 dark:text-kx-text text-sm flex items-center gap-2 uppercase tracking-wider">
                  <Clock className="h-4 w-4 text-kx-text-3" /> Historial de Movimientos
                </h4>
                <div className="flex items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="ccp-fecha-desde" className="text-2xs text-kx-text-3 uppercase">Desde</Label>
                    <Input id="ccp-fecha-desde" type="date" value={fechaDesde}
                      onChange={e => setFechaDesde(e.target.value)}
                      className="h-8 text-xs w-36 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="ccp-fecha-hasta" className="text-2xs text-kx-text-3 uppercase">Hasta</Label>
                    <Input id="ccp-fecha-hasta" type="date" value={fechaHasta}
                      onChange={e => setFechaHasta(e.target.value)}
                      className="h-8 text-xs w-36 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
                  </div>
                  {(fechaDesde || fechaHasta) && (
                    <Button variant="ghost" size="sm"
                      onClick={() => { setFechaDesde(''); setFechaHasta(''); }}
                      className="h-8 text-xs text-kx-text-3 hover:text-kx-text">
                      Limpiar
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleDescargarPDFProveedor} disabled={descargandoPDF}
                    className="h-8 text-xs dark:text-kx-text dark:border-kx-border">
                    {descargandoPDF ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5 mr-1.5" />}
                    Descargar PDF
                  </Button>
                </div>
              </div>
              {!fechaDesde && !fechaHasta && (
                <p className="text-2xs text-kx-text-3 -mt-2">Mostrando los últimos 100 movimientos. Filtrá por fecha para ver un rango completo.</p>
              )}

              <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
                    <tr>
                      <th className="p-3 text-left">Fecha</th>
                      <th className="p-3 text-left">Tipo</th>
                      <th className="p-3 text-left">Descripción</th>
                      <th className="p-3 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {cuentaCorriente.length === 0 ? (
                      <tr><td colSpan={4} className="p-6 text-center text-kx-text-3">Sin movimientos</td></tr>
                    ) : cuentaCorriente.map(m => {
                      const cfg = TIPOS_MOV[m.tipo] ?? TIPOS_MOV.ajuste;
                      const esDebito = m.tipo === 'compra' || m.tipo === 'nota_debito';
                      return (
                        <tr key={m.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40">
                          <td className="p-3 text-slate-500 dark:text-kx-text-2">{formatDateAR(m.fecha)}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                          </td>
                          <td className="p-3 text-kx-text-2 dark:text-slate-300">
                            {m.descripcion || '—'}
                            {puedeRegenerarAsientoCxp(m) && (
                              <div className="mt-1">
                                <Button size="sm" variant="outline"
                                  onClick={() => handleRegenerarAsientoCxp(m.id)}
                                  className="h-6 px-2 gap-1 text-2xs text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-900/50 dark:hover:bg-amber-900/20">
                                  <RefreshCw className="h-3 w-3" /> Sin asiento — Regenerar
                                </Button>
                              </div>
                            )}
                          </td>
                          <td className={`p-3 text-right font-mono font-bold ${esDebito ? 'text-kx-red' : 'text-kx-green'}`}>
                            {esDebito ? '+' : '-'}${Number(m.monto).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* Tab: Historial OC */}
            <TabsContent value="historial" className="flex-1 min-h-0 overflow-y-auto mt-4 pb-4">
              <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
                    <tr>
                      <th className="p-3 text-left">Número</th>
                      <th className="p-3 text-left">Fecha</th>
                      <th className="p-3 text-left">Estado</th>
                      <th className="p-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {historialOC.length === 0 ? (
                      <tr><td colSpan={4} className="p-6 text-center text-kx-text-3">Sin órdenes de compra</td></tr>
                    ) : historialOC.map(oc => (
                      <tr key={oc.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40">
                        <td className="p-3 font-mono text-indigo-600 dark:text-indigo-400">{oc.numero}</td>
                        <td className="p-3 text-slate-500 dark:text-kx-text-2">{formatDateAR(oc.fecha)}</td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300">{oc.estado}</span></td>
                        <td className="p-3 text-right font-mono font-bold dark:text-kx-text">
                          {oc.moneda !== 'ARS' ? oc.moneda + ' ' : '$'}{Number(oc.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            {/* Tab: Ficha */}
            <TabsContent value="ficha" className="flex-1 min-h-0 overflow-y-auto mt-4 pb-4">
              {detalle && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    { label: 'Nombre', value: detalle.nombre },
                    { label: 'Razón Social', value: detalle.razon_social },
                    { label: 'CUIT', value: detalle.cuit },
                    { label: 'Condición IVA', value: detalle.condicion_iva },
                    { label: 'Teléfono', value: detalle.telefono },
                    { label: 'Email', value: detalle.email },
                    { label: 'Dirección', value: detalle.direccion },
                    { label: 'Localidad', value: detalle.localidad },
                    { label: 'Provincia', value: detalle.provincia },
                    { label: 'Condición de Pago', value: detalle.condicion_pago },
                    { label: 'Plazo (días)', value: detalle.plazo_pago_dias },
                    { label: 'Estado', value: detalle.activo ? 'Activo' : 'Inactivo' },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-xs text-kx-text-3 uppercase">{label}</p>
                      <p className="font-medium dark:text-kx-text">{value || '—'}</p>
                    </div>
                  ))}
                  {detalle.notas && (
                    <div className="col-span-2">
                      <p className="text-xs text-kx-text-3 uppercase">Notas</p>
                      <p className="dark:text-slate-300">{detalle.notas}</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="shrink-0 px-6 py-4 border-t border-kx-border dark:border-kx-border">
            <Button variant="outline" onClick={() => openEditar(detalle)} className="dark:border-kx-border dark:text-slate-300">
              <Edit className="w-4 h-4 mr-2" /> Editar
            </Button>
            <Button variant="outline" onClick={() => setDetalleId(null)} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal Pago (12/09: extraído a useRegistrarPago + ModalRegistrarPago,
          mismo criterio que useRegistrarCobro/ModalCobro del lado Ventas —
          así también se puede abrir desde el detalle de una Factura de
          Compra) ── */}
      <ModalRegistrarPago
        isPaymentDialogOpen={pago.isPaymentDialogOpen} setIsPaymentDialogOpen={pago.setIsPaymentDialogOpen}
        selectedProveedor={pago.selectedProveedor}
        facturaOrigenId={pago.facturaOrigenId}
        paymentData={pago.paymentData} setPaymentData={pago.setPaymentData}
        formasPago={pago.formasPago}
        isProcessingPayment={pago.isProcessingPayment}
        handleRegisterPayment={pago.handleRegisterPayment}
        facturasAbiertas={pago.facturasAbiertas}
        imputaciones={pago.imputaciones} setImputaciones={pago.setImputaciones}
        imputacionesFX={pago.imputacionesFX} setImputacionesFX={pago.setImputacionesFX}
        autoDistribuirFIFO={pago.autoDistribuirFIFO}
      />

      <PaymentRunModal empresaId={empresaId} formasPago={formasPago} open={runOpen} onOpenChange={setRunOpen} />
    </div>
  );
}

export default ProveedoresSection;
