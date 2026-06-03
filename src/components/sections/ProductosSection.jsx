import React, { useState, useEffect, useRef } from 'react';
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
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getNowAR, formatDateTimeAR } from '@/lib/dateUtils';
import { Textarea } from '@/components/ui/textarea';

// Defined outside ProductosSection to keep a stable component identity across renders.
// If defined inside, React creates a new function reference every render, causing
// Radix UI portal (Select, Dialog) DOM nodes to unmount/remount and throw removeChild errors.
const ProductForm = ({ data, setData, onSubmit, isEdit = false, providers, categories, isSubmitting }) => (
  <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
    <div className="space-y-2">
      <Label htmlFor="nombre">Nombre del Producto *</Label>
      <Input
        id="nombre"
        value={data.nombre}
        onChange={e => setData({...data, nombre: e.target.value})}
        required
        className="bg-white dark:bg-slate-950"
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="sku">Código SKU *</Label>
      <Input
        id="sku"
        value={data.codigo_sku}
        onChange={e => setData({...data, codigo_sku: e.target.value})}
        required
        className="bg-white dark:bg-slate-950 font-mono"
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
          className="bg-white dark:bg-slate-950"
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
        <SelectTrigger id="proveedor" className="bg-white dark:bg-slate-950">
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
        type="number"
        step="0.01"
        min="0"
        value={data.costo_compra}
        onChange={e => setData({...data, costo_compra: e.target.value})}
        className="bg-white dark:bg-slate-950"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="precio">Precio Venta ($) *</Label>
      <Input
        id="precio"
        type="number"
        step="0.01"
        min="0"
        value={data.precio_venta}
        onChange={e => setData({...data, precio_venta: e.target.value})}
        required
        className="bg-white dark:bg-slate-950"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="stock">Stock Actual</Label>
      <Input
        id="stock"
        type="number"
        value={data.stock_actual}
        onChange={e => setData({...data, stock_actual: e.target.value})}
        className="bg-white dark:bg-slate-950"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="min_stock">Stock Mínimo</Label>
      <Input
        id="min_stock"
        type="number"
        value={data.stock_minimo}
        onChange={e => setData({...data, stock_minimo: e.target.value})}
        className="bg-white dark:bg-slate-950"
      />
    </div>

    <div className="col-span-1 md:col-span-2 space-y-2">
      <Label htmlFor="desc">Descripción</Label>
      <Textarea
        id="desc"
        value={data.descripcion}
        onChange={e => setData({...data, descripcion: e.target.value})}
        className="bg-white dark:bg-slate-950 resize-none h-20"
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

const ProductosSection = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
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
  const [historyFilters, setHistoryFilters] = useState({ productId: 'all', dateFrom: '', dateTo: '' });
  
  // Modal States
  const [isNewProductOpen, setIsNewProductOpen] = useState(false);
  const [isEditProductOpen, setIsEditProductOpen] = useState(false);
  const [isNewProviderOpen, setIsNewProviderOpen] = useState(false);
  const [isMovimientoOpen, setIsMovimientoOpen] = useState(false);
  
  // Selection State
  const [selectedProductForMov, setSelectedProductForMov] = useState(null);

  // Forms
  const initialProductState = {
    nombre: '', codigo_sku: '', categoria_nombre: '', proveedor_id: '',
    unidad_medida: 'Unidad', costo_compra: '', precio_venta: '',
    stock_actual: '', stock_minimo: 5, descripcion: ''
  };

  const [newProduct, setNewProduct] = useState(initialProductState);
  const [editProduct, setEditProduct] = useState({ ...initialProductState, id: '' });
  const [newProvider, setNewProvider] = useState({ 
    nombre: '', contacto: '', telefono: '', email: '', direccion: '' 
  });
  
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
      const payload = {
        nombre: newProduct.nombre,
        codigo_sku: newProduct.codigo_sku,
        user_id: user.id, 
        empresa_id: user.empresa_id,
        costo_compra: parseFloat(newProduct.costo_compra) || 0,
        precio_venta: parseFloat(newProduct.precio_venta) || 0,
        stock_actual: parseInt(newProduct.stock_actual) || 0,
        stock_minimo: parseInt(newProduct.stock_minimo) || 0,
        categoria_id: categoryId,
        proveedor_id: newProduct.proveedor_id || null,
        unidad_medida: newProduct.unidad_medida,
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
    } catch (error) {
      console.error("Create product error:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
        costo_compra: parseFloat(editProduct.costo_compra) || 0,
        precio_venta: parseFloat(editProduct.precio_venta) || 0,
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
    } catch (error) {
      console.error("Update product error:", error);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateProvider = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Critical check for empresa_id
    if (!user || !user.empresa_id) {
        toast({ 
            title: "Error de permisos", 
            description: "No se ha identificado la empresa. Por favor recarga la página.", 
            variant: "destructive" 
        });
        return;
    }

    setIsSubmitting(true);

    try {
      // Validate inputs
      if (!newProvider.nombre || newProvider.nombre.trim() === '') {
        throw new Error("El nombre de la empresa es obligatorio.");
      }

      const payload = {
        nombre: newProvider.nombre.trim(),
        contacto: newProvider.contacto?.trim() || null,
        telefono: newProvider.telefono?.trim() || null,
        email: newProvider.email?.trim() || null,
        direccion: newProvider.direccion?.trim() || null,
        empresa_id: user.empresa_id,
        created_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('proveedores')
        .insert([payload])
        .select();

      if (error) {
          console.error("Supabase Error:", error);
          throw new Error(error.message || "Error al guardar en base de datos");
      }

      toast({ 
        title: "Proveedor agregado", 
        description: "El proveedor ha sido registrado exitosamente.",
        className: "bg-green-50 border-green-200 text-green-800"
      });
      
      setNewProvider({ nombre: '', contacto: '', telefono: '', email: '', direccion: '' });
      setIsNewProviderOpen(false);
      await fetchProviders();
    } catch (error) {
      console.error("Create provider error:", error);
      toast({ 
        title: "Error al crear proveedor", 
        description: error.message || "Verifique los datos e intente nuevamente.", 
        variant: "destructive" 
      });
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

       let newStock = selectedProductForMov.stock_actual;
       if (movimientoForm.tipo === 'entrada') newStock += cantidad;
       else if (movimientoForm.tipo === 'salida') newStock -= cantidad;
       else newStock = cantidad; // ajuste

       // Update Product Stock
       const { error: prodError } = await supabase.from('productos')
         .update({ stock_actual: newStock })
         .eq('id', selectedProductForMov.id)
         .eq('empresa_id', user.empresa_id);
       
       if (prodError) throw prodError;

       // Record Movement
       const { error: movError } = await supabase.from('movimientos_inventario').insert([{
         tenant_id: user.tenant_id,
         empresa_id: user.empresa_id,
         producto_id: selectedProductForMov.id,
         tipo: movimientoForm.tipo,
         cantidad: cantidad,
         motivo: movimientoForm.motivo,
         fecha: getNowAR().toISOString()
       }]);

       if (movError) throw movError;

       toast({ title: "Movimiento registrado", description: "Stock actualizado correctamente." });
       setIsMovimientoOpen(false);
       setMovimientoForm(initialMovimientoState);
       await fetchProducts();
    } catch (error) {
       console.error("Movimiento error:", error);
       toast({ title: "Error", description: error.message, variant: "destructive" });
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
      toast({ title: "Producto inhabilitado", description: `"${product.nombre}" fue quitado del inventario.` });
      await fetchProducts();
    } catch (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  // --- Filtered Views ---
  const filteredProducts = products
    .filter(p => p.activo !== false)
    .filter(p =>
      (p.nombre || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.codigo_sku || '').toLowerCase().includes(searchQuery.toLowerCase())
    );

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
       <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-white dark:bg-slate-900 p-6 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">Inventario</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Gestiona tus productos y control de stock</p>
        </div>
        <div className="flex flex-wrap gap-3">
           {/* Add Provider Dialog */}
           <Dialog open={isNewProviderOpen} onOpenChange={setIsNewProviderOpen}>
             <DialogTrigger asChild>
               <Button variant="outline" className="border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800">
                 <Truck className="h-4 w-4 mr-2" /> Nuevo Proveedor
               </Button>
             </DialogTrigger>
             <DialogContent className="sm:max-w-[500px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
               <DialogHeader>
                 <DialogTitle>Registrar Proveedor</DialogTitle>
                 <DialogDescription>Agrega un nuevo proveedor a tu lista.</DialogDescription>
               </DialogHeader>
               <form onSubmit={handleCreateProvider} className="space-y-4 py-4">
                 <div className="space-y-2">
                   <Label htmlFor="provider-name">Nombre Empresa *</Label>
                   <Input 
                     id="provider-name"
                     value={newProvider.nombre} 
                     onChange={e=>setNewProvider({...newProvider, nombre:e.target.value})} 
                     required 
                     className="bg-white dark:bg-slate-950"
                     placeholder="Ej: Distribuidora Central S.A."
                   />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                     <Label htmlFor="provider-contact">Contacto (Persona)</Label>
                     <Input 
                        id="provider-contact"
                        value={newProvider.contacto} 
                        onChange={e=>setNewProvider({...newProvider, contacto:e.target.value})} 
                        className="bg-white dark:bg-slate-950"
                        placeholder="Ej: Juan Pérez"
                     />
                   </div>
                   <div className="space-y-2">
                     <Label htmlFor="provider-phone">Teléfono</Label>
                     <Input 
                       id="provider-phone"
                       value={newProvider.telefono} 
                       onChange={e=>setNewProvider({...newProvider, telefono:e.target.value})} 
                       className="bg-white dark:bg-slate-950"
                       placeholder="Ej: 11-1234-5678"
                     />
                   </div>
                 </div>
                 <div className="space-y-2">
                   <Label htmlFor="provider-email">Email</Label>
                   <Input 
                     id="provider-email"
                     type="email" 
                     value={newProvider.email} 
                     onChange={e=>setNewProvider({...newProvider, email:e.target.value})} 
                     className="bg-white dark:bg-slate-950"
                     placeholder="Ej: contacto@empresa.com"
                   />
                 </div>
                 <div className="space-y-2">
                   <Label htmlFor="provider-address">Dirección</Label>
                   <Input 
                     id="provider-address"
                     value={newProvider.direccion} 
                     onChange={e=>setNewProvider({...newProvider, direccion:e.target.value})} 
                     className="bg-white dark:bg-slate-950"
                     placeholder="Ej: Av. Corrientes 1234, CABA"
                   />
                 </div>
                 <DialogFooter>
                   <Button type="button" variant="outline" onClick={() => setIsNewProviderOpen(false)}>Cancelar</Button>
                   <Button type="submit" disabled={isSubmitting}>
                     {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                     Guardar Proveedor
                   </Button>
                 </DialogFooter>
               </form>
             </DialogContent>
           </Dialog>

           {/* Add Product Dialog */}
           <Dialog open={isNewProductOpen} onOpenChange={setIsNewProductOpen}>
            <DialogTrigger asChild>
              <Button className="bg-blue-600 hover:bg-blue-700 text-white">
                <Plus className="h-4 w-4 mr-2" /> Nuevo Producto
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
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
               />
            </DialogContent>
           </Dialog>
        </div>
       </div>

       {/* Edit Product Dialog - Triggered programmatically */}
       <Dialog open={isEditProductOpen} onOpenChange={setIsEditProductOpen}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
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
             />
          </DialogContent>
       </Dialog>

       <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-slate-100 dark:bg-slate-800 p-1">
            <TabsTrigger value="inventory" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Inventario</TabsTrigger>
            <TabsTrigger value="history" className="data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Historial de Movimientos</TabsTrigger>
          </TabsList>

          <TabsContent value="inventory" className="space-y-4">
             {/* Search Bar */}
             <div className="relative">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
               <Input 
                 placeholder="Buscar por nombre o SKU..." 
                 value={searchQuery}
                 onChange={(e) => setSearchQuery(e.target.value)}
                 className="pl-10 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
               />
             </div>

             <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
               <div className="overflow-x-auto">
                 <table className="w-full text-sm text-left">
                   <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-medium">
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
                             <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                <td className="p-4">
                                  <div className="font-medium text-slate-900 dark:text-slate-100">{p.nombre}</div>
                                  <div className="text-xs text-slate-500 font-mono">{p.codigo_sku}</div>
                                </td>
                                <td className="p-4 text-center">
                                  {p.categories?.nombre ? (
                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                      {p.categories.nombre}
                                    </span>
                                  ) : (
                                    <span className="text-slate-400">-</span>
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
                                <td className="p-4 text-right font-medium text-slate-900 dark:text-white">
                                  ${p.precio_venta?.toLocaleString('es-AR')}
                                </td>
                                <td className="p-4 text-right">
                                  <div className="flex items-center justify-end gap-2">
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
                                       title="Inhabilitar producto"
                                     >
                                       <Trash2 className="h-4 w-4"/>
                                     </Button>
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
                 <SelectTrigger className="w-[250px] bg-white dark:bg-slate-900">
                   <SelectValue placeholder="Filtrar por producto" />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Todos los productos</SelectItem>
                   {products.map(p => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                 </SelectContent>
               </Select>
             </div>

             <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
               <table className="w-full text-sm text-left">
                 <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-medium">
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
                       <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
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
         <DialogContent className="sm:max-w-[425px] bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
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
                   <SelectTrigger className="bg-white dark:bg-slate-950">
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
                   value={movimientoForm.cantidad} 
                   onChange={e=>setMovimientoForm({...movimientoForm, cantidad:e.target.value})} 
                   placeholder="0" 
                   required
                   className="bg-white dark:bg-slate-950 font-mono text-lg"
                 />
               </div>

               <div className="space-y-2">
                 <Label>Motivo / Observación</Label>
                 <Input 
                   value={movimientoForm.motivo} 
                   onChange={e=>setMovimientoForm({...movimientoForm, motivo:e.target.value})} 
                   placeholder="Ej: Compra mensual, Rotura, etc."
                   className="bg-white dark:bg-slate-950"
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
    </div>
  );
};

export default ProductosSection;