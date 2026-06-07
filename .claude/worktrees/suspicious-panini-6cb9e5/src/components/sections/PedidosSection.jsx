import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, ShoppingBasket, Search, Eye, Trash2,
  CheckCircle, XCircle, ArrowRight, Loader2, PackageCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { pedidosService, PEDIDOS_KEYS } from '@/services/pedidosService';
import NuevaVentaModal from '@/components/ventas/NuevaVentaModal';

const ESTADOS = {
  borrador:       { label: 'Borrador',        color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  confirmado:     { label: 'Confirmado',       color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  en_preparacion: { label: 'En preparación',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  facturado:      { label: 'Facturado',        color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  cancelado:      { label: 'Cancelado',        color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

const EMPTY_ITEM = { descripcion: '', cantidad: 1, precio_unitario: '', producto_id: null, unidad_medida: '' };

function PedidosSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState('lista');
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Detalle modal
  const [viewId, setViewId] = useState(null);

  // Convertir a venta
  const [convertirPedido, setConvertirPedido] = useState(null);
  const [loadingConvertir, setLoadingConvertir] = useState(false);
  const [showVentaModal, setShowVentaModal] = useState(false);

  // Formulario nuevo pedido
  const [clientes, setClientes] = useState([]);
  const [clienteSeleccionado, setClienteSeleccionado] = useState(null);
  const [form, setForm] = useState({ notas: '', fecha_entrega: '' });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [prodSearch, setProdSearch] = useState({});
  const [prodResults, setProdResults] = useState({});

  const empresaId = user?.empresa_id;

  const { data: listData, isLoading } = useQuery({
    queryKey: PEDIDOS_KEYS.list(empresaId, { estado: estadoFiltro, page }),
    queryFn: () => pedidosService.getAll(empresaId, { estado: estadoFiltro || undefined, page }),
    enabled: !!empresaId,
  });

  const { data: detalle } = useQuery({
    queryKey: PEDIDOS_KEYS.detail(viewId),
    queryFn: () => pedidosService.getById(viewId),
    enabled: !!viewId,
  });

  const createMutation = useMutation({
    mutationFn: (payload) => pedidosService.create(empresaId, user.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pedidos', empresaId] });
      toast({ title: 'Pedido creado', className: 'bg-green-600 text-white' });
      setTab('lista');
      resetForm();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const estadoMutation = useMutation({
    mutationFn: ({ id, estado }) => pedidosService.updateEstado(id, estado),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pedidos', empresaId] }),
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => pedidosService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pedidos', empresaId] });
      toast({ title: 'Pedido eliminado' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // Carga clientes cuando se abre el tab nuevo
  const handleTabChange = async (val) => {
    setTab(val);
    if (val === 'nuevo' && clientes.length === 0) {
      const { data } = await supabase
        .from('clientes')
        .select('id, nombre, condicion_pago')
        .eq('empresa_id', empresaId)
        .neq('activo', false)
        .order('nombre');
      setClientes(data || []);
    }
  };

  const resetForm = () => {
    setClienteSeleccionado(null);
    setForm({ notas: '', fecha_entrega: '' });
    setItems([{ ...EMPTY_ITEM }]);
    setProdSearch({});
    setProdResults({});
  };

  // Búsqueda de productos para ítems
  const searchProducto = async (idx, q) => {
    setProdSearch(prev => ({ ...prev, [idx]: q }));
    if (!q || q.length < 2) { setProdResults(prev => ({ ...prev, [idx]: [] })); return; }
    const { data } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, unidad_medida, stock_actual, codigo_sku')
      .eq('empresa_id', empresaId)
      .neq('activo', false)
      .ilike('nombre', `%${q}%`)
      .limit(6);
    setProdResults(prev => ({ ...prev, [idx]: data ?? [] }));
  };

  const selectProducto = (idx, prod) => {
    const updated = [...items];
    updated[idx] = {
      ...updated[idx],
      producto_id: prod.id,
      descripcion: prod.nombre,
      precio_unitario: prod.precio_venta ?? '',
      unidad_medida: prod.unidad_medida ?? '',
    };
    setItems(updated);
    setProdSearch(prev => ({ ...prev, [idx]: prod.nombre }));
    setProdResults(prev => ({ ...prev, [idx]: [] }));
  };

  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };

  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const total = items.reduce((s, i) => {
    return s + (parseFloat(i.cantidad) || 0) * (parseFloat(i.precio_unitario) || 0);
  }, 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    const validItems = items.filter(i => i.descripcion && Number(i.cantidad) > 0 && Number(i.precio_unitario) >= 0);
    if (validItems.length === 0) {
      toast({ title: 'Agrega al menos un ítem válido', variant: 'destructive' }); return;
    }
    createMutation.mutate({
      clienteId: clienteSeleccionado?.id ?? null,
      clienteNombre: clienteSeleccionado?.nombre ?? null,
      items: validItems,
      notas: form.notas || null,
      fechaEntrega: form.fecha_entrega || null,
    });
  };

  // Convertir pedido a venta
  const handleConvertir = async (pedidoId) => {
    setLoadingConvertir(true);
    try {
      const data = await pedidosService.getById(pedidoId);
      setConvertirPedido(data);
      setShowVentaModal(true);
    } catch (e) {
      toast({ title: 'Error al cargar el pedido', description: e.message, variant: 'destructive' });
    } finally {
      setLoadingConvertir(false);
    }
  };

  const handlePedidoConverted = async (comprobanteId) => {
    if (!convertirPedido?.id) return;
    try {
      await pedidosService.markAsFacturado(convertirPedido.id, comprobanteId);
      qc.invalidateQueries({ queryKey: ['pedidos', empresaId] });
      toast({ title: 'Pedido facturado', description: `Comprobante vinculado al pedido ${convertirPedido.numero}.`, className: 'bg-green-600 text-white' });
    } catch (e) {
      console.warn('[Pedidos] No se pudo marcar como facturado:', e.message);
    } finally {
      setConvertirPedido(null);
    }
  };

  const filteredData = (listData?.data ?? []).filter(p =>
    !search ||
    p.numero?.toLowerCase().includes(search.toLowerCase()) ||
    (p.cliente_nombre ?? p.clientes?.nombre ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <ShoppingBasket className="w-6 h-6 text-blue-500" /> Pedidos de Clientes
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Gestiona pedidos y conviértelos en ventas
          </p>
        </div>
        <Button onClick={() => handleTabChange('nuevo')} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nuevo Pedido
        </Button>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="bg-transparent gap-2">
          <TabsTrigger value="lista" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
            <ShoppingBasket className="w-4 h-4 mr-2" /> Lista
          </TabsTrigger>
          <TabsTrigger value="nuevo" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
            <Plus className="w-4 h-4 mr-2" /> Nuevo
          </TabsTrigger>
        </TabsList>

        {/* ─── LISTA ─── */}
        <TabsContent value="lista" className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Buscar número o cliente..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 dark:bg-slate-900 dark:border-slate-700"
              />
            </div>
            <select
              value={estadoFiltro}
              onChange={e => { setEstadoFiltro(e.target.value); setPage(1); }}
              className="h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 text-slate-700 dark:text-slate-300"
            >
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="p-4 text-left">Número</th>
                  <th className="p-4 text-left">Cliente</th>
                  <th className="p-4 text-left">Fecha</th>
                  <th className="p-4 text-left">Entrega</th>
                  <th className="p-4 text-left">Estado</th>
                  <th className="p-4 text-right">Total</th>
                  <th className="p-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-400">Cargando...</td></tr>
                ) : filteredData.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-400">No hay pedidos</td></tr>
                ) : filteredData.map(ped => (
                  <tr key={ped.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="p-4 font-mono font-semibold text-blue-600 dark:text-blue-400">{ped.numero}</td>
                    <td className="p-4 text-slate-700 dark:text-slate-300">
                      {ped.cliente_nombre ?? ped.clientes?.nombre ?? <span className="text-slate-400 italic">Sin cliente</span>}
                    </td>
                    <td className="p-4 text-slate-500 dark:text-slate-400">
                      {new Date(ped.created_at).toLocaleDateString('es-AR')}
                    </td>
                    <td className="p-4 text-slate-500 dark:text-slate-400">
                      {ped.fecha_entrega ? new Date(ped.fecha_entrega + 'T00:00:00').toLocaleDateString('es-AR') : '—'}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[ped.estado]?.color}`}>
                        {ESTADOS[ped.estado]?.label ?? ped.estado}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                      ${Number(ped.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1">
                        {/* Ver detalle */}
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-slate-400 hover:text-blue-500"
                          onClick={() => setViewId(ped.id)}
                          title="Ver detalle"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>

                        {/* Flujo de estados */}
                        {ped.estado === 'borrador' && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-blue-600"
                            onClick={() => estadoMutation.mutate({ id: ped.id, estado: 'confirmado' })}
                            title="Confirmar pedido"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {ped.estado === 'confirmado' && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-amber-600"
                            onClick={() => estadoMutation.mutate({ id: ped.id, estado: 'en_preparacion' })}
                            title="Marcar en preparación"
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {(ped.estado === 'confirmado' || ped.estado === 'en_preparacion') && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-green-600"
                            onClick={() => handleConvertir(ped.id)}
                            disabled={loadingConvertir}
                            title="Convertir a venta"
                          >
                            {loadingConvertir ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PackageCheck className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                        {(ped.estado === 'borrador' || ped.estado === 'confirmado' || ped.estado === 'en_preparacion') && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-red-500"
                            onClick={() => estadoMutation.mutate({ id: ped.id, estado: 'cancelado' })}
                            title="Cancelar pedido"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {(ped.estado === 'borrador' || ped.estado === 'cancelado') && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-slate-400 hover:text-red-500"
                            onClick={() => deleteMutation.mutate(ped.id)}
                            title="Eliminar"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
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

        {/* ─── NUEVO PEDIDO ─── */}
        <TabsContent value="nuevo">
          <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
            <Card className="dark:bg-slate-950 dark:border-slate-800">
              <CardHeader><CardTitle className="text-base dark:text-white">Datos del Pedido</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="dark:text-white">Cliente</Label>
                  <select
                    value={clienteSeleccionado?.id || ''}
                    onChange={e => setClienteSeleccionado(clientes.find(c => c.id === e.target.value) || null)}
                    className="w-full h-10 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 text-slate-700 dark:text-slate-300 focus:border-blue-500"
                  >
                    <option value="">Sin cliente asignado</option>
                    {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-white">Fecha de Entrega Estimada</Label>
                  <Input
                    type="date"
                    value={form.fecha_entrega}
                    onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))}
                    className="dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label className="dark:text-white">Notas u observaciones</Label>
                  <Input
                    value={form.notas}
                    onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                    placeholder="Instrucciones especiales, referencias, etc."
                    className="dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="dark:bg-slate-950 dark:border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base dark:text-white">Ítems del Pedido</CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5 space-y-1 relative">
                      <Label className="text-xs dark:text-slate-400">Producto</Label>
                      <Input
                        value={prodSearch[idx] ?? item.descripcion}
                        onChange={e => { searchProducto(idx, e.target.value); updateItem(idx, 'descripcion', e.target.value); updateItem(idx, 'producto_id', null); }}
                        placeholder="Buscar producto..."
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm"
                      />
                      {(prodResults[idx] ?? []).length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl mt-1 max-h-48 overflow-y-auto">
                          {prodResults[idx].map(p => (
                            <button key={p.id} type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-200 border-b last:border-0 dark:border-slate-700"
                              onClick={() => selectProducto(idx, p)}
                            >
                              <span className="font-medium">{p.nombre}</span>
                              <span className="text-slate-400 text-xs ml-2">Stock: {p.stock_actual} · ${p.precio_venta}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-slate-400">Cantidad</Label>
                      <Input
                        type="number" min="0.001" step="0.001"
                        value={item.cantidad}
                        onChange={e => updateItem(idx, 'cantidad', e.target.value)}
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-slate-400">Unidad</Label>
                      <Input
                        value={item.unidad_medida}
                        onChange={e => updateItem(idx, 'unidad_medida', e.target.value)}
                        placeholder="un"
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-slate-400">Precio Unit.</Label>
                      <Input
                        type="number" min="0" step="0.01"
                        value={item.precio_unitario}
                        onChange={e => updateItem(idx, 'precio_unitario', e.target.value)}
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm"
                      />
                    </div>
                    <div className="col-span-1 flex justify-end pb-0.5">
                      <Button
                        type="button" variant="ghost" size="icon"
                        className="h-8 w-8 text-slate-400 hover:text-red-500"
                        onClick={() => removeItem(idx)}
                        disabled={items.length === 1}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
                  <div className="text-right">
                    <span className="text-sm text-slate-500 dark:text-slate-400 mr-4">Total estimado:</span>
                    <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono">
                      ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={resetForm} className="dark:border-slate-700 dark:text-slate-300">
                Limpiar
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {createMutation.isPending ? 'Guardando...' : 'Guardar Pedido'}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      {/* ─── MODAL DETALLE ─── */}
      <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
        <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white flex items-center gap-2">
              <ShoppingBasket className="w-5 h-5 text-blue-500" />
              Pedido {detalle?.numero}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              Detalle y líneas del pedido.
            </DialogDescription>
          </DialogHeader>

          {detalle && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-400 dark:text-slate-500 text-xs uppercase">Cliente</span>
                  <p className="font-medium dark:text-white">
                    {detalle.cliente_nombre ?? detalle.clientes?.nombre ?? <span className="italic text-slate-400">Sin cliente</span>}
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-slate-500 text-xs uppercase">Estado</span>
                  <p>
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>
                      {ESTADOS[detalle.estado]?.label}
                    </span>
                  </p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-slate-500 text-xs uppercase">Fecha</span>
                  <p className="dark:text-slate-300">{new Date(detalle.created_at).toLocaleDateString('es-AR')}</p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-slate-500 text-xs uppercase">Entrega estimada</span>
                  <p className="dark:text-slate-300">
                    {detalle.fecha_entrega
                      ? new Date(detalle.fecha_entrega + 'T00:00:00').toLocaleDateString('es-AR')
                      : '—'}
                  </p>
                </div>
              </div>

              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="text-left py-2 text-xs text-slate-400">Descripción</th>
                    <th className="text-right py-2 text-xs text-slate-400">Cant.</th>
                    <th className="text-right py-2 text-xs text-slate-400">Precio</th>
                    <th className="text-right py-2 text-xs text-slate-400">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(detalle.pedido_items ?? []).map(item => (
                    <tr key={item.id}>
                      <td className="py-2 dark:text-slate-300">
                        {item.descripcion}
                        {item.unidad_medida && <span className="text-xs text-slate-400 ml-1">({item.unidad_medida})</span>}
                      </td>
                      <td className="py-2 text-right dark:text-slate-300">{Number(item.cantidad)}</td>
                      <td className="py-2 text-right dark:text-slate-300">${Number(item.precio_unitario).toFixed(2)}</td>
                      <td className="py-2 text-right font-medium dark:text-white">${Number(item.subtotal).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-slate-700">
                    <td colSpan={3} className="py-3 text-right font-bold dark:text-white">TOTAL</td>
                    <td className="py-3 text-right font-bold text-lg dark:text-white">
                      ${Number(detalle.total).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>

              {detalle.notas && (
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium">Notas: </span>{detalle.notas}
                </div>
              )}

              {detalle.comprobante_id && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm text-green-700 dark:text-green-400 flex items-center gap-2">
                  <PackageCheck className="w-4 h-4" />
                  Convertido a venta — comprobante generado.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            {detalle && (detalle.estado === 'confirmado' || detalle.estado === 'en_preparacion') && (
              <Button
                onClick={() => { setViewId(null); handleConvertir(detalle.id); }}
                disabled={loadingConvertir}
                className="bg-green-600 hover:bg-green-700 text-white gap-2"
              >
                <PackageCheck className="w-4 h-4" />
                Convertir a Venta
              </Button>
            )}
            <Button variant="outline" onClick={() => setViewId(null)} className="dark:border-slate-700 dark:text-slate-300">
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL NUEVA VENTA (preloaded desde pedido) ─── */}
      <NuevaVentaModal
        isOpen={showVentaModal}
        onOpenChange={(open) => {
          setShowVentaModal(open);
          if (!open) setConvertirPedido(null);
        }}
        onSaleSuccess={() => qc.invalidateQueries({ queryKey: ['pedidos', empresaId] })}
        initialPedido={convertirPedido}
        onPedidoConverted={handlePedidoConverted}
      />
    </div>
  );
}

export default PedidosSection;
