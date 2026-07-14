import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cotizacionesService, COTIZACIONES_KEYS } from '@/services/cotizacionesService';
import { supabase } from '@/lib/customSupabaseClient';
import NuevaVentaModal from '@/components/ventas/NuevaVentaModal';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { EMPTY_ITEM } from '@/components/cotizaciones/shared';
import TablaCotizaciones from '@/components/cotizaciones/TablaCotizaciones';
import FormNuevaCotizacion from '@/components/cotizaciones/FormNuevaCotizacion';
import ModalDetalleCotizacion from '@/components/cotizaciones/ModalDetalleCotizacion';

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
    cliente_id: '',
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

  // Productos y clientes para autocompletar
  const { data: allProducts = [] } = useQuery({
    queryKey: ['cotizaciones_productos_autocomplete', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from('productos').select('id, nombre, precio_venta, unidad_medida').eq('empresa_id', empresaId).eq('activo', true).order('nombre').limit(200);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: allClientes = [] } = useQuery({
    queryKey: ['cotizaciones_clientes_autocomplete', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('id, nombre').eq('empresa_id', empresaId).order('nombre').limit(500);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

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
    setForm({ cliente_id: '', cliente_nombre: '', notas: '', condiciones_pago: 'Pago a 30 días', fecha_vencimiento: '', moneda: 'ARS', tipoCambioTasa: 1 });
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
      cliente: form.cliente_nombre ? { id: form.cliente_id || null, nombre: form.cliente_nombre } : null,
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
            <FileText className="w-6 h-6 text-kx-blue" /> Cotizaciones
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

        <TabsContent value="lista" className="space-y-4">
          <TablaCotizaciones
            search={search} setSearch={setSearch}
            estadoFiltro={estadoFiltro} setEstadoFiltro={setEstadoFiltro} setPage={setPage}
            isLoading={isLoading} filteredData={filteredData}
            listData={listData} page={page}
            setViewId={setViewId} estadoMutation={estadoMutation} deleteMutation={deleteMutation}
            handleConvertirClick={handleConvertirClick} onNavigateToSale={onNavigateToSale}
          />
        </TabsContent>

        <TabsContent value="nueva">
          <FormNuevaCotizacion
            form={form} setForm={setForm}
            items={items} addItem={addItem} removeItem={removeItem} updateItem={updateItem}
            prodSearch={prodSearch} prodResults={prodResults} prodOpen={prodOpen} setProdOpen={setProdOpen}
            searchProducto={searchProducto} selectProducto={selectProducto}
            unidadesMedida={unidadesMedida}
            allClientes={allClientes} showClienteDropdown={showClienteDropdown}
            setShowClienteDropdown={setShowClienteDropdown} clienteWrapperRef={clienteWrapperRef}
            tcMissing={tcMissing} setTcMissing={setTcMissing}
            total={total}
            handleSubmit={handleSubmit} resetForm={resetForm}
            createMutation={createMutation}
          />
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
      <ModalDetalleCotizacion viewId={viewId} setViewId={setViewId} detalle={detalle} />
    </div>
  );
}

export default CotizacionesSection;
