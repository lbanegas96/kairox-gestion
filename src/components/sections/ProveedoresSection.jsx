import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Plus, Search, Edit, Eye, UserX, UserCheck,
  DollarSign, FileText, ShoppingBag, Banknote, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { proveedoresService, PROV_KEYS } from '@/services/proveedoresService';
import { supabase } from '@/lib/customSupabaseClient';
import { formatDateAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';

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
  telefono: '', email: '', direccion: '', localidad: '', provincia: 'Buenos Aires',
  condicion_pago: 'contado', plazo_pago_dias: 0, notas: '', activo: true,
};

// ─── Componente principal ────────────────────────────────────────────────────
function ProveedoresSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { currentSession } = useCaja();
  const empresaId = user?.empresa_id;
  const isAdmin = user?.role === 'admin';

  const [search, setSearch]         = useState('');
  const [filtroActivo, setFiltro]   = useState('activos');
  const [page, setPage]             = useState(1);
  const [formOpen, setFormOpen]     = useState(false);
  const [editando, setEditando]     = useState(null);   // proveedor a editar
  const [form, setForm]             = useState({ ...EMPTY_FORM });
  const [detalleId, setDetalleId]   = useState(null);
  const [pagoOpen, setPagoOpen]     = useState(false);
  const [pagoForm, setPagoForm]     = useState({ monto: '', descripcion: '', metodo: 'Efectivo' });
  // Imputación por factura (Open Item clearing, migration 169/170) — opcional.
  // Si no se imputa nada, el pago se comporta igual que siempre (reduce el
  // saldo corrido, sin marcar ninguna compra puntual como cancelada).
  const [facturasAbiertas, setFacturasAbiertas] = useState([]);
  const [imputaciones, setImputaciones] = useState({}); // { compra_id: "monto string" }
  const [imputacionesFX, setImputacionesFX] = useState({}); // { compra_id: "monto FX string" } — compras en moneda extranjera

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

  const { data: detalle } = useQuery({
    queryKey: PROV_KEYS.detail(detalleId),
    queryFn: () => proveedoresService.getById(detalleId),
    enabled: !!detalleId,
  });

  const { data: cuentaCorriente = [] } = useQuery({
    queryKey: PROV_KEYS.cuentaCorriente(detalleId),
    queryFn: () => proveedoresService.getCuentaCorriente(detalleId, empresaId),
    enabled: !!detalleId,
  });

  const { data: historialOC = [] } = useQuery({
    queryKey: PROV_KEYS.historial(detalleId),
    queryFn: () => proveedoresService.getHistorialOC(detalleId, empresaId),
    enabled: !!detalleId,
  });

  const montoPago = parseNumberLocale(pagoForm.monto) || 0;
  const totalImputadoPago = facturasAbiertas.reduce((s, f) => {
    if (f.moneda && f.moneda !== 'ARS') {
      const fx = parseNumberLocale(imputacionesFX[f.compra_id] || '') || 0;
      return s + fx * (f.tipo_cambio_tasa || 0);
    }
    return s + (parseNumberLocale(imputaciones[f.compra_id] || '') || 0);
  }, 0);

  const saldo = (cuentaCorriente).reduce((acc, m) => {
    if (m.tipo === 'compra' || m.tipo === 'nota_debito')  return acc + Number(m.monto);
    if (m.tipo === 'pago'   || m.tipo === 'nota_credito') return acc - Number(m.monto);
    return acc;
  }, 0);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['proveedores', empresaId] });
    qc.invalidateQueries({ queryKey: ['proveedores_stats', empresaId] });
  }, [qc, empresaId]);

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

  const pagoMutation = useMutation({
    mutationFn: ({ monto, descripcion, metodo, imputaciones: imp }) =>
      proveedoresService.registrarPago(empresaId, detalleId, detalle?.nombre, monto, metodo, descripcion, user.id, currentSession?.id ?? null, imp),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: PROV_KEYS.cuentaCorriente(detalleId) });
      invalidate();
      toast({ title: 'Pago registrado ✓', className: 'bg-green-600 text-white' });
      // El RPC genera el asiento en la misma transacción, no bloqueante: si falla
      // (período cerrado o cuenta faltante), el pago igual se registra sin avisar.
      if (data?.asiento_generado === false) {
        toast({
          title: 'Pago registrado sin asiento contable',
          description: 'El pago se guardó correctamente, pero no se generó el asiento (período cerrado o cuenta contable faltante). Revisar Plan de Cuentas.',
          variant: 'destructive',
          action: (
            <ToastAction altText="Regenerar asiento" onClick={() => handleRegenerarAsientoCxp(data.ccp_id)}>
              Regenerar
            </ToastAction>
          ),
        });
      }
      setPagoOpen(false);
      setPagoForm({ monto: '', descripcion: '', metodo: 'Efectivo' });
      setImputaciones({});
      setImputacionesFX({});
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

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

  const fetchFacturasAbiertas = async (proveedorId) => {
    const { data, error } = await supabase
      .from('compras_saldo_pendiente')
      .select('compra_id, total, saldo_pendiente, moneda, tipo_cambio_tasa')
      .eq('proveedor_id', proveedorId)
      .gt('saldo_pendiente', 0)
      .order('compra_id');
    if (error) {
      console.error('[compras_saldo_pendiente]', error.message);
      return;
    }
    // Traer el número de factura por separado (la vista no lo incluye).
    const ids = (data || []).map(f => f.compra_id);
    let numerosPorId = {};
    if (ids.length > 0) {
      const { data: compras } = await supabase.from('compras').select('id, numero_factura, fecha').in('id', ids);
      numerosPorId = Object.fromEntries((compras || []).map(c => [c.id, c]));
    }
    setFacturasAbiertas((data || []).map(f => ({
      ...f,
      numero_factura: numerosPorId[f.compra_id]?.numero_factura || 'S/N',
      fecha: numerosPorId[f.compra_id]?.fecha,
    })));
  };

  const openPagoDialog = () => {
    setPagoForm({ monto: '', descripcion: '', metodo: 'Efectivo' });
    setImputaciones({});
    setImputacionesFX({});
    setFacturasAbiertas([]);
    setPagoOpen(true);
    if (detalleId) fetchFacturasAbiertas(detalleId);
  };

  // Reparte `monto` entre las compras abiertas más viejas primero (FIFO). Solo
  // aplica a compras en ARS — las de moneda extranjera se imputan a mano.
  const autoDistribuirFIFO = (monto) => {
    let restante = monto;
    const nuevo = {};
    for (const f of facturasAbiertas) {
      if (f.moneda && f.moneda !== 'ARS') continue;
      if (restante <= 0) break;
      const aplicar = Math.min(restante, f.saldo_pendiente);
      if (aplicar > 0) {
        nuevo[f.compra_id] = String(aplicar);
        restante -= aplicar;
      }
    }
    setImputaciones(nuevo);
  };

  const handlePago = (e) => {
    e.preventDefault();
    const monto = parseNumberLocale(pagoForm.monto);
    if (!monto || monto <= 0) return toast({ title: 'Ingresá un monto válido', variant: 'destructive' });

    // Imputación por compra (opcional): facturas en moneda extranjera usan
    // monto_moneda_extranjera — el RPC calcula la diferencia de cambio realizada.
    const imputacionesArray = facturasAbiertas
      .map(f => {
        if (f.moneda && f.moneda !== 'ARS') {
          const fx = parseNumberLocale(imputacionesFX[f.compra_id] || '');
          return fx > 0 ? { compra_id: f.compra_id, monto_moneda_extranjera: fx } : null;
        }
        const m = parseNumberLocale(imputaciones[f.compra_id] || '');
        return m > 0 ? { compra_id: f.compra_id, monto: m } : null;
      })
      .filter(Boolean);

    pagoMutation.mutate({
      monto,
      descripcion: pagoForm.descripcion || `Pago a ${detalle?.nombre}`,
      metodo: pagoForm.metodo,
      imputaciones: imputacionesArray.length > 0 ? imputacionesArray : null,
    });
  };

  const proveedores = listData?.data ?? [];

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Truck className="w-6 h-6 text-indigo-500" /> Proveedores
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">Gestión de proveedores y cuenta corriente</p>
        </div>
        <Button onClick={openCrear} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nuevo Proveedor
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total', value: stats?.total ?? 0, icon: Truck, color: 'text-indigo-500' },
          { label: 'Activos', value: stats?.activos ?? 0, icon: UserCheck, color: 'text-green-500' },
          { label: 'Deuda Total', value: `$${(stats?.deudaTotal ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-red-500' },
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
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-indigo-500"
                      onClick={() => setDetalleId(prov.id)} title="Ver detalle">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-500"
                      onClick={() => openEditar(prov)} title="Editar">
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    {isAdmin && (
                      <Button variant="ghost" size="icon"
                        className={`h-7 w-7 ${prov.activo ? 'text-kx-text-3 hover:text-red-500' : 'text-kx-text-3 hover:text-green-500'}`}
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
      <Dialog open={!!detalleId} onOpenChange={(o) => { if (!o) setDetalleId(null); }}>
        <DialogContent className="max-w-3xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <Truck className="w-5 h-5 text-indigo-500" /> {detalle?.nombre}
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              {detalle?.cuit ? `CUIT: ${detalle.cuit} · ` : ''}{detalle?.condicion_iva} · {detalle?.condicion_pago}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="cuentaCorriente">
            <TabsList className="bg-transparent gap-2">
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
            <TabsContent value="cuentaCorriente" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-lg bg-kx-surface-2 dark:bg-kx-surface border border-kx-border dark:border-kx-border">
                  <p className="text-xs text-kx-text-3 uppercase">Saldo Deuda</p>
                  <p className={`text-2xl font-bold font-mono ${saldo > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    ${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-kx-text-3 mt-0.5">{saldo > 0 ? 'Deuda pendiente' : saldo < 0 ? 'Saldo a favor' : 'Sin deuda'}</p>
                </div>
                <Button onClick={openPagoDialog} className="bg-green-600 hover:bg-green-700 text-white gap-2">
                  <Banknote className="w-4 h-4" /> Registrar Pago
                </Button>
              </div>

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
                                  className="h-6 px-2 gap-1 text-[11px] text-amber-600 border-amber-300 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-900/50 dark:hover:bg-amber-900/20">
                                  <RefreshCw className="h-3 w-3" /> Sin asiento — Regenerar
                                </Button>
                              </div>
                            )}
                          </td>
                          <td className={`p-3 text-right font-mono font-bold ${esDebito ? 'text-red-500' : 'text-green-500'}`}>
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
            <TabsContent value="historial" className="mt-4">
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
            <TabsContent value="ficha" className="mt-4">
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

          <DialogFooter>
            <Button variant="outline" onClick={() => openEditar(detalle)} className="dark:border-kx-border dark:text-slate-300">
              <Edit className="w-4 h-4 mr-2" /> Editar
            </Button>
            <Button variant="outline" onClick={() => setDetalleId(null)} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal Pago ───────────────────────────────────────────────────────── */}
      <Dialog open={pagoOpen} onOpenChange={setPagoOpen}>
        <DialogContent className="max-w-sm dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text">Registrar Pago</DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Saldo actual: <span className="font-bold text-red-500">${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePago} className="space-y-4">
            <div className="space-y-1">
              <Label className="dark:text-kx-text">Monto *</Label>
              <Input type="text" inputMode="decimal" value={pagoForm.monto}
                onChange={e => setPagoForm(p => ({ ...p, monto: e.target.value }))}
                placeholder="0,00" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            </div>
            <div className="space-y-1">
              <Label className="dark:text-kx-text">Método de pago *</Label>
              <select
                value={pagoForm.metodo}
                onChange={e => setPagoForm(p => ({ ...p, metodo: e.target.value }))}
                className="w-full h-10 rounded-md border border-kx-border bg-kx-surface px-3 text-sm text-kx-text dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              >
                <option value="Efectivo">Efectivo (Caja)</option>
                <option value="Transferencia">Transferencia (Bancos)</option>
                <option value="Tarjeta de débito">Tarjeta de débito (Bancos)</option>
                <option value="Tarjeta de crédito">Tarjeta de crédito (Bancos)</option>
              </select>
              <p className="text-[11px] text-kx-text-3">Efectivo descuenta de la Caja; los demás, de la cuenta bancaria mapeada.</p>
            </div>
            <div className="space-y-1">
              <Label className="dark:text-kx-text">Descripción</Label>
              <Input value={pagoForm.descripcion}
                onChange={e => setPagoForm(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Nota opcional del pago..." className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            </div>

            {facturasAbiertas.length > 0 && (
                <div className="grid gap-2 border-t border-kx-border pt-3">
                  <div className="flex items-center justify-between">
                    <Label className="dark:text-kx-text">Imputar a factura(s) (opcional)</Label>
                    {montoPago > 0 && (
                      <Button type="button" size="sm" variant="outline" onClick={() => autoDistribuirFIFO(montoPago)}>
                        Auto (más vieja primero)
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-kx-text-3">
                    Si no imputás nada, el pago solo baja el saldo total del proveedor (como siempre).
                  </p>
                  <div className="border border-kx-border rounded-lg divide-y divide-kx-border max-h-48 overflow-y-auto">
                    {facturasAbiertas.map(f => {
                      const esFX = !!(f.moneda && f.moneda !== 'ARS');
                      return (
                        <div key={f.compra_id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium text-kx-text truncate">{f.numero_factura}</div>
                            <div className="text-xs text-kx-text-3">
                              Pendiente: ${Number(f.saldo_pendiente).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                              {esFX && <span className="ml-1">({f.moneda})</span>}
                            </div>
                          </div>
                          {esFX ? (
                            <Input
                              type="text" inputMode="decimal" placeholder={`0,00 ${f.moneda}`}
                              value={imputacionesFX[f.compra_id] ?? ''}
                              onChange={(e) => setImputacionesFX(prev => ({ ...prev, [f.compra_id]: e.target.value }))}
                              className="w-28 h-8 text-right text-xs shrink-0"
                            />
                          ) : (
                            <Input
                              type="text" inputMode="decimal" placeholder="0,00"
                              value={imputaciones[f.compra_id] ?? ''}
                              onChange={(e) => setImputaciones(prev => ({ ...prev, [f.compra_id]: e.target.value }))}
                              className="w-28 h-8 text-right text-xs shrink-0"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className={`text-xs text-right ${totalImputadoPago > montoPago ? 'text-red-500 font-semibold' : 'text-kx-text-3'}`}>
                    Imputado: ${totalImputadoPago.toLocaleString('es-AR', { minimumFractionDigits: 2 })} / ${montoPago.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </div>
                </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPagoOpen(false)} className="dark:border-kx-border dark:text-slate-300">Cancelar</Button>
              <Button type="submit" disabled={pagoMutation.isPending || totalImputadoPago > montoPago} className="bg-green-600 hover:bg-green-700 text-white">
                {pagoMutation.isPending ? 'Guardando...' : 'Confirmar Pago'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProveedoresSection;
