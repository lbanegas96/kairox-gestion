import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { EMPTY_OFERTA, preparePayload } from '@/components/ofertas/shared';
import TablaOfertas from '@/components/ofertas/TablaOfertas';
import ModalOfertaForm from '@/components/ofertas/ModalOfertaForm';

const OFERTAS_KEY = (eid) => ['ofertas', eid];

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

  if (user?.role !== 'admin') {
    return (
      <div className="p-8 text-center text-kx-text-2">
        No tenés permisos para gestionar ofertas.
      </div>
    );
  }

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

      <TablaOfertas
        ofertas={ofertas} isLoading={isLoading}
        activas={activas} vigentesHoy={vigentesHoy}
        openNueva={openNueva} openEditar={openEditar} setDeleteConfirm={setDeleteConfirm}
        toggleActivo={toggleActivo}
      />

      <ModalOfertaForm
        modalOpen={modalOpen} setModalOpen={setModalOpen}
        editingOferta={editingOferta}
        form={form} setForm={setForm}
        prodSearch={prodSearch} setProdSearch={setProdSearch}
        productos={productos} filteredProductos={filteredProductos}
        toggleDia={toggleDia}
        handleSave={handleSave} isSaving={isSaving}
      />

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
