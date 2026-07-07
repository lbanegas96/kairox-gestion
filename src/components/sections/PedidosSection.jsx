import React, { useState, useEffect, useMemo } from 'react';
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
import GenerarMovimientoModal from '@/components/shared/GenerarMovimientoModal';
import NuevaVentaModal from '@/components/ventas/NuevaVentaModal';
import { ESTADOS, getEstado } from '@/components/pedidos/shared';
import TablaPedidos from '@/components/pedidos/TablaPedidos';
import ModalPedidoForm from '@/components/pedidos/ModalPedidoForm';
import ModalDetallePedido from '@/components/pedidos/ModalDetallePedido';

// ── Componente principal ───────────────────────────────────────────────────────
function PedidosSection({ onNavigate } = {}) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [pedidos, setPedidos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [productos, setProductos] = useState([]);
  const [loading, setLoading] = useState(true);
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
    items: [{ producto_id: '', descripcion: '', cantidad: 1, precio_unitario: 0 }],
  });
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user?.empresa_id) fetchAll();
  }, [user]);

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
      const [{ data: p }, { data: c }, { data: pr }] = await Promise.all([
        supabase
          .from('pedidos')
          .select('*, pedido_items(*)')
          .eq('empresa_id', user.empresa_id)
          .order('created_at', { ascending: false }),
        supabase.from('clientes').select('id, nombre').eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre'),
        supabase.from('productos').select('id, nombre, precio_venta, codigo_sku').eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre'),
      ]);
      setPedidos(p || []);
      setClientes(c || []);
      setProductos(pr || []);
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
    setForm(f => ({ ...f, items: [...f.items, { producto_id: '', descripcion: '', cantidad: 1, precio_unitario: 0 }] }));

  const removeItem = (i) =>
    setForm(f => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const updateItem = (i, field, value) =>
    setForm(f => {
      const items = [...f.items];
      items[i] = { ...items[i], [field]: value };
      if (field === 'producto_id' && value) {
        const prod = productos.find(p => p.id === value);
        if (prod) {
          items[i].descripcion = prod.nombre;
          items[i].precio_unitario = prod.precio_venta;
        }
      }
      return { ...f, items };
    });

  const totalForm = form.items.reduce(
    (s, it) => s + (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0), 0
  );

  const openNew = () => { setEditingPedido(null); setForm(emptyForm()); setIsModalOpen(true); };
  const openEdit = (p) => {
    setEditingPedido(p);
    setForm({
      cliente_id: p.cliente_id || '',
      notas: p.notas || '',
      fecha_entrega: p.fecha_entrega || '',
      items: p.pedido_items?.length
        ? p.pedido_items.map(it => ({
            id: it.id,
            producto_id: it.producto_id || '',
            descripcion: it.descripcion,
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
          }))
        : emptyForm().items,
    });
    setIsModalOpen(true);
  };

  // ── Guardar ─────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const validItems = form.items.filter(it => it.descripcion.trim() || it.producto_id);
    if (!validItems.length) {
      toast({ title: 'Agregá al menos un ítem', variant: 'destructive' }); return;
    }
    setSaving(true);
    try {
      const clienteObj = clientes.find(c => c.id === form.cliente_id);
      const now = getNowAR().toISOString();
      const total = validItems.reduce(
        (s, it) => s + (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0), 0
      );

      if (editingPedido) {
        await supabase.from('pedidos').update({
          cliente_id: form.cliente_id || null,
          cliente_nombre: clienteObj?.nombre || 'Sin cliente',
          notas: form.notas,
          fecha_entrega: form.fecha_entrega || null,
          total,
          updated_at: now,
        }).eq('id', editingPedido.id);

        await supabase.from('pedido_items').delete().eq('pedido_id', editingPedido.id);
        await supabase.from('pedido_items').insert(
          validItems.map(it => ({
            pedido_id: editingPedido.id,
            empresa_id: user.empresa_id,
            producto_id: it.producto_id || null,
            descripcion: it.descripcion,
            cantidad: parseFloat(it.cantidad) || 1,
            precio_unitario: parseFloat(it.precio_unitario) || 0,
            subtotal: (parseFloat(it.cantidad) || 1) * (parseFloat(it.precio_unitario) || 0),
          }))
        );
        toast({ title: 'Pedido actualizado' });
      } else {
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
          total,
          fecha: now,
        }]).select().single();
        if (error) throw error;

        await supabase.from('pedido_items').insert(
          validItems.map(it => ({
            pedido_id: pedido.id,
            empresa_id: user.empresa_id,
            producto_id: it.producto_id || null,
            descripcion: it.descripcion,
            cantidad: parseFloat(it.cantidad) || 1,
            precio_unitario: parseFloat(it.precio_unitario) || 0,
            subtotal: (parseFloat(it.cantidad) || 1) * (parseFloat(it.precio_unitario) || 0),
          }))
        );
        toast({ title: `Pedido ${numero} creado` });
      }
      setIsModalOpen(false);
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

  const handleEntregaSuccess = (numeroEntrega) => {
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
            <ClipboardList className="h-8 w-8 text-blue-600 dark:text-[#00D4FF]" /> Pedidos de Clientes
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
        productos={productos}
        addItem={addItem}
        removeItem={removeItem}
        updateItem={updateItem}
        totalForm={totalForm}
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
