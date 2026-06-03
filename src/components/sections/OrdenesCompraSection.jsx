import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, ShoppingBag, Search, Eye, Truck, XCircle,
  Send, CheckCircle, Clock, AlertCircle, Package,
  ChevronRight, Trash2, ArrowRight
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

// ─── Helpers de estado ────────────────────────────────────────────────────────

const ESTADOS = {
  borrador:         { label: 'Borrador',         color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',     icon: Clock },
  enviada:          { label: 'Enviada',           color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',      icon: Send },
  recibida_parcial: { label: 'Recibida parcial',  color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', icon: AlertCircle },
  recibida:         { label: 'Recibida',          color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',  icon: CheckCircle },
  cancelada:        { label: 'Cancelada',         color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',         icon: XCircle },
};

const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Cheque', 'Tarjeta Crédito', 'Cuenta Corriente'];
const EMPTY_ITEM = { descripcion: '', cantidad_pedida: 1, costo_unitario: '', producto_id: null, unidad_medida: '', _prodSearch: '' };

// ─── Componente principal ─────────────────────────────────────────────────────

function OrdenesCompraSection({ navPayload }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState('lista');
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // modales
  const [detalleId, setDetalleId] = useState(null);
  const [recepcionId, setRecepcionId] = useState(null);
  const [recepciones, setRecepciones] = useState({});   // { [itemId]: cantidad }

  // form nueva OC
  const [form, setForm] = useState({ proveedor_nombre: '', fecha_entrega_esperada: '', forma_pago: 'Efectivo', notas: '' });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [provSearch, setProvSearch] = useState('');
  const [provResults, setProvResults] = useState([]);
  const [selectedProv, setSelectedProv] = useState(null);
  const [prodResults, setProdResults] = useState({});

  const empresaId = user?.empresa_id;

  // Abrir modal de recepción directo desde notificaciones
  useEffect(() => {
    if (navPayload?.openRecepcion) {
      setRecepcionId(navPayload.openRecepcion);
    }
  }, [navPayload]);

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

  const { data: detalleRecepcion } = useQuery({
    queryKey: OC_KEYS.detail(recepcionId),
    queryFn: () => ordenesCompraService.getById(recepcionId),
    enabled: !!recepcionId,
    onSuccess: (data) => {
      // inicializar con la cantidad PENDIENTE de recibir (lo que falta, no lo que ya llegó)
      const init = {};
      (data?.ordenes_compra_items ?? []).forEach(i => {
        const pendiente = Number(i.cantidad_pedida) - Number(i.cantidad_recibida ?? 0);
        init[i.id] = Math.max(pendiente, 0);
      });
      setRecepciones(init);
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────

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

  const estadoMutation = useMutation({
    mutationFn: ({ id, estado }) => ordenesCompraService.updateEstado(id, estado),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ordenes_compra', empresaId] }),
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const cancelarMutation = useMutation({
    mutationFn: (id) => ordenesCompraService.cancelar(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ordenes_compra', empresaId] }),
  });

  const recibirMutation = useMutation({
    mutationFn: ({ ordenId, recepciones: recs }) =>
      ordenesCompraService.recibirItems(ordenId, Object.entries(recs).map(([itemId, qty]) => ({ itemId, cantidadRecibida: Number(qty) }))),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ordenes_compra', empresaId] });
      toast({ title: 'Stock actualizado ✓', description: 'Recepción registrada. El inventario fue actualizado automáticamente.', className: 'bg-green-600 text-white' });
      setRecepcionId(null);
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // ── Helpers de form ───────────────────────────────────────────────────────────

  const resetForm = () => {
    setForm({ proveedor_nombre: '', fecha_entrega_esperada: '', forma_pago: 'Efectivo', notas: '' });
    setItems([{ ...EMPTY_ITEM }]);
    setSelectedProv(null);
    setProvSearch('');
  };

  const searchProveedor = async (q) => {
    setProvSearch(q);
    setForm(f => ({ ...f, proveedor_nombre: q }));
    const query = supabase.from('proveedores').select('id, nombre').eq('empresa_id', empresaId).order('nombre').limit(10);
    const { data } = q ? await query.ilike('nombre', `%${q}%`) : await query;
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

  const total = items.reduce((s, i) => s + (parseFloat(i.cantidad_pedida) || 0) * (parseFloat(i.costo_unitario) || 0), 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    const validItems = items.filter(i => i.descripcion && i.cantidad_pedida > 0 && i.costo_unitario > 0);
    if (!validItems.length) { toast({ title: 'Agrega al menos un ítem válido', variant: 'destructive' }); return; }
    createMutation.mutate({
      proveedor_id: selectedProv?.id ?? null,
      proveedor_nombre: form.proveedor_nombre || null,
      fecha_entrega_esperada: form.fecha_entrega_esperada || null,
      forma_pago: form.forma_pago,
      notas: form.notas || undefined,
      items: validItems.map(i => ({
        producto_id: i.producto_id ?? null,
        descripcion: i.descripcion,
        cantidad_pedida: parseFloat(i.cantidad_pedida),
        costo_unitario: parseFloat(i.costo_unitario),
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
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-indigo-500" /> Órdenes de Compra
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Gestioná pedidos a proveedores con seguimiento de recepción y actualización de stock automática
          </p>
        </div>
        <Button onClick={() => setTab('nueva')} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nueva OC
        </Button>
      </div>

      {/* Stats rápidas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {['borrador', 'enviada', 'recibida_parcial', 'recibida'].map(est => {
          const count = (listData?.data ?? []).filter(o => o.estado === est).length;
          const cfg = ESTADOS[est];
          const Icon = cfg.icon;
          return (
            <button key={est} onClick={() => { setEstadoFiltro(estadoFiltro === est ? '' : est); setPage(1); }}
              className={`p-3 rounded-xl border text-left transition-all ${estadoFiltro === est ? 'ring-2 ring-indigo-500' : 'hover:shadow-md'} bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${cfg.color}`}>{cfg.label}</span>
                <Icon className="w-4 h-4 text-slate-400" />
              </div>
              <p className="text-2xl font-bold text-slate-800 dark:text-white">{count}</p>
            </button>
          );
        })}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-transparent gap-2">
          <TabsTrigger value="lista" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
            <ShoppingBag className="w-4 h-4 mr-2" /> Lista
          </TabsTrigger>
          <TabsTrigger value="nueva" className="data-[state=active]:bg-indigo-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
            <Plus className="w-4 h-4 mr-2" /> Nueva OC
          </TabsTrigger>
        </TabsList>

        {/* ── LISTA ── */}
        <TabsContent value="lista" className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <Input placeholder="Buscar número o proveedor..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 dark:bg-slate-900 dark:border-slate-700" />
            </div>
            <select value={estadoFiltro} onChange={e => { setEstadoFiltro(e.target.value); setPage(1); }}
              className="h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 text-slate-700 dark:text-slate-300">
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
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
                  <tr><td colSpan={7} className="p-10 text-center text-slate-400">Cargando...</td></tr>
                ) : filteredList.length === 0 ? (
                  <tr><td colSpan={7} className="p-10 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <ShoppingBag className="w-8 h-8 opacity-30" />
                      <span>No hay órdenes de compra</span>
                    </div>
                  </td></tr>
                ) : filteredList.map(oc => {
                  const cfg = ESTADOS[oc.estado] ?? ESTADOS.borrador;
                  const Icon = cfg.icon;
                  return (
                    <tr key={oc.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">{oc.numero}</td>
                      <td className="p-4 font-medium text-slate-700 dark:text-slate-200">{oc.proveedor_nombre ?? oc.proveedores?.nombre ?? '—'}</td>
                      <td className="p-4 text-slate-500 dark:text-slate-400">{new Date(oc.created_at).toLocaleDateString('es-AR')}</td>
                      <td className="p-4 text-slate-500 dark:text-slate-400">
                        {oc.fecha_entrega_esperada ? new Date(oc.fecha_entrega_esperada).toLocaleDateString('es-AR') : '—'}
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                          <Icon className="w-3 h-3" /> {cfg.label}
                        </span>
                      </td>
                      <td className="p-4 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                        ${Number(oc.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-4">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-indigo-500"
                            onClick={() => setDetalleId(oc.id)} title="Ver detalle">
                            <Eye className="w-3.5 h-3.5" />
                          </Button>

                          {oc.estado === 'borrador' && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-blue-600"
                              onClick={() => estadoMutation.mutate({ id: oc.id, estado: 'enviada' })} title="Marcar como enviada al proveedor">
                              <Send className="w-3.5 h-3.5" />
                            </Button>
                          )}

                          {['enviada', 'recibida_parcial'].includes(oc.estado) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-green-600"
                              onClick={() => setRecepcionId(oc.id)} title="Registrar recepción de mercadería">
                              <Truck className="w-3.5 h-3.5" />
                            </Button>
                          )}

                          {['borrador', 'enviada'].includes(oc.estado) && (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500"
                              onClick={() => cancelarMutation.mutate(oc.id)} title="Cancelar OC">
                              <XCircle className="w-3.5 h-3.5" />
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
            <Card className="dark:bg-slate-950 dark:border-slate-800">
              <CardHeader><CardTitle className="text-base dark:text-white">Datos del Pedido</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Proveedor */}
                <div className="space-y-2 relative">
                  <Label className="dark:text-white">Proveedor</Label>
                  <Input value={provSearch} onChange={e => searchProveedor(e.target.value)}
                    onFocus={() => searchProveedor(provSearch)}
                    onBlur={() => setTimeout(() => setProvResults([]), 200)}
                    placeholder="Buscar o seleccionar proveedor..." className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
                  {provResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl mt-1">
                      {provResults.map(p => (
                        <button key={p.id} type="button" onClick={() => selectProveedor(p)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-200">
                          {p.nombre}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label className="dark:text-white">Forma de pago</Label>
                  <select value={form.forma_pago} onChange={e => setForm(f => ({ ...f, forma_pago: e.target.value }))}
                    className="w-full h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm text-slate-700 dark:text-slate-300">
                    {FORMAS_PAGO.map(fp => <option key={fp}>{fp}</option>)}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label className="dark:text-white">Fecha de entrega esperada</Label>
                  <Input type="date" value={form.fecha_entrega_esperada}
                    onChange={e => setForm(f => ({ ...f, fecha_entrega_esperada: e.target.value }))}
                    className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
                </div>

                <div className="space-y-2">
                  <Label className="dark:text-white">Notas internas</Label>
                  <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Instrucciones especiales, referencia, etc."
                    className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
                </div>
              </CardContent>
            </Card>

            {/* Ítems */}
            <Card className="dark:bg-slate-950 dark:border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base dark:text-white">Productos a pedir</CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={() => setItems(prev => [...prev, { ...EMPTY_ITEM }])}
                  className="dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Header de columnas */}
                <div className="hidden md:grid grid-cols-12 gap-2 text-xs text-slate-400 uppercase font-semibold px-1">
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
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm" />
                      {(prodResults[idx] ?? []).length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl mt-1 max-h-40 overflow-y-auto">
                          {prodResults[idx].map(p => (
                            <button key={p.id} type="button" onClick={() => selectProducto(idx, p)}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-200 flex justify-between">
                              <span>{p.nombre}</span>
                              <span className="text-slate-400 text-xs">Costo: ${p.costo_compra ?? '—'}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2">
                      <Input type="number" min="0.001" step="0.001" value={item.cantidad_pedida}
                        onChange={e => updateItem(idx, 'cantidad_pedida', e.target.value)}
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm" />
                    </div>
                    <div className="col-span-2">
                      <Input list="unidades-medida" value={item.unidad_medida} placeholder="un"
                        onChange={e => updateItem(idx, 'unidad_medida', e.target.value)}
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm" />
                      <datalist id="unidades-medida">
                        <option value="un" />
                        <option value="kg" />
                        <option value="g" />
                        <option value="lt" />
                        <option value="ml" />
                        <option value="mt" />
                        <option value="cm" />
                        <option value="m²" />
                        <option value="m³" />
                        <option value="caja" />
                        <option value="pack" />
                        <option value="docena" />
                        <option value="par" />
                        <option value="hs" />
                        <option value="día" />
                        <option value="servicio" />
                      </datalist>
                    </div>
                    <div className="col-span-2">
                      <Input type="number" min="0" step="0.01" value={item.costo_unitario} placeholder="0.00"
                        onChange={e => updateItem(idx, 'costo_unitario', e.target.value)}
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm" />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500"
                        onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
                  <div className="text-right">
                    <span className="text-sm text-slate-500 mr-4">Total pedido:</span>
                    <span className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
                      ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={resetForm} className="dark:border-slate-700 dark:text-slate-300">Limpiar</Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                <ShoppingBag className="w-4 h-4" />
                {createMutation.isPending ? 'Guardando...' : 'Crear Orden de Compra'}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      {/* ── MODAL: Detalle OC ── */}
      <Dialog open={!!detalleId} onOpenChange={() => setDetalleId(null)}>
        <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white flex items-center gap-2">
              <ShoppingBag className="w-5 h-5 text-indigo-500" />
              Orden de Compra {detalle?.numero}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">Detalle e ítems de la orden de compra.</DialogDescription>
          </DialogHeader>
          {detalle && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Proveedor</p>
                  <p className="font-medium dark:text-white">{detalle.proveedor_nombre ?? detalle.proveedores?.nombre ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Estado</p>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>
                    {ESTADOS[detalle.estado]?.label}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Forma de pago</p>
                  <p className="dark:text-slate-300">{detalle.forma_pago}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase mb-1">Entrega esperada</p>
                  <p className="dark:text-slate-300">{detalle.fecha_entrega_esperada ? new Date(detalle.fecha_entrega_esperada).toLocaleDateString('es-AR') : '—'}</p>
                </div>
              </div>

              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="text-left py-2 text-xs text-slate-400">Producto</th>
                    <th className="text-right py-2 text-xs text-slate-400">Pedido</th>
                    <th className="text-right py-2 text-xs text-slate-400">Recibido</th>
                    <th className="text-right py-2 text-xs text-slate-400">Costo unit.</th>
                    <th className="text-right py-2 text-xs text-slate-400">Subtotal</th>
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
                          <span className={`font-medium ${item.cantidad_recibida >= item.cantidad_pedida ? 'text-green-600 dark:text-green-400' : item.cantidad_recibida > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-slate-400'}`}>
                            {item.cantidad_recibida}
                          </span>
                          <div className="w-16 h-1 bg-slate-200 dark:bg-slate-700 rounded-full mt-1 ml-auto">
                            <div className={`h-1 rounded-full ${progreso >= 100 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${Math.min(progreso, 100)}%` }} />
                          </div>
                        </td>
                        <td className="py-2 text-right dark:text-slate-300">${Number(item.costo_unitario).toFixed(2)}</td>
                        <td className="py-2 text-right font-medium dark:text-white">${Number(item.subtotal).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                    <td colSpan={4} className="py-3 text-right font-bold dark:text-white">TOTAL</td>
                    <td className="py-3 text-right font-bold text-lg dark:text-white">${Number(detalle.total).toFixed(2)}</td>
                  </tr>
                </tfoot>
              </table>

              {detalle.notas && (
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium">Notas: </span>{detalle.notas}
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            {detalle && ['enviada', 'recibida_parcial'].includes(detalle.estado) && (
              <Button className="bg-green-600 hover:bg-green-700 text-white gap-2"
                onClick={() => { setDetalleId(null); setRecepcionId(detalle.id); }}>
                <Truck className="w-4 h-4" /> Registrar Recepción
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetalleId(null)} className="dark:border-slate-700 dark:text-slate-300">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: Recepción de mercadería ── */}
      <Dialog open={!!recepcionId} onOpenChange={() => setRecepcionId(null)}>
        <DialogContent className="max-w-xl dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white flex items-center gap-2">
              <Truck className="w-5 h-5 text-green-500" /> Registrar Recepción
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              Ingresá las cantidades recibidas. El stock se actualizará automáticamente al confirmar.
            </DialogDescription>
          </DialogHeader>

          {detalleRecepcion && (
            <div className="space-y-3">
              {(detalleRecepcion.ordenes_compra_items ?? []).map(item => (
                <div key={item.id} className="flex items-center gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <Package className="w-5 h-5 text-slate-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm dark:text-white truncate">{item.descripcion}</p>
                    <p className="text-xs text-slate-400">
                      Pedido: {item.cantidad_pedida} {item.unidad_medida}
                      {' · '}
                      <span className="text-green-500">Recibido: {item.cantidad_recibida ?? 0}</span>
                      {' · '}
                      <span className="text-yellow-500">Pendiente: {Math.max(Number(item.cantidad_pedida) - Number(item.cantidad_recibida ?? 0), 0)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Label className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">Recibir ahora:</Label>
                    <Input type="number" min="0"
                      max={Math.max(Number(item.cantidad_pedida) - Number(item.cantidad_recibida ?? 0), 0)}
                      value={recepciones[item.id] !== undefined ? recepciones[item.id] : Math.max(Number(item.cantidad_pedida) - Number(item.cantidad_recibida ?? 0), 0)}
                      onChange={e => setRecepciones(r => ({ ...r, [item.id]: e.target.value }))}
                      className="w-20 text-center dark:bg-slate-800 dark:border-slate-700 dark:text-white text-sm" />
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRecepcionId(null)} className="dark:border-slate-700 dark:text-slate-300">Cancelar</Button>
            <Button className="bg-green-600 hover:bg-green-700 text-white gap-2"
              disabled={recibirMutation.isPending}
              onClick={() => recibirMutation.mutate({ ordenId: recepcionId, recepciones })}>
              <CheckCircle className="w-4 h-4" />
              {recibirMutation.isPending ? 'Actualizando stock...' : 'Confirmar Recepción'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default OrdenesCompraSection;
