import React, { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck, Plus, Search, Edit, Eye, UserX, UserCheck,
  DollarSign, FileText, ShoppingBag, X, Banknote
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { proveedoresService, PROV_KEYS } from '@/services/proveedoresService';

// ─── Constantes ───────────────────────────────────────────────────────────────
const CONDICIONES_IVA = ['RI', 'Monotributo', 'Exento', 'CF', 'No Categorizado'];
const CONDICIONES_PAGO = ['contado', '30 días', '60 días', '90 días', 'personalizado'];
const TIPOS_MOV = {
  compra:      { label: 'Compra',       color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  pago:        { label: 'Pago',         color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  nota_credito:{ label: 'Nota Crédito', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  nota_debito: { label: 'Nota Débito',  color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  ajuste:      { label: 'Ajuste',       color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
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
  const [pagoForm, setPagoForm]     = useState({ monto: '', descripcion: '' });

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

  const pagoMutation = useMutation({
    mutationFn: ({ monto, descripcion }) =>
      proveedoresService.registrarPago(empresaId, detalleId, monto, descripcion, user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PROV_KEYS.cuentaCorriente(detalleId) });
      invalidate();
      toast({ title: 'Pago registrado ✓', className: 'bg-green-600 text-white' });
      setPagoOpen(false);
      setPagoForm({ monto: '', descripcion: '' });
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

  const handlePago = (e) => {
    e.preventDefault();
    const monto = parseFloat(pagoForm.monto);
    if (!monto || monto <= 0) return toast({ title: 'Ingresá un monto válido', variant: 'destructive' });
    pagoMutation.mutate({ monto, descripcion: pagoForm.descripcion || `Pago a ${detalle?.nombre}` });
  };

  const proveedores = listData?.data ?? [];

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Truck className="w-6 h-6 text-indigo-500" /> Proveedores
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Gestión de proveedores y cuenta corriente</p>
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
          <Card key={label} className="dark:bg-slate-950 dark:border-slate-800">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-slate-100 dark:bg-slate-800 ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                <p className="text-xl font-bold dark:text-white">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <Input placeholder="Buscar por nombre..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 dark:bg-slate-900 dark:border-slate-700" />
        </div>
        <select value={filtroActivo} onChange={e => { setFiltro(e.target.value); setPage(1); }}
          className="h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 text-slate-700 dark:text-slate-300">
          <option value="activos">Activos</option>
          <option value="inactivos">Inactivos</option>
          <option value="todos">Todos</option>
        </select>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
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
              <tr><td colSpan={7} className="p-8 text-center text-slate-400">Cargando...</td></tr>
            ) : proveedores.length === 0 ? (
              <tr><td colSpan={7} className="p-8 text-center text-slate-400">No hay proveedores</td></tr>
            ) : proveedores.map(prov => (
              <tr key={prov.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                <td className="p-4">
                  <div className="font-medium text-slate-900 dark:text-white">{prov.nombre}</div>
                  {prov.razon_social && <div className="text-xs text-slate-400">{prov.razon_social}</div>}
                </td>
                <td className="p-4 font-mono text-slate-600 dark:text-slate-300">{prov.cuit || '—'}</td>
                <td className="p-4 text-slate-500 dark:text-slate-400">{prov.condicion_iva}</td>
                <td className="p-4 text-slate-500 dark:text-slate-400">{prov.condicion_pago}</td>
                <td className="p-4 text-slate-500 dark:text-slate-400">
                  {prov.telefono || prov.email ? (
                    <div className="text-xs">
                      {prov.telefono && <div>{prov.telefono}</div>}
                      {prov.email && <div className="text-slate-400">{prov.email}</div>}
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
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-indigo-500"
                      onClick={() => setDetalleId(prov.id)} title="Ver detalle">
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-blue-500"
                      onClick={() => openEditar(prov)} title="Editar">
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    {isAdmin && (
                      <Button variant="ghost" size="icon"
                        className={`h-7 w-7 ${prov.activo ? 'text-slate-400 hover:text-red-500' : 'text-slate-400 hover:text-green-500'}`}
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
          <span className="text-sm text-slate-500">{page} / {listData.pages}</span>
          <Button variant="outline" size="sm" disabled={page >= listData.pages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
        </div>
      )}

      {/* ── Modal Crear / Editar ────────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={(o) => { setFormOpen(o); if (!o) { setEditando(null); setForm({ ...EMPTY_FORM }); } }}>
        <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-white">{editando ? 'Editar Proveedor' : 'Nuevo Proveedor'}</DialogTitle>
            <DialogDescription className="dark:text-slate-400">Completá la ficha del proveedor.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="dark:text-white">Nombre *</Label>
                <Input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre comercial" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" required />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">Razón Social</Label>
                <Input value={form.razon_social} onChange={e => setForm(f => ({ ...f, razon_social: e.target.value }))}
                  placeholder="Razón social legal" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">CUIT</Label>
                <Input value={form.cuit} onChange={e => setForm(f => ({ ...f, cuit: e.target.value }))}
                  placeholder="XX-XXXXXXXX-X" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">Condición IVA</Label>
                <select value={form.condicion_iva} onChange={e => setForm(f => ({ ...f, condicion_iva: e.target.value }))}
                  className="w-full h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-700 dark:text-slate-300">
                  {CONDICIONES_IVA.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">Teléfono</Label>
                <Input value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))}
                  placeholder="+54 11 XXXX-XXXX" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">Email</Label>
                <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="contacto@proveedor.com" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="dark:text-white">Dirección</Label>
                <Input value={form.direccion} onChange={e => setForm(f => ({ ...f, direccion: e.target.value }))}
                  placeholder="Calle, número, piso" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">Localidad</Label>
                <Input value={form.localidad} onChange={e => setForm(f => ({ ...f, localidad: e.target.value }))}
                  className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">Provincia</Label>
                <Input value={form.provincia} onChange={e => setForm(f => ({ ...f, provincia: e.target.value }))}
                  className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">Condición de Pago</Label>
                <select value={form.condicion_pago} onChange={e => setForm(f => ({ ...f, condicion_pago: e.target.value }))}
                  className="w-full h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-700 dark:text-slate-300">
                  {CONDICIONES_PAGO.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="dark:text-white">Plazo de pago (días)</Label>
                <Input type="number" min="0" value={form.plazo_pago_dias}
                  onChange={e => setForm(f => ({ ...f, plazo_pago_dias: e.target.value }))}
                  className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="dark:text-white">Notas</Label>
                <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Observaciones internas" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} className="dark:border-slate-700 dark:text-slate-300">Cancelar</Button>
              <Button type="submit" disabled={saveMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                {saveMutation.isPending ? 'Guardando...' : editando ? 'Actualizar' : 'Crear Proveedor'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Panel Detalle ────────────────────────────────────────────────────── */}
      <Dialog open={!!detalleId} onOpenChange={(o) => { if (!o) setDetalleId(null); }}>
        <DialogContent className="max-w-3xl dark:bg-slate-950 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-white flex items-center gap-2">
              <Truck className="w-5 h-5 text-indigo-500" /> {detalle?.nombre}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              {detalle?.cuit ? `CUIT: ${detalle.cuit} · ` : ''}{detalle?.condicion_iva} · {detalle?.condicion_pago}
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="cuentaCorriente">
            <TabsList className="bg-transparent gap-2">
              <TabsTrigger value="cuentaCorriente" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
                <Banknote className="w-4 h-4 mr-2" /> Cuenta Corriente
              </TabsTrigger>
              <TabsTrigger value="historial" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
                <ShoppingBag className="w-4 h-4 mr-2" /> Historial OC
              </TabsTrigger>
              <TabsTrigger value="ficha" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
                <FileText className="w-4 h-4 mr-2" /> Ficha
              </TabsTrigger>
            </TabsList>

            {/* Tab: Cuenta Corriente */}
            <TabsContent value="cuentaCorriente" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <p className="text-xs text-slate-400 uppercase">Saldo Deuda</p>
                  <p className={`text-2xl font-bold font-mono ${saldo > 0 ? 'text-red-500' : 'text-green-500'}`}>
                    ${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{saldo > 0 ? 'Deuda pendiente' : saldo < 0 ? 'Saldo a favor' : 'Sin deuda'}</p>
                </div>
                <Button onClick={() => setPagoOpen(true)} className="bg-green-600 hover:bg-green-700 text-white gap-2">
                  <Banknote className="w-4 h-4" /> Registrar Pago
                </Button>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="p-3 text-left">Fecha</th>
                      <th className="p-3 text-left">Tipo</th>
                      <th className="p-3 text-left">Descripción</th>
                      <th className="p-3 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {cuentaCorriente.length === 0 ? (
                      <tr><td colSpan={4} className="p-6 text-center text-slate-400">Sin movimientos</td></tr>
                    ) : cuentaCorriente.map(m => {
                      const cfg = TIPOS_MOV[m.tipo] ?? TIPOS_MOV.ajuste;
                      const esDebito = m.tipo === 'compra' || m.tipo === 'nota_debito';
                      return (
                        <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="p-3 text-slate-500 dark:text-slate-400">{new Date(m.fecha).toLocaleDateString('es-AR')}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                          </td>
                          <td className="p-3 text-slate-600 dark:text-slate-300">{m.descripcion || '—'}</td>
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
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="p-3 text-left">Número</th>
                      <th className="p-3 text-left">Fecha</th>
                      <th className="p-3 text-left">Estado</th>
                      <th className="p-3 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {historialOC.length === 0 ? (
                      <tr><td colSpan={4} className="p-6 text-center text-slate-400">Sin órdenes de compra</td></tr>
                    ) : historialOC.map(oc => (
                      <tr key={oc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="p-3 font-mono text-indigo-600 dark:text-indigo-400">{oc.numero}</td>
                        <td className="p-3 text-slate-500 dark:text-slate-400">{new Date(oc.fecha).toLocaleDateString('es-AR')}</td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{oc.estado}</span></td>
                        <td className="p-3 text-right font-mono font-bold dark:text-white">
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
                      <p className="text-xs text-slate-400 uppercase">{label}</p>
                      <p className="font-medium dark:text-white">{value || '—'}</p>
                    </div>
                  ))}
                  {detalle.notas && (
                    <div className="col-span-2">
                      <p className="text-xs text-slate-400 uppercase">Notas</p>
                      <p className="dark:text-slate-300">{detalle.notas}</p>
                    </div>
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => openEditar(detalle)} className="dark:border-slate-700 dark:text-slate-300">
              <Edit className="w-4 h-4 mr-2" /> Editar
            </Button>
            <Button variant="outline" onClick={() => setDetalleId(null)} className="dark:border-slate-700 dark:text-slate-300">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal Pago ───────────────────────────────────────────────────────── */}
      <Dialog open={pagoOpen} onOpenChange={setPagoOpen}>
        <DialogContent className="max-w-sm dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white">Registrar Pago</DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              Saldo actual: <span className="font-bold text-red-500">${saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handlePago} className="space-y-4">
            <div className="space-y-1">
              <Label className="dark:text-white">Monto *</Label>
              <Input type="number" min="0.01" step="0.01" value={pagoForm.monto}
                onChange={e => setPagoForm(p => ({ ...p, monto: e.target.value }))}
                placeholder="0.00" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
            </div>
            <div className="space-y-1">
              <Label className="dark:text-white">Descripción</Label>
              <Input value={pagoForm.descripcion}
                onChange={e => setPagoForm(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Transferencia, cheque, efectivo..." className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPagoOpen(false)} className="dark:border-slate-700 dark:text-slate-300">Cancelar</Button>
              <Button type="submit" disabled={pagoMutation.isPending} className="bg-green-600 hover:bg-green-700 text-white">
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
