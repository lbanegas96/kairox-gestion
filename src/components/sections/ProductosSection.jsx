import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Package, Search, Filter, Plus, Edit, Tag, Archive, AlertCircle, 
  DollarSign, MoreVertical, Truck, Loader2, Power, PowerOff, Trash2, 
  History, ArrowRightLeft, Download, Upload, ArrowUpCircle, ArrowDownCircle, 
  AlertTriangle, Save
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { 
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, 
  DialogTrigger, DialogFooter 
} from "@/components/ui/dialog";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, 
  DropdownMenuSeparator 
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue 
} from "@/components/ui/select";
import { supabase } from '@/lib/customSupabaseClient';
import { productosService } from '@/services/productosService';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getNowAR, formatDateTimeAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { Textarea } from '@/components/ui/textarea';
import CSVImportModal from '@/components/ui/CSVImportModal';

// Defined outside ProductosSection to keep a stable component identity across renders.
// If defined inside, React creates a new function reference every render, causing
// Radix UI portal (Select, Dialog) DOM nodes to unmount/remount and throw removeChild errors.
const ProductForm = ({ data, setData, onSubmit, isEdit = false, providers, categories, isSubmitting, unidadesMedida = [] }) => {
  // En alta (no edit), si todavía no se eligió unidad y ya cargó el maestro, default a "Unidad".
  useEffect(() => {
    if (!isEdit && !data.unidad_medida_id && unidadesMedida.length > 0) {
      const def = unidadesMedida.find(u => u.descripcion === 'Unidad') || unidadesMedida[0];
      if (def) setData(prev => ({ ...prev, unidad_medida_id: def.id, unidad_medida: def.descripcion }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, unidadesMedida]);

  return (
  <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
    <div className="space-y-2">
      <Label htmlFor="nombre">Nombre del Producto *</Label>
      <Input
        id="nombre"
        value={data.nombre}
        onChange={e => setData({...data, nombre: e.target.value})}
        required
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="sku">Código SKU *</Label>
      <Input
        id="sku"
        value={data.codigo_sku}
        onChange={e => setData({...data, codigo_sku: e.target.value})}
        required
        className="bg-kx-surface dark:bg-kx-bg font-mono"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="categoria">Categoría</Label>
      <div className="relative">
        <Input
          id="categoria"
          value={data.categoria_nombre}
          onChange={e => setData({...data, categoria_nombre: e.target.value})}
          list="categories-list"
          placeholder="Escribe o selecciona..."
          className="bg-kx-surface dark:bg-kx-bg"
        />
        <datalist id="categories-list">
          {categories.map(c => <option key={c.id} value={c.nombre} />)}
        </datalist>
      </div>
    </div>

    <div className="space-y-2">
      <Label htmlFor="proveedor">Proveedor</Label>
      <Select
        value={data.proveedor_id || "none"}
        onValueChange={(val) => setData({...data, proveedor_id: val === "none" ? null : val})}
      >
        <SelectTrigger id="proveedor" className="bg-kx-surface dark:bg-kx-bg">
          <SelectValue placeholder="Seleccionar proveedor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sin proveedor</SelectItem>
          {providers.map(p => (
            <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="space-y-2">
      <Label htmlFor="costo">Costo Compra ($)</Label>
      <Input
        id="costo"
        type="text"
        inputMode="decimal"
        placeholder="0,00"
        value={data.costo_compra}
        onChange={e => setData({...data, costo_compra: e.target.value})}
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="precio">Precio Venta ($) *</Label>
      <Input
        id="precio"
        type="text"
        inputMode="decimal"
        placeholder="0,00"
        value={data.precio_venta}
        onChange={e => setData({...data, precio_venta: e.target.value})}
        required
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="stock">Stock Actual</Label>
      <Input
        id="stock"
        type="number"
        min="0"
        step="1"
        value={data.stock_actual}
        onChange={e => setData({...data, stock_actual: e.target.value.replace(/[^\d]/g, '')})}
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="min_stock">Stock Mínimo</Label>
      <Input
        id="min_stock"
        type="number"
        min="0"
        step="1"
        value={data.stock_minimo}
        onChange={e => setData({...data, stock_minimo: e.target.value.replace(/[^\d]/g, '')})}
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="unidad">Unidad de Medida</Label>
      <select
        id="unidad"
        value={data.unidad_medida_id || ''}
        onChange={e => {
          const id = e.target.value;
          const um = unidadesMedida.find(u => u.id === id);
          setData({
            ...data,
            unidad_medida_id: id || null,
            unidad_medida: um?.descripcion ?? data.unidad_medida,
          });
        }}
        className="w-full h-10 px-3 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-bg dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— Elegí —</option>
        {unidadesMedida.map(u => (
          <option key={u.id} value={u.id}>{u.codigo} — {u.descripcion}</option>
        ))}
      </select>
      {!data.unidad_medida_id && data.unidad_medida && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Valor actual: "{data.unidad_medida}" — no coincide con el maestro, seleccioná una unidad.
        </p>
      )}
    </div>

    <div className="col-span-1 md:col-span-2 space-y-2">
      <Label htmlFor="desc">Descripción</Label>
      <Textarea
        id="desc"
        value={data.descripcion}
        onChange={e => setData({...data, descripcion: e.target.value})}
        className="bg-kx-surface dark:bg-kx-bg resize-none h-20"
      />
    </div>

    <div className="col-span-1 md:col-span-2 pt-4 flex justify-end gap-2">
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white"
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isEdit ? 'Guardar Cambios' : 'Crear Producto'}
      </Button>
    </div>
  </form>
  );
};

const ProductosSection = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  // Helper: invalidar cache de notificaciones cuando cambia stock
  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ['notif'] });

  const [activeTab, setActiveTab] = useState('inventory');
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false); 
  
  // Data
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [providers, setProviders] = useState([]);
  const [movements, setMovements] = useState([]);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [showInactivos, setShowInactivos] = useState(false);
  const [historyFilters, setHistoryFilters] = useState({ productId: 'all', dateFrom: '', dateTo: '' });
  
  // Modal States
  const [isNewProductOpen, setIsNewProductOpen] = useState(false);
  const [isEditProductOpen, setIsEditProductOpen] = useState(false);
  const [isMovimientoOpen, setIsMovimientoOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  
  // Selection State
  const [selectedProductForMov, setSelectedProductForMov] = useState(null);

  const { data: unidadesMedida = [] } = useQuery({
    queryKey: ['unidades_medida', user?.empresa_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('unidades_medida')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .eq('activo', true)
        .order('codigo');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.empresa_id,
  });

  // Forms
  const initialProductState = {
    nombre: '', codigo_sku: '', categoria_nombre: '', proveedor_id: '',
    unidad_medida: 'Unidad', unidad_medida_id: '', costo_compra: '', precio_venta: '',
    stock_actual: '', stock_minimo: 5, descripcion: ''
  };

  const [newProduct, setNewProduct] = useState(initialProductState);
  const [editProduct, setEditProduct] = useState({ ...initialProductState, id: '' });
  const initialMovimientoState = { tipo: 'entrada', cantidad: '', motivo: '' };
  const [movimientoForm, setMovimientoForm] = useState(initialMovimientoState);

  // --- Effects ---

  useEffect(() => {
    if (user && user.empresa_id) {
      fetchInitialData();
    }
  }, [user]);

  useEffect(() => {
    if (activeTab === 'history' && user?.empresa_id) {
      fetchMovements();
    }
  }, [activeTab, historyFilters]);

  // --- Data Fetching ---

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      await Promise.all([fetchProducts(), fetchCategories(), fetchProviders()]);
    } catch (error) {
      console.error("Error loading data:", error);
      toast({ title: "Error de carga", description: "No se pudieron cargar los datos.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    if (!user?.empresa_id) return;
    try {
      const { data, error } = await supabase.from('productos')
        .select(`*, categories:categorias(id, nombre), providers:proveedores(nombre)`)
        .eq('empresa_id', user.empresa_id)
        .order('nombre');
      
      if (error) throw error;
      setProducts(data || []);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  const fetchCategories = async () => {
    if (!user?.empresa_id) return;
    try {
      const { data } = await supabase.from('categorias')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('nombre');
      setCategories(data || []);
    } catch (error) {
      console.error("Error fetching categories:", error);
    }
  };

  const fetchProviders = async () => {
    if (!user?.empresa_id) return;
    try {
      const { data } = await supabase.from('proveedores')
        .select('*')
        .eq('empresa_id', user.empresa_id)
        .order('nombre');
      setProviders(data || []);
    } catch (error) {
      console.error("Error fetching providers:", error);
    }
  };

  const fetchMovements = async () => {
    if (!user?.empresa_id) return;
    try {
      let query = supabase.from('movimientos_inventario')
        .select(`*, productos (nombre, codigo_sku)`)
        .eq('empresa_id', user.empresa_id)
        .order('fecha', { ascending: false });
      
      if (historyFilters.productId !== 'all') query = query.eq('producto_id', historyFilters.productId);
      if (historyFilters.dateFrom) query = query.gte('fecha', historyFilters.dateFrom);
      if (historyFilters.dateTo) query = query.lte('fecha', `${historyFilters.dateTo}T23:59:59`);
      
      const { data, error } = await query;
      if (error) throw error;
      setMovements(data || []);
    } catch (error) {
      console.error("Error fetching movements:", error);
    }
  };

  // --- Helpers ---

  const getCategoryIdFromName = async (categoryName) => {
    if (!categoryName) return null;
    const cleanName = categoryName.trim();
    if (!cleanName) return null;

    const existingCat = categories.find(c => c.nombre.toLowerCase() === cleanName.toLowerCase());
    if (existingCat) return existingCat.id;

    // Create new category automatically if it doesn't exist
    if (!user?.empresa_id) throw new Error("Empresa ID no encontrado");

    const { data, error } = await supabase.from('categorias')
      .insert([{ 
        nombre: cleanName, 
        descripcion: 'Creada automáticamente', 
        empresa_id: user.empresa_id 
      }])
      .select()
      .single();
    
    if (error) throw error;
    setCategories(prev => [...prev, data]);
    return data.id;
  };

  // --- Handlers ---

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!user?.empresa_id) {
        toast({ title: "Error", description: "No se encontró el ID de empresa.", variant: "destructive" });
        return;
    }

    setIsSubmitting(true); 

    try {
      const categoryId = await getCategoryIdFromName(newProduct.categoria_nombre);
      const autoSku = newProduct.codigo_sku?.trim() || `SKU-${Date.now().toString(36).toUpperCase()}`;
      const payload = {
        nombre: newProduct.nombre,
        codigo_sku: autoSku,
        user_id: user.id, 
        empresa_id: user.empresa_id,
        costo_compra: parseNumberLocale(newProduct.costo_compra) || 0,
        precio_venta: parseNumberLocale(newProduct.precio_venta) || 0,
        stock_actual: parseInt(newProduct.stock_actual) || 0,
        stock_minimo: parseInt(newProduct.stock_minimo) || 0,
        categoria_id: categoryId,
        proveedor_id: newProduct.proveedor_id || null,
        unidad_medida: newProduct.unidad_medida,
        unidad_medida_id: newProduct.unidad_medida_id || null,
        descripcion: newProduct.descripcion,
        activo: true,
        fecha_creacion: getNowAR().toISOString()
      };

      const { error } = await supabase.from('productos').insert([payload]);
      if (error) throw error;

      toast({ title: "Producto creado", description: "El producto se ha añadido al inventario." });
      setIsNewProductOpen(false);
      setNewProduct(initialProductState);
      await fetchProducts();
      invalidateNotifs();
    } catch (error) {
      console.error("Create product error:", error);
      const msg = error.message?.includes('productos_empresa_id_codigo_sku_key')
        ? 'Ya existe un producto con ese código SKU. Usá uno diferente o dejá el campo vacío para generar uno automático.'
        : error.message;
      toast({ title: "Error", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false); 
    }
  };

  const handleUpdateProduct = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!user?.empresa_id) return;
    setIsSubmitting(true);

    try {
      const categoryId = await getCategoryIdFromName(editProduct.categoria_nombre);
      const updates = {
        nombre: editProduct.nombre,
        codigo_sku: editProduct.codigo_sku,
        categoria_id: categoryId,
        proveedor_id: editProduct.proveedor_id || null,
        unidad_medida: editProduct.unidad_medida,
        unidad_medida_id: editProduct.unidad_medida_id || null,
        costo_compra: parseNumberLocale(editProduct.costo_compra) || 0,
        precio_venta: parseNumberLocale(editProduct.precio_venta) || 0,
        stock_actual: parseInt(editProduct.stock_actual) || 0,
        stock_minimo: parseInt(editProduct.stock_minimo) || 0,
        descripcion: editProduct.descripcion
      };

      const { error } = await supabase.from('productos')
        .update(updates)
        .eq('id', editProduct.id)
        .eq('empresa_id', user.empresa_id);

      if (error) throw error;

      toast({ title: "Producto actualizado", description: "Los cambios se han guardado correctamente." });
      setIsEditProductOpen(false);
      await fetchProducts();
      invalidateNotifs();
    } catch (error) {
      console.error("Update product error:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitMovimiento = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedProductForMov) return;
    if (!user?.empresa_id) return;
    
    setIsSubmitting(true);
    try {
       const cantidad = parseInt(movimientoForm.cantidad);
       if (isNaN(cantidad) || cantidad <= 0) throw new Error("Cantidad inválida");

       await productosService.adjustStock({
         id: selectedProductForMov.id,
         cantidad,
         tipo: movimientoForm.tipo,
         motivo: movimientoForm.motivo,
       });

       toast({ title: "Movimiento registrado", description: "Stock actualizado correctamente." });
       setIsMovimientoOpen(false);
       setMovimientoForm(initialMovimientoState);
       await fetchProducts();
      invalidateNotifs();
    } catch (error) {
       console.error("Movimiento error:", error);

       let description = error.message;

       if (error.message?.toLowerCase().includes('stock insuficiente')) {
         description = `Stock insuficiente. El stock disponible de "${selectedProductForMov?.nombre}" es ${selectedProductForMov?.stock_actual} unidades.`;
       } else if (error.message?.toLowerCase().includes('cantidad inválida') || error.message?.toLowerCase().includes('cantidad inv')) {
         description = 'La cantidad ingresada no es válida. Ingresá un número entero mayor a cero.';
       }

       toast({ title: "Error", description, variant: "destructive" });
    } finally {
       setIsSubmitting(false);
    }
  };

  const handleDisableProduct = async (product) => {
    if (!user?.empresa_id) return;
    try {
      const { error } = await supabase.from('productos')
        .update({ activo: false })
        .eq('id', product.id)
        .eq('empresa_id', user.empresa_id);
      if (error) throw error;
      toast({ title: "Producto desactivado", description: `"${product.nombre}" fue desactivado. Puede reactivarlo desde la vista de inactivos.` });
      await fetchProducts();
      invalidateNotifs();
    } catch (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const handleReactivateProduct = async (product) => {
    if (!user?.empresa_id) return;
    try {
      const { error } = await supabase.from('productos')
        .update({ activo: true })
        .eq('id', product.id)
        .eq('empresa_id', user.empresa_id);
      if (error) throw error;
      toast({ title: "Producto reactivado", description: `"${product.nombre}" vuelve a estar disponible en el inventario.` });
      await fetchProducts();
      invalidateNotifs();
    } catch (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  // --- Filtered Views ---
  const filteredProducts = products
    .filter(p => showInactivos ? p.activo === false : p.activo !== false)
    .filter(p =>
      (p.nombre || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.codigo_sku || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

  const inactivosCount = products.filter(p => p.activo === false).length;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
       <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-kx-surface dark:bg-kx-surface p-6 rounded-lg border border-kx-border dark:border-kx-border shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-kx-text mb-1">Inventario</h2>
          <p className="text-sm text-slate-500 dark:text-kx-text-2">Gestiona tus productos y control de stock</p>
        </div>
        <div className="flex flex-wrap gap-3">
           {/* Toggle Inactive */}
           <Button
             variant={showInactivos ? "destructive" : "outline"}
             onClick={() => setShowInactivos(v => !v)}
             className={showInactivos ? "" : "border-slate-300 dark:border-kx-border"}
           >
             {showInactivos ? <Power className="h-4 w-4 mr-2" /> : <PowerOff className="h-4 w-4 mr-2" />}
             {showInactivos ? `Activos` : `Inactivos${inactivosCount > 0 ? ` (${inactivosCount})` : ''}`}
           </Button>

           {/* Import CSV Button */}
           <Button variant="outline" onClick={() => setIsImportOpen(true)} className="dark:text-kx-text dark:border-kx-border">
             <Upload className="h-4 w-4 mr-2" /> Importar CSV
           </Button>

           {/* Add Product Dialog */}
           <Dialog open={isNewProductOpen} onOpenChange={setIsNewProductOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="h-4 w-4 mr-2" /> Nuevo Producto
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border">
               <DialogHeader>
                 <DialogTitle>Nuevo Producto</DialogTitle>
                 <DialogDescription>Ingresa los detalles del nuevo producto para el inventario.</DialogDescription>
               </DialogHeader>
               <ProductForm
                  data={newProduct}
                  setData={setNewProduct}
                  onSubmit={handleCreateProduct}
                  providers={providers}
                  categories={categories}
                  isSubmitting={isSubmitting}
                  unidadesMedida={unidadesMedida}
               />
            </DialogContent>
           </Dialog>
        </div>
       </div>

       {/* Edit Product Dialog - Triggered programmatically */}
       <Dialog open={isEditProductOpen} onOpenChange={setIsEditProductOpen}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border">
             <DialogHeader>
               <DialogTitle>Editar Producto</DialogTitle>
               <DialogDescription>Modifica los detalles del producto.</DialogDescription>
             </DialogHeader>
             <ProductForm
                data={editProduct}
                setData={setEditProduct}
                onSubmit={handleUpdateProduct}
                isEdit={true}
                providers={providers}
                categories={categories}
                isSubmitting={isSubmitting}
                unidadesMedida={unidadesMedida}
             />
          </DialogContent>
       </Dialog>

       <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-slate-100 dark:bg-kx-surface-2 p-1">
            <TabsTrigger value="inventory" className="data-[state=active]:bg-kx-surface dark:data-[state=active]:bg-slate-700">Inventario</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-kx-surface dark:data-[state=active]:bg-slate-700">Historial de Movimientos</TabsTrigger>
          </TabsList>

          <TabsContent value="inventory" className="space-y-4">
             {showInactivos && (
               <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
                 <PowerOff className="h-4 w-4 shrink-0" />
                 Mostrando productos <strong>inactivos</strong>. Usá el botón "Activos" para volver a la vista normal.
               </div>
             )}
             {/* Search Bar */}
             <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
               <Input
                 placeholder="Buscar por nombre o SKU..."
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="pl-10 bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border"
               />
             </div>

             <div className="rounded-lg border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface overflow-hidden shadow-sm">
               <div className="overflow-x-auto">
                 <table className="w-full text-sm text-left">
                   <thead className="bg-kx-surface-2 dark:bg-slate-800/50 border-b border-kx-border dark:border-kx-border text-slate-500 dark:text-kx-text-2 font-medium">
                     <tr>
                       <th className="p-4">Producto</th>
                       <th className="p-4 text-center">Categoría</th>
                       <th className="p-4 text-right">Stock</th>
                       <th className="p-4 text-right">Costo</th>
                       <th className="p-4 text-right">Precio</th>
                       <th className="p-4 text-right">Acciones</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {loading ? (
                        <tr><td colSpan="6" className="p-8 text-center text-slate-500">Cargando inventario...</td></tr>
                      ) : filteredProducts.length === 0 ? (
                        <tr><td colSpan="6" className="p-8 text-center text-slate-500">No se encontraron productos.</td></tr>
                      ) : (
                        filteredProducts.map(p => {
                           const isLowStock = p.stock_actual <= p.stock_minimo;
                           return (
                             <tr key={p.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/30 transition-colors">
                                <td className="p-4">
                                  <div className="font-medium text-slate-900 dark:text-kx-text">{p.nombre}</div>
                                  <div className="text-xs text-slate-500 font-mono">{p.codigo_sku}</div>
                                </td>
                                <td className="p-4 text-center">
                                  {p.categories?.nombre ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                      {p.categories.nombre}
                                    </span>
                                  ) : (
                                    <span className="text-kx-text-3">-</span>
                                  )}
                                </td>
                                <td className="p-4 text-right">
                                  <div className={`font-mono font-bold ${isLowStock ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                                    {p.stock_actual}
                                  </div>
                                  {isLowStock && <div className="text-[10px] text-red-500 flex items-center justify-end gap-1"><AlertTriangle className="h-3 w-3" /> Bajo stock</div>}
                                </td>
                                <td className="p-4 text-right text-slate-500">
                                  ${p.costo_compra?.toLocaleString('es-AR')}
                                </td>
                                <td className="p-4 text-right font-medium text-slate-900 dark:text-kx-text">
                                  ${p.precio_venta?.toLocaleString('es-AR')}
                                </td>
                                <td className="p-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    {!showInactivos && (
                                      <>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                          onClick={() => {
                                            setEditProduct({
                                              ...p,
                                              categoria_nombre: p.categories?.nombre || '',
                                              proveedor_id: p.proveedor_id || 'none'
                                            });
                                            setIsEditProductOpen(true);
                                          }}
                                          title="Editar"
                                        >
                                          <Edit className="h-4 w-4"/>
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0 text-slate-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                          onClick={() => { setSelectedProductForMov(p); setIsMovimientoOpen(true); }}
                                          title="Ajustar Stock"
                                        >
                                          <ArrowRightLeft className="h-4 w-4"/>
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 w-8 p-0 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                          onClick={() => handleDisableProduct(p)}
                                          title="Desactivar producto"
                                        >
                                          <PowerOff className="h-4 w-4"/>
                                        </Button>
                                      </>
                                    )}
                                    {showInactivos && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                        onClick={() => handleReactivateProduct(p)}
                                        title="Reactivar producto"
                                      >
                                        <Power className="h-4 w-4"/>
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
             </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
             {/* History Filters */}
             <div className="flex gap-4 mb-4">
               <Select 
                 value={historyFilters.productId} 
                 onValueChange={(val) => setHistoryFilters({...historyFilters, productId: val})}
               >
                 <SelectTrigger className="w-[250px] bg-kx-surface dark:bg-kx-surface">
                   <SelectValue placeholder="Filtrar por producto" />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Todos los productos</SelectItem>
                   {products.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                 </SelectContent>
               </Select>
             </div>

             <div className="rounded-lg border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface overflow-hidden shadow-sm">
               <table className="w-full text-sm text-left">
                 <thead className="bg-kx-surface-2 dark:bg-slate-800/50 border-b border-kx-border dark:border-kx-border text-slate-500 dark:text-kx-text-2 font-medium">
                   <tr>
                     <th className="p-4">Fecha</th>
                     <th className="p-4">Producto</th>
                     <th className="p-4">Tipo</th>
                     <th className="p-4">Motivo</th>
                     <th className="p-4 text-right">Cantidad</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {movements.map(m => (
                       <tr key={m.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/30">
                          <td className="p-4 text-slate-500">{formatDateTimeAR(m.fecha)}</td>
                          <td className="p-4 font-medium">{m.productos?.nombre}</td>
                          <td className="p-4">
                             <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase
                               ${m.tipo === 'entrada' ? 'bg-emerald-100 text-emerald-700' : 
                                 m.tipo === 'salida' ? 'bg-red-100 text-red-700' : 
                                 'bg-blue-100 text-blue-700'}`
                             }>
                               {m.tipo}
                             </span>
                          </td>
                          <td className="p-4 text-slate-500 truncate max-w-[200px]">{m.motivo || '-'}</td>
                          <td className={`p-4 text-right font-mono font-bold ${m.tipo === 'salida' ? 'text-red-600' : 'text-emerald-600'}`}>
                             {m.tipo === 'salida' ? '-' : '+'}{m.cantidad}
                          </td>
                       </tr>
                    ))}
                    {movements.length === 0 && (
                      <tr><td colSpan="5" className="p-8 text-center text-slate-500">No hay movimientos registrados.</td></tr>
                    )}
                 </tbody>
               </table>
             </div>
          </TabsContent>
       </Tabs>
       
       {/* Movement Dialog */}
       <Dialog open={isMovimientoOpen} onOpenChange={setIsMovimientoOpen}>
         <DialogContent className="sm:max-w-[425px] bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border">
            <DialogHeader>
              <DialogTitle>Registrar Movimiento</DialogTitle>
              <DialogDescription>Ajuste de stock para: <strong>{selectedProductForMov?.nombre}</strong></DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmitMovimiento} className="space-y-4 py-2">
               <div className="space-y-2">
                 <Label>Tipo de Movimiento</Label>
                 <Select 
                   value={movimientoForm.tipo} 
                   onValueChange={val=>setMovimientoForm({...movimientoForm, tipo:val})}
                 >
                   <SelectTrigger className="bg-kx-surface dark:bg-kx-bg">
                     <SelectValue />
                   </SelectTrigger>
                   <SelectContent>
                     <SelectItem value="entrada">Entrada (Compra/Devolución)</SelectItem>
                     <SelectItem value="salida">Salida (Venta/Pérdida)</SelectItem>
                     <SelectItem value="ajuste">Ajuste (Inventario Físico)</SelectItem>
                   </SelectContent>
                 </Select>
               </div>
               
               <div className="space-y-2">
                 <Label>Cantidad</Label>
                 <Input
                   type="number"
                   min="1"
                   step="1"
                   value={movimientoForm.cantidad}
                   onChange={e=>setMovimientoForm({...movimientoForm, cantidad:e.target.value.replace(/[^\d]/g, '')})}
                   placeholder="0"
                   required
                   className="bg-kx-surface dark:bg-kx-bg font-mono text-lg"
                 />
               </div>

               <div className="space-y-2">
                 <Label>Motivo / Observación</Label>
                 <Input 
                   value={movimientoForm.motivo} 
                   onChange={e=>setMovimientoForm({...movimientoForm, motivo:e.target.value})} 
                   placeholder="Ej: Compra mensual, Rotura, etc."
                   className="bg-kx-surface dark:bg-kx-bg"
                 />
               </div>

               <DialogFooter>
                 <Button type="button" variant="outline" onClick={() => setIsMovimientoOpen(false)}>Cancelar</Button>
                 <Button type="submit" disabled={isSubmitting}>
                   {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                   Confirmar
                 </Button>
               </DialogFooter>
            </form>
         </DialogContent>
       </Dialog>

       {/* CSV Import Modal */}
       <CSVImportModal
         open={isImportOpen}
         onOpenChange={setIsImportOpen}
         tipo="productos"
         onSuccess={() => Promise.all([fetchProducts(), fetchCategories(), fetchProviders()])}
       />
    </div>
  );
};

export default ProductosSection;