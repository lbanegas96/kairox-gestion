import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { ordenesCompraService, OC_KEYS } from '@/services/ordenesCompraService';
import { supabase } from '@/lib/customSupabaseClient';
import GenerarMovimientoModal from '@/components/shared/GenerarMovimientoModal';
import NuevaDevolucionModal from '@/components/shared/NuevaDevolucionModal';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import { getTodayAR } from '@/lib/dateUtils';
import { ESTADOS, EMPTY_ITEM } from '@/components/ordenes-compra/shared';
import TablaOrdenesCompra from '@/components/ordenes-compra/TablaOrdenesCompra';
import FormNuevaOC from '@/components/ordenes-compra/FormNuevaOC';
import ModalDetalleOC from '@/components/ordenes-compra/ModalDetalleOC';
import ModalRegistrarFactura from '@/components/ordenes-compra/ModalRegistrarFactura';

// costo_unitario es SIEMPRE el precio final que paga la empresa (IVA incluido) —
// mismo criterio que Cotizaciones/Pedidos/Ventas. Para separar neto/IVA hay que
// DIVIDIR por el factor de la alícuota, nunca sumarlo.
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 };

function OrdenesCompraSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [estadoFiltro, setEstadoFiltro] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // modales
  const [detalleId, setDetalleId]   = useState(null);
  const [genRecepId, setGenRecepId] = useState(null);
  const [devolverOC, setDevolverOC] = useState(null);
  const [facturaModal, setFacturaModal] = useState(false);
  const [facturaForm, setFacturaForm] = useState({ numero_factura: '', fecha_factura: '', items: [] });

  // form nueva OC / edición (editingId != null = editando una OC existente)
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ proveedor_nombre: '', fecha_entrega_esperada: '', forma_pago: 'Efectivo', notas: '', moneda: 'ARS', tipoCambioTasa: 1, descuentoGlobalPct: '' });
  const [tcMissingOC, setTcMissingOC] = useState(false);
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [provSearch, setProvSearch] = useState('');
  const [provResults, setProvResults] = useState([]);
  const [selectedProv, setSelectedProv] = useState(null);
  const [prodResults, setProdResults] = useState({});
  const [prodOpen, setProdOpen] = useState({});

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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: OC_KEYS.factura(detalleId) });
      toast({ title: 'Factura registrada — deuda cargada a Cuenta Corriente del proveedor ✓', className: 'bg-green-600 text-white' });
      setFacturaModal(false);

      // Asiento contable automático (no bloquea el flujo) — mismo patrón que
      // Compra Rápida. Siempre esCredito=true: esta factura SIEMPRE crea Open
      // Item en CC (el pago es un evento separado, ver mig.279).
      const providerName = detalle?.proveedor_nombre ?? detalle?.proveedores?.nombre ?? 'Proveedor';
      asientosAutoService.crearAsientoCompra(
        empresaId,
        user.id,
        {
          compraId: data.compra_id,
          total: data.total,
          neto: data.neto_gravado,
          iva: data.iva_discriminado,
          fecha: facturaForm.fecha_factura || getTodayAR(),
          descripcion: `Compra a ${providerName} - Fac. ${facturaForm.numero_factura || 'S/N'} (OC ${detalle?.numero})`,
          esCredito: true,
        }
      ).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento factura OC (no crítico):', e.message);
        }
      });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const abrirModalFactura = () => {
    if (!detalle) return;
    const itemsRecibidos = (detalle.ordenes_compra_items ?? []).filter(i => Number(i.cantidad_recibida) > 0);
    setFacturaForm({
      numero_factura: '',
      fecha_factura: '',
      items: itemsRecibidos.map(i => ({
        producto_id: i.producto_id ?? null,
        descripcion: i.descripcion,
        cantidad: i.cantidad_recibida,
        costo_unitario_neto: i.costo_unitario,
        alicuota_iva: 21,
      })),
    });
    setFacturaModal(true);
  };

  const handleRegistrarFactura = (e) => {
    e.preventDefault();
    if (!detalle) return;
    registrarFacturaMutation.mutate({
      empresa_id: empresaId,
      user_id: user.id,
      orden_compra_id: detalle.id,
      numero_factura: facturaForm.numero_factura,
      fecha_factura: facturaForm.fecha_factura,
      items: facturaForm.items.map(i => ({
        producto_id: i.producto_id ?? null,
        cantidad: parseFloat(i.cantidad) || 0,
        costo_unitario_neto: parseNumberLocale(String(i.costo_unitario_neto)) || 0,
        alicuota_iva: Number(i.alicuota_iva) || 0,
      })),
    });
  };

  const createMutation = useMutation({
    mutationFn: (payload) => ordenesCompraService.create(empresaId, user.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ordenes_compra', empresaId] });
      toast({ title: 'Orden de compra creada ✓', className: 'bg-green-600 text-white' });
      setIsModalOpen(false);
      resetForm();
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // Edición (Fase 1 del plan, 13/08): mismo form/items que "Nueva OC" — reusa el mismo
  // componente FormNuevaOC, con diffing por id en la RPC (mig.322).
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => ordenesCompraService.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ordenes_compra', empresaId] });
      qc.invalidateQueries({ queryKey: ['orden_compra'] });
      toast({ title: 'Orden de compra actualizada ✓', className: 'bg-green-600 text-white' });
      setIsModalOpen(false);
      resetForm();
    },
    onError: (e) => toast({ title: 'Error al guardar los cambios', description: e.message, variant: 'destructive' }),
  });

  // Helper: invalidar también el cache de notificaciones cuando cambia el estado/stock
  const invalidateOCAndNotifs = () => {
    qc.invalidateQueries({ queryKey: ['ordenes_compra', empresaId] });
    qc.invalidateQueries({ queryKey: ['notif'] });
    // OC_KEYS.detail() usa la clave singular 'orden_compra' (no 'ordenes_compra')
    // — mismo bug encontrado y corregido en CotizacionesSection: sin esto, el
    // ModalDetalleOC abierto nunca se refresca tras cambiar el estado (el cambio
    // sí se guarda bien, solo que la UI del modal queda mostrando el estado viejo).
    qc.invalidateQueries({ queryKey: ['orden_compra'] });
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
    setForm({ proveedor_nombre: '', fecha_entrega_esperada: '', forma_pago: 'Efectivo', notas: '', moneda: 'ARS', tipoCambioTasa: 1, descuentoGlobalPct: '' });
    setItems([{ ...EMPTY_ITEM }]);
    setSelectedProv(null);
    setProvSearch('');
    setTcMissingOC(false);
    setEditingId(null);
  };

  // "Editar" desde el detalle — solo se ofrece si estado IN ('borrador','enviada'),
  // ver ModalDetalleOC. Reusa el mismo form/items/modal de "Nueva OC".
  const openEdit = async (oc) => {
    const full = await ordenesCompraService.getById(oc.id);
    setForm({
      proveedor_nombre: full.proveedor_nombre ?? full.proveedores?.nombre ?? '',
      fecha_entrega_esperada: full.fecha_entrega_esperada ?? '',
      forma_pago: full.forma_pago ?? 'Efectivo',
      notas: full.notas ?? '',
      moneda: full.moneda ?? 'ARS',
      tipoCambioTasa: Number(full.tipo_cambio_tasa) || 1,
      descuentoGlobalPct: full.descuento_global_pct ? String(full.descuento_global_pct) : '',
    });
    setSelectedProv(full.proveedor_id ? { id: full.proveedor_id, nombre: full.proveedor_nombre ?? full.proveedores?.nombre } : null);
    setProvSearch(full.proveedor_nombre ?? full.proveedores?.nombre ?? '');
    setItems((full.ordenes_compra_items ?? []).map(i => ({
      id: i.id,
      descripcion: i.descripcion,
      cantidad_pedida: i.cantidad_pedida,
      costo_unitario: i.costo_unitario,
      descuento_item: i.descuento_item || '',
      producto_id: i.producto_id,
      unidad_medida: i.unidad_medida ?? '',
      alicuota_iva: i.alicuota_iva ?? '21',
      _prodSearch: i.descripcion,
    })));
    setEditingId(full.id);
    setDetalleId(null);
    setIsModalOpen(true);
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
    const { data } = await supabase.from('productos').select('id, nombre, costo_compra, unidad_medida, alicuota_iva').eq('empresa_id', empresaId).ilike('nombre', `%${q}%`).limit(6);
    setProdResults(p => ({ ...p, [idx]: data ?? [] }));
  };

  const selectProducto = (idx, prod) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], producto_id: prod.id, descripcion: prod.nombre, _prodSearch: prod.nombre, costo_unitario: prod.costo_compra ?? '', unidad_medida: prod.unidad_medida ?? '', alicuota_iva: prod.alicuota_iva ?? '21' };
    setItems(updated);
    setProdResults(p => ({ ...p, [idx]: [] }));
    setProdOpen(p => ({ ...p, [idx]: false }));
  };

  const updateItem = (idx, field, value) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };

  // Totales — mismo criterio que Cotizaciones/Pedidos (13/08): "subtotal" es precio
  // de lista sin ningún descuento, "descuento" suma línea + global combinados, para
  // que un ítem con % Desc. propio nunca quede invisible en el resumen. Neto/IVA se
  // muestran SIEMPRE en Compras (a diferencia de Ventas, que lo condiciona a la letra
  // A) — como comprador Responsable Inscripto siempre importa el IVA Crédito Fiscal,
  // sin importar qué letra emitió el proveedor (confirmado por código:
  // NuevaFacturaProveedorModal.jsx ya lo muestra sin ninguna condición).
  const totales = items.reduce((acc, i) => {
    const cant = parseFloat(i.cantidad_pedida) || 0;
    const costo = parseNumberLocale(i.costo_unitario) || 0;
    const descPct = parseNumberLocale(i.descuento_item) || 0;
    const brutoLista = cant * costo;
    const brutoConDescLinea = brutoLista * (1 - descPct / 100);
    const factor = FACTOR_IVA[i.alicuota_iva] ?? 1;
    const neto = brutoConDescLinea / factor;
    acc.subtotal += brutoLista;
    acc.subtotalConDescLinea += brutoConDescLinea;
    acc.subtotalNeto += neto;
    acc.subtotalIva += brutoConDescLinea - neto;
    return acc;
  }, { subtotal: 0, subtotalConDescLinea: 0, subtotalNeto: 0, subtotalIva: 0 });
  const descuentoGlobalPct = parseNumberLocale(form.descuentoGlobalPct) || 0;
  const factorDescGlobal = 1 - descuentoGlobalPct / 100;
  totales.total = totales.subtotalConDescLinea * factorDescGlobal;
  totales.neto = totales.subtotalNeto * factorDescGlobal;
  totales.iva = totales.subtotalIva * factorDescGlobal;
  totales.descuento = totales.subtotal - totales.total;

  const handleSubmit = (e) => {
    e.preventDefault();
    const validItems = items.filter(i => i.descripcion && i.cantidad_pedida > 0 && (parseNumberLocale(i.costo_unitario) || 0) > 0);
    if (!validItems.length) { toast({ title: 'Agrega al menos un ítem válido', variant: 'destructive' }); return; }
    const payload = {
      proveedor_id: selectedProv?.id ?? null,
      proveedor_nombre: form.proveedor_nombre || null,
      fecha_entrega_esperada: form.fecha_entrega_esperada || null,
      forma_pago: form.forma_pago,
      notas: form.notas || undefined,
      moneda: form.moneda,
      tipoCambioTasa: form.tipoCambioTasa,
      descuentoGlobalPct,
      items: validItems.map(i => ({
        ...(i.id ? { id: i.id } : {}),
        producto_id: i.producto_id ?? null,
        descripcion: i.descripcion,
        cantidad_pedida: parseFloat(i.cantidad_pedida),
        costo_unitario: parseNumberLocale(i.costo_unitario) || 0,
        descuento_item: parseNumberLocale(i.descuento_item) || 0,
        alicuota_iva: i.alicuota_iva ?? '21',
        unidad_medida: i.unidad_medida || null,
      })),
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, payload });
    } else {
      createMutation.mutate(payload);
    }
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
            <ShoppingBag className="w-6 h-6 text-indigo-600 dark:text-indigo-500" /> Órdenes de Compra
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Gestioná pedidos a proveedores con seguimiento de recepción y actualización de stock automática
          </p>
        </div>
        <Button onClick={() => { resetForm(); setIsModalOpen(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
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

      <TablaOrdenesCompra
        search={search} setSearch={setSearch}
        estadoFiltro={estadoFiltro} setEstadoFiltro={setEstadoFiltro}
        isLoading={isLoading} filteredList={filteredList}
        listData={listData} page={page} setPage={setPage}
        setDetalleId={setDetalleId} setGenRecepId={setGenRecepId} setDevolverOC={setDevolverOC}
        estadoMutation={estadoMutation} cancelarMutation={cancelarMutation}
      />

      {/* ── MODAL: Nueva / Editar OC ── */}
      <Dialog open={isModalOpen} onOpenChange={v => { if (!v) { setIsModalOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] flex flex-col dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader className="shrink-0">
            <DialogTitle className="dark:text-kx-text">{editingId ? 'Editar Orden de Compra' : 'Nueva Orden de Compra'}</DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              {editingId ? 'Modificá los datos y guardá los cambios.' : 'Cargá los ítems y datos de la orden de compra.'}
            </DialogDescription>
          </DialogHeader>
          <FormNuevaOC
            form={form} setForm={setForm}
            items={items} setItems={setItems}
            provSearch={provSearch} provResults={provResults} selectedProv={selectedProv}
            searchProveedor={searchProveedor} selectProveedor={selectProveedor}
            prodResults={prodResults} prodOpen={prodOpen} setProdOpen={setProdOpen}
            searchProducto={searchProducto} selectProducto={selectProducto}
            updateItem={updateItem}
            unidadesMedida={unidadesMedida}
            tcMissingOC={tcMissingOC} setTcMissingOC={setTcMissingOC}
            totales={totales}
            handleSubmit={handleSubmit} resetForm={resetForm}
            onCancel={() => { setIsModalOpen(false); resetForm(); }}
            createMutation={editingId ? updateMutation : createMutation}
            isEditing={!!editingId}
          />
        </DialogContent>
      </Dialog>

      {/* ── MODAL: Detalle OC ── */}
      <ModalDetalleOC
        detalleId={detalleId} setDetalleId={setDetalleId}
        detalle={detalle} factura={factura}
        setDevolverOC={setDevolverOC} setGenRecepId={setGenRecepId}
        abrirModalFactura={abrirModalFactura}
        onEditar={openEdit}
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
