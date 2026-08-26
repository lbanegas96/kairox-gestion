import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, Power, PowerOff, Upload, Sparkles, Search, Check, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from '@/lib/customSupabaseClient';
import { productosService } from '@/services/productosService';
import { dispararPublicacionCatalogo, dispararPublicacionMercadoLibre } from '@/services/integracionesService';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getNowAR, getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useStockDisponible } from '@/hooks/useStockDisponible';
import CSVImportModal from '@/components/ui/CSVImportModal';
import ProductForm from '@/components/productos/ProductForm';
import TablaInventario from '@/components/productos/TablaInventario';
import TabHistorialMovimientos from '@/components/productos/TabHistorialMovimientos';
import ModalMovimiento from '@/components/productos/ModalMovimiento';
import TabRecuentoInventario from '@/components/productos/TabRecuentoInventario';
import TabRevalorizacionInventario from '@/components/productos/TabRevalorizacionInventario';

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

  // mig.354 — Ajuste masivo de precios del catálogo (aumento por inflación, pedido de Nadia
  // 26/08). Mismo patrón que ListasPrecioSection: preview antes de aplicar, nada se graba hasta
  // confirmar.
  const [isAjusteOpen, setIsAjusteOpen] = useState(false);
  const [ajusteForm, setAjusteForm] = useState({ tipoAjuste: 'porcentaje', valor: '', categoriaId: '', redondeo: 'ninguno' });
  const [ajustePreview, setAjustePreview] = useState(null); // AjusteMasivoCatalogoItem[] | null

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

  // Stock Comprometido — Fase 1 (mig.349): mapa aparte, no una columna de `productos`.
  const { mapaDisponible } = useStockDisponible(empresaId);

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

  // mig.354 — Ajuste masivo de precios del catálogo
  const previewAjuste = useMutation({
    mutationFn: async () => {
      const valor = parseNumberLocale(ajusteForm.valor);
      if (isNaN(valor) || valor === 0) throw new Error('Ingresá un valor de ajuste válido');
      return productosService.ajustarPreciosMasivo({
        tipoAjuste: ajusteForm.tipoAjuste,
        valor,
        categoriaId: ajusteForm.categoriaId || null,
        redondeo: ajusteForm.redondeo,
      }, false);
    },
    onSuccess: (items) => setAjustePreview(items),
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const aplicarAjuste = useMutation({
    mutationFn: async () => {
      const valor = parseNumberLocale(ajusteForm.valor);
      return productosService.ajustarPreciosMasivo({
        tipoAjuste: ajusteForm.tipoAjuste,
        valor,
        categoriaId: ajusteForm.categoriaId || null,
        redondeo: ajusteForm.redondeo,
      }, true);
    },
    onSuccess: (items) => {
      invalidateProductos();
      toast({
        title: 'Precios actualizados ✓',
        description: `${items.length} producto${items.length !== 1 ? 's' : ''} ajustado${items.length !== 1 ? 's' : ''}`,
        className: 'bg-green-600 text-white',
      });
      setIsAjusteOpen(false);
      setAjustePreview(null);
      setAjusteForm({ tipoAjuste: 'porcentaje', valor: '', categoriaId: '', redondeo: 'ninguno' });
    },
    onError: (e) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const openAjusteMasivo = () => {
    setAjustePreview(null);
    setAjusteForm({ tipoAjuste: 'porcentaje', valor: '', categoriaId: '', redondeo: 'ninguno' });
    setIsAjusteOpen(true);
  };

  // Forms
  const initialProductState = {
    nombre: '', codigo_sku: '', codigo_barras: '', categoria_nombre: '', proveedor_id: '',
    unidad_medida: 'Unidad', unidad_medida_id: '', costo_compra: '', precio_venta: '',
    stock_actual: '', stock_minimo: 5, descripcion: '',
    // Venta por peso/volumen (mig.338) — default 'unidad' = comportamiento actual sin
    // cambios (ferreterías/distribuidoras siguen igual). precio_por_kg_litro solo se usa
    // cuando tipo_venta ≠ 'unidad', ver ProductForm.jsx.
    tipo_venta: 'unidad', precio_por_kg_litro: '',
    // Factor de conversión de unidad de compra (roadmap SAP) — opcional, default sin cambio
    // de comportamiento: unidad_compra_id vacío = se compra en la misma unidad del stock.
    unidad_compra_id: '', factor_conversion_compra: '1',
    // Unidad de venta / pack (roadmap SAP, mig.189/190) — opcional. Vacío = se vende en
    // la unidad de stock. precio_venta_pack vacío = proporcional; descuento_pack_pct = auto.
    unidad_venta_id: '', factor_conversion_venta: '1', precio_venta_pack: '', descuento_pack_pct: '',
    // Tipo de artículo estilo SAP B1 (OITM: InvntItem/SellItem/PrchseItem) + servicio
    // (mig.234). Defaults = producto físico de venta y compra (comportamiento actual).
    es_inventariable: true, es_articulo_venta: true, es_articulo_compra: true, es_servicio: false,
    publicar_mercadolibre: false,
    // Exposición a ecommerce (Tiendanube). Default off — el usuario lo tilda explícito.
    publicar_ecommerce: false,
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
        // Producto pesable: precio_venta queda en 0 (no se cobra), el precio real vive en
        // precio_por_kg_litro. Producto por unidad: al revés, precio_por_kg_litro null.
        precio_venta: newProduct.tipo_venta === 'unidad' ? (parseNumberLocale(newProduct.precio_venta) || 0) : 0,
        precio_por_kg_litro: newProduct.tipo_venta !== 'unidad'
          ? (parseNumberLocale(newProduct.precio_por_kg_litro) || 0) : null,
        tipo_venta: newProduct.tipo_venta || 'unidad',
        stock_actual: parseNumberLocale(newProduct.stock_actual) || 0,
        stock_minimo: parseNumberLocale(newProduct.stock_minimo) || 0,
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
        // Tipo de artículo SAP (mig.234). Un servicio nunca es inventariable (lo
        // fuerza el CHECK chk_servicio_no_inventariable) — la UI ya lo refleja.
        es_inventariable: newProduct.es_servicio ? false : !!newProduct.es_inventariable,
        es_articulo_venta: !!newProduct.es_articulo_venta,
        es_articulo_compra: !!newProduct.es_articulo_compra,
        es_servicio: !!newProduct.es_servicio,
        publicar_ecommerce: !!newProduct.publicar_ecommerce,
        publicar_mercadolibre: !!newProduct.publicar_mercadolibre,
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
      // Disparo inmediato del worker de publicación — no esperar al cron.
      if (payload.publicar_ecommerce) dispararPublicacionCatalogo();
      if (payload.publicar_mercadolibre) dispararPublicacionMercadoLibre();
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
        precio_venta: editProduct.tipo_venta === 'unidad' ? (parseNumberLocale(editProduct.precio_venta) || 0) : 0,
        precio_por_kg_litro: editProduct.tipo_venta !== 'unidad'
          ? (parseNumberLocale(editProduct.precio_por_kg_litro) || 0) : null,
        tipo_venta: editProduct.tipo_venta || 'unidad',
        // stock_actual NO se toca acá — se ajusta solo vía "Ajustar Stock"
        // (productosService.adjustStock → ajustar_stock_manual), que tiene lock +
        // guard de negativo + trazabilidad en movimientos_inventario. Escribirlo
        // directo acá permitía revertir en silencio ventas/compras concurrentes al
        // guardar el form con el valor stale que tenía al abrirlo.
        stock_minimo: parseNumberLocale(editProduct.stock_minimo) || 0,
        // Tipo de artículo SAP (mig.234) — mismo criterio que el alta.
        es_inventariable: editProduct.es_servicio ? false : !!editProduct.es_inventariable,
        es_articulo_venta: !!editProduct.es_articulo_venta,
        es_articulo_compra: !!editProduct.es_articulo_compra,
        es_servicio: !!editProduct.es_servicio,
        publicar_ecommerce: !!editProduct.publicar_ecommerce,
        publicar_mercadolibre: !!editProduct.publicar_mercadolibre,
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
      if (updates.publicar_ecommerce) dispararPublicacionCatalogo();
      if (updates.publicar_mercadolibre) dispararPublicacionMercadoLibre();
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

       const { delta, costo_unitario } = await productosService.adjustStock({
         id: selectedProductForMov.id,
         cantidad,
         tipo: movimientoForm.tipo,
         motivo: movimientoForm.motivo,
       });

       // Asiento contable — no bloqueante, mismo patrón que Ventas/NC.
       asientosAutoService.crearAsientoAjusteStock(user.empresa_id, user.id, {
         productoId: selectedProductForMov.id,
         delta,
         costoUnitario: costo_unitario,
         fecha: getTodayAR(),
         descripcion: `Ajuste de stock — ${selectedProductForMov.nombre}${movimientoForm.motivo ? ` (${movimientoForm.motivo})` : ''}`,
       }).catch(e => {
         if (e.message?.startsWith('Período cerrado:')) {
           toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
         } else {
           console.warn('[Contabilidad] Asiento ajuste de stock:', e.message);
         }
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

           {/* Ajuste masivo de precios (mig.354) */}
           <Button variant="outline" onClick={openAjusteMasivo} className="dark:text-kx-text dark:border-kx-border">
             <Sparkles className="h-4 w-4 mr-2" /> Ajuste masivo
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
            <TabsTrigger value="recuento" className="data-[state=active]:bg-kx-surface dark:data-[state=active]:bg-slate-700">Recuento</TabsTrigger>
            <TabsTrigger value="revalorizacion" className="data-[state=active]:bg-kx-surface dark:data-[state=active]:bg-slate-700">Revalorización</TabsTrigger>
          </TabsList>

          <TabsContent value="inventory" className="space-y-4">
             <TablaInventario
               showInactivos={showInactivos}
               searchQuery={searchQuery} setSearchQuery={setSearchQuery}
               loading={loading}
               filteredProducts={filteredProducts}
               mapaDisponible={mapaDisponible}
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

          <TabsContent value="recuento" className="space-y-4">
             <TabRecuentoInventario categories={categories} />
          </TabsContent>

          <TabsContent value="revalorizacion" className="space-y-4">
             <TabRevalorizacionInventario categories={categories} />
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

       {/* Ajuste masivo de precios del catálogo (mig.354) */}
       <Dialog open={isAjusteOpen} onOpenChange={(open) => { setIsAjusteOpen(open); if (!open) setAjustePreview(null); }}>
         <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[85vh] flex flex-col">
           <DialogHeader>
             <DialogTitle className="dark:text-kx-text flex items-center gap-2">
               <Sparkles className="w-5 h-5 text-kx-violet" />
               Ajuste masivo de precios
             </DialogTitle>
             <DialogDescription className="dark:text-kx-text-2">
               Aplicá un aumento (o baja) por porcentaje o monto fijo al precio de venta del
               catálogo. Previsualizá el resultado antes de confirmar — no se graba nada hasta que
               apliques. Los productos con precio en $0 se excluyen automáticamente.
             </DialogDescription>
           </DialogHeader>

           <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1.5">
               <Label className="dark:text-kx-text text-xs">Tipo de ajuste</Label>
               <Select
                 value={ajusteForm.tipoAjuste}
                 onValueChange={v => { setAjusteForm(f => ({ ...f, tipoAjuste: v })); setAjustePreview(null); }}
               >
                 <SelectTrigger className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="porcentaje">Porcentaje (%)</SelectItem>
                   <SelectItem value="monto_fijo">Monto fijo ($)</SelectItem>
                 </SelectContent>
               </Select>
             </div>
             <div className="space-y-1.5">
               <Label className="dark:text-kx-text text-xs">
                 Valor {ajusteForm.tipoAjuste === 'porcentaje' ? '(ej: 10 = +10%, -5 = -5%)' : '(ej: 500 ó -200)'}
               </Label>
               <Input
                 value={ajusteForm.valor}
                 onChange={e => { setAjusteForm(f => ({ ...f, valor: e.target.value })); setAjustePreview(null); }}
                 placeholder={ajusteForm.tipoAjuste === 'porcentaje' ? '10' : '500'}
                 inputMode="decimal"
                 className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
               />
             </div>
             <div className="space-y-1.5">
               <Label className="dark:text-kx-text text-xs">Categoría <span className="text-kx-text-3 font-normal">(opcional)</span></Label>
               <Select
                 value={ajusteForm.categoriaId || 'all'}
                 onValueChange={v => { setAjusteForm(f => ({ ...f, categoriaId: v === 'all' ? '' : v })); setAjustePreview(null); }}
               >
                 <SelectTrigger className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="all">Todas las categorías</SelectItem>
                   {categories.map(c => (
                     <SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>
                   ))}
                 </SelectContent>
               </Select>
             </div>
             <div className="space-y-1.5">
               <Label className="dark:text-kx-text text-xs">Redondeo</Label>
               <Select
                 value={ajusteForm.redondeo}
                 onValueChange={v => { setAjusteForm(f => ({ ...f, redondeo: v })); setAjustePreview(null); }}
               >
                 <SelectTrigger className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text">
                   <SelectValue />
                 </SelectTrigger>
                 <SelectContent>
                   <SelectItem value="ninguno">Sin redondeo</SelectItem>
                   <SelectItem value="decena">Terminar en $X0</SelectItem>
                   <SelectItem value="centena">Terminar en $X00</SelectItem>
                   <SelectItem value="terminar_99">Terminar en $X99</SelectItem>
                 </SelectContent>
               </Select>
             </div>
           </div>

           {!ajustePreview ? (
             <div className="flex-1 flex items-center justify-center py-8">
               <Button
                 onClick={() => previewAjuste.mutate()}
                 disabled={previewAjuste.isPending || !ajusteForm.valor}
                 className="bg-violet-600 hover:bg-violet-700 text-white gap-2"
               >
                 {previewAjuste.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                 Previsualizar cambios
               </Button>
             </div>
           ) : ajustePreview.length === 0 ? (
             <p className="text-center text-kx-text-3 py-8 text-sm">
               No hay productos con precio real que coincidan con los filtros (los que están en $0 se excluyen siempre)
             </p>
           ) : (
             <>
               <div className="flex-1 overflow-y-auto border border-kx-border dark:border-kx-border rounded-lg">
                 <table className="w-full text-sm">
                   <thead className="bg-kx-surface-2 dark:bg-slate-900/50 text-xs uppercase text-slate-500 dark:text-kx-text-2 sticky top-0">
                     <tr>
                       <th className="p-2.5 text-left">Producto</th>
                       <th className="p-2.5 text-right">Actual</th>
                       <th className="p-2.5 text-center w-8"></th>
                       <th className="p-2.5 text-right">Nuevo</th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                     {ajustePreview.map(item => {
                       const sube = item.precio_nuevo > item.precio_actual;
                       const baja = item.precio_nuevo < item.precio_actual;
                       return (
                         <tr key={item.producto_id}>
                           <td className="p-2.5 text-kx-text dark:text-kx-text truncate max-w-[200px]">{item.nombre}</td>
                           <td className="p-2.5 text-right text-kx-text-3 tabular-nums">
                             ${Number(item.precio_actual).toLocaleString('es-AR')}
                           </td>
                           <td className="p-2.5 text-center">
                             <ArrowRight className="w-3.5 h-3.5 text-kx-text-3 inline" />
                           </td>
                           <td className={`p-2.5 text-right font-semibold tabular-nums ${
                             sube ? 'text-kx-green' : baja ? 'text-kx-red' : 'text-kx-text dark:text-kx-text'
                           }`}>
                             ${Number(item.precio_nuevo).toLocaleString('es-AR')}
                           </td>
                         </tr>
                       );
                     })}
                   </tbody>
                 </table>
               </div>
               <div className="flex items-center justify-between pt-1">
                 <span className="text-xs text-kx-text-3">
                   {ajustePreview.length} producto{ajustePreview.length !== 1 ? 's' : ''} — nada se guardó todavía
                 </span>
                 <div className="flex gap-2">
                   <Button variant="outline" onClick={() => setAjustePreview(null)} className="dark:border-kx-border dark:text-slate-300">
                     Volver a editar
                   </Button>
                   <Button
                     onClick={() => aplicarAjuste.mutate()}
                     disabled={aplicarAjuste.isPending}
                     className="bg-kx-green hover:bg-green-700 text-white gap-2"
                   >
                     {aplicarAjuste.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                     Aplicar a {ajustePreview.length} producto{ajustePreview.length !== 1 ? 's' : ''}
                   </Button>
                 </div>
               </div>
             </>
           )}

           <DialogFooter className="pt-2 border-t border-kx-border dark:border-kx-border">
             <Button variant="outline" onClick={() => setIsAjusteOpen(false)} className="dark:border-kx-border dark:text-slate-300">
               Cerrar
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>
    </div>
  );
};

export default ProductosSection;