import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, ShoppingBag, Search, Eye, Truck, XCircle,
  Send, CheckCircle, Clock, AlertCircle, Package,
  ChevronRight, Trash2, ArrowRight, Receipt, AlertTriangle, BadgeCheck, Banknote, RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { ordenesCompraService, OC_KEYS } from '@/services/ordenesCompraService';
import { supabase } from '@/lib/customSupabaseClient';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import GenerarRecepcionModal from '@/components/compras/GenerarRecepcionModal';
import NuevaDevolucionProveedorModal from '@/components/compras/NuevaDevolucionProveedorModal';
import { formatCurrency, parseNumberLocale } from '@/lib/currencyUtils';
import { formatDateAR } from '@/lib/dateUtils';

// ─── Helpers de estado ────────────────────────────────────────────────────────

const ESTADOS = {
  borrador:         { label: 'Borrador',         color: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300',     icon: Clock },
  enviada:          { label: 'Enviada',           color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',      icon: Send },
  recibida_parcial: { label: 'Recibida parcial',  color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', icon: AlertCircle },
  recibida:         { label: 'Recibida',          color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',  icon: CheckCircle },
  cancelada:        { label: 'Cancelada',         color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',         icon: XCircle },
};

const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Cheque', 'Tarjeta Crédito', 'Cuenta Corriente'];
const EMPTY_ITEM = { descripcion: '', cantidad_pedida: 1, costo_unitario: '', producto_id: null, unidad_medida: '', _prodSearch: '' };

// ─── Componente principal ─────────────────────────────────────────────────────

function OrdenesCompraSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState('lista');
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // modales
  const [detalleId, setDetalleId]   = useState(null);
  const [genRecepId, setGenRecepId] = useState(null);
  const [devolverOC, setDevolverOC] = useState(null);
  const [facturaModal, setFacturaModal] = useState(false);
  const [facturaForm, setFacturaForm] = useState({ numero_factura: '', fecha_factura: '', fecha_vencimiento: '', monto_total: '', notas: '' });

  // form nueva OC
  const [form, setForm] = useState({ proveedor_nombre: '', fecha_entrega_esperada: '', forma_pago: 'Efectivo', notas: '', moneda: 'ARS', tipoCambioTasa: 1 });
  const [tcMissingOC, setTcMissingOC] = useState(false);
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [provSearch, setProvSearch] = useState('');
  const [provResults, setProvResults] = useState([]);
  const [selectedProv, setSelectedProv] = useState(null);
  const [prodResults, setProdResults] = useState({});

  const empresaId = user?.empresa_id;

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: listData, isLoading } = useQuery({
    queryKey: OC_KEYS.list(empresaId, { estado: estadoFiltro || undefined, page }),
    queryFn: () => ordenesCompraService.getAll(empresaId, { estado: estadoFiltro || undefined, page }),
    enabled: !!empresaId,
  });

  const { data: detalle } = useQuery({
    queryKey: OC_KEYS.detail(detalleId),
    queryFn: () => ordenesCompraService.getById(detalleId),
    enabled: !!detalleId,
  });

  const { data: unidadesMedida = [] } = useQuery({
    queryKey: ['unidades_medida', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unidades_medida')
        .select('*')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('codigo');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: factura } = useQuery({
    queryKey: OC_KEYS.factura(detalleId),
    queryFn: () => ordenesCompraService.getFactura(detalleId),
    enabled: !!detalleId,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const registrarFacturaMutation = useMutation({
    mutationFn: (payload) => ordenesCompraService.registrarFactura(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OC_KEYS.factura(detalleId) });
      toast({ title: 'Factura registrada ✓', className: 'bg-green-600 text-white' });
      setFacturaModal(false);
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const pagarFacturaMutation = useMutation({
    mutationFn: (facturaId) => ordenesCompraService.pagarFactura(facturaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OC_KEYS.factura(detalleId) });
      toast({ title: 'Factura marcada como pagada ✓', className: 'bg-green-600 text-white' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const handleRegistrarFactura = (e) => {
    e.preventDefault();
    if (!detalle) return;
    registrarFacturaMutation.mutate({
      empresa_id: empresaId,
      orden_compra_id: detalle.id,
      proveedor_id: detalle.proveedor_id ?? null,
      numero_factura: facturaForm.numero_factura,
      fecha_factura: facturaForm.fecha_factura,
      fecha_vencimiento: facturaForm.fecha_vencimiento || null,
      monto_total: parseNumberLocale(facturaForm.monto_total) || 0,
      notas: facturaForm.notas || null,
    });
  };

  const createMutation = useMutation({
    mutationFn: (payload) => ordenesCompraService.create(empresaId, user.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ordenes_compra', empresaId] });
      toast({ title: 'Orden de compra creada ✓', className: 'bg-green-600 text-white' });
      setTab('lista');
      resetForm();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // Helper: invalidar también el cache de notificaciones cuando cambia el estado/stock
  const invalidateOCAndNotifs = () => {
    qc.invalidateQueries({ queryKey: ['ordenes_compra', empresaId] });
    qc.invalidateQueries({ queryKey: ['notif'] });
  };

  const estadoMutation = useMutation({
    mutationFn: ({ id, estado }) => ordenesCompraService.updateEstado(id, estado),
    onSuccess: invalidateOCAndNotifs,
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const cancelarMutation = useMutation({
    mutationFn: (id) => ordenesCompraService.cancelar(id),
    onSuccess: invalidateOCAndNotifs,
  });

  // ── Helpers de form ───────────────────────────────────────────────────────────

  const resetForm = () => {
    setForm({ proveedor_nombre: '', fecha_entrega_esperada: '', forma_pago: 'Efectivo', notas: '', moneda: 'ARS', tipoCambioTasa: 1 });
    setItems([{ ...EMPTY_ITEM }]);
    setSelectedProv(null);
    setProvSearch('');
    setTcMissingOC(false);
  };

  const searchProveedor = async (q) => {
    setProvSearch(q);
    setForm(f => ({ ...f, proveedor_nombre: q }));
    if (!q || q.length < 1) { setProvResults([]); return; }
    const { data } = await supabase.from('proveedores').select('id, nombre').eq('empresa_id', empresaId).ilike('nombre', `%${q}%`).limit(6);
    setProvResults(data ?? []);
  };

  const selectProveedor = (prov) => {
    setSelectedProv(prov);
    setProvSearch(prov.nombre);
    setForm(f => ({ ...f, proveedor_nombre: prov.nombre }));
    setProvResults([]);
  };

  const searchProducto = async (idx, q) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], _prodSearch: q, descripcion: q };
    setItems(updated);
    if (!q || q.length < 2) { setProdResults(p => ({ ...p, [idx]: [] })); return; }
    const { data } = await supabase.from('productos').select('id, nombre, costo_compra, unidad_medida').eq('empresa_id', empresaId).ilike('nombre', `%${q}%`).limit(6);
    setProdResults(p => ({ ...p, [idx]: data ?? [] }));
  };

  const selectProducto = (idx, prod) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], producto_id: prod.id, descripcion: prod.nombre, _prodSearch: prod.nombre, costo_unitario: prod.costo_compra ?? '', unidad_medida: prod.unidad_medida ?? '' };
    setItems(updated);
    setProdResults(p => ({ ...p, [idx]: [] }));
  };

  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };

  const total = items.reduce((s, i) => s + (parseFloat(i.cantidad_pedida) || 0) * (parseNumberLocale(i.costo_unitario) || 0), 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    const validItems = items.filter(i => i.descripcion && i.cantidad_pedida > 0 && (parseNumberLocale(i.costo_unitario) || 0) > 0);
    if (!validItems.length) { toast({ title: 'Agrega al menos un ítem válido', variant: 'destructive' }); return; }
    createMutation.mutate({
      proveedor_id: selectedProv?.id ?? null,
      proveedor_nombre: form.proveedor_nombre || null,
      fecha_entrega_esperada: form.fecha_entrega_esperada || null,
      forma_pago: form.forma_pago,
      notas: form.notas || undefined,
      moneda: form.moneda,
      tipoCambioTasa: form.tipoCambioTasa,
      items: validItems.map(i => ({
        producto_id: i.producto_id ?? null,
        descripcion: i.descripcion,
        cantidad_pedida: parseFloat(i.cantidad_pedida),
        costo_unitario: parseNumberLocale(i.costo_unitario) || 0,
        unidad_medida: i.unidad_medida || null,
      })),
    });
  };

  const filteredList = (listData?.data ?? []).filter(oc =>
    !search || oc.numero?.includes(search) || (oc.proveedor_nombre ?? '').toLowerCase().includes(search.toLowerCase())
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-indigo-500" /> Órdenes de Compra
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Gestioná pedidos a proveedores con seguimiento de recepción y actualización de stock automática
          </p>
        </div>
        <Button onClick={() => setTab('nueva')} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nueva OC
        </Button>
      </div>

      {/* Stats rápidas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
        {[
          { est: 'borrador',         accent: 'border-t-kx-text-3' },
          { est: 'enviada',          accent: 'border-t-kx-blue'   },
          { est: 'recibida_parcial', accent: 'border-t-kx-amber'  },
          { est: 'recibida',         accent: 'border-t-kx-green'  },
        ].map(({ est, accent }) => {
          const count = (listData?.data ?? []).filter(o => o.estado === est).length;
          const cfg = ESTADOS[est];
          const Icon = cfg.icon;
          return (
            <button key={est} onClick={() => { setEstadoFiltro(estadoFiltro === est ? '' : est); setPage(1); }}
              className={`p-4 text-left border-t-2 ${accent} transition-colors duration-200
                ${estadoFiltro === est ? 'bg-kx-surface-2' : 'bg-kx-surface hover:bg-kx-surface-2'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cfg.color}`}>{cfg.label}</span>
                <Icon className="w-4 h-4 text-kx-text-3" />
              </div>
              <p className="text-2xl font-bold text-kx-text tabular-nums">{count}</p>
            </button>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-transparent gap-2">
          <TabsTrigger value="lista" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface rounded-md px-4 py-2 text-slate-500 dark:text-kx-text-2">
            <ShoppingBag className="w-4 h-4 mr-2" /> Lista
          </TabsTrigger>
          <TabsTrigger value="nueva" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface rounded-md px-4 py-2 text-slate-500 dark:text-kx-text-2">
            <Plus className="w-4 h-4 mr-2" /> Nueva OC
          </TabsTrigger>
        </TabsList>

        {/* ── LISTA ── */}
        <TabsContent value="lista" className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-kx-text-3" />
              <Input placeholder="Buscar número o proveedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 dark:bg-kx-surface dark:border-kx-border" />
            </div>
            <select value={estadoFiltro} onChange={e => { setEstadoFiltro(e.target.value); setPage(1); }}
              className="h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface text-sm px-3 text-slate-700 dark:text-slate-300">
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
                <tr>
                  <th className="p-4 text-left">N° OC</th>
                  <th className="p-4 text-left">Proveedor</th>
                  <th className="p-4 text-left">Fecha</th>
                  <th className="p-4 text-left">Entrega esperada</th>
                  <th className="p-4 text-left">Estado</th>
                  <th className="p-4 text-right">Total</th>
                  <th className="p-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr><td colSpan={7} className="p-10 text-center text-kx-text-3">Cargando...</td></tr>
                ) : filteredList.length === 0 ? (
                  <tr><td colSpan={7} className="p-10 text-center text-kx-text-3">
                    <div className="flex flex-col items-center gap-2">
                      <ShoppingBag className="w-8 h-8 opacity-30" />
                      <span>No hay órdenes de compra</span>
                    </div>
                  </td></tr>
                ) : filteredList.map(oc => {
                  const cfg = ESTADOS[oc.estado] ?? ESTADOS.borrador;
                  const Icon = cfg.icon;
                  return (
                    <tr key={oc.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">{oc.numero}</td>
                      <td className="p-4 font-medium text-slate-700 dark:text-kx-text">{oc.proveedor_nombre ?? oc.proveedores?.nombre ?? '—'}</td>
                      <td className="p-4 text-slate-500 dark:text-kx-text-2">{formatDateAR(oc.created_at)}</td>
                      <td className="p-4 text-slate-500 dark:text-kx-text-2">
                        {oc.fecha_entrega_esperada ? formatDateAR(oc.fecha_entrega_esperada) : '—'}
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                          <Icon className="w-3 h-3" /> {cfg.label}
                        </span>
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-kx-text dark:text-kx-text">
                        {formatCurrency(oc.total, oc.moneda ?? 'ARS')}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-indigo-500"
                            onClick={() => setDetalleId(oc.id)} title="Ver detalle">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>

                          {oc.estado === 'borrador' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-600"
                              onClick={() => estadoMutation.mutate({ id: oc.id, estado: 'enviada' })} title="Marcar como enviada al proveedor">
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          )}

                          {['enviada', 'recibida_parcial'].includes(oc.estado) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-green-600"
                              onClick={() => setGenRecepId(oc.id)} title="Generar Recepción">
                              <Package className="w-3.5 h-3.5" />
                            </Button>
                          )}

                          {['borrador', 'enviada'].includes(oc.estado) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500"
                              onClick={() => cancelarMutation.mutate(oc.id)} title="Cancelar OC">
                              <XCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}

                          {['recibida', 'recibida_parcial'].includes(oc.estado) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-orange-500"
                              onClick={() => setDevolverOC(oc)} title="Devolver al proveedor">
                              <RotateCcw className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {listData && listData.pages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Anterior</Button>
              <span className="text-sm text-slate-500">{page} / {listData.pages}</span>
              <Button variant="outline" size="sm" disabled={page >= listData.pages} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
            </div>
          )}
        </TabsContent>

        {/* ── NUEVA OC ── */}
        <TabsContent value="nueva">
          <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
            <Card className="dark:bg-kx-bg dark:border-kx-border">
              <CardHeader><CardTitle className="text-base dark:text-kx-text">Datos del Pedido</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Proveedor */}
                <div className="space-y-2 relative">
                  <Label className="dark:text-kx-text">Proveedor</Label>
                  <Input value={provSearch} onChange={e => searchProveedor(e.target.value)}
                    placeholder="Buscar proveedor..." className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
                  {provResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1">
                      {provResults.map(p => (
                        <button key={p.id} type="button" onClick={() => selectProveedor(p)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text">
                          {p.nombre}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="dark:text-kx-text">Forma de pago</Label>
                  <select value={form.forma_pago} onChange={e => setForm(f => ({ ...f, forma_pago: e.target.value }))}
                    className="w-full h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm text-slate-700 dark:text-slate-300">
                    {FORMAS_PAGO.map(fp => <option key={fp}>{fp}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="dark:text-kx-text">Fecha de entrega esperada</Label>
                  <Input type="date" value={form.fecha_entrega_esperada}
                    onChange={e => setForm(f => ({ ...f, fecha_entrega_esperada: e.target.value }))}
                    className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
                </div>

                <div className="space-y-2">
                  <Label className="dark:text-kx-text">Notas internas</Label>
                  <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Instrucciones especiales, referencia, etc."
                    className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
                </div>
                <div className="col-span-2">
                  <MonedaSelector
                    moneda={form.moneda}
                    tasa={form.tipoCambioTasa}
                    onMonedaChange={v => {
                      setForm(f => ({ ...f, moneda: v, tipoCambioTasa: v === 'ARS' ? 1 : f.tipoCambioTasa }));
                      if (v === 'ARS') setTcMissingOC(false);
                    }}
                    onTasaChange={v => setForm(f => ({ ...f, tipoCambioTasa: v }))}
                    onTCMissingChange={setTcMissingOC}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Ítems */}
            <Card className="dark:bg-kx-bg dark:border-kx-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base dark:text-kx-text">Productos a pedir</CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={() => setItems(prev => [...prev, { ...EMPTY_ITEM }])}
                  className="dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Header de columnas */}
                <div className="hidden md:grid grid-cols-12 gap-2 text-xs text-kx-text-3 uppercase font-semibold px-1">
                  <div className="col-span-5">Producto / Descripción</div>
                  <div className="col-span-2">Cantidad</div>
                  <div className="col-span-2">Unidad</div>
                  <div className="col-span-2">Costo unit.</div>
                  <div className="col-span-1"></div>
                </div>

                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5 relative">
                      <Input value={item._prodSearch ?? item.descripcion}
                        onChange={e => searchProducto(idx, e.target.value)}
                        placeholder="Buscar producto o describir"
                        className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                      {(prodResults[idx] ?? []).length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-20 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1 max-h-40 overflow-y-auto">
                          {prodResults[idx].map(p => (
                            <button key={p.id} type="button" onClick={() => selectProducto(idx, p)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text flex justify-between">
                              <span>{p.nombre}</span>
                              <span className="text-kx-text-3 text-xs">Costo: ${p.costo_compra ?? '—'}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2">
                      <Input type="number" min="1" step="1" value={item.cantidad_pedida}
                        onChange={e => updateItem(idx, 'cantidad_pedida', e.target.value.replace(/[^\d]/g, ''))}
                        className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                    </div>
                    <div className="col-span-2">
                      <select
                        value={item.unidad_medida || ''}
                        onChange={e => updateItem(idx, 'unidad_medida', e.target.value)}
                        className="w-full h-10 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">— Elegí —</option>
                        {unidadesMedida.map(u => (
                          <option key={u.id} value={u.descripcion}>{u.descripcion} ({u.codigo.toLowerCase()})</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Input type="text" inputMode="decimal" value={item.costo_unitario} placeholder="0,00"
                        onChange={e => updateItem(idx, 'costo_unitario', e.target.value)}
                        className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-kx-text-3 hover:text-red-500"
                        onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end pt-4 border-t border-kx-border dark:border-kx-border">
                  <div className="text-right">
                    <span className="text-sm text-slate-500 mr-4">Total pedido:</span>
                    <span className="text-2xl font-bold font-mono text-slate-900 dark:text-kx-text">
                      {formatCurrency(total, form.moneda)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={resetForm} className="dark:border-kx-border dark:text-slate-300">Limpiar</Button>
              <div className="flex flex-col items-end gap-1">
                <Button
                  type="submit"
                  disabled={createMutation.isPending || (form.moneda !== 'ARS' && tcMissingOC)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
                >
                  <ShoppingBag className="w-4 h-4" />
                  {createMutation.isPending ? 'Guardando...' : 'Crear Orden de Compra'}
                </Button>
                {form.moneda !== 'ARS' && tcMissingOC && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    ⚠ Cargá el TC del día para habilitar la creación de la OC
                  </p>
                )}
              </div>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      {/* ── MODAL: Detalle OC ── */}
      <Dialog open={!!detalleId} onOpenChange={() => setDetalleId(null)}>
        <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-indigo-500" />
              Orden de Compra {detalle?.numero}
            </DialogTitle>
          </DialogHeader>
          {detalle && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-kx-text-3 uppercase mb-1">Proveedor</p>
                  <p className="font-medium dark:text-kx-text">{detalle.proveedor_nombre ?? detalle.proveedores?.nombre ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-kx-text-3 uppercase mb-1">Estado</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>
                    {ESTADOS[detalle.estado]?.label}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-kx-text-3 uppercase mb-1">Forma de pago</p>
                  <p className="dark:text-slate-300">{detalle.forma_pago}</p>
                </div>
                <div>
                  <p className="text-xs text-kx-text-3 uppercase mb-1">Entrega esperada</p>
                  <p className="dark:text-slate-300">{detalle.fecha_entrega_esperada ? formatDateAR(detalle.fecha_entrega_esperada) : '—'}</p>
                </div>
              </div>

              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-kx-border dark:border-kx-border">
                    <th className="text-left py-2 text-xs text-kx-text-3">Producto</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Pedido</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Recibido</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Costo unit.</th>
                    <th className="text-right py-2 text-xs text-kx-text-3">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(detalle.ordenes_compra_items ?? []).map(item => {
                    const progreso = item.cantidad_pedida > 0 ? (item.cantidad_recibida / item.cantidad_pedida) * 100 : 0;
                    return (
                      <tr key={item.id}>
                        <td className="py-2 dark:text-slate-300">{item.descripcion}</td>
                        <td className="py-2 text-right dark:text-slate-300">{item.cantidad_pedida} {item.unidad_medida}</td>
                        <td className="py-2 text-right">
                          <span className={`font-medium ${item.cantidad_recibida >= item.cantidad_pedida ? 'text-green-600 dark:text-green-400' : item.cantidad_recibida > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-kx-text-3'}`}>
                            {item.cantidad_recibida}
                          </span>
                          <div className="w-16 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mt-1 ml-auto">
                            <div className={`h-1 rounded-full ${progreso >= 100 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${Math.min(progreso, 100)}%` }} />
                          </div>
                        </td>
                        <td className="py-2 text-right dark:text-slate-300">{formatCurrency(item.costo_unitario, detalle.moneda ?? 'ARS')}</td>
                        <td className="py-2 text-right font-medium dark:text-kx-text">{formatCurrency(item.subtotal, detalle.moneda ?? 'ARS')}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-kx-border dark:border-kx-border">
                    <td colSpan={4} className="py-3 text-right font-bold dark:text-kx-text">TOTAL {detalle.moneda && detalle.moneda !== 'ARS' && <span className="text-xs font-normal text-kx-text-3 ml-1">({detalle.moneda} — tasa {detalle.tipo_cambio_tasa})</span>}</td>
                    <td className="py-3 text-right font-bold text-lg dark:text-kx-text">{formatCurrency(detalle.total, detalle.moneda ?? 'ARS')}</td>
                  </tr>
                </tfoot>
              </table>

              {detalle.notas && (
                <div className="p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg text-sm text-kx-text-2 dark:text-kx-text-2">
                  <span className="font-medium">Notas: </span>{detalle.notas}
                </div>
              )}

              {/* ── 3-Way Match ── */}
              {(() => {
                const totalOC = Number(detalle.total);
                const totalRecibido = (detalle.ordenes_compra_items ?? [])
                  .reduce((s, i) => s + Number(i.cantidad_recibida) * Number(i.costo_unitario), 0);
                const totalFactura = factura ? Number(factura.monto_total) : null;
                const diff = totalFactura !== null ? Math.abs(totalFactura - totalRecibido) : null;
                const matchOk = diff !== null && diff < 0.01;
                const matchWarn = diff !== null && !matchOk && diff / (totalRecibido || 1) < 0.05;

                const FACTURA_ESTADO_COLORS = {
                  pendiente: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
                  pagada:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
                  vencida:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                  anulada:   'bg-slate-100 text-slate-500 dark:bg-kx-surface-2 dark:text-kx-text-2',
                };

                return (
                  <div className="border border-kx-border dark:border-kx-border rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-2">
                      <Receipt className="w-3.5 h-3.5" /> 3-Way Match
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                        <p className="text-xs text-kx-text-3 mb-1">Total OC</p>
                        <p className="font-bold text-sm dark:text-kx-text">{formatCurrency(totalOC, detalle.moneda ?? 'ARS')}</p>
                      </div>
                      <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                        <p className="text-xs text-kx-text-3 mb-1">Recibido</p>
                        <p className={`font-bold text-sm ${totalRecibido >= totalOC ? 'text-green-600 dark:text-green-400' : totalRecibido > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-kx-text-3'}`}>
                          {formatCurrency(totalRecibido, detalle.moneda ?? 'ARS')}
                        </p>
                      </div>
                      <div className="p-2 rounded bg-kx-surface-2 dark:bg-kx-surface">
                        <p className="text-xs text-kx-text-3 mb-1">Factura</p>
                        {totalFactura !== null ? (
                          <p className={`font-bold text-sm ${matchOk ? 'text-green-600 dark:text-green-400' : matchWarn ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500'}`}>
                            {formatCurrency(totalFactura, detalle.moneda ?? 'ARS')}
                          </p>
                        ) : (
                          <p className="text-xs text-kx-text-3 italic">Sin factura</p>
                        )}
                      </div>
                    </div>

                    {totalFactura !== null && (
                      <div className={`p-2 rounded text-xs flex items-center gap-2 ${matchOk ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : matchWarn ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'}`}>
                        {matchOk ? <BadgeCheck className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
                        {matchOk
                          ? 'Match perfecto — OC, recepción y factura coinciden.'
                          : `Diferencia de $${diff.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} entre recibido y factura.`}
                      </div>
                    )}

                    {factura ? (
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-kx-text-2">
                          <span className={`px-2 py-0.5 rounded font-medium ${FACTURA_ESTADO_COLORS[factura.estado]}`}>
                            {factura.estado.charAt(0).toUpperCase() + factura.estado.slice(1)}
                          </span>
                          <span>N° {factura.numero_factura}</span>
                          {factura.fecha_vencimiento && (
                            <span>· Vence: {formatDateAR(factura.fecha_vencimiento)}</span>
                          )}
                        </div>
                        {factura.estado === 'pendiente' && (
                          <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"
                            onClick={() => pagarFacturaMutation.mutate(factura.id)}
                            disabled={pagarFacturaMutation.isPending}>
                            <Banknote className="w-3.5 h-3.5" /> Marcar pagada
                          </Button>
                        )}
                      </div>
                    ) : (
                      ['recibida_parcial', 'recibida'].includes(detalle.estado) && (
                        <Button size="sm" variant="outline" className="w-full gap-2 text-xs"
                          onClick={() => {
                            setFacturaForm({
                              numero_factura: '', fecha_factura: '',
                              fecha_vencimiento: '',
                              monto_total: totalRecibido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                              notas: ''
                            });
                            setFacturaModal(true);
                          }}>
                          <Receipt className="w-3.5 h-3.5" /> Registrar Factura del Proveedor
                        </Button>
                      )
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter className="gap-2">
            {detalle && ['recibida', 'recibida_parcial'].includes(detalle.estado) && (
              <Button variant="outline" className="gap-2 text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-900/20"
                onClick={() => { setDetalleId(null); setDevolverOC(detalle); }}>
                <RotateCcw className="w-4 h-4" /> Devolver
              </Button>
            )}
            {detalle && ['enviada', 'recibida_parcial'].includes(detalle.estado) && (
              <Button className="bg-green-600 hover:bg-green-700 text-white gap-2"
                onClick={() => { setDetalleId(null); setGenRecepId(detalle.id); }}>
                <Truck className="w-4 h-4" /> Registrar Recepción
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetalleId(null)} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: Registrar Factura del Proveedor ── */}
      <Dialog open={facturaModal} onOpenChange={setFacturaModal}>
        <DialogContent className="max-w-md dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <Receipt className="w-5 h-5 text-indigo-500" />
              Registrar Factura — OC {detalle?.numero}
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Completá los datos de la factura recibida del proveedor.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRegistrarFactura} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">N° de Factura *</label>
                <input
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text"
                  placeholder="ej: A-0001-00012345"
                  value={facturaForm.numero_factura}
                  onChange={e => setFacturaForm(p => ({ ...p, numero_factura: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Fecha Factura *</label>
                <input type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text dark:[color-scheme:dark]"
                  value={facturaForm.fecha_factura}
                  onChange={e => setFacturaForm(p => ({ ...p, fecha_factura: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Vencimiento</label>
                <input type="date"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text dark:[color-scheme:dark]"
                  value={facturaForm.fecha_vencimiento}
                  onChange={e => setFacturaForm(p => ({ ...p, fecha_vencimiento: e.target.value }))}
                />
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Monto Total Facturado *</label>
                <input type="text" inputMode="decimal"
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text"
                  placeholder="0,00"
                  value={facturaForm.monto_total}
                  onChange={e => setFacturaForm(p => ({ ...p, monto_total: e.target.value }))}
                  required
                />
                <p className="text-xs text-kx-text-3 mt-1">Pre-cargado con el total de lo recibido. Ajustá si el proveedor facturó diferente.</p>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Notas</label>
                <textarea
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-kx-text resize-none"
                  rows={2}
                  placeholder="Observaciones opcionales..."
                  value={facturaForm.notas}
                  onChange={e => setFacturaForm(p => ({ ...p, notas: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFacturaModal(false)} className="dark:border-kx-border dark:text-slate-300">Cancelar</Button>
              <Button type="submit" disabled={registrarFacturaMutation.isPending}>
                {registrarFacturaMutation.isPending ? 'Guardando...' : 'Registrar Factura'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: Generar Recepción (nuevo flujo via crear_recepcion RPC) ── */}
      <GenerarRecepcionModal
        ocId={genRecepId}
        onClose={() => setGenRecepId(null)}
        onSuccess={() => {
          setGenRecepId(null);
          qc.invalidateQueries({ queryKey: OC_KEYS.list(empresaId) });
        }}
      />

      {/* ── MODAL: Devolución al Proveedor desde OC ── */}
      <NuevaDevolucionProveedorModal
        isOpen={!!devolverOC}
        onClose={() => setDevolverOC(null)}
        oc={devolverOC}
        onSuccess={() => {
          setDevolverOC(null);
          qc.invalidateQueries({ queryKey: OC_KEYS.list(empresaId) });
        }}
      />
    </div>
  );
}

export default OrdenesCompraSection;
