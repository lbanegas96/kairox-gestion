import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus, Search, Eye, Trash2, Check, X, Loader2, Package,
  ClipboardList, ChevronRight, ArrowRight, Banknote, AlertTriangle,
  Calendar, User, FileText, Edit3
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getNowAR, getTodayAR, formatDateAR } from '@/lib/dateUtils';

// ── Estados del workflow ───────────────────────────────────────────────────────
const ESTADOS = [
  { id: 'borrador',        label: 'Borrador',        color: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',           next: 'confirmado'       },
  { id: 'confirmado',      label: 'Confirmado',      color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',            next: 'en_preparacion'   },
  { id: 'en_preparacion',  label: 'En Preparación',  color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',        next: 'facturado'        },
  { id: 'facturado',       label: 'Facturado',       color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',        next: null               },
  { id: 'cancelado',       label: 'Cancelado',       color: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',               next: null               },
];

const getEstado = (id) => ESTADOS.find(e => e.id === id) || ESTADOS[0];

function EstadoBadge({ estado }) {
  const e = getEstado(estado);
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${e.color}`}>{e.label}</span>;
}

// ── Componente principal ───────────────────────────────────────────────────────
function PedidosSection() {
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
    if (user?.empresa_id) {
      fetchAll();
    }
  }, [user]);

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
    const todayStr = getTodayAR().replace(/-/g, '');
    const { data } = await supabase
      .from('pedidos').select('numero').eq('empresa_id', user.empresa_id)
      .ilike('numero', `PED-${todayStr}-%`)
      .order('numero', { ascending: false }).limit(1);
    let seq = 1;
    if (data?.length) seq = parseInt(data[0].numero.split('-')[2] || '0') + 1;
    return `PED-${todayStr}-${String(seq).padStart(3, '0')}`;
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
      // Auto-fill precio from product
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
        // Update
        await supabase.from('pedidos').update({
          cliente_id: form.cliente_id || null,
          cliente_nombre: clienteObj?.nombre || 'Sin cliente',
          notas: form.notas,
          fecha_entrega: form.fecha_entrega || null,
          total,
          updated_at: now,
        }).eq('id', editingPedido.id);

        // Replace items
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

  // ── Avanzar estado ──────────────────────────────────────────────────────────
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

  const handleCancelar = async () => {
    if (!cancelTarget) return;
    await supabase.from('pedidos')
      .update({ estado: 'cancelado', updated_at: getNowAR().toISOString() })
      .eq('id', cancelTarget.id);
    toast({ title: `Pedido ${cancelTarget.numero} cancelado` });
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
          <h2 className="text-3xl font-bold dark:text-white flex items-center gap-3">
            <ClipboardList className="h-8 w-8 text-blue-600 dark:text-[#00D4FF]" /> Pedidos de Clientes
          </h2>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Gestioná pedidos desde borrador hasta facturación</p>
        </div>
        <Button onClick={openNew} className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" /> Nuevo Pedido
        </Button>
      </div>

      {/* KPIs estado */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { estado: 'borrador',       label: 'Borradores',      color: 'bg-slate-100 dark:bg-slate-900', textColor: 'text-slate-700 dark:text-slate-300' },
          { estado: 'confirmado',     label: 'Confirmados',     color: 'bg-blue-50 dark:bg-blue-900/20', textColor: 'text-blue-700 dark:text-blue-300' },
          { estado: 'en_preparacion', label: 'En Preparación',  color: 'bg-amber-50 dark:bg-amber-900/20', textColor: 'text-amber-700 dark:text-amber-300' },
          { estado: 'facturado',      label: 'Facturados',      color: 'bg-green-50 dark:bg-green-900/20', textColor: 'text-green-700 dark:text-green-300' },
        ].map(({ estado, label, color, textColor }) => (
          <button
            key={estado}
            onClick={() => setFilterEstado(filterEstado === estado ? 'Todos' : estado)}
            className={`rounded-xl p-4 text-left border transition-all ${color} ${filterEstado === estado ? 'ring-2 ring-blue-400' : 'border-slate-200 dark:border-slate-800 hover:opacity-80'}`}
          >
            <div className={`text-2xl font-bold ${textColor}`}>{stats[estado]}</div>
            <div className={`text-xs font-medium mt-0.5 ${textColor}`}>{label}</div>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por número o cliente..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9 dark:bg-slate-900 dark:border-slate-700 dark:text-white"
          />
        </div>
        <select
          value={filterEstado}
          onChange={e => setFilterEstado(e.target.value)}
          className="h-10 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white px-3 text-sm"
        >
          <option value="Todos">Todos los estados</option>
          {ESTADOS.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
      </div>

      {/* Tabla */}
      <Card className="dark:bg-slate-950 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="text-left p-4 font-semibold text-slate-600 dark:text-slate-400">Número</th>
                <th className="text-left p-4 font-semibold text-slate-600 dark:text-slate-400">Cliente</th>
                <th className="text-left p-4 font-semibold text-slate-600 dark:text-slate-400">Fecha</th>
                <th className="text-left p-4 font-semibold text-slate-600 dark:text-slate-400">Entrega</th>
                <th className="text-right p-4 font-semibold text-slate-600 dark:text-slate-400">Total</th>
                <th className="text-center p-4 font-semibold text-slate-600 dark:text-slate-400">Estado</th>
                <th className="text-center p-4 font-semibold text-slate-600 dark:text-slate-400">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="p-4">
                        <div className="h-4 bg-slate-200 dark:bg-slate-800 rounded animate-pulse w-20" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-slate-400 dark:text-slate-500">
                    <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="font-medium">No hay pedidos{filterEstado !== 'Todos' ? ` en estado "${getEstado(filterEstado).label}"` : ''}</p>
                    <Button variant="link" onClick={openNew} className="mt-2 text-blue-500">
                      Crear el primer pedido
                    </Button>
                  </td>
                </tr>
              ) : (
                filtered.map(pedido => {
                  const e = getEstado(pedido.estado);
                  const canAdvance = !!e.next;
                  const canEdit = pedido.estado === 'borrador';
                  return (
                    <tr key={pedido.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors cursor-pointer"
                      onClick={() => { setDetailPedido(pedido); setIsDetailOpen(true); }}
                    >
                      <td className="p-4 font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {pedido.numero}
                      </td>
                      <td className="p-4 dark:text-slate-200">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          {pedido.cliente_nombre}
                        </div>
                      </td>
                      <td className="p-4 text-slate-500 dark:text-slate-400 text-xs">
                        {formatDateAR(pedido.fecha)}
                      </td>
                      <td className="p-4 text-slate-500 dark:text-slate-400 text-xs">
                        {pedido.fecha_entrega ? (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDateAR(pedido.fecha_entrega)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="p-4 text-right font-mono font-bold dark:text-slate-200">
                        ${Number(pedido.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-4 text-center">
                        <EstadoBadge estado={pedido.estado} />
                      </td>
                      <td className="p-4 text-center" onClick={ev => ev.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          {canEdit && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-blue-600"
                              onClick={() => openEdit(pedido)} title="Editar">
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canAdvance && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                              onClick={() => handleAvanzar(pedido)}
                              title={`Avanzar → ${getEstado(e.next).label}`}>
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {pedido.estado !== 'cancelado' && pedido.estado !== 'facturado' && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                              onClick={() => setCancelTarget(pedido)} title="Cancelar">
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Modal Nuevo / Editar ──────────────────────────────────────────────── */}
      <Dialog open={isModalOpen} onOpenChange={v => { if (!v) setIsModalOpen(false); }}>
        <DialogContent className="max-w-3xl dark:bg-slate-950 dark:border-slate-800 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="dark:text-white">
              {editingPedido ? `Editar ${editingPedido.numero}` : 'Nuevo Pedido'}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              {editingPedido ? 'Modificá los ítems del pedido en borrador.' : 'Cargá los productos y datos del pedido.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Cliente + Entrega */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="dark:text-white">Cliente</Label>
                <select
                  value={form.cliente_id}
                  onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}
                  className="w-full h-10 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white px-3 text-sm"
                >
                  <option value="">Sin cliente</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label className="dark:text-white">Fecha de Entrega (opcional)</Label>
                <Input
                  type="date"
                  value={form.fecha_entrega}
                  onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))}
                  className="dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                />
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <Label className="dark:text-white">Ítems del Pedido</Label>
                <Button variant="outline" size="sm" onClick={addItem} className="h-8 dark:text-white dark:border-slate-700">
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar ítem
                </Button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 px-1">
                  <span className="col-span-4">Producto / Descripción</span>
                  <span className="col-span-3">Descripción libre</span>
                  <span className="col-span-2 text-center">Cantidad</span>
                  <span className="col-span-2 text-right">Precio Unit.</span>
                  <span className="col-span-1"></span>
                </div>
                {form.items.map((item, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-4">
                      <select
                        value={item.producto_id}
                        onChange={e => updateItem(i, 'producto_id', e.target.value)}
                        className="w-full h-9 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 dark:text-white px-2"
                      >
                        <option value="">— sin producto —</option>
                        {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <Input
                        placeholder="Descripción"
                        value={item.descripcion}
                        onChange={e => updateItem(i, 'descripcion', e.target.value)}
                        className="h-9 text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number" min="0.001" step="0.001"
                        value={item.cantidad}
                        onChange={e => updateItem(i, 'cantidad', e.target.value)}
                        className="h-9 text-sm text-center dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                      />
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number" min="0" step="0.01"
                        value={item.precio_unitario}
                        onChange={e => updateItem(i, 'precio_unitario', e.target.value)}
                        className="h-9 text-sm text-right dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {form.items.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500"
                          onClick={() => removeItem(i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">
                Total: ${totalForm.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
              </div>
            </div>

            {/* Notas */}
            <div className="space-y-1.5">
              <Label className="dark:text-white">Notas internas</Label>
              <Textarea
                placeholder="Instrucciones especiales, referencias, etc."
                value={form.notas}
                onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                className="resize-none h-20 dark:bg-slate-900 dark:border-slate-700 dark:text-white"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)} className="dark:text-white dark:border-slate-700">
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
              {editingPedido ? 'Guardar cambios' : 'Crear Pedido'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Modal Detalle ──────────────────────────────────────────────────────── */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-lg dark:bg-slate-950 dark:border-slate-800">
          {detailPedido && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 dark:text-white">
                  <FileText className="h-5 w-5 text-blue-500" />
                  Pedido {detailPedido.numero}
                </DialogTitle>
                <DialogDescription className="dark:text-slate-400">
                  Detalle completo del pedido
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Estado</span>
                  <EstadoBadge estado={detailPedido.estado} />
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Cliente</span>
                  <span className="font-medium dark:text-white">{detailPedido.cliente_nombre}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-slate-500">Fecha</span>
                  <span className="text-sm dark:text-slate-300">{formatDateAR(detailPedido.fecha)}</span>
                </div>
                {detailPedido.fecha_entrega && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-500">Entrega</span>
                    <span className="text-sm dark:text-slate-300">{formatDateAR(detailPedido.fecha_entrega)}</span>
                  </div>
                )}
                {detailPedido.notas && (
                  <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 text-sm text-slate-600 dark:text-slate-400">
                    {detailPedido.notas}
                  </div>
                )}

                {/* Items */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800">
                      <th className="text-left pb-2 text-slate-500">Descripción</th>
                      <th className="text-center pb-2 text-slate-500 w-16">Cant.</th>
                      <th className="text-right pb-2 text-slate-500">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailPedido.pedido_items || []).map(it => (
                      <tr key={it.id} className="border-b border-slate-100 dark:border-slate-800/50">
                        <td className="py-2 dark:text-slate-200">{it.descripcion}</td>
                        <td className="py-2 text-center text-slate-500">{it.cantidad}</td>
                        <td className="py-2 text-right font-mono dark:text-slate-200">
                          ${Number(it.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="text-right font-bold text-lg dark:text-white">
                  Total: ${Number(detailPedido.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </div>

                {/* Workflow */}
                {(() => {
                  const e = getEstado(detailPedido.estado);
                  if (!e.next) return null;
                  return (
                    <Button
                      className="w-full bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => { handleAvanzar(detailPedido); setIsDetailOpen(false); }}
                    >
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Avanzar a {getEstado(e.next).label}
                    </Button>
                  );
                })()}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Confirm cancelar ─────────────────────────────────────────────────── */}
      <AlertDialog open={!!cancelTarget} onOpenChange={v => !v && setCancelTarget(null)}>
        <AlertDialogContent className="dark:bg-slate-950 dark:border-slate-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-white">¿Cancelar pedido?</AlertDialogTitle>
            <AlertDialogDescription className="dark:text-slate-400">
              El pedido <strong>{cancelTarget?.numero}</strong> se marcará como cancelado. Esta acción no puede deshacerse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="dark:text-white dark:border-slate-700">Volver</AlertDialogCancel>
            <AlertDialogAction onClick={handleCancelar} className="bg-red-600 hover:bg-red-700 text-white">
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default PedidosSection;
