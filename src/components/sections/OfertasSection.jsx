import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag, Percent, DollarSign, Calendar, ShoppingCart, Clock,
  ToggleLeft, ToggleRight, Plus, Edit, Trash2, Loader2, Check, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

const OFERTAS_KEY = (eid) => ['ofertas', eid];

const DIAS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

const MEDIOS_PAGO = [
  { value: '', label: 'Todos' },
  { value: 'Efectivo', label: 'Efectivo' },
  { value: 'Transferencia', label: 'Transferencia' },
  { value: 'Tarjeta', label: 'Tarjeta' },
  { value: 'Cuenta Corriente', label: 'Cuenta Corriente' },
];

const EMPTY_OFERTA = {
  nombre: '',
  descripcion: '',
  tipo_descuento: 'porcentaje',
  valor_descuento: '',
  producto_id: null,
  categoria_nombre: '',
  medio_pago: '',
  dia_semana: [],
  monto_minimo_carrito: '',
  cantidad_minima: '',
  fecha_desde: '',
  fecha_hasta: '',
  prioridad: 0,
  acumulable: false,
  activo: true,
};

const preparePayload = (form) => ({
  nombre: form.nombre,
  descripcion: form.descripcion?.trim() || null,
  tipo_descuento: form.tipo_descuento,
  valor_descuento: parseFloat(form.valor_descuento),
  producto_id: form.producto_id || null,
  categoria_nombre: form.categoria_nombre?.trim() || null,
  medio_pago: form.medio_pago || null,
  dia_semana: form.dia_semana.length > 0 ? form.dia_semana : null,
  monto_minimo_carrito: form.monto_minimo_carrito ? parseFloat(form.monto_minimo_carrito) : null,
  cantidad_minima: form.cantidad_minima ? parseFloat(form.cantidad_minima) : null,
  fecha_desde: form.fecha_desde || null,
  fecha_hasta: form.fecha_hasta || null,
  prioridad: parseInt(form.prioridad) || 0,
  acumulable: form.acumulable,
  activo: form.activo,
});

