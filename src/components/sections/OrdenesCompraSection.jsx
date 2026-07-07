import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { ordenesCompraService, OC_KEYS } from '@/services/ordenesCompraService';
import { supabase } from '@/lib/customSupabaseClient';
import GenerarMovimientoModal from '@/components/shared/GenerarMovimientoModal';
import NuevaDevolucionModal from '@/components/shared/NuevaDevolucionModal';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { ESTADOS, EMPTY_ITEM } from '@/components/ordenes-compra/shared';
import TablaOrdenesCompra from '@/components/ordenes-compra/TablaOrdenesCompra';
import FormNuevaOC from '@/components/ordenes-compra/FormNuevaOC';
import ModalDetalleOC from '@/components/ordenes-compra/ModalDetalleOC';
import ModalRegistrarFactura from '@/components/ordenes-compra/ModalRegistrarFactura';

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
          <TablaOrdenesCompra
            search={search} setSearch={setSearch}
            estadoFiltro={estadoFiltro} setEstadoFiltro={setEstadoFiltro}
            isLoading={isLoading} filteredList={filteredList}
            listData={listData} page={page} setPage={setPage}
            setDetalleId={setDetalleId} setGenRecepId={setGenRecepId} setDevolverOC={setDevolverOC}
            estadoMutation={estadoMutation} cancelarMutation={cancelarMutation}
          />
        </TabsContent>

        {/* ── NUEVA OC ── */}
        <TabsContent value="nueva">
          <FormNuevaOC
            form={form} setForm={setForm}
            items={items} setItems={setItems}
            provSearch={provSearch} provResults={provResults} selectedProv={selectedProv}
            searchProveedor={searchProveedor} selectProveedor={selectProveedor}
            prodResults={prodResults} searchProducto={searchProducto} selectProducto={selectProducto}
            updateItem={updateItem}
            unidadesMedida={unidadesMedida}
            tcMissingOC={tcMissingOC} setTcMissingOC={setTcMissingOC}
            total={total}
            handleSubmit={handleSubmit} resetForm={resetForm}
            createMutation={createMutation}
          />
        </TabsContent>
      </Tabs>

      {/* ── MODAL: Detalle OC ── */}
      <ModalDetalleOC
        detalleId={detalleId} setDetalleId={setDetalleId}
        detalle={detalle} factura={factura}
        pagarFacturaMutation={pagarFacturaMutation}
        setDevolverOC={setDevolverOC} setGenRecepId={setGenRecepId}
        setFacturaModal={setFacturaModal} setFacturaForm={setFacturaForm}
      />

      {/* ── MODAL: Registrar Factura del Proveedor ── */}
      <ModalRegistrarFactura
        facturaModal={facturaModal} setFacturaModal={setFacturaModal}
        facturaForm={facturaForm} setFacturaForm={setFacturaForm}
        detalle={detalle}
        handleRegistrarFactura={handleRegistrarFactura}
        registrarFacturaMutation={registrarFacturaMutation}
      />

      {/* ── MODAL: Generar Recepción (nuevo flujo via crear_recepcion RPC) ── */}
      <GenerarMovimientoModal
        tipo="recepcion"
        sourceId={genRecepId}
        onClose={() => setGenRecepId(null)}
        onSuccess={() => {
          setGenRecepId(null);
          qc.invalidateQueries({ queryKey: OC_KEYS.list(empresaId) });
        }}
      />

      {/* ── MODAL: Devolución al Proveedor desde OC ── */}
      <NuevaDevolucionModal
        tipo="proveedor"
        isOpen={!!devolverOC}
        onClose={() => setDevolverOC(null)}
        origen={devolverOC ? {
          fuente:        'oc',
          id:            devolverOC.id,
          numero:        devolverOC.numero,
          entidadId:     devolverOC.proveedor_id,
          entidadNombre: devolverOC.proveedor_nombre ?? devolverOC.proveedores?.nombre,
        } : null}
        onSuccess={() => {
          setDevolverOC(null);
          qc.invalidateQueries({ queryKey: OC_KEYS.list(empresaId) });
        }}
      />
    </div>
  );
}

export default OrdenesCompraSection;
