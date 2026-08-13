import { useState, useEffect, useMemo } from 'react';
import { Plus, Search, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getNowAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import GenerarMovimientoModal from '@/components/shared/GenerarMovimientoModal';
import NuevaVentaModal from '@/components/ventas/NuevaVentaModal';
import { ESTADOS, getEstado } from '@/components/pedidos/shared';
import TablaPedidos from '@/components/pedidos/TablaPedidos';
import ModalPedidoForm from '@/components/pedidos/ModalPedidoForm';
import ModalDetallePedido from '@/components/pedidos/ModalDetallePedido';
import { determinarTipoComprobante } from '@/hooks/useAfipConfig';

// precio_unitario es SIEMPRE el precio final que paga el cliente (IVA incluido) —
// mismo criterio que en Cotizaciones/Ventas. Para separar neto/IVA hay que
// DIVIDIR por el factor de la alícuota, nunca sumarlo.
const FACTOR_IVA = { '21': 1.21, '10.5': 1.105 };

// ── Componente principal ───────────────────────────────────────────────────────
function PedidosSection({ onNavigate, prefillCotizacion, onPrefillConsumed, navigatePedidoId, onNavigated } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [empresaCondicionIva, setEmpresaCondicionIva] = useState(null);
  const [loading, setLoading] = useState(true);

  // Autocompletar Producto/Descripción — mismo patrón que CotizacionesSection.jsx
  // (búsqueda con desplegable en vez de un <select> con el catálogo entero).
  const [prodSearch, setProdSearch] = useState({});
  const [prodResults, setProdResults] = useState({});
  const [prodOpen, setProdOpen] = useState({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterEstado, setFilterEstado] = useState('Todos');

  // Modal nuevo/editar
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPedido, setEditingPedido] = useState(null);

  // Modal detalle
  const [detailPedido, setDetailPedido] = useState(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Confirm cancelar
  const [cancelTarget, setCancelTarget] = useState(null);

  // Generar Entrega
  const [entregaPedidoId, setEntregaPedidoId] = useState(null);

  // Facturar desde pedido
  const [isFacturarOpen, setIsFacturarOpen] = useState(false);
  const [pedidoToFacturar, setPedidoToFacturar] = useState(null);

  // Entregas del pedido abierto en el modal de detalle
  const [entregasDetalle, setEntregasDetalle] = useState([]);
  const [loadingEntregas, setLoadingEntregas] = useState(false);
  const [entregasRefreshKey, setEntregasRefreshKey] = useState(0);

  // Form state
  const emptyForm = () => ({
    cliente_id: '',
    notas: '',
    fecha_entrega: '',
    referencia_cliente: '',
    moneda: 'ARS',
    tipoCambioTasa: 1,
    descuentoGlobalPct: '',
    items: [{ producto_id: '', descripcion: '', cantidad: 1, precio_unitario: 0, descuento_item: '', alicuota_iva: '21' }],
  });
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [tcMissing, setTcMissing] = useState(false);

  // Origen de la cotización cuando el pedido se prellenó vía "Copiar a Pedido"
  const [origenCotizacionId, setOrigenCotizacionId] = useState(null);

  useEffect(() => {
    if (user?.empresa_id) fetchAll();
  }, [user]);

  // Copiar a Pedido — prellenar el form con los ítems/cliente de una cotización
  useEffect(() => {
    if (!prefillCotizacion) return;
    setEditingPedido(null);
    setOrigenCotizacionId(prefillCotizacion.id);
    setForm({
      cliente_id: prefillCotizacion.cliente_id || '',
      notas: `Copiado de cotización ${prefillCotizacion.numero}`,
      fecha_entrega: '',
      referencia_cliente: '',
      // La cotización guarda los montos crudos en su propia moneda (sin normalizar
      // a ARS) — hay que copiar moneda + tasa junto con los ítems, si no el pedido
      // reinterpreta silenciosamente un monto en USD como si fuera ARS.
      moneda: prefillCotizacion.moneda || 'ARS',
      tipoCambioTasa: Number(prefillCotizacion.tipo_cambio_tasa) || 1,
      // La cotización ya trae su propio % de descuento global — mismo significado
      // en ambos documentos, se copia directo en vez de perderse en la conversión.
      descuentoGlobalPct: prefillCotizacion.descuento ? String(prefillCotizacion.descuento) : '',
      items: (prefillCotizacion.cotizacion_items ?? []).map(it => ({
        producto_id: it.producto_id || '',
        descripcion: it.descripcion,
        cantidad: Number(it.cantidad) || 1,
        precio_unitario: Number(it.precio_unitario) || 0,
        descuento_item: it.descuento_item || '',
        alicuota_iva: it.alicuota_iva ?? '21',
      })),
    });
    setIsModalOpen(true);
    if (!prefillCotizacion.cliente_id) {
      toast({ title: 'La cotización no tenía un cliente registrado', description: 'Seleccionalo manualmente en el pedido.', variant: 'destructive' });
    }
    onPrefillConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillCotizacion]);

  // Navegación desde el Flujo del Documento de otra sección (ej. Cotización → Pedido generado)
  useEffect(() => {
    if (!navigatePedidoId || !pedidos.length) return;
    const pedido = pedidos.find(p => p.id === navigatePedidoId);
    if (pedido) {
      setDetailPedido(pedido);
      setIsDetailOpen(true);
    }
    onNavigated?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigatePedidoId, pedidos]);

  // Fetch entregas del pedido abierto en el modal de detalle
  useEffect(() => {
    if (!isDetailOpen || !detailPedido?.id || !user?.empresa_id) {
      setEntregasDetalle([]);
      return;
    }
    setLoadingEntregas(true);
    supabase
      .from('entregas')
      .select('id, numero_entrega, estado, comprobante_id, comprobantes(numero_venta)')
      .eq('pedido_id', detailPedido.id)
      .eq('empresa_id', user.empresa_id)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        setEntregasDetalle(data || []);
        setLoadingEntregas(false);
      });
  }, [isDetailOpen, detailPedido?.id, user?.empresa_id, entregasRefreshKey]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [{ data: p }, { data: c }, { data: pr }, { data: emp }] = await Promise.all([
        supabase
          .from('pedidos')
          .select('*, pedido_items(*), cotizaciones(numero), clientes(condicion_iva)')
          .eq('empresa_id', user.empresa_id)
          .order('created_at', { ascending: false }),
        supabase.from('clientes').select('id, nombre, condicion_iva').eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre'),
        supabase.from('productos').select('id, nombre, precio_venta, codigo_sku, unidad_medida, alicuota_iva').eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre'),
        supabase.from('empresas').select('condicion_iva').eq('id', user.empresa_id).single(),
      ]);
      setPedidos(p || []);
      setClientes(c || []);
      setProductos(pr || []);
      setEmpresaCondicionIva(emp?.condicion_iva ?? null);
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const generateNumero = async () => {
    const { data, error } = await supabase.rpc('obtener_proximo_numero', {
      p_empresa_id: user.empresa_id,
      p_tipo_documento: 'pedido',
    });
    if (error) throw error;
    return data;
  };

  // ── Form helpers ────────────────────────────────────────────────────────────
  const addItem = () =>
    setForm(f => ({ ...f, items: [...f.items, { producto_id: '', descripcion: '', cantidad: 1, precio_unitario: 0, descuento_item: '', alicuota_iva: '21' }] }));

  const removeItem = (i) =>
    setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const updateItem = (i, field, value) =>
    setForm(f => {
      const items = [...f.items];
      items[i] = { ...items[i], [field]: value };
      return { ...f, items };
    });

  // Búsqueda con desplegable (reemplaza el <select> del catálogo entero) — mismo
  // patrón que CotizacionesSection.jsx, tope de 50 resultados (catálogos chicos/
  // medianos completos, el filtro por texto reduce antes de llegar ahí).
  const searchProducto = (idx, q) => {
    setProdSearch(prev => ({ ...prev, [idx]: q }));
    const query = (q ?? '').toLowerCase().trim();
    const filtered = query
      ? productos.filter(p => p.nombre.toLowerCase().includes(query)).slice(0, 50)
      : productos.slice(0, 50);
    setProdResults(prev => ({ ...prev, [idx]: filtered }));
  };

  const selectProducto = (idx, prod) => {
    setForm(f => {
      const items = [...f.items];
      items[idx] = {
        ...items[idx],
        producto_id: prod.id,
        descripcion: prod.nombre,
        precio_unitario: prod.precio_venta ?? '',
        unidad_medida: prod.unidad_medida ?? '',
        alicuota_iva: prod.alicuota_iva ?? '21',
      };
      return { ...f, items };
    });
    setProdSearch(prev => ({ ...prev, [idx]: prod.nombre }));
    setProdResults(prev => ({ ...prev, [idx]: [] }));
    setProdOpen(prev => ({ ...prev, [idx]: false }));
  };

  // Letra probable (A/B/C) — misma función que ya deciden las facturas reales
  // (y que ya usa Cotizaciones), nunca una opción manual aparte.
  const clienteSeleccionado = clientes.find(c => c.id === form.cliente_id);
  const letra = determinarTipoComprobante(empresaCondicionIva, clienteSeleccionado?.condicion_iva ?? 'CF');
  const discrimina = letra === 'A';

  const totales = form.items.reduce((acc, it) => {
    const cant = parseFloat(it.cantidad) || 0;
    const precio = parseFloat(it.precio_unitario) || 0;
    const descPct = parseNumberLocale(it.descuento_item) || 0;
    // "subtotal" es precio de lista sin ningún descuento — mismo criterio que
    // CotizacionesSection.jsx (bug real corregido 13/08: si no, un ítem con %
    // Desc. propio no dejaba rastro visible en los totales).
    const brutoLista = cant * precio;
    const brutoConDescLinea = brutoLista * (1 - descPct / 100);
    const factor = FACTOR_IVA[it.alicuota_iva] ?? 1;
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

  const openNew = () => { setEditingPedido(null); setForm(emptyForm()); setOrigenCotizacionId(null); setIsModalOpen(true); };
  const openEdit = (p) => {
    setEditingPedido(p);
    setForm({
      cliente_id: p.cliente_id || '',
      notas: p.notas || '',
      fecha_entrega: p.fecha_entrega || '',
      referencia_cliente: p.referencia_cliente || '',
      moneda: p.moneda || 'ARS',
      tipoCambioTasa: Number(p.tipo_cambio_tasa) || 1,
      descuentoGlobalPct: p.descuento_global_pct ? String(p.descuento_global_pct) : '',
      items: p.pedido_items?.length
        ? p.pedido_items.map(it => ({
            id: it.id,
            producto_id: it.producto_id || '',
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            descuento_item: it.descuento_item || '',
            alicuota_iva: it.alicuota_iva ?? '21',
          }))
        : emptyForm().items,
    });
    setIsModalOpen(true);
  };

  // ── Guardar ─────────────────────────────────────────────────────────────────
  // Editar delega TODO el cálculo (subtotal/descuento/total) a la RPC
  // actualizar_pedido, que además diffea los ítems por id (mig.320) — no repite
  // el error de "borrar todo y reinsertar" que tuvo la primera versión de
  // Cotizaciones y generaba ruido en el historial de auditoría.
  const handleSave = async () => {
    const validItems = form.items.filter(it => it.descripcion.trim() || it.producto_id);
    if (!validItems.length) {
      toast({ title: 'Agregá al menos un ítem', variant: 'destructive' }); return;
    }
    if (form.moneda !== 'ARS' && tcMissing) {
      toast({ title: 'Falta el tipo de cambio del día', description: `Cargá la tasa de ${form.moneda} para hoy antes de guardar el pedido.`, variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const clienteObj = clientes.find(c => c.id === form.cliente_id);
      const descGlobal = parseNumberLocale(form.descuentoGlobalPct) || 0;

      if (editingPedido) {
        const itemsPayload = validItems.map(it => ({
          id: it.id ?? null,
          producto_id: it.producto_id || null,
          descripcion: it.descripcion,
          cantidad: parseFloat(it.cantidad) || 1,
          precio_unitario: parseFloat(it.precio_unitario) || 0,
          descuento_item: parseNumberLocale(it.descuento_item) || 0,
          unidad_medida: it.unidad_medida || null,
          alicuota_iva: it.alicuota_iva ?? '21',
        }));
        const { error } = await supabase.rpc('actualizar_pedido', {
          p_pedido_id: editingPedido.id,
          p_cliente_id: form.cliente_id || null,
          p_cliente_nombre: clienteObj?.nombre || 'Sin cliente',
          p_items: itemsPayload,
          p_notas: form.notas,
          p_fecha_entrega: form.fecha_entrega || null,
          p_referencia_cliente: form.referencia_cliente || null,
          p_moneda: form.moneda,
          p_tipo_cambio_tasa: form.tipoCambioTasa,
          p_descuento_global_pct: descGlobal,
        });
        if (error) throw error;
        toast({ title: 'Pedido actualizado' });
      } else {
        const now = getNowAR().toISOString();
        const itemsCalc = validItems.map(it => {
          const cantidad = parseFloat(it.cantidad) || 1;
          const precioUnitario = parseFloat(it.precio_unitario) || 0;
          const descuentoItem = parseNumberLocale(it.descuento_item) || 0;
          return { ...it, cantidad, precioUnitario, descuentoItem, subtotal: cantidad * precioUnitario * (1 - descuentoItem / 100) };
        });
        const subtotalConDescLinea = itemsCalc.reduce((s, it) => s + it.subtotal, 0);
        const total = subtotalConDescLinea * (1 - descGlobal / 100);
        const descuento = subtotalConDescLinea - total;

        const numero = await generateNumero();
        const { data: pedido, error } = await supabase.from('pedidos').insert([{
          empresa_id: user.empresa_id,
          user_id: user.id,
          numero,
          cliente_id: form.cliente_id || null,
          cliente_nombre: clienteObj?.nombre || 'Sin cliente',
          estado: 'borrador',
          notas: form.notas,
          fecha_entrega: form.fecha_entrega || null,
          referencia_cliente: form.referencia_cliente || null,
          moneda: form.moneda,
          tipo_cambio_tasa: form.tipoCambioTasa,
          subtotal: subtotalConDescLinea,
          descuento,
          descuento_global_pct: descGlobal,
          total,
          fecha: now,
          cotizacion_id: origenCotizacionId,
        }]).select().single();
        if (error) throw error;

        const { error: itemsError } = await supabase.from('pedido_items').insert(
          itemsCalc.map(it => ({
            pedido_id: pedido.id,
            empresa_id: user.empresa_id,
            producto_id: it.producto_id || null,
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            precio_unitario: it.precioUnitario,
            descuento_item: it.descuentoItem,
            subtotal: it.subtotal,
            unidad_medida: it.unidad_medida || null,
            alicuota_iva: it.alicuota_iva ?? '21',
          }))
        );
        if (itemsError) throw itemsError;
        toast({ title: `Pedido ${numero} creado` });
      }
      setIsModalOpen(false);
      setOrigenCotizacionId(null);
      fetchAll();
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  // ── Avanzar estado (para borrador→confirmado y confirmado→en_preparacion) ─
  const handleAvanzar = async (pedido) => {
    const e = getEstado(pedido.estado);
    if (!e.next) return;
    const { error } = await supabase.from('pedidos')
      .update({ estado: e.next, updated_at: getNowAR().toISOString() })
      .eq('id', pedido.id);
    if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
    else {
      toast({ title: `Pedido ${pedido.numero} → ${getEstado(e.next).label}` });
      fetchAll();
      // Mismo bug encontrado y corregido por Luciano en Cotizaciones/OC/Proveedores
      // (mig. f137a54): la mutación guarda bien, pero si el detalle sigue abierto
      // se queda mostrando el estado viejo — acá el "detalle" es un objeto plano
      // (`detailPedido`), no una query de react-query, así que la forma de
      // corregirlo es sincronizarlo a mano en vez de invalidar una key.
      setDetailPedido(prev => (prev?.id === pedido.id ? { ...prev, estado: e.next } : prev));
    }
  };

  // ── Facturar desde pedido (abre NuevaVentaModal pre-cargado) ─────────────
  const handleFacturarPedido = (pedido) => {
    setPedidoToFacturar(pedido);
    setIsDetailOpen(false);
    setIsFacturarOpen(true);
  };

  const handleSaleSuccessForPedido = async () => {
    if (!pedidoToFacturar) return;
    const { error } = await supabase.from('pedidos')
      .update({ estado: 'facturado', updated_at: getNowAR().toISOString() })
      .eq('id', pedidoToFacturar.id);
    if (error) {
      toast({ title: 'La venta se registró, pero no se pudo marcar el pedido como Facturado', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Pedido ${pedidoToFacturar.numero} marcado como Facturado` });
    }
    setPedidoToFacturar(null);
    setIsFacturarOpen(false);
    fetchAll();
  };

  // ── Generar Entrega ─────────────────────────────────────────────────────────
  const handleAbrirGenerarEntrega = (pedido, ev) => {
    ev?.stopPropagation();
    setEntregaPedidoId(pedido.id);
  };

  const handleEntregaSuccess = () => {
    fetchAll();
    setEntregasRefreshKey(k => k + 1); // refresca el DocumentFlow del modal de detalle
  };

  const handleCancelar = async () => {
    if (!cancelTarget) return;
    const { error } = await supabase.from('pedidos')
      .update({ estado: 'cancelado', updated_at: getNowAR().toISOString() })
      .eq('id', cancelTarget.id);
    if (error) {
      toast({ title: 'Error al cancelar el pedido', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Pedido ${cancelTarget.numero} cancelado` });
    }
    setCancelTarget(null);
    fetchAll();
  };

  // ── Filtros ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = pedidos;
    if (filterEstado !== 'Todos') r = r.filter(p => p.estado === filterEstado);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      r = r.filter(p =>
        p.numero.toLowerCase().includes(q) ||
        p.cliente_nombre.toLowerCase().includes(q)
      );
    }
    return r;
  }, [pedidos, filterEstado, searchTerm]);

  const stats = useMemo(() => ({
    borrador:       pedidos.filter(p => p.estado === 'borrador').length,
    confirmado:     pedidos.filter(p => p.estado === 'confirmado').length,
    en_preparacion: pedidos.filter(p => p.estado === 'en_preparacion').length,
    facturado:      pedidos.filter(p => p.estado === 'facturado').length,
  }), [pedidos]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold dark:text-kx-text flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-blue-600 dark:text-kx-violet" /> Pedidos de Clientes
          </h2>
          <p className="text-slate-500 dark:text-kx-text-2 mt-1">Gestioná pedidos desde borrador hasta facturación</p>
        </div>
        <Button onClick={openNew} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" /> Nuevo Pedido
        </Button>
      </div>

      {/* KPIs estado */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-kx-border border border-kx-border rounded-2xl overflow-hidden shadow-sm dark:shadow-none">
        {[
          { estado: 'borrador',       label: 'Borradores',     accent: 'border-t-kx-text-3' },
          { estado: 'confirmado',     label: 'Confirmados',    accent: 'border-t-kx-blue'   },
          { estado: 'en_preparacion', label: 'En Preparación', accent: 'border-t-kx-amber'  },
          { estado: 'facturado',      label: 'Facturados',     accent: 'border-t-kx-green'  },
        ].map(({ estado, label, accent }) => (
          <button
            key={estado}
            onClick={() => setFilterEstado(filterEstado === estado ? 'Todos' : estado)}
            className={`p-4 text-left border-t-2 ${accent} transition-colors duration-200
              ${filterEstado === estado ? 'bg-kx-surface-2' : 'bg-kx-surface hover:bg-kx-surface-2'}`}
          >
            <div className="text-2xl font-bold text-kx-text tabular-nums">{stats[estado]}</div>
            <div className="text-xs font-medium mt-0.5 text-kx-text-2">{label}</div>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
          <Input
            placeholder="Buscar por número o cliente..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
          />
        </div>
        <select
          value={filterEstado}
          onChange={e => setFilterEstado(e.target.value)}
          className="h-10 rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-3 text-sm"
        >
          <option value="Todos">Todos los estados</option>
          {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </div>

      {/* Tabla */}
      <TablaPedidos
        filtered={filtered}
        loading={loading}
        filterEstado={filterEstado}
        openNew={openNew}
        openEdit={openEdit}
        onVerDetalle={(pedido) => { setDetailPedido(pedido); setIsDetailOpen(true); }}
        handleAbrirGenerarEntrega={handleAbrirGenerarEntrega}
        handleFacturarPedido={handleFacturarPedido}
        handleAvanzar={handleAvanzar}
        setCancelTarget={setCancelTarget}
      />

      {/* ── Modal Nuevo / Editar ──────────────────────────────────────────────── */}
      <ModalPedidoForm
        isModalOpen={isModalOpen} setIsModalOpen={setIsModalOpen}
        editingPedido={editingPedido}
        form={form} setForm={setForm}
        clientes={clientes}
        addItem={addItem}
        removeItem={removeItem}
        updateItem={updateItem}
        prodSearch={prodSearch} prodResults={prodResults} prodOpen={prodOpen} setProdOpen={setProdOpen}
        searchProducto={searchProducto} selectProducto={selectProducto}
        totales={totales} discrimina={discrimina}
        tcMissing={tcMissing} setTcMissing={setTcMissing}
        handleSave={handleSave}
        saving={saving}
      />

      {/* ── Modal Detalle ──────────────────────────────────────────────────────── */}
      <ModalDetallePedido
        isDetailOpen={isDetailOpen} setIsDetailOpen={setIsDetailOpen}
        detailPedido={detailPedido} setDetailPedido={setDetailPedido}
        entregasDetalle={entregasDetalle}
        loadingEntregas={loadingEntregas}
        onNavigate={onNavigate}
        handleAbrirGenerarEntrega={handleAbrirGenerarEntrega}
        handleFacturarPedido={handleFacturarPedido}
        handleAvanzar={handleAvanzar}
        onEditar={(p) => { setIsDetailOpen(false); openEdit(p); }}
        discrimina={detailPedido ? determinarTipoComprobante(empresaCondicionIva, detailPedido.clientes?.condicion_iva ?? 'CF') === 'A' : false}
      />

      {/* ── Confirm cancelar ─────────────────────────────────────────────────── */}
      <AlertDialog open={!!cancelTarget} onOpenChange={v => !v && setCancelTarget(null)}>
        <AlertDialogContent className="dark:bg-kx-bg dark:border-kx-border">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-kx-text">¿Cancelar pedido?</AlertDialogTitle>
            <AlertDialogDescription className="dark:text-kx-text-2">
              El pedido <strong>{cancelTarget?.numero}</strong> se marcará como cancelado. Esta acción no puede deshacerse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:text-kx-text dark:border-kx-border">Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelar} className="bg-red-600 hover:bg-red-700 text-white">
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Generar Entrega Modal ────────────────────────────────────────────── */}
      <GenerarMovimientoModal
        tipo="entrega"
        sourceId={entregaPedidoId}
        onClose={() => setEntregaPedidoId(null)}
        onSuccess={handleEntregaSuccess}
      />

      {/* ── Facturar desde Pedido (abre POS pre-cargado) ────────────────────── */}
      <NuevaVentaModal
        isOpen={isFacturarOpen}
        onOpenChange={v => !v && setIsFacturarOpen(false)}
        onSaleSuccess={handleSaleSuccessForPedido}
        pedido={pedidoToFacturar}
      />
    </div>
  );
}

export default PedidosSection;
