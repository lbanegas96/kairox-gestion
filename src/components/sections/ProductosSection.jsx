import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Power, PowerOff, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from '@/lib/customSupabaseClient';
import { productosService } from '@/services/productosService';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getNowAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import CSVImportModal from '@/components/ui/CSVImportModal';
import ProductForm from '@/components/productos/ProductForm';
import TablaInventario from '@/components/productos/TablaInventario';
import TabHistorialMovimientos from '@/components/productos/TabHistorialMovimientos';
import ModalMovimiento from '@/components/productos/ModalMovimiento';

const ProductosSection = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const empresaId = user?.empresa_id;
  // Helper: invalidar cache de notificaciones cuando cambia stock
  const invalidateNotifs = () => qc.invalidateQueries({ queryKey: ['notif'] });

  const [activeTab, setActiveTab] = useState('inventory');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // --- Data Fetching (useQuery) ---

  const { data: products = [], isLoading: loading } = useQuery({
    queryKey: ['inventario_productos', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from('productos')
        .select(`*, categories:categorias(id, nombre), providers:proveedores(nombre)`)
        .eq('empresa_id', empresaId)
        .order('nombre');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['inventario_categorias', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase.from('categorias')
        .select('*')
        .eq('empresa_id', empresaId)
        .order('nombre');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: providers = [] } = useQuery({
    queryKey: ['inventario_proveedores', empresaId],
    queryFn: async () => {
      // SECURITY-RLS-CROSS: RPC scoped id+nombre — Inventario no requiere permiso 'compras' (mig.135)
      const { data, error } = await supabase.rpc('listar_proveedores_min');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId,
  });

  const { data: movements = [] } = useQuery({
    queryKey: ['inventario_movimientos', empresaId, historyFilters],
    queryFn: async () => {
      let query = supabase.from('movimientos_inventario')
        .select(`*, productos (nombre, codigo_sku)`)
        .eq('empresa_id', empresaId)
        .order('fecha', { ascending: false });

      if (historyFilters.productId !== 'all') query = query.eq('producto_id', historyFilters.productId);
      if (historyFilters.dateFrom) query = query.gte('fecha', historyFilters.dateFrom);
      if (historyFilters.dateTo) query = query.lte('fecha', `${historyFilters.dateTo}T23:59:59`);

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!empresaId && activeTab === 'history',
  });

  const invalidateProductos = () => qc.invalidateQueries({ queryKey: ['inventario_productos', empresaId] });
  const invalidateTodo = () => {
    invalidateProductos();
    qc.invalidateQueries({ queryKey: ['inventario_categorias', empresaId] });
    qc.invalidateQueries({ queryKey: ['inventario_proveedores', empresaId] });
  };

  // Forms
  const initialProductState = {
    nombre: '', codigo_sku: '', codigo_barras: '', categoria_nombre: '', proveedor_id: '',
    unidad_medida: 'Unidad', unidad_medida_id: '', costo_compra: '', precio_venta: '',
    stock_actual: '', stock_minimo: 5, descripcion: '',
    // Factor de conversión de unidad de compra (roadmap SAP) — opcional, default sin cambio
    // de comportamiento: unidad_compra_id vacío = se compra en la misma unidad del stock.
    unidad_compra_id: '', factor_conversion_compra: '1',
    // Unidad de venta / pack (roadmap SAP, mig.189/190) — opcional. Vacío = se vende en
    // la unidad de stock. precio_venta_pack vacío = proporcional; descuento_pack_pct = auto.
    unidad_venta_id: '', factor_conversion_venta: '1', precio_venta_pack: '', descuento_pack_pct: '',
  };

  const [newProduct, setNewProduct] = useState(initialProductState);
  const [editProduct, setEditProduct] = useState({ ...initialProductState, id: '' });
  const initialMovimientoState = { tipo: 'entrada', cantidad: '', motivo: '' };
  const [movimientoForm, setMovimientoForm] = useState(initialMovimientoState);

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
    qc.setQueryData(['inventario_categorias', user.empresa_id], (prev = []) => [...prev, data]);
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
        codigo_barras: newProduct.codigo_barras?.trim() || null,  // SCANNER
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
        unidad_compra_id: newProduct.unidad_compra_id || null,
        factor_conversion_compra: parseNumberLocale(newProduct.factor_conversion_compra) || 1,
        unidad_venta_id: newProduct.unidad_venta_id || null,
        factor_conversion_venta: parseNumberLocale(newProduct.factor_conversion_venta) || 1,
        precio_venta_pack: (newProduct.precio_venta_pack ?? '') !== '' ? parseNumberLocale(newProduct.precio_venta_pack) : null,
        descuento_pack_pct: parseNumberLocale(newProduct.descuento_pack_pct) || 0,
        descripcion: newProduct.descripcion,
        activo: true,
        fecha_creacion: getNowAR().toISOString()
      };

      const { error } = await supabase.from('productos').insert([payload]);
      if (error) throw error;

      toast({ title: "Producto creado", description: "El producto se ha añadido al inventario." });
      setIsNewProductOpen(false);
      setNewProduct(initialProductState);
      invalidateProductos();
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
        codigo_barras: editProduct.codigo_barras?.trim() || null,  // SCANNER
        categoria_id: categoryId,
        proveedor_id: editProduct.proveedor_id || null,
        unidad_medida: editProduct.unidad_medida,
        unidad_medida_id: editProduct.unidad_medida_id || null,
        unidad_compra_id: editProduct.unidad_compra_id || null,
        factor_conversion_compra: parseNumberLocale(editProduct.factor_conversion_compra) || 1,
        unidad_venta_id: editProduct.unidad_venta_id || null,
        factor_conversion_venta: parseNumberLocale(editProduct.factor_conversion_venta) || 1,
        precio_venta_pack: (editProduct.precio_venta_pack ?? '') !== '' ? parseNumberLocale(editProduct.precio_venta_pack) : null,
        descuento_pack_pct: parseNumberLocale(editProduct.descuento_pack_pct) || 0,
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
      invalidateProductos();
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
       invalidateProductos();
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
      invalidateProductos();
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
      invalidateProductos();
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
             <TablaInventario
               showInactivos={showInactivos}
               searchQuery={searchQuery} setSearchQuery={setSearchQuery}
               loading={loading}
               filteredProducts={filteredProducts}
               setEditProduct={setEditProduct}
               setIsEditProductOpen={setIsEditProductOpen}
               setSelectedProductForMov={setSelectedProductForMov}
               setIsMovimientoOpen={setIsMovimientoOpen}
               handleDisableProduct={handleDisableProduct}
               handleReactivateProduct={handleReactivateProduct}
             />
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
             <TabHistorialMovimientos
               historyFilters={historyFilters} setHistoryFilters={setHistoryFilters}
               products={products}
               movements={movements}
             />
          </TabsContent>
       </Tabs>

       {/* Movement Dialog */}
       <ModalMovimiento
         isMovimientoOpen={isMovimientoOpen} setIsMovimientoOpen={setIsMovimientoOpen}
         selectedProductForMov={selectedProductForMov}
         movimientoForm={movimientoForm} setMovimientoForm={setMovimientoForm}
         handleSubmitMovimiento={handleSubmitMovimiento}
         isSubmitting={isSubmitting}
       />

       {/* CSV Import Modal */}
       <CSVImportModal
         open={isImportOpen}
         onOpenChange={setIsImportOpen}
         tipo="productos"
         onSuccess={invalidateTodo}
       />
    </div>
  );
};

export default ProductosSection;