import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, FileText, Search, Eye, Trash2, CheckCircle, XCircle,
  Send, Clock, ArrowRight, Download, RefreshCw, Filter, ShoppingCart, ExternalLink
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cotizacionesService, COTIZACIONES_KEYS } from '@/services/cotizacionesService';
import { supabase } from '@/lib/customSupabaseClient';
import NuevaVentaModal from '@/components/ventas/NuevaVentaModal';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { formatCurrency, MONEDA_SYMBOLS, parseNumberLocale } from '@/lib/currencyUtils';
import { formatDateAR } from '@/lib/dateUtils';

const ESTADOS = {
  borrador:   { label: 'Borrador',   color: 'bg-slate-100 text-kx-text-2 dark:bg-kx-surface-2 dark:text-slate-300' },
  enviada:    { label: 'Enviada',    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  aprobada:   { label: 'Aprobada',   color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  rechazada:  { label: 'Rechazada',  color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  vencida:    { label: 'Vencida',    color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  convertida: { label: 'Convertida', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
};

const EMPTY_ITEM = { descripcion: '', cantidad: 1, precio_unitario: '', producto_id: null, unidad_medida: '' };

function CotizacionesSection({ onNavigateToSale } = {}) {
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
    moneda: 'ARS',
    tipoCambioTasa: 1,
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [prodSearch, setProdSearch] = useState({});
  const [prodResults, setProdResults] = useState({});
  const [prodOpen, setProdOpen] = useState({});  // qué fila tiene el dropdown abierto
  const [allProducts, setAllProducts] = useState([]);

  // Clientes para autocompletar
  const [allClientes, setAllClientes] = useState([]);
  const [showClienteDropdown, setShowClienteDropdown] = useState(false);
  const clienteWrapperRef = useRef(null);

  // Detail modal
  const [viewId, setViewId] = useState(null);

  // Conversión a venta
  const [convertirCot, setConvertirCot] = useState(null);  // cotización completa para convertir
  const [showVentaModal, setShowVentaModal] = useState(false);

  // Bloqueo por tipo de cambio faltante
  const [tcMissing, setTcMissing] = useState(false);

  const empresaId = user?.empresa_id;

  // Cargar productos y clientes al montar (después de tener empresaId)
  useEffect(() => {
    if (!empresaId) return;
    (async () => {
      const { data: prods } = await supabase.from('productos').select('id, nombre, precio_venta, unidad_medida').eq('empresa_id', empresaId).eq('activo', true).order('nombre').limit(200);
      setAllProducts(prods ?? []);
      const { data: clis } = await supabase.from('clientes').select('id, nombre').eq('empresa_id', empresaId).order('nombre').limit(500);
      setAllClientes(clis ?? []);
    })();
  }, [empresaId]);

  // Cerrar dropdowns al hacer click afuera
  useEffect(() => {
    const onClick = (e) => {
      if (clienteWrapperRef.current && !clienteWrapperRef.current.contains(e.target)) {
        setShowClienteDropdown(false);
      }
      if (!e.target.closest('[data-prod-row]')) {
        setProdOpen({});
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

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

  const convertirMutation = useMutation({
    mutationFn: ({ cotizacionId, comprobanteId }) =>
      cotizacionesService.convertir(cotizacionId, comprobanteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cotizaciones', empresaId] });
      toast({ title: '✅ Cotización convertida en venta', className: 'bg-green-600 text-white' });
    },
    onError: (e) => toast({ title: 'Error al convertir', description: e.message, variant: 'destructive' }),
  });

  const handleConvertirClick = async (cot) => {
    // Cargar detalle completo (con items) antes de abrir el modal
    const detalle = await cotizacionesService.getById(cot.id);
    setConvertirCot(detalle);
    setShowVentaModal(true);
  };

  const handleConvertSuccess = (comprobanteId) => {
    if (convertirCot) {
      convertirMutation.mutate({ cotizacionId: convertirCot.id, comprobanteId });
      setConvertirCot(null);
    }
  };

  const resetForm = () => {
    setForm({ cliente_nombre: '', notas: '', condiciones_pago: 'Pago a 30 días', fecha_vencimiento: '', moneda: 'ARS', tipoCambioTasa: 1 });
    setItems([{ ...EMPTY_ITEM }]);
    setTcMissing(false);
  };

  const searchProducto = (idx, q) => {
    setProdSearch(prev => ({ ...prev, [idx]: q }));
    const query = (q ?? '').toLowerCase().trim();
    const filtered = query
      ? allProducts.filter(p => p.nombre.toLowerCase().includes(query)).slice(0, 10)
      : allProducts.slice(0, 10);
    setProdResults(prev => ({ ...prev, [idx]: filtered }));
  };

  const selectProducto = (idx, prod) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], producto_id: prod.id, descripcion: prod.nombre, precio_unitario: prod.precio_venta ?? '', unidad_medida: prod.unidad_medida ?? '' };
    setItems(updated);
    setProdSearch(prev => ({ ...prev, [idx]: prod.nombre }));
    setProdResults(prev => ({ ...prev, [idx]: [] }));
    setProdOpen(prev => ({ ...prev, [idx]: false }));
  };

  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };

  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const total = items.reduce((s, i) => {
    const cant = parseInt(i.cantidad) || 0;
    const precio = parseNumberLocale(i.precio_unitario) || 0;
    return s + cant * precio;
  }, 0);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (items.every(i => !i.descripcion)) {
      toast({ title: 'Agrega al menos un ítem', variant: 'destructive' }); return;
    }
    if (form.moneda !== 'ARS' && tcMissing) {
      toast({
        title: 'Falta el tipo de cambio del día',
        description: `Cargá la tasa de ${form.moneda} para hoy antes de guardar la cotización.`,
        variant: 'destructive',
      });
      return;
    }
    const validItems = items
      .map(i => ({ ...i, cantidad: parseInt(i.cantidad) || 0, precio_unitario: parseNumberLocale(i.precio_unitario) || 0 }))
      .filter(i => i.descripcion && i.cantidad > 0 && i.precio_unitario > 0);
    if (validItems.length === 0) {
      return toast({ title: 'Ítems inválidos', description: 'Revisá cantidades y precios (usar coma para decimales).', variant: 'destructive' });
    }
    createMutation.mutate({
      cliente: form.cliente_nombre ? { nombre: form.cliente_nombre } : null,
      items: validItems,
      notas: form.notas,
      condicionesPago: form.condiciones_pago,
      fechaVencimiento: form.fecha_vencimiento || null,
      moneda: form.moneda,
      tipoCambioTasa: form.tipoCambioTasa,
    });
  };

  const filteredData = (listData?.data ?? []).filter(c =>
    !search || c.numero?.includes(search) || (c.cliente_nombre ?? '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <FileText className="w-6 h-6 text-blue-500" /> Cotizaciones
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Genera presupuestos y convierte en ventas
          </p>
        </div>
        <Button onClick={() => setTab('nueva')} className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nueva Cotización
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-transparent gap-2">
          <TabsTrigger value="lista" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface rounded-md px-4 py-2 text-slate-500 dark:text-kx-text-2">
            <FileText className="w-4 h-4 mr-2" /> Lista
          </TabsTrigger>
          <TabsTrigger value="nueva" className="data-[state=active]:bg-blue-500 data-[state=active]:text-white bg-slate-100 dark:bg-kx-surface rounded-md px-4 py-2 text-slate-500 dark:text-kx-text-2">
            <Plus className="w-4 h-4 mr-2" /> Nueva
          </TabsTrigger>
        </TabsList>

        {/* LISTA */}
        <TabsContent value="lista" className="space-y-4">
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-kx-text-3" />
              <Input placeholder="Buscar número o cliente..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 dark:bg-kx-surface dark:border-kx-border" />
            </div>
            <select
              value={estadoFiltro}
              onChange={e => { setEstadoFiltro(e.target.value); setPage(1); }}
              className="h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface text-sm px-3 text-slate-700 dark:text-slate-300"
            >
              <option value="">Todos los estados</option>
              {Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>

          <div className="rounded-xl border border-kx-border dark:border-kx-border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
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
                  <tr><td colSpan={7} className="p-8 text-center text-kx-text-3">Cargando...</td></tr>
                ) : filteredData.length === 0 ? (
                  <tr><td colSpan={7} className="p-8 text-center text-kx-text-3">No hay cotizaciones</td></tr>
                ) : filteredData.map(cot => (
                  <tr key={cot.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40">
                    <td className="p-4 font-mono font-semibold text-blue-600 dark:text-blue-400">{cot.numero}</td>
                    <td className="p-4 text-slate-700 dark:text-slate-300">{cot.cliente_nombre ?? cot.clientes?.nombre ?? '—'}</td>
                    <td className="p-4 text-slate-500 dark:text-kx-text-2">{formatDateAR(cot.created_at)}</td>
                    <td className="p-4 text-slate-500 dark:text-kx-text-2">
                      {cot.fecha_vencimiento ? formatDateAR(cot.fecha_vencimiento) : '—'}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[cot.estado]?.color}`}>
                        {ESTADOS[cot.estado]?.label ?? cot.estado}
                      </span>
                    </td>
                    <td className="p-4 text-right font-mono font-bold text-kx-text dark:text-kx-text">
                      {(() => {
                        const tc = Number(cot.tipo_cambio_tasa) || 1;
                        const esExt = cot.moneda && cot.moneda !== 'ARS' && tc > 0;
                        const valor = esExt ? Number(cot.total) / tc : Number(cot.total);
                        return formatCurrency(valor, cot.moneda ?? 'ARS');
                      })()}
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-500" onClick={() => setViewId(cot.id)} title="Ver detalle">
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                        {cot.estado === 'borrador' && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-600" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'enviada' })} title="Marcar como enviada">
                            <Send className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {cot.estado === 'enviada' && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-green-600" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'aprobada' })} title="Aprobar">
                              <CheckCircle className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500" onClick={() => estadoMutation.mutate({ id: cot.id, estado: 'rechazada' })} title="Rechazar">
                              <XCircle className="w-3.5 h-3.5" />
                            </Button>
                          </>
                        )}
                        {['aprobada', 'enviada'].includes(cot.estado) && (
                          <Button
                            variant="ghost" size="icon"
                            className="h-7 w-7 text-kx-text-3 hover:text-purple-600"
                            onClick={() => handleConvertirClick(cot)}
                            title="Convertir en Venta"
                          >
                            <ShoppingCart className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {cot.estado === 'convertida' && cot.comprobante_id && (
                          <button
                            type="button"
                            onClick={() => onNavigateToSale?.(cot.comprobante_id)}
                            className="text-xs text-purple-500 hover:text-purple-400 font-medium flex items-center gap-1 hover:underline cursor-pointer"
                            title="Ver venta generada"
                          >
                            <ExternalLink className="w-3 h-3" /> Venta
                          </button>
                        )}
                        {['borrador', 'rechazada'].includes(cot.estado) && (
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500" onClick={() => deleteMutation.mutate(cot.id)} title="Eliminar">
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
          {/* Opciones globales de unidad de medida para los <input list="..."> de los ítems */}
          <datalist id="unidades-medida">
            <option value="un" />
            <option value="kg" />
            <option value="g" />
            <option value="l" />
            <option value="ml" />
            <option value="m" />
            <option value="cm" />
            <option value="mm" />
            <option value="m²" />
            <option value="m³" />
            <option value="caja" />
            <option value="paquete" />
            <option value="docena" />
            <option value="par" />
            <option value="hora" />
            <option value="día" />
            <option value="servicio" />
          </datalist>
          <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
            <Card className="dark:bg-kx-bg dark:border-kx-border">
              <CardHeader><CardTitle className="text-base dark:text-kx-text">Datos del Cliente</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 relative" ref={clienteWrapperRef}>
                  <Label className="dark:text-kx-text">Nombre del Cliente</Label>
                  <Input
                    value={form.cliente_nombre}
                    onChange={e => { setForm(f => ({ ...f, cliente_nombre: e.target.value })); setShowClienteDropdown(true); }}
                    onFocus={() => setShowClienteDropdown(true)}
                    placeholder="Buscar cliente existente o escribir uno nuevo"
                    className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                    autoComplete="off"
                  />
                  {showClienteDropdown && (() => {
                    const q = form.cliente_nombre.toLowerCase().trim();
                    const filtered = q ? allClientes.filter(c => c.nombre.toLowerCase().includes(q)) : allClientes;
                    const shown = filtered.slice(0, 8);
                    if (shown.length === 0) return null;
                    return (
                      <div className="absolute top-full left-0 right-0 z-30 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1 max-h-56 overflow-y-auto">
                        {shown.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text"
                            onClick={() => { setForm(f => ({ ...f, cliente_nombre: c.nombre })); setShowClienteDropdown(false); }}
                          >
                            {c.nombre}
                          </button>
                        ))}
                        {q && !allClientes.some(c => c.nombre.toLowerCase() === q) && (
                          <div className="px-3 py-2 text-xs text-slate-500 dark:text-kx-text-2 border-t border-slate-100 dark:border-kx-border italic">
                            O tipeá un nombre nuevo y se guardará como texto libre.
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-kx-text">Condiciones de Pago</Label>
                  <Input value={form.condiciones_pago} onChange={e => setForm(f => ({ ...f, condiciones_pago: e.target.value }))} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-kx-text">Fecha de Vencimiento</Label>
                  <Input type="date" value={form.fecha_vencimiento} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-kx-text">Notas</Label>
                  <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones opcionales" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
                </div>
                <div className="space-y-2 col-span-2">
                  <MonedaSelector
                    moneda={form.moneda}
                    tasa={form.tipoCambioTasa}
                    onMonedaChange={v => setForm(f => ({ ...f, moneda: v, tipoCambioTasa: v === 'ARS' ? 1 : f.tipoCambioTasa }))}
                    onTasaChange={v => setForm(f => ({ ...f, tipoCambioTasa: v }))}
                    onTCMissingChange={setTcMissing}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="dark:bg-kx-bg dark:border-kx-border">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base dark:text-kx-text">Ítems</CardTitle>
                <Button type="button" variant="outline" size="sm" onClick={addItem} className="dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5 space-y-1 relative" data-prod-row>
                      <Label className="text-xs dark:text-kx-text-2">Descripción / Producto</Label>
                      <Input
                        value={prodSearch[idx] ?? item.descripcion}
                        onChange={e => { searchProducto(idx, e.target.value); updateItem(idx, 'descripcion', e.target.value); setProdOpen(prev => ({ ...prev, [idx]: true })); }}
                        onFocus={() => { searchProducto(idx, prodSearch[idx] ?? item.descripcion ?? ''); setProdOpen(prev => ({ ...prev, [idx]: true })); }}
                        placeholder="Buscar producto o escribir descripción"
                        className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm"
                        autoComplete="off"
                      />
                      {prodOpen[idx] && (prodResults[idx] ?? []).length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-30 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1 max-h-56 overflow-y-auto">
                          {prodResults[idx].map(p => (
                            <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text flex justify-between items-center" onClick={() => selectProducto(idx, p)}>
                              <span className="truncate">{p.nombre}</span>
                              <span className="text-kx-text-3 text-xs ml-2 flex-shrink-0">${Number(p.precio_venta ?? 0).toLocaleString('es-AR')}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Cantidad</Label>
                      <Input type="number" min="1" step="1" value={item.cantidad} onChange={e => updateItem(idx, 'cantidad', e.target.value.replace(/[^\d]/g, ''))} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Unidad</Label>
                      <select
                        value={item.unidad_medida || ''}
                        onChange={e => updateItem(idx, 'unidad_medida', e.target.value)}
                        className="w-full h-10 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">— Elegí —</option>
                        <option value="Unidad">Unidad (un)</option>
                        <option value="Kilogramos">Kilogramos (kg)</option>
                        <option value="Gramos">Gramos (gr)</option>
                        <option value="Litros">Litros (lt)</option>
                        <option value="Mililitros">Mililitros (ml)</option>
                        <option value="Metros">Metros (m)</option>
                        <option value="Centimetros">Centímetros (cm)</option>
                        <option value="Caja">Caja</option>
                        <option value="Pack">Pack</option>
                        <option value="Docena">Docena</option>
                        <option value="Bolsa">Bolsa</option>
                      </select>
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Precio Unit.</Label>
                      <Input type="text" inputMode="decimal" placeholder="0,00" value={item.precio_unitario} onChange={e => updateItem(idx, 'precio_unitario', e.target.value)} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                    </div>
                    <div className="col-span-1 flex justify-end pb-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-kx-text-3 hover:text-red-500" onClick={() => removeItem(idx)} disabled={items.length === 1}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}

                <div className="flex justify-end pt-4 border-t border-kx-border dark:border-kx-border">
                  <div className="text-right">
                    <span className="text-sm text-slate-500 dark:text-kx-text-2 mr-4">Total:</span>
                    <span className="text-2xl font-bold text-slate-900 dark:text-kx-text font-mono">
                      {formatCurrency(total, form.moneda)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3 justify-end">
              <Button type="button" variant="outline" onClick={resetForm} className="dark:border-kx-border dark:text-slate-300">Limpiar</Button>
              <Button
                type="submit"
                disabled={createMutation.isPending || (form.moneda !== 'ARS' && tcMissing)}
                className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                title={form.moneda !== 'ARS' && tcMissing ? `Cargá el tipo de cambio ${form.moneda} del día para continuar` : undefined}
              >
                {createMutation.isPending ? 'Guardando...' : 'Guardar Cotización'}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      {/* MODAL CONVERTIR EN VENTA */}
      <NuevaVentaModal
        isOpen={showVentaModal}
        onOpenChange={(open) => { setShowVentaModal(open); if (!open) setConvertirCot(null); }}
        cotizacion={convertirCot}
        onConvertSuccess={handleConvertSuccess}
      />

      {/* MODAL DETALLE */}
      <Dialog open={!!viewId} onOpenChange={() => setViewId(null)}>
        <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-500" />
              Cotización {detalle?.numero}
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">Detalle y líneas de la cotización.</DialogDescription>
          </DialogHeader>
          {detalle && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Cliente</span>
                  <p className="font-medium dark:text-kx-text">{detalle.cliente_nombre ?? detalle.clientes?.nombre ?? '—'}</p>
                </div>
                <div>
                  <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Estado</span>
                  <p><span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${ESTADOS[detalle.estado]?.color}`}>{ESTADOS[detalle.estado]?.label}</span></p>
                </div>
                <div>
                  <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Condiciones</span>
                  <p className="dark:text-slate-300">{detalle.condiciones_pago ?? '—'}</p>
                </div>
                <div>
                  <span className="text-kx-text-3 dark:text-kx-text-3 text-xs uppercase">Vence</span>
                  <p className="dark:text-slate-300">{detalle.fecha_vencimiento ? formatDateAR(detalle.fecha_vencimiento) : '—'}</p>
                </div>
              </div>

              {(() => {
                const tc = Number(detalle.tipo_cambio_tasa) || 1;
                const esExtranjera = detalle.moneda && detalle.moneda !== 'ARS' && tc > 0;
                const conv = esExtranjera ? (n) => Number(n) / tc : (n) => Number(n);
                const fmt = (n) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const monedaDisp = esExtranjera ? detalle.moneda : 'ARS';
                const simbolo = esExtranjera ? `${detalle.moneda} ` : '$';
                return (
                  <table className="w-full text-sm border-collapse">
                    <thead><tr className="border-b border-kx-border dark:border-kx-border">
                      <th className="text-left py-2 text-xs text-kx-text-3">Descripción</th>
                      <th className="text-right py-2 text-xs text-kx-text-3">Cant.</th>
                      <th className="text-right py-2 text-xs text-kx-text-3">Precio ({monedaDisp})</th>
                      <th className="text-right py-2 text-xs text-kx-text-3">Subtotal ({monedaDisp})</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(detalle.cotizacion_items ?? []).map(item => (
                        <tr key={item.id}>
                          <td className="py-2 dark:text-slate-300">{item.descripcion}</td>
                          <td className="py-2 text-right dark:text-slate-300">{item.cantidad} {item.unidad_medida}</td>
                          <td className="py-2 text-right dark:text-slate-300">{simbolo}{fmt(conv(item.precio_unitario))}</td>
                          <td className="py-2 text-right font-medium dark:text-kx-text">{simbolo}{fmt(conv(item.subtotal))}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-kx-border dark:border-kx-border">
                        <td colSpan={3} className="py-3 text-right font-bold dark:text-kx-text">TOTAL</td>
                        <td className="py-3 text-right font-bold text-lg dark:text-kx-text">{simbolo}{fmt(conv(detalle.total))}</td>
                      </tr>
                      {esExtranjera && (
                        <>
                          <tr className="text-xs text-slate-500 dark:text-kx-text-2">
                            <td colSpan={3} className="py-1 text-right">Tipo de cambio</td>
                            <td className="py-1 text-right">1 {detalle.moneda} = ${fmt(tc)}</td>
                          </tr>
                          <tr className="text-xs text-slate-500 dark:text-kx-text-2">
                            <td colSpan={3} className="py-1 text-right">Equivale a</td>
                            <td className="py-1 text-right">${fmt(Number(detalle.total))} ARS</td>
                          </tr>
                        </>
                      )}
                    </tfoot>
                  </table>
                );
              })()}

              {detalle.notas && (
                <div className="p-3 bg-kx-surface-2 dark:bg-kx-surface rounded-lg text-sm text-kx-text-2 dark:text-kx-text-2">
                  <span className="font-medium">Notas: </span>{detalle.notas}
                </div>
              )}
              {detalle.estado === 'convertida' && detalle.comprobante_id && (
                <div className="flex items-center gap-2 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800 text-sm text-purple-700 dark:text-purple-300">
                  <CheckCircle className="w-4 h-4 flex-shrink-0" />
                  <span>Esta cotización fue convertida en venta. Comprobante ID: <span className="font-mono text-xs">{detalle.comprobante_id}</span></span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewId(null)} className="dark:border-kx-border dark:text-slate-300">Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default CotizacionesSection;