const formatDate = (d) => {
  if (!d) return null;
  const date = new Date(d + 'T00:00:00');
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

function OfertasSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingOferta, setEditingOferta] = useState(null);
  const [form, setForm] = useState(EMPTY_OFERTA);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [prodSearch, setProdSearch] = useState('');

  if (user?.role !== 'admin') {
    return (
      <div className="p-8 text-center text-kx-text-2">
        No tenés permisos para gestionar ofertas.
      </div>
    );
  }

  const { data: ofertas = [], isLoading } = useQuery({
    queryKey: OFERTAS_KEY(empresaId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ofertas')
        .select('*, productos(nombre)')
        .eq('empresa_id', empresaId)
        .order('prioridad', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: productos = [] } = useQuery({
    queryKey: ['productos_select', empresaId],
    queryFn: async () => {
      const { data } = await supabase
        .from('productos')
        .select('id, nombre, categorias(nombre)')
        .eq('empresa_id', empresaId)
        .eq('activo', true)
        .order('nombre')
        .limit(500);
      return data ?? [];
    },
    enabled: !!empresaId && modalOpen,
  });

  const createOferta = useMutation({
    mutationFn: async (oferta) => {
      const { error } = await supabase
        .from('ofertas')
        .insert([{ ...oferta, empresa_id: empresaId }]);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OFERTAS_KEY(empresaId) });
      toast({ title: 'Oferta creada ✓', className: 'bg-green-600 text-white' });
      setModalOpen(false);
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const updateOferta = useMutation({
    mutationFn: async ({ id, ...data }) => {
      const { error } = await supabase
        .from('ofertas')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('empresa_id', empresaId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OFERTAS_KEY(empresaId) });
      toast({ title: 'Oferta actualizada ✓', className: 'bg-green-600 text-white' });
      setModalOpen(false);
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const toggleActivo = useMutation({
    mutationFn: async ({ id, activo }) => {
      const { error } = await supabase
        .from('ofertas')
        .update({ activo, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('empresa_id', empresaId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: OFERTAS_KEY(empresaId) }),
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteOferta = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase
        .from('ofertas')
        .delete()
        .eq('id', id)
        .eq('empresa_id', empresaId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OFERTAS_KEY(empresaId) });
      toast({ title: 'Oferta eliminada' });
      setDeleteConfirm(null);
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const openNueva = () => {
    setEditingOferta(null);
    setForm(EMPTY_OFERTA);
    setProdSearch('');
    setModalOpen(true);
  };

  const openEditar = (oferta) => {
    setEditingOferta(oferta);
    setForm({
      nombre: oferta.nombre,
      descripcion: oferta.descripcion ?? '',
      tipo_descuento: oferta.tipo_descuento,
      valor_descuento: String(oferta.valor_descuento),
      producto_id: oferta.producto_id,
      categoria_nombre: oferta.categoria_nombre ?? '',
      medio_pago: oferta.medio_pago ?? '',
      dia_semana: oferta.dia_semana ?? [],
      monto_minimo_carrito: oferta.monto_minimo_carrito ? String(oferta.monto_minimo_carrito) : '',
      cantidad_minima: oferta.cantidad_minima ? String(oferta.cantidad_minima) : '',
      fecha_desde: oferta.fecha_desde ?? '',
      fecha_hasta: oferta.fecha_hasta ?? '',
      prioridad: oferta.prioridad ?? 0,
      acumulable: oferta.acumulable ?? false,
      activo: oferta.activo,
    });
    setProdSearch('');
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.nombre.trim()) return;
    if (!form.valor_descuento || parseFloat(form.valor_descuento) <= 0) return;

    const payload = preparePayload(form);
    if (editingOferta) {
      updateOferta.mutate({ id: editingOferta.id, ...payload });
    } else {
      createOferta.mutate(payload);
    }
  };

  const toggleDia = (val) => {
    setForm(f => ({
      ...f,
      dia_semana: f.dia_semana.includes(val)
        ? f.dia_semana.filter(d => d !== val)
        : [...f.dia_semana, val],
    }));
  };

  const hoy = new Date().toISOString().split('T')[0];
  const activas = ofertas.filter(o => o.activo).length;
  const vigentesHoy = ofertas.filter(o =>
    o.activo &&
    (!o.fecha_desde || o.fecha_desde <= hoy) &&
    (!o.fecha_hasta || o.fecha_hasta >= hoy)
  ).length;

  const isSaving = createOferta.isPending || updateOferta.isPending;

  const filteredProductos = prodSearch
    ? productos.filter(p =>
        p.nombre.toLowerCase().includes(prodSearch.toLowerCase()) ||
        p.categorias?.nombre?.toLowerCase().includes(prodSearch.toLowerCase())
      )
    : productos;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Tag className="w-6 h-6 text-emerald-500" /> Ofertas y Descuentos
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Configurá descuentos automáticos por producto, categoría, medio de pago o día de la semana
          </p>
        </div>
        <Button onClick={openNueva} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nueva Oferta
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Ofertas activas</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">{activas}</p>
          </CardContent>
        </Card>
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Total ofertas</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">{ofertas.length}</p>
          </CardContent>
        </Card>
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Vigentes hoy</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">{vigentesHoy}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla */}
      <Card className="dark:bg-kx-bg dark:border-kx-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-kx-text-3 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
            </div>
          ) : ofertas.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center gap-3">
              <Tag className="w-10 h-10 text-slate-300 dark:text-slate-700" />
              <p className="text-slate-500 dark:text-kx-text-2 font-medium">No hay ofertas configuradas</p>
              <p className="text-sm text-kx-text-3">
                Creá tu primera oferta para aplicar descuentos automáticos en el POS
              </p>
              <Button onClick={openNueva} variant="outline" className="mt-2 gap-2 dark:border-kx-border dark:text-slate-300">
                <Plus className="w-4 h-4" /> Crear primera oferta
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
                  <tr>
                    <th className="p-4 text-left">Nombre</th>
                    <th className="p-4 text-center">Descuento</th>
                    <th className="p-4 text-left hidden lg:table-cell">Condiciones</th>
                    <th className="p-4 text-center hidden md:table-cell">Vigencia</th>
                    <th className="p-4 text-center">Estado</th>
                    <th className="p-4 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ofertas.map(oferta => {
                    const vencida = oferta.fecha_hasta && oferta.fecha_hasta < hoy;
                    return (
                      <tr key={oferta.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-md bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                              <Tag className="w-3.5 h-3.5 text-emerald-500" />
                            </div>
                            <div className="min-w-0">
                              <span className="font-semibold text-kx-text dark:text-kx-text block truncate">{oferta.nombre}</span>
                              {oferta.descripcion && (
                                <span className="text-xs text-kx-text-3 block truncate">{oferta.descripcion}</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-center">
                          {oferta.tipo_descuento === 'porcentaje' ? (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 hover:bg-emerald-100">
                              {oferta.valor_descuento}%
                            </Badge>
                          ) : (
                            <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 hover:bg-blue-100">
                              ${Number(oferta.valor_descuento).toLocaleString('es-AR')}
                            </Badge>
                          )}
                        </td>
                        <td className="p-4 hidden lg:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {oferta.producto_id && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {oferta.productos?.nombre ?? 'Producto específico'}
                              </span>
                            )}
                            {oferta.categoria_nombre && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                Cat: {oferta.categoria_nombre}
                              </span>
                            )}
                            {oferta.medio_pago && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                {oferta.medio_pago}
                              </span>
                            )}
                            {oferta.dia_semana && oferta.dia_semana.length > 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                Días específicos
                              </span>
                            )}
                            {oferta.monto_minimo_carrito && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                Min ${Number(oferta.monto_minimo_carrito).toLocaleString('es-AR')}
                              </span>
                            )}
                            {!oferta.producto_id && !oferta.categoria_nombre && !oferta.medio_pago
                              && (!oferta.dia_semana || oferta.dia_semana.length === 0)
                              && !oferta.monto_minimo_carrito && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-kx-text-3">
                                Todos los productos
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-4 text-center hidden md:table-cell">
                          {vencida ? (
                            <Badge variant="destructive" className="text-xs">Vencida</Badge>
                          ) : oferta.fecha_desde && oferta.fecha_hasta ? (
                            <span className="text-xs text-kx-text-3">
                              {formatDate(oferta.fecha_desde)} — {formatDate(oferta.fecha_hasta)}
                            </span>
                          ) : oferta.fecha_hasta ? (
                            <span className="text-xs text-kx-text-3">
                              Hasta {formatDate(oferta.fecha_hasta)}
                            </span>
                          ) : (
                            <span className="text-xs text-kx-text-3 italic">Sin vencimiento</span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => toggleActivo.mutate({ id: oferta.id, activo: !oferta.activo })}
                            className="flex items-center justify-center mx-auto"
                            title={oferta.activo ? 'Desactivar oferta' : 'Activar oferta'}
                          >
                            {oferta.activo
                              ? <ToggleRight className="w-6 h-6 text-emerald-500" />
                              : <ToggleLeft className="w-6 h-6 text-kx-text-3" />
                            }
                          </button>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center justify-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-500"
                              onClick={() => openEditar(oferta)} title="Editar oferta">
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500"
                              onClick={() => setDeleteConfirm(oferta.id)} title="Eliminar oferta">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── MODAL: Crear / Editar oferta ── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-lg dark:bg-kx-bg dark:border-kx-border max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <Tag className="w-5 h-5 text-emerald-500" />
              {editingOferta ? 'Editar oferta' : 'Nueva oferta'}
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              {editingOferta
                ? 'Modificá los datos de la oferta.'
                : 'Configurá un descuento automático que se aplique en el POS.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
            {/* Nombre */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Nombre *</Label>
              <Input
                value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="ej: 10% en Ferretería, Promo Efectivo"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                autoFocus
              />
            </div>

            {/* Descripción */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">
                Descripción <span className="text-kx-text-3 font-normal">(opcional)</span>
              </Label>
              <textarea
                value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción interna de la oferta"
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-kx-surface dark:border-kx-border dark:text-kx-text resize-none"
              />
            </div>

            {/* Tipo de descuento */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Tipo de descuento</Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, tipo_descuento: 'porcentaje' }))}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                    form.tipo_descuento === 'porcentaje'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400'
                      : 'bg-white border-slate-200 text-slate-500 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text-2 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <Percent className="w-4 h-4" /> Porcentaje %
                </button>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, tipo_descuento: 'monto_fijo' }))}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                    form.tipo_descuento === 'monto_fijo'
                      ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-400'
                      : 'bg-white border-slate-200 text-slate-500 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text-2 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <DollarSign className="w-4 h-4" /> Monto fijo $
                </button>
              </div>
            </div>

            {/* Valor del descuento */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">
                {form.tipo_descuento === 'porcentaje' ? 'Porcentaje de descuento (%)' : 'Monto a descontar ($)'} *
              </Label>
              <Input
                type="number"
                min="0"
                max={form.tipo_descuento === 'porcentaje' ? '100' : undefined}
                step="0.01"
                value={form.valor_descuento}
                onChange={e => setForm(f => ({ ...f, valor_descuento: e.target.value }))}
                placeholder={form.tipo_descuento === 'porcentaje' ? 'Ej: 10' : 'Ej: 500'}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>

            {/* Separador: Condiciones */}
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs text-kx-text-3 uppercase font-medium">Condiciones (opcionales)</span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>

            {/* Producto específico */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Producto específico</Label>
              <div className="space-y-2">
                {form.producto_id && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                    <span className="text-sm text-emerald-700 dark:text-emerald-400 flex-1 truncate">
                      {productos.find(p => p.id === form.producto_id)?.nombre ?? 'Producto seleccionado'}
                    </span>
                    <button onClick={() => setForm(f => ({ ...f, producto_id: null }))}
                      className="text-emerald-500 hover:text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                <Input
                  value={prodSearch}
                  onChange={e => setProdSearch(e.target.value)}
                  placeholder="Buscar producto..."
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
                {prodSearch && (
                  <div className="max-h-32 overflow-y-auto rounded-md border border-slate-200 dark:border-kx-border bg-white dark:bg-kx-surface">
                    {filteredProductos.length === 0 ? (
                      <p className="p-2 text-xs text-kx-text-3 text-center">Sin resultados</p>
                    ) : filteredProductos.slice(0, 20).map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setForm(f => ({ ...f, producto_id: p.id }));
                          setProdSearch('');
                        }}
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 text-kx-text dark:text-kx-text truncate"
                      >
                        {p.nombre} {p.categorias?.nombre && <span className="text-kx-text-3 text-xs">· {p.categorias.nombre}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Categoría */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Categoría</Label>
              <Input
                value={form.categoria_nombre}
                onChange={e => setForm(f => ({ ...f, categoria_nombre: e.target.value }))}
                placeholder="Ej: Tecnología, Ferretería"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
              <p className="text-xs text-kx-text-3">Debe coincidir exactamente con la categoría del producto</p>
            </div>

            {/* Medio de pago */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Medio de pago</Label>
              <select
                value={form.medio_pago}
                onChange={e => setForm(f => ({ ...f, medio_pago: e.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              >
                {MEDIOS_PAGO.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Días de la semana */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Días de la semana</Label>
              <div className="flex flex-wrap gap-2">
                {DIAS.map(dia => (
                  <label key={dia.value}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-colors ${
                      form.dia_semana.includes(dia.value)
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400'
                        : 'bg-white border-slate-200 text-slate-500 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text-2'
                    }`}
                  >
                    <Checkbox
                      checked={form.dia_semana.includes(dia.value)}
                      onCheckedChange={() => toggleDia(dia.value)}
                      className="h-3.5 w-3.5"
                    />
                    {dia.label}
                  </label>
                ))}
              </div>
              <p className="text-xs text-kx-text-3">Sin selección = todos los días</p>
            </div>

            {/* Monto mínimo carrito */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Monto mínimo del carrito</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.monto_minimo_carrito}
                onChange={e => setForm(f => ({ ...f, monto_minimo_carrito: e.target.value }))}
                placeholder="Ej: 50000"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>

            {/* Cantidad mínima */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Cantidad mínima del producto</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.cantidad_minima}
                onChange={e => setForm(f => ({ ...f, cantidad_minima: e.target.value }))}
                placeholder="Ej: 3"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>

            {/* Separador: Vigencia */}
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs text-kx-text-3 uppercase font-medium">Vigencia (opcional)</span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>

            {/* Fechas */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="dark:text-kx-text">Fecha desde</Label>
                <Input
                  type="date"
                  value={form.fecha_desde}
                  onChange={e => setForm(f => ({ ...f, fecha_desde: e.target.value }))}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
              <div className="space-y-2">
                <Label className="dark:text-kx-text">Fecha hasta</Label>
                <Input
                  type="date"
                  value={form.fecha_hasta}
                  onChange={e => setForm(f => ({ ...f, fecha_hasta: e.target.value }))}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
            </div>

            {/* Separador: Configuración */}
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
              <span className="text-xs text-kx-text-3 uppercase font-medium">Configuración</span>
              <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>

            {/* Prioridad */}
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Prioridad</Label>
              <Input
                type="number"
                min="0"
                value={form.prioridad}
                onChange={e => setForm(f => ({ ...f, prioridad: e.target.value }))}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
              <p className="text-xs text-kx-text-3">Mayor número = se aplica primero si hay conflictos</p>
            </div>

            {/* Acumulable */}
            <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-kx-border p-3">
              <div>
                <p className="text-sm font-medium text-kx-text dark:text-kx-text">¿Acumulable con descuento manual?</p>
                <p className="text-xs text-kx-text-3">Permitir que el cajero agregue descuento adicional</p>
              </div>
              <Switch
                checked={form.acumulable}
                onCheckedChange={v => setForm(f => ({ ...f, acumulable: v }))}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="dark:border-kx-border dark:text-slate-300">
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !form.nombre.trim() || !form.valor_descuento || parseFloat(form.valor_descuento) <= 0}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isSaving ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {editingOferta ? 'Guardar cambios' : 'Crear oferta'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: Confirmar eliminación ── */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text">¿Eliminar oferta?</DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Esta acción no se puede deshacer. Las ventas que ya aplicaron esta oferta conservarán el descuento registrado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="dark:border-kx-border dark:text-slate-300">
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteOferta.mutate(deleteConfirm)}
              disabled={deleteOferta.isPending}
            >
              {deleteOferta.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default OfertasSection;
