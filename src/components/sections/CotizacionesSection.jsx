import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, FileText, Search, Eye, Trash2, CheckCircle, XCircle,
  Send, Clock, ArrowRight, Download, RefreshCw, Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cotizacionesService, COTIZACIONES_KEYS } from '@/services/cotizacionesService';
import { supabase } from '@/lib/customSupabaseClient';

const ESTADOS = {
  borrador:   { label: 'Borrador',   color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  enviada:    { label: 'Enviada',    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  aprobada:   { label: 'Aprobada',   color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  rechazada:  { label: 'Rechazada',  color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  vencida:    { label: 'Vencida',    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  convertida: { label: 'Convertida', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
};

const EMPTY_ITEM = { descripcion: '', cantidad: 1, precio_unitario: '', producto_id: null, unidad_medida: '' };

function CotizacionesSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState('lista');
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // Form state
  const [form, setForm] = useState({
    cliente_nombre: '',
    notas: '',
    condiciones_pago: 'Pago a 30 días',
    fecha_vencimiento: '',
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [prodSearch, setProdSearch] = useState({});
  const [prodResults, setProdResults] = useState({});

  // Detail modal
  const [viewId, setViewId] = useState(null);

  const empresaId = user?.empresa_id;

  const { data: listData, isLoading } = useQuery({
    queryKey: COTIZACIONES_KEYS.list(empresaId, { estado: estadoFiltro, page }),
    queryFn: () => cotizacionesService.getAll(empresaId, { estado: estadoFiltro || undefined, page }),
    enabled: !!empresaId,
  });

  const { data: detalle } = useQuery({
    queryKey: COTIZACIONES_KEYS.detail(viewId),
    queryFn: () => cotizacionesService.getById(viewId),
    enabled: !!viewId,
  });

  const createMutation = useMutation({
    mutationFn: (payload) => cotizacionesService.create(empresaId, user.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] });
      toast({ title: 'Cotización creada', className: 'bg-green-600 text-white' });
      setTab('lista');
      resetForm();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const estadoMutation = useMutation({
    mutationFn: ({ id, estado }) => cotizacionesService.updateEstado(id, estado),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => cotizacionesService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] });
      toast({ title: 'Cotización eliminada' });
    },
  });

  const resetForm = () => {
    setForm({ cliente_nombre: '', notas: '', condiciones_pago: 'Pago a 30 días', fecha_vencimiento: '' });
    setItems([{ ...EMPTY_ITEM }]);
  };

  const searchProducto = async (idx, q) => {
    setProdSearch(prev => ({ ...prev, [idx]: q }));
    if (!q || q.length < 2) { setProdResults(prev => ({ ...prev, [idx]: [] })); return; }
    const { data } = await supabase.from('productos').select('id, nombre, precio_venta, unidad_medida').eq('user_id', empresaId).ilike('nombre', `%${q}%`).limit(5);
    setProdResults(prev => ({ ...prev, [idx]: data ?? [] }));
  };

  const selectProducto = (idx, prod) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], producto_id: prod.id, descripcion: prod.nombre, precio_unitario: prod.precio_venta ?? '', unidad_medida: prod.unidad_medida ?? '' };
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
    const cant = parseFloat(i.cantidad) || 0;
    const precio = parseFloat(i.precio_unitario) || 0;
    return s + cant * precio;
  }, 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (items.every(i => !i.descripcion)) {
      toast({ title: 'Agrega al menos un ítem', variant: 'destructive' }); return;
    }
    const validItems = items.filter(i => i.descripcion && i.cantidad > 0 && i.precio_unitario > 0);
    createMutation.mutate({
      cliente: form.cliente_nombre ? { nombre: form.cliente_nombre } : null,
      items: validItems,
      notas: form.notas,
      condicionesPago: form.condiciones_pago,
      fechaVencimiento: form.fecha_vencimiento || null,
    });
  };

  const filteredData = (listData?.data ?? []).filter(c =>
    !search || c.numero?.includes(search) || (c.cliente_nombre ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-500" /> Cotizaciones
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Genera presupuestos y convierte en ventas
          </p>
        </div>
        <Button onClick={() => setTab('nueva')} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nueva Cotización
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-transparent gap-2">
          <TabsTrigger value="lista" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
            <FileText className="w-4 h-4 mr-2" /> Lista
          </TabsTrigger>
          <TabsTrigger value="nueva" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white bg-slate-100 dark:bg-slate-900 rounded-md px-4 py-2 text-slate-500 dark:text-slate-400">
            <Plus className="w-4 h-4 mr-2" /> Nueva
          </TabsTrigger>
        </TabsList>

        {/* LISTA */}
        <TabsContent value="lista" className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <Input placeholder="Buscar número o cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 dark:bg-slate-900 dark:border-slate-700" />
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
                  <th className="p-4 text-left">Vence</th>
                  <th className="p-4 text-left">Estado</th>
                  <th className="p-4 text-right">Total</th>
                  <th className="p-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-400">Cargando...</td></tr>
                ) : filteredData.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-slate-400">No hay cotizaciones</td></tr>
                ) : filteredData.map(cot => (
                  <tr key={cot.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="p-4 font-mono font-semibold text-blue-600 dark:text-blue-400">{cot.numero}</td>
                    <td className="p-4 text-slate-700 dark:text-slate-300">{cot.cliente_nombre ?? cot.clientes?.nombre ?? '—'}</td>
                    <td className="p-4 text-slate-500 dark:text-slate-400">{new Date(cot.created_at).toLocaleDateString('es-AR')}</td>
                    <td className="p-4 text-slate-500 dark:text-slate-400">
                      {cot.fecha_vencimiento ? new Date(cot.fecha_vencimiento).toLocaleDateString('es-AR') : '—'}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[cot.estado]?.color}`}>
                        {ESTADOS[cot.estado]?.label ?? cot.estado}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                      ${Number(cot.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-blue-500" onClick={() => setViewId(cot.id)} title="Ver detalle">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {cot.estado === 'borrador' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-blue-600" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'enviada' })} title="Marcar como enviada">
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {cot.estado === 'enviada' && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-green-600" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'aprobada' })} title="Aprobar">
                              <CheckCircle className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'rechazada' })} title="Rechazar">
                              <XCircle className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                        {['borrador', 'rechazada'].includes(cot.estado) && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => deleteMutation.mutate(cot.id)} title="Eliminar">
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

        {/* NUEVA COTIZACIÓN */}
        <TabsContent value="nueva">
          <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
            <Card className="dark:bg-slate-950 dark:border-slate-800">
              <CardHeader><CardTitle className="text-base dark:text-white">Datos del Cliente</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="dark:text-white">Nombre del Cliente</Label>
                  <Input value={form.cliente_nombre} onChange={e => setForm(f => ({ ...f, cliente_nombre: e.target.value }))} placeholder="Nombre del cliente o empresa" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-white">Condiciones de Pago</Label>
                  <Input value={form.condiciones_pago} onChange={e => setForm(f => ({ ...f, condiciones_pago: e.target.value }))} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-white">Fecha de Vencimiento</Label>
                  <Input type="date" value={form.fecha_vencimiento} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-white">Notas</Label>
                  <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones opcionales" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
                </div>
              </CardContent>
            </Card>

            <Card className="dark:bg-slate-950 dark:border-slate-800">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base dark:text-white">Ítems</CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5 space-y-1 relative">
                      <Label className="text-xs dark:text-slate-400">Descripción / Producto</Label>
                      <Input
                        value={prodSearch[idx] ?? item.descripcion}
                        onChange={e => { searchProducto(idx, e.target.value); updateItem(idx, 'descripcion', e.target.value); }}
                        placeholder="Buscar producto o escribir descripción"
                        className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm"
                      />
                      {(prodResults[idx] ?? []).length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl mt-1 max-h-40 overflow-y-auto">
                          {prodResults[idx].map(p => (
                            <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 dark:text-slate-200" onClick={() => selectProducto(idx, p)}>
                              {p.nombre} <span className="text-slate-400 text-xs ml-2">${p.precio_venta}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-slate-400">Cantidad</Label>
                      <Input type="number" min="0.001" step="0.001" value={item.cantidad} onChange={e => updateItem(idx, 'cantidad', e.target.value)} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-slate-400">Unidad</Label>
                      <Input value={item.unidad_medida} onChange={e => updateItem(idx, 'unidad_medida', e.target.value)} placeholder="un" className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-slate-400">Precio Unit.</Label>
                      <Input type="number" min="0" step="0.01" value={item.precio_unitario} onChange={e => updateItem(idx, 'precio_unitario', e.target.value)} className="dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm" />
                    </div>
                    <div className="col-span-1 flex justify-end pb-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => removeItem(idx)} disabled={items.length === 1}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
                  <div className="text-right">
                    <span className="text-sm text-slate-500 dark:text-slate-400 mr-4">Total:</span>
                    <span className="text-2xl font-bold text-slate-900 dark:text-white font-mono">
                      ${total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={resetForm} className="dark:border-slate-700 dark:text-slate-300">Limpiar</Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {createMutation.isPending ? 'Guardando...' : 'Guardar Cotización'}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      {/* MODAL DETALLE */}
      <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
        <DialogContent className="max-w-2xl dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="dark:text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              Cotización {detalle?.numero}
            </DialogTitle>
          </DialogHeader>
          {detalle && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-400 dark:text-slate-500 text-xs uppercase">Cliente</span>
                  <p className="font-medium dark:text-white">{detalle.cliente_nombre ?? detalle.clientes?.nombre ?? '—'}</p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-slate-500 text-xs uppercase">Estado</span>
                  <p><span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>{ESTADOS[detalle.estado]?.label}</span></p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-slate-500 text-xs uppercase">Condiciones</span>
                  <p className="dark:text-slate-300">{detalle.condiciones_pago ?? '—'}</p>
                </div>
                <div>
                  <span className="text-slate-400 dark:text-slate-500 text-xs uppercase">Vence</span>
                  <p className="dark:text-slate-300">{detalle.fecha_vencimiento ? new Date(detalle.fecha_vencimiento).toLocaleDateString('es-AR') : '—'}</p>
                </div>
              </div>

              <table className="w-full text-sm border-collapse">
                <thead><tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="text-left py-2 text-xs text-slate-400">Descripción</th>
                  <th className="text-right py-2 text-xs text-slate-400">Cant.</th>
                  <th className="text-right py-2 text-xs text-slate-400">Precio</th>
                  <th className="text-right py-2 text-xs text-slate-400">Subtotal</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(detalle.cotizacion_items ?? []).map(item => (
                    <tr key={item.id}>
                      <td className="py-2 dark:text-slate-300">{item.descripcion}</td>
                      <td className="py-2 text-right dark:text-slate-300">{item.cantidad} {item.unidad_medida}</td>
                      <td className="py-2 text-right dark:text-slate-300">${Number(item.precio_unitario).toFixed(2)}</td>
                      <td className="py-2 text-right font-medium dark:text-white">${Number(item.subtotal).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr className="border-t-2 border-slate-200 dark:border-slate-700">
                  <td colSpan={3} className="py-3 text-right font-bold dark:text-white">TOTAL</td>
                  <td className="py-3 text-right font-bold text-lg dark:text-white">${Number(detalle.total).toFixed(2)}</td>
                </tr></tfoot>
              </table>

              {detalle.notas && (
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium">Notas: </span>{detalle.notas}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewId(null)} className="dark:border-slate-700 dark:text-slate-300">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CotizacionesSection;
