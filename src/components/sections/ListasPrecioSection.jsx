import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Tag, Plus, Edit, Trash2, Package, Search, Check,
  ChevronRight, ToggleLeft, ToggleRight, X, Loader2, DollarSign
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { listaPreciosService } from '@/services/listaPreciosService';

const LISTAS_KEY = (eid) => ['listas_precio', eid];
const ITEMS_KEY  = (lid) => ['lista_precio_items', lid];

function ListasPrecioSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;

  // ── Modales ──────────────────────────────────────────────────────────────────
  const [listaModal, setListaModal] = useState(false);
  const [editingLista, setEditingLista] = useState(null); // null = nueva
  const [formLista, setFormLista] = useState({ nombre: '', descripcion: '' });

  const [itemsModal, setItemsModal] = useState(false);
  const [selectedLista, setSelectedLista] = useState(null);
  const [prodSearch, setProdSearch] = useState('');
  const [productos, setProductos] = useState([]);
  const [precioEdicion, setPrecioEdicion] = useState({}); // { producto_id: precio_str }
  const [savingItem, setSavingItem] = useState(null);

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: listas = [], isLoading } = useQuery({
    queryKey: LISTAS_KEY(empresaId),
    queryFn: () => listaPreciosService.getAll(empresaId),
    enabled: !!empresaId,
  });

  const { data: items = [] } = useQuery({
    queryKey: ITEMS_KEY(selectedLista?.id),
    queryFn: () => listaPreciosService.getItems(selectedLista.id),
    enabled: !!selectedLista?.id,
  });

  // Inicializar precios de edición cuando cambian los items
  useEffect(() => {
    if (items.length > 0) {
      const map = {};
      items.forEach(i => { map[i.producto_id] = String(i.precio); });
      setPrecioEdicion(map);
    }
  }, [items]);

  // Buscar productos al abrir modal de items
  useEffect(() => {
    if (!itemsModal || !empresaId) return;
    supabase
      .from('productos')
      .select('id, nombre, codigo_sku, precio_venta')
      .eq('empresa_id', empresaId)
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => setProductos(data ?? []));
  }, [itemsModal, empresaId]);

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const saveLista = useMutation({
    mutationFn: async () => {
      if (!formLista.nombre.trim()) throw new Error('El nombre es requerido');
      if (editingLista) {
        return listaPreciosService.update(editingLista.id, formLista.nombre, formLista.descripcion);
      }
      return listaPreciosService.create(empresaId, user.id, formLista.nombre, formLista.descripcion);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LISTAS_KEY(empresaId) });
      toast({ title: editingLista ? 'Lista actualizada ✓' : 'Lista creada ✓', className: 'bg-green-600 text-white' });
      setListaModal(false);
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const toggleActivo = useMutation({
    mutationFn: ({ id, activo }) => listaPreciosService.toggleActivo(id, !activo),
    onSuccess: () => qc.invalidateQueries({ queryKey: LISTAS_KEY(empresaId) }),
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteLista = useMutation({
    mutationFn: (id) => listaPreciosService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: LISTAS_KEY(empresaId) });
      toast({ title: 'Lista eliminada' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const deleteItem = useMutation({
    mutationFn: (itemId) => listaPreciosService.deleteItem(itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ITEMS_KEY(selectedLista?.id) });
      qc.invalidateQueries({ queryKey: LISTAS_KEY(empresaId) });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────
  const openNueva = () => {
    setEditingLista(null);
    setFormLista({ nombre: '', descripcion: '' });
    setListaModal(true);
  };

  const openEditar = (lista) => {
    setEditingLista(lista);
    setFormLista({ nombre: lista.nombre, descripcion: lista.descripcion ?? '' });
    setListaModal(true);
  };

  const openItems = (lista) => {
    setSelectedLista(lista);
    setProdSearch('');
    setPrecioEdicion({});
    setItemsModal(true);
  };

  const handleSaveItemPrecio = async (productoId) => {
    const precio = parseFloat(precioEdicion[productoId]);
    if (isNaN(precio) || precio <= 0) {
      toast({ title: 'Precio inválido', variant: 'destructive' });
      return;
    }
    setSavingItem(productoId);
    try {
      await listaPreciosService.upsertItem(selectedLista.id, empresaId, productoId, precio);
      qc.invalidateQueries({ queryKey: ITEMS_KEY(selectedLista.id) });
      qc.invalidateQueries({ queryKey: LISTAS_KEY(empresaId) });
      toast({ title: 'Precio guardado ✓', className: 'bg-green-600 text-white' });
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setSavingItem(null);
    }
  };

  const filteredProductos = prodSearch
    ? productos.filter(p =>
        p.nombre.toLowerCase().includes(prodSearch.toLowerCase()) ||
        p.codigo_sku?.toLowerCase().includes(prodSearch.toLowerCase())
      )
    : productos;

  const itemMap = Object.fromEntries(items.map(i => [i.producto_id, i]));
  const totalConPrecio = items.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text flex items-center gap-2">
            <Tag className="w-6 h-6 text-violet-500" /> Listas de Precios
          </h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2 mt-1">
            Creá listas de precios por segmento (VIP, Mayorista, etc.) y asignálas a clientes
          </p>
        </div>
        <Button onClick={openNueva} className="bg-violet-600 hover:bg-violet-700 text-white gap-2">
          <Plus className="w-4 h-4" /> Nueva Lista
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Listas activas</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">
              {listas.filter(l => l.activo).length}
            </p>
          </CardContent>
        </Card>
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Total listas</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">{listas.length}</p>
          </CardContent>
        </Card>
        <Card className="dark:bg-kx-surface dark:border-kx-border">
          <CardContent className="p-4">
            <p className="text-xs text-kx-text-3 uppercase mb-1">Productos con precio esp.</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-kx-text">
              {listas.reduce((s, l) => s + (l._itemCount ?? 0), 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabla de listas */}
      <Card className="dark:bg-kx-bg dark:border-kx-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center text-kx-text-3 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Cargando...
            </div>
          ) : listas.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center gap-3">
              <Tag className="w-10 h-10 text-slate-300 dark:text-slate-700" />
              <p className="text-slate-500 dark:text-kx-text-2 font-medium">No hay listas de precios</p>
              <p className="text-sm text-kx-text-3 dark:text-kx-text-3">
                Creá tu primera lista (ej: "Precio Mayorista", "VIP") y asignala a tus clientes
              </p>
              <Button onClick={openNueva} variant="outline" className="mt-2 gap-2 dark:border-kx-border dark:text-slate-300">
                <Plus className="w-4 h-4" /> Crear primera lista
              </Button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2">
                <tr>
                  <th className="p-4 text-left">Nombre</th>
                  <th className="p-4 text-left hidden md:table-cell">Descripción</th>
                  <th className="p-4 text-center">Productos</th>
                  <th className="p-4 text-center">Estado</th>
                  <th className="p-4 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {listas.map(lista => (
                  <tr key={lista.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/40 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-md bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                          <Tag className="w-3.5 h-3.5 text-violet-500" />
                        </div>
                        <span className="font-semibold text-kx-text dark:text-kx-text">{lista.nombre}</span>
                      </div>
                    </td>
                    <td className="p-4 text-slate-500 dark:text-kx-text-2 hidden md:table-cell">
                      {lista.descripcion ?? <span className="italic text-slate-300 dark:text-kx-text-2">—</span>}
                    </td>
                    <td className="p-4 text-center">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400">
                        <Package className="w-3 h-3" /> {lista._itemCount ?? 0}
                      </span>
                    </td>
                    <td className="p-4 text-center">
                      <button
                        onClick={() => toggleActivo.mutate({ id: lista.id, activo: lista.activo })}
                        className="flex items-center justify-center mx-auto"
                        title={lista.activo ? 'Desactivar lista' : 'Activar lista'}
                      >
                        {lista.activo
                          ? <ToggleRight className="w-6 h-6 text-emerald-500" />
                          : <ToggleLeft className="w-6 h-6 text-kx-text-3" />
                        }
                      </button>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-violet-500"
                          onClick={() => openItems(lista)} title="Gestionar precios">
                          <DollarSign className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-blue-500"
                          onClick={() => openEditar(lista)} title="Editar lista">
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-red-500"
                          onClick={() => deleteLista.mutate(lista.id)} title="Eliminar lista">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── MODAL: Nueva / Editar lista ── */}
      <Dialog open={listaModal} onOpenChange={setListaModal}>
        <DialogContent className="max-w-md dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <Tag className="w-5 h-5 text-violet-500" />
              {editingLista ? 'Editar lista' : 'Nueva lista de precios'}
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              {editingLista
                ? 'Modificá el nombre y descripción de la lista.'
                : 'Creá una nueva lista y después asignale precios a los productos.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Nombre *</Label>
              <Input
                value={formLista.nombre}
                onChange={e => setFormLista(f => ({ ...f, nombre: e.target.value }))}
                placeholder="ej: Precio VIP, Mayorista, Distribuidor"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Descripción <span className="text-kx-text-3 font-normal">(opcional)</span></Label>
              <Input
                value={formLista.descripcion}
                onChange={e => setFormLista(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="ej: Precios para clientes con cuenta corriente"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setListaModal(false)} className="dark:border-kx-border dark:text-slate-300">
              Cancelar
            </Button>
            <Button
              onClick={() => saveLista.mutate()}
              disabled={saveLista.isPending || !formLista.nombre.trim()}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {saveLista.isPending ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {editingLista ? 'Guardar cambios' : 'Crear lista'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: Gestionar precios de una lista ── */}
      <Dialog open={itemsModal} onOpenChange={setItemsModal}>
        <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="dark:text-kx-text flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-violet-500" />
              Precios: {selectedLista?.nombre}
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Asigná un precio especial por producto. Solo los productos con precio guardado aparecerán en esta lista.
              Los productos sin precio usarán el precio de venta estándar.
            </DialogDescription>
          </DialogHeader>

          {/* Buscador */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-kx-text-3" />
            <Input
              value={prodSearch}
              onChange={e => setProdSearch(e.target.value)}
              placeholder="Buscar producto..."
              className="pl-9 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {filteredProductos.length === 0 ? (
              <p className="text-center text-kx-text-3 py-8 text-sm">Sin resultados</p>
            ) : filteredProductos.map(prod => {
              const existingItem = itemMap[prod.id];
              const hasPrice = !!existingItem;
              const currentPrecioStr = precioEdicion[prod.id] ?? (existingItem ? String(existingItem.precio) : '');

              return (
                <div key={prod.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    hasPrice
                      ? 'bg-violet-50 border-violet-200 dark:bg-violet-900/10 dark:border-violet-800/40'
                      : 'bg-kx-surface border-slate-100 dark:bg-kx-surface dark:border-kx-border hover:bg-kx-surface-2 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-kx-text dark:text-kx-text truncate">{prod.nombre}</p>
                    <p className="text-xs text-kx-text-3">
                      {prod.codigo_sku} · Precio estándar: ${Number(prod.precio_venta).toLocaleString('es-AR')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-kx-text-3 text-xs">$</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={currentPrecioStr}
                        onChange={e => setPrecioEdicion(prev => ({ ...prev, [prod.id]: e.target.value }))}
                        placeholder="0.00"
                        className="w-28 h-8 pl-6 pr-2 text-right text-sm rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/20"
                      onClick={() => handleSaveItemPrecio(prod.id)}
                      disabled={savingItem === prod.id || !precioEdicion[prod.id]}
                      title="Guardar precio"
                    >
                      {savingItem === prod.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Check className="w-3.5 h-3.5" />
                      }
                    </Button>
                    {hasPrice && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-kx-text-3 hover:text-red-500"
                        onClick={() => deleteItem.mutate(existingItem.id)}
                        title="Quitar precio especial"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-kx-border dark:border-kx-border">
            <span className="text-xs text-kx-text-3">
              {totalConPrecio} producto{totalConPrecio !== 1 ? 's' : ''} con precio especial
            </span>
            <Button variant="outline" onClick={() => setItemsModal(false)} className="dark:border-kx-border dark:text-slate-300">
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ListasPrecioSection;
