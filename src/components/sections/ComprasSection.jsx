import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, Filter, Eye, ShoppingBag, Search, Eraser, PackageOpen, X, FileText, User, Clock, Loader2, Trash2, AlertTriangle, Edit, Save, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getTodayAR, getDateFromInputAR } from '@/lib/dateUtils';
import CompraDetailModal from '../ventas/CompraDetailModal';
import EstadoBadge from '@/components/ui/EstadoBadge';

function ComprasSection() {
  const { user } = useAuth();
  const { isSessionOpen, currentSession } = useCaja();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("historial");
  const searchInputRef = useRef(null);
  const editSearchInputRef = useRef(null);
  
  // Shared Data
  const [proveedores, setProveedores] = useState([]);
  const [loading, setLoading] = useState(false);

  // --- NUEVA COMPRA States ---
  const [purchaseForm, setPurchaseForm] = useState({
    proveedor_id: '',
    numero_factura: '',
    fecha: getTodayAR(),
    forma_pago: 'Efectivo'
  });
  const [products, setProducts] = useState([]); // All available products for search
  const [productSearch, setProductSearch] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [cart, setCart] = useState([]); // Items to buy
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // --- HISTORIAL States ---
  const [compras, setCompras] = useState([]);
  const [filters, setFilters] = useState({
    dateStart: '',
    dateEnd: '',
    proveedorId: 'Todos',
    paymentMethod: 'Todos',
    status: 'Todos'
  });

  // --- MODAL DETALLE States ---
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedCompraId, setSelectedCompraId] = useState(null);

  // --- MODAL EDIT States ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editItems, setEditItems] = useState([]);
  const [originalItems, setOriginalItems] = useState([]); // To track diffs
  const [editSearch, setEditSearch] = useState('');
  const [showEditAutocomplete, setShowEditAutocomplete] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    if (user) {
      loadProveedores();
      loadProducts();
      loadCompras();
    }
  }, [user]);

  // --- DATA LOADING ---

  const loadProveedores = async () => {
    const { data } = await supabase
      .from('proveedores')
      .select('id, nombre')
      .order('nombre');
    if (data) setProveedores(data);
  };

  const loadProducts = async () => {
    const { data } = await supabase
      .from('productos')
      .select('id, nombre, codigo_sku, costo_compra, stock_actual, unidad_medida')
      .eq('user_id', user.tenant_id)
      .eq('activo', true)
      .order('nombre');
    if (data) setProducts(data);
  };

  const loadCompras = async () => {
    setLoading(true);
    try {
      // Basic fetch, filtering done in memory for small datasets or specialized queries
      // If dataset is huge, move filters to Supabase query
      const { data, error } = await supabase
        .from('compras')
        .select('*, proveedores(nombre)')
        .eq('user_id', user.tenant_id)
        .order('fecha', { ascending: false });

      if (error) throw error;
      
      // Normalize data
      const processed = (data || []).map(c => ({
        ...c,
        estado_pago: c.estado_pago || 'pendiente',
        forma_pago: c.forma_pago || 'Efectivo'
      }));

      setCompras(processed);
    } catch (error) {
      console.error('Error loading purchases:', error);
      toast({
        title: "Error al cargar historial",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const getShortUnit = (unit) => {
    switch(unit) {
      case 'Gramos': return 'gr';
      case 'Kilogramos': return 'kg';
      case 'Litros': return 'lt';
      case 'Mililitros': return 'ml';
      default: return 'un.';
    }
  };

  // --- FILTERING LOGIC ---
  const filteredCompras = useMemo(() => {
    return compras.filter(compra => {
      // Date Range
      if (filters.dateStart && new Date(compra.fecha) < new Date(filters.dateStart)) return false;
      if (filters.dateEnd) {
         const toDate = new Date(filters.dateEnd);
         toDate.setHours(23, 59, 59, 999);
         if (new Date(compra.fecha) > toDate) return false;
      }
      // Proveedor
      if (filters.proveedorId !== 'Todos' && compra.proveedor_id !== filters.proveedorId) return false;
      // Payment Method
      if (filters.paymentMethod !== 'Todos' && compra.forma_pago !== filters.paymentMethod) return false;
      // Status
      if (filters.status !== 'Todos' && compra.estado_pago !== filters.status) return false;

      return true;
    });
  }, [compras, filters]);

  const totalPeriodo = useMemo(() => {
    return filteredCompras.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  }, [filteredCompras]);

  const activeFiltersCount = [
    filters.dateStart, 
    filters.dateEnd, 
    filters.proveedorId !== 'Todos', 
    filters.paymentMethod !== 'Todos', 
    filters.status !== 'Todos'
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilters({
      dateStart: '',
      dateEnd: '',
      proveedorId: 'Todos',
      paymentMethod: 'Todos',
      status: 'Todos'
    });
  };

  // --- NUEVA COMPRA LOGIC ---

  const filteredProducts = products.filter(p => 
    p.nombre.toLowerCase().includes(productSearch.toLowerCase()) || 
    p.codigo_sku.toLowerCase().includes(productSearch.toLowerCase())
  );
  
  // Filter for Edit Modal
  const filteredEditProducts = products.filter(p => 
    p.nombre.toLowerCase().includes(editSearch.toLowerCase()) || 
    p.codigo_sku.toLowerCase().includes(editSearch.toLowerCase())
  );

  const addToCart = (product) => {
    const newItem = { 
      ...product, 
      cartItemId: crypto.randomUUID(),
      cantidad: 1, 
      costo_unitario: product.costo_compra || 0 
    };
    
    setCart([...cart, newItem]);
    setProductSearch('');
    setShowAutocomplete(false);
    
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 10);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredProducts.length > 0) {
        addToCart(filteredProducts[0]);
      }
    }
  };

  const updateCartItem = (cartItemId, field, value) => {
    setCart(cart.map(item => {
      if (item.cartItemId === cartItemId) {
        const val = parseFloat(value);
        return { ...item, [field]: isNaN(val) ? '' : val };
      }
      return item;
    }));
  };

  const removeFromCart = (cartItemId) => {
    setCart(cart.filter(item => item.cartItemId !== cartItemId));
  };

  const calculateTotal = () => {
    return cart.reduce((sum, item) => {
      const qty = Number(item.cantidad) || 0;
      const cost = Number(item.costo_unitario) || 0;
      return sum + (qty * cost);
    }, 0);
  };

  const calculateTotalUnits = () => {
    return cart.reduce((sum, item) => sum + (Number(item.cantidad) || 0), 0);
  };

  const handleClearAll = () => {
    setCart([]);
    setPurchaseForm({
      proveedor_id: '',
      numero_factura: '',
      fecha: getTodayAR(),
      forma_pago: 'Efectivo'
    });
    setProductSearch('');
    setShowClearConfirm(false);
    toast({ title: "Formulario limpiado" });
  };

  const isPurchaseValid = () => {
    return (
      purchaseForm.proveedor_id &&
      cart.length > 0 &&
      cart.every(item => item.cantidad > 0 && item.costo_unitario >= 0)
    );
  };

  const handleRegisterPurchase = async () => {
    // 1. Session Check
    if (!isSessionOpen) {
      toast({ 
        variant: 'destructive', 
        title: 'Caja cerrada', 
        description: 'Debe abrir caja antes de registrar compras' 
      });
      return; 
    }

    if (!isPurchaseValid()) return;
    setIsSubmitting(true);

    try {
      const totalCompra = calculateTotal();
      const status = purchaseForm.forma_pago === 'Cuenta Corriente' ? 'pendiente' : 'pagada';

      const { data: newPurchase, error: purchaseError } = await supabase
        .from('compras')
        .insert([{
          user_id: user.tenant_id,
          fecha: getDateFromInputAR(purchaseForm.fecha), 
          proveedor_id: purchaseForm.proveedor_id,
          numero_factura: purchaseForm.numero_factura || 'S/N',
          total: totalCompra,
          forma_pago: purchaseForm.forma_pago,
          estado_pago: status
        }])
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      const purchaseItems = cart.map(item => ({
        compra_id: newPurchase.id,
        producto_id: item.id,
        cantidad: parseInt(item.cantidad),
        costo_unitario: parseFloat(item.costo_unitario),
        subtotal: parseInt(item.cantidad) * parseFloat(item.costo_unitario)
      }));

      const { error: detailsError } = await supabase
        .from('detalle_compras')
        .insert(purchaseItems);

      if (detailsError) throw detailsError;

      // Update Stock (Create Mode: Always Add)
      for (const item of cart) {
         // Using RPC for safety
         await supabase.rpc('increment_stock', { row_id: item.id, quantity: parseInt(item.cantidad) });
         
         // Update cost
         await supabase.from('productos')
           .update({ costo_compra: parseFloat(item.costo_unitario) })
           .eq('id', item.id);
      }

      // Caja
      const providerName = proveedores.find(p => p.id === purchaseForm.proveedor_id)?.nombre || 'Proveedor';
      if (status === 'pagada') {
        await supabase.from('movimientos_caja').insert([{
          user_id: user.tenant_id,
          caja_sesion_id: currentSession?.id, // Link to Session
          fecha: getDateFromInputAR(purchaseForm.fecha), 
          tipo: 'egreso',
          categoria: 'Compra',
          concepto: `Compra a ${providerName} (${purchaseForm.forma_pago})`,
          monto: totalCompra,
          metodo_pago: purchaseForm.forma_pago,
          is_automatic: true
        }]);
      }

      toast({
        title: "¡Compra registrada correctamente! Stock actualizado.",
        className: "bg-green-600 text-white border-green-500"
      });

      setPurchaseForm({
        proveedor_id: '',
        numero_factura: '',
        fecha: getTodayAR(),
        forma_pago: 'Efectivo'
      });
      setCart([]);
      
      loadProducts();
      setActiveTab('historial');
      loadCompras(); 

    } catch (error) {
      console.error('Transaction error:', error);
      toast({
        title: "Error al registrar compra",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT COMPRA LOGIC (Legacy retained but not requested to be changed, kept functional) ---

  const handleEditClick = async (compra, e) => {
    e.stopPropagation(); // Prevent row click
    // 1. Initialize Header
    setEditForm({
      id: compra.id,
      proveedor_id: compra.proveedor_id,
      numero_factura: compra.numero_factura,
      fecha: compra.fecha.split('T')[0],
      total: compra.total
    });

    // 2. Fetch Details
    const { data, error } = await supabase
      .from('detalle_compras')
      .select('*, productos(nombre, codigo_sku, unidad_medida)')
      .eq('compra_id', compra.id);

    if (error) {
      toast({ title: "Error", description: "No se pudieron cargar los detalles", variant: "destructive" });
      return;
    }

    // 3. Prepare Items (Add internal ID for React keys)
    const items = data.map(d => ({
      id: d.id, // Database ID for existing items
      internalId: crypto.randomUUID(),
      producto_id: d.producto_id,
      nombre: d.productos?.nombre,
      codigo_sku: d.productos?.codigo_sku,
      unidad_medida: d.productos?.unidad_medida,
      cantidad: d.cantidad,
      costo_unitario: d.costo_unitario,
      is_new: false
    }));

    setEditItems(JSON.parse(JSON.stringify(items)));
    setOriginalItems(JSON.parse(JSON.stringify(items))); // Deep copy for Diffing
    
    setIsEditModalOpen(true);
  };

  const addProductToEdit = (product) => {
    const newItem = {
      id: null, // No DB ID yet
      internalId: crypto.randomUUID(),
      producto_id: product.id,
      nombre: product.nombre,
      codigo_sku: product.codigo_sku,
      unidad_medida: product.unidad_medida,
      cantidad: 1,
      costo_unitario: product.costo_compra || 0,
      is_new: true
    };
    
    setEditItems([...editItems, newItem]);
    setEditSearch('');
    setShowEditAutocomplete(false);
  };

  const updateEditItem = (internalId, field, value) => {
    setEditItems(editItems.map(item => {
      if (item.internalId === internalId) {
        const val = parseFloat(value);
        return { ...item, [field]: isNaN(val) ? '' : val };
      }
      return item;
    }));
  };

  const removeEditItem = (internalId) => {
    setEditItems(editItems.filter(item => item.internalId !== internalId));
  };

  const calculateEditTotal = () => {
    return editItems.reduce((sum, item) => {
      return sum + ((Number(item.cantidad) || 0) * (Number(item.costo_unitario) || 0));
    }, 0);
  };

  const handleSaveEdit = async () => {
    setIsSavingEdit(true);
    try {
      const newTotal = calculateEditTotal();

      // 1. Update Purchase Header
      const { error: headerError } = await supabase
        .from('compras')
        .update({
          proveedor_id: editForm.proveedor_id,
          numero_factura: editForm.numero_factura,
          fecha: editForm.fecha,
          total: newTotal
        })
        .eq('id', editForm.id);

      if (headerError) throw headerError;

      // 2. Process Items (Diff Logic)
      
      // A. Deleted Items: Existed in Original but not in Edit
      const deletedItems = originalItems.filter(orig => !editItems.find(curr => curr.id === orig.id));
      
      for (const item of deletedItems) {
        // Reverse Stock: Subtract the OLD quantity (since purchase adds stock, deleting it removes stock)
        await supabase.rpc('increment_stock', { row_id: item.producto_id, quantity: -Number(item.cantidad) });
        
        // Delete record
        await supabase.from('detalle_compras').delete().eq('id', item.id);
      }

      // B. New & Modified Items
      for (const item of editItems) {
        if (item.is_new) {
          // New Item: Add full quantity to stock
          await supabase.rpc('increment_stock', { row_id: item.producto_id, quantity: Number(item.cantidad) });
          
          // Insert record
          await supabase.from('detalle_compras').insert({
            compra_id: editForm.id,
            producto_id: item.producto_id,
            cantidad: Number(item.cantidad),
            costo_unitario: Number(item.costo_unitario),
            subtotal: Number(item.cantidad) * Number(item.costo_unitario)
          });
        } else {
          // Existing Item: Check for changes
          const orig = originalItems.find(o => o.id === item.id);
          if (orig) {
            const diff = Number(item.cantidad) - Number(orig.cantidad);
            
            // Only update stock if quantity changed
            // If new qty (15) > old qty (10), diff is +5. We add 5 to stock.
            // If new qty (5) < old qty (10), diff is -5. We subtract 5 from stock.
            if (diff !== 0) {
              await supabase.rpc('increment_stock', { row_id: item.producto_id, quantity: diff });
            }

            // Always update record in case cost changed
            await supabase.from('detalle_compras').update({
              cantidad: Number(item.cantidad),
              costo_unitario: Number(item.costo_unitario),
              subtotal: Number(item.cantidad) * Number(item.costo_unitario)
            }).eq('id', item.id);
          }
        }

        // Update Product Cost (Last purchase cost logic)
        await supabase.from('productos')
          .update({ costo_compra: Number(item.costo_unitario) })
          .eq('id', item.producto_id);
      }

      toast({ title: "Cambios guardados", description: "La compra y el stock han sido actualizados." });
      setIsEditModalOpen(false);
      loadCompras();
      loadProducts(); // Refresh stock in UI

    } catch (error) {
      console.error("Save Edit Error:", error);
      toast({ title: "Error al guardar", description: error.message, variant: "destructive" });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleCompraUpdate = () => {
    loadCompras();
  };

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex justify-between items-center bg-white dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-1">Gestión de Compras</h2>
          <p className="text-slate-500 dark:text-slate-400">Registro y control de compras a proveedores</p>
        </div>
        {!isSessionOpen && (
           <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-4 py-2 rounded-lg flex items-center gap-2 border border-red-200 dark:border-red-800">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-bold">CAJA CERRADA: No se pueden registrar compras</span>
           </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-transparent p-0 gap-2 mb-4 w-full flex justify-start">
          <TabsTrigger value="nueva" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-slate-900 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><ShoppingBag className="w-4 h-4 mr-2"/> Nueva Compra</TabsTrigger>
          <TabsTrigger value="historial" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-slate-900 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><Calendar className="w-4 h-4 mr-2"/> Historial de Compras</TabsTrigger>
        </TabsList>

        {/* TAB: NUEVA COMPRA */}
        <TabsContent value="nueva" className="mt-0 space-y-4">
          <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm dark:bg-slate-950 dark:border-slate-800">
            <h3 className="text-lg font-bold text-blue-800 dark:text-[#00D4FF] flex items-center gap-2 mb-4"><ShoppingBag className="h-5 w-5" /> DATOS DE COMPRA</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2"><Label className="dark:text-white">Proveedor <span className="text-red-500">*</span></Label><div className="relative"><select className="w-full h-10 rounded-md bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-[#00D4FF]" value={purchaseForm.proveedor_id} onChange={e => setPurchaseForm({...purchaseForm, proveedor_id: e.target.value})}><option value="">Seleccione Proveedor...</option>{proveedores.map(p => (<option key={p.id} value={p.id}>{p.nombre}</option>))}</select></div></div>
              <div className="space-y-2"><Label className="dark:text-white">N° Factura / Referencia</Label><Input value={purchaseForm.numero_factura} onChange={e => setPurchaseForm({...purchaseForm, numero_factura: e.target.value})} placeholder="Ej: F-001-2304" className="kairox-input dark:bg-slate-900 dark:border-slate-700 dark:text-white"/></div>
              <div className="space-y-2"><Label className="dark:text-white">Fecha de Compra</Label><div className="relative"><Calendar className="absolute left-3 top-2.5 h-4 w-4 text-slate-500"/><Input type="date" value={purchaseForm.fecha} onChange={e => setPurchaseForm({...purchaseForm, fecha: e.target.value})} className="pl-9 kairox-input dark:bg-slate-900 dark:border-slate-700 dark:text-white"/></div></div>
              <div className="space-y-2"><Label className="dark:text-white">Forma de Pago</Label><select className="w-full h-10 rounded-md bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={purchaseForm.forma_pago} onChange={e => setPurchaseForm({...purchaseForm, forma_pago: e.target.value})}><option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Cuenta Corriente">Cuenta Corriente</option></select></div>
            </div>
          </div>

          <div className="kairox-bg-card border kairox-border p-6 rounded-xl flex flex-col relative min-h-[400px] shadow-sm dark:bg-slate-950 dark:border-slate-800">
            <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-blue-800 dark:text-[#00D4FF] flex items-center gap-2"><PackageOpen className="h-5 w-5" /> PRODUCTOS</h3>{cart.length > 0 && (<div className="bg-slate-100 dark:bg-slate-800 kairox-text-primary text-xs px-3 py-1 rounded-full border kairox-border font-medium shadow-sm dark:text-slate-300 dark:border-slate-700">{cart.length} filas | {calculateTotalUnits()} unidades</div>)}</div>
            <div className="relative mb-4 z-20"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" /><Input ref={searchInputRef} placeholder="Buscar producto por nombre o SKU..." value={productSearch} onChange={e => {setProductSearch(e.target.value); setShowAutocomplete(true);}} onKeyDown={handleSearchKeyDown} onFocus={() => setShowAutocomplete(true)} className="pl-9 focus:border-blue-500 dark:focus:border-[#00D4FF] kairox-input dark:bg-slate-900 dark:border-slate-700 dark:text-white"/>{showAutocomplete && productSearch && (<div className="absolute top-full left-0 w-full kairox-bg-card border kairox-border rounded-md mt-1 shadow-xl max-h-60 overflow-y-auto dark:bg-slate-950 dark:border-slate-800">{filteredProducts.length === 0 ? (<div className="p-3 text-slate-500 text-sm text-center">No se encontraron productos</div>) : (filteredProducts.map(p => {const shortUnit = getShortUnit(p.unidad_medida); return (<div key={p.id} className="p-3 flex justify-between items-center border-b kairox-border last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-colors dark:border-slate-800" onClick={() => addToCart(p)}><div><div className="font-medium kairox-text-primary dark:text-white">{p.nombre}</div><div className="text-xs text-slate-500 dark:text-slate-400">{p.codigo_sku} | {p.unidad_medida || 'Unidad'}</div></div><div className="text-right text-slate-600 dark:text-slate-400 text-xs">Costo Actual: ${p.costo_compra?.toFixed(2)}<div className="text-slate-500 dark:text-slate-500">Stock: {p.stock_actual} {shortUnit}</div></div></div>)}))}</div>)}{showAutocomplete && productSearch && (<div className="fixed inset-0 z-[-1]" onClick={() => setShowAutocomplete(false)}></div>)}</div>
            <div className="border kairox-border rounded-lg overflow-hidden bg-slate-50/50 dark:bg-slate-950/30 flex-grow dark:border-slate-800">
              <table className="w-full text-sm text-left"><thead className="kairox-table-header border-b kairox-border dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-800"><tr><th className="p-4">Producto</th><th className="p-4 text-center w-32">Cantidad</th><th className="p-4 text-right w-40">Costo Unit. ($)</th><th className="p-4 text-right">Subtotal</th><th className="p-4 w-16 text-center">Acción</th></tr></thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">{cart.length === 0 ? (<tr><td colSpan="5" className="p-12 text-center text-slate-500 dark:text-slate-400"><ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-20"/>Agrega productos a la compra usando el buscador</td></tr>) : (cart.map(item => (<tr key={item.cartItemId} className="group hover:bg-slate-100 dark:hover:bg-slate-900/50"><td className="p-4 font-medium kairox-text-primary dark:text-slate-200">{item.nombre}<div className="text-xs text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1">{item.codigo_sku}<span className="text-slate-400 dark:text-slate-600">|</span>{getShortUnit(item.unidad_medida)}</div></td><td className="p-4 text-center"><Input type="number" min="1" value={item.cantidad} onChange={(e) => updateCartItem(item.cartItemId, 'cantidad', e.target.value)} className="w-24 mx-auto text-center h-8 focus:bg-white dark:focus:bg-slate-700 kairox-input dark:bg-slate-800 dark:border-slate-700 dark:text-white"/></td><td className="p-4 text-right"><Input type="number" min="0" step="0.01" value={item.costo_unitario} onChange={(e) => updateCartItem(item.cartItemId, 'costo_unitario', e.target.value)} className="w-32 ml-auto text-right h-8 focus:bg-white dark:focus:bg-slate-700 kairox-input dark:bg-slate-800 dark:border-slate-700 dark:text-white"/></td><td className="p-4 text-right font-bold kairox-text-primary dark:text-emerald-400">${((Number(item.cantidad) || 0) * (Number(item.costo_unitario) || 0)).toFixed(2)}</td><td className="p-4 text-center"><Button size="icon" variant="ghost" onClick={() => removeFromCart(item.cartItemId)} className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"><X className="h-4 w-4" /></Button></td></tr>)))}</tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 justify-end items-center pt-4">
            <div className="kairox-bg-card border kairox-border rounded-xl p-6 flex items-center gap-6 shadow-lg w-full md:w-auto justify-between md:justify-start dark:bg-slate-950 dark:border-slate-800">
              <div className="text-right"><div className="text-slate-500 dark:text-slate-400 text-sm font-medium uppercase tracking-wider">Total de Compra</div><div className="text-3xl font-black bg-gradient-to-r from-blue-600 to-purple-600 dark:from-[#00D4FF] dark:to-[#A855F7] bg-clip-text text-transparent font-mono">${calculateTotal().toFixed(2)}</div></div>
              <div className="h-12 w-px bg-slate-200 dark:bg-slate-700 mx-2 hidden md:block"></div>
              <div className="flex gap-2 w-full md:w-auto">
                 <Button variant="destructive" onClick={() => setShowClearConfirm(true)} className="h-14 px-4 bg-red-100 hover:bg-red-200 text-red-600 border border-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 dark:border-red-900/50 w-full md:w-auto" disabled={isSubmitting || cart.length === 0}><Trash2 className="w-5 h-5" /></Button>
                <Button 
                  onClick={handleRegisterPurchase} 
                  disabled={!isPurchaseValid() || isSubmitting || !isSessionOpen} 
                  className={`h-14 px-8 text-lg font-bold text-white shadow-lg border-0 transition-all w-full md:w-auto ${!isSessionOpen ? 'bg-slate-400 cursor-not-allowed dark:bg-slate-600' : 'bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 shadow-blue-900/20 hover:scale-105 dark:from-[#00D4FF] dark:to-[#A855F7]'}`}
                >
                  {isSubmitting ? 'REGISTRANDO...' : !isSessionOpen ? 'CAJA CERRADA' : 'REGISTRAR COMPRA'}
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* TAB: HISTORIAL */}
        <TabsContent value="historial" className="mt-0 space-y-4">
          
          {/* ADVANCED FILTERS */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border kairox-border shadow-sm space-y-4 dark:border-slate-800">
            <div className="flex justify-between items-center mb-2">
               <h3 className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                 <Filter className="h-4 w-4" /> Filtros Avanzados
                 {activeFiltersCount > 0 && <Badge variant="secondary" className="ml-1 px-1.5 h-5 min-w-[20px] dark:bg-slate-800 dark:text-slate-300">{activeFiltersCount}</Badge>}
               </h3>
               {activeFiltersCount > 0 && (
                 <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400">
                   <X className="h-3 w-3 mr-1" /> Limpiar filtros
                 </Button>
               )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Desde</Label>
                 <Input type="date" value={filters.dateStart} onChange={e => setFilters({...filters, dateStart: e.target.value})} className="h-9 kairox-input text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Hasta</Label>
                 <Input type="date" value={filters.dateEnd} onChange={e => setFilters({...filters, dateEnd: e.target.value})} className="h-9 kairox-input text-sm dark:bg-slate-900 dark:border-slate-700 dark:text-white" />
              </div>
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Proveedor</Label>
                 <select 
                   className="w-full h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm dark:bg-slate-900 dark:text-white"
                   value={filters.proveedorId}
                   onChange={e => setFilters({...filters, proveedorId: e.target.value})}
                 >
                   <option value="Todos">Todos</option>
                   {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                 </select>
              </div>
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Forma de Pago</Label>
                 <select 
                   className="w-full h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm dark:bg-slate-900 dark:text-white"
                   value={filters.paymentMethod}
                   onChange={e => setFilters({...filters, paymentMethod: e.target.value})}
                 >
                   <option value="Todos">Todas</option>
                   <option value="Efectivo">Efectivo</option>
                   <option value="Transferencia">Transferencia</option>
                   <option value="Tarjeta">Tarjeta</option>
                   <option value="Cuenta Corriente">Cuenta Corriente</option>
                 </select>
              </div>
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-slate-400">Estado</Label>
                 <select 
                   className="w-full h-9 rounded-md border border-slate-300 dark:border-slate-700 bg-transparent px-3 text-sm dark:bg-slate-900 dark:text-white"
                   value={filters.status}
                   onChange={e => setFilters({...filters, status: e.target.value})}
                 >
                   <option value="Todos">Todos</option>
                   <option value="pagada">Pagada</option>
                   <option value="pendiente">Pendiente</option>
                   <option value="parcial">Parcial</option>
                 </select>
              </div>
            </div>
          </div>

          {/* SUMMARY CARD */}
          <Card className="p-4 bg-gradient-to-r from-blue-50 to-white dark:from-blue-900/10 dark:to-slate-900 border-blue-100 dark:border-blue-900/20">
             <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-full text-blue-600 dark:text-blue-400">
                    <Check className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Compras Filtradas</p>
                    <p className="text-2xl font-bold text-slate-800 dark:text-white">{filteredCompras.length}</p>
                  </div>
                </div>
                <div className="text-center sm:text-right border-t sm:border-t-0 sm:border-l border-blue-200 dark:border-slate-700 pt-4 sm:pt-0 sm:pl-8 w-full sm:w-auto">
                   <p className="text-sm text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider mb-1">Total Comprado</p>
                   <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                     ${totalPeriodo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                   </p>
                </div>
             </div>
          </Card>

          {/* TABLE */}
          <div className="kairox-bg-card border kairox-border rounded-xl overflow-hidden shadow-sm dark:bg-slate-950 dark:border-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 dark:bg-slate-900/50 border-b kairox-border text-xs uppercase font-semibold text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="p-4 w-40">Fecha</th>
                    <th className="p-4 w-32">N° Factura</th>
                    <th className="p-4">Proveedor</th>
                    <th className="p-4 w-32">Forma Pago</th>
                    <th className="p-4 w-28 text-center">Estado</th>
                    <th className="p-4 w-32 text-right">Total</th>
                    <th className="p-4 w-24 text-center">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-32" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                        <td className="p-4"><Skeleton className="h-6 w-16 mx-auto rounded-full" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                        <td className="p-4"><Skeleton className="h-8 w-8 mx-auto" /></td>
                      </tr>
                    ))
                  ) : filteredCompras.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="p-12 text-center text-slate-500 bg-slate-50/50 dark:bg-slate-900/20 dark:text-slate-400">
                        <div className="flex flex-col items-center gap-2">
                           <AlertTriangle className="h-10 w-10 text-slate-300" />
                           <p className="font-medium">
                             {compras.length === 0 ? "Sin compras registradas aún" : "No hay compras que coincidan con los filtros"}
                           </p>
                           {activeFiltersCount > 0 && (
                             <Button variant="link" onClick={clearFilters} className="text-blue-500 h-auto p-0">Limpiar filtros</Button>
                           )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredCompras.map(compra => (
                      <tr key={compra.id} className="group hover:bg-blue-50/50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => { setSelectedCompraId(compra.id); setDetailsOpen(true); }}>
                        <td className="p-4 text-slate-600 dark:text-slate-300 font-mono text-xs">
                          {new Date(compra.fecha).toLocaleDateString()} <span className="text-slate-400 ml-1">{new Date(compra.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </td>
                        <td className="p-4 text-slate-500 font-mono text-xs font-medium dark:text-slate-400">
                          {compra.numero_factura}
                        </td>
                        <td className="p-4 font-medium text-slate-800 dark:text-slate-200">
                          {compra.proveedores?.nombre || '---'}
                        </td>
                        <td className="p-4 text-slate-600 dark:text-slate-400 text-xs font-medium uppercase tracking-wide">
                          {compra.forma_pago}
                        </td>
                        <td className="p-4 text-center">
                          <EstadoBadge estado={compra.estado_pago} />
                        </td>
                        <td className="p-4 text-right font-bold text-slate-700 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                          ${compra.total?.toFixed(2)}
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex justify-center gap-1">
                             <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full">
                               <Eye className="h-4 w-4" />
                             </Button>
                             <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-full" onClick={(e) => handleEditClick(compra, e)}>
                               <Edit className="h-4 w-4" />
                             </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* MODAL DETALLE DE COMPRA */}
      <CompraDetailModal 
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        compraId={selectedCompraId}
        onUpdateCompra={handleCompraUpdate}
      />

      {/* MODAL EDITAR COMPRA */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-w-4xl kairox-bg-card border kairox-border kairox-text-primary shadow-2xl max-h-[90vh] overflow-y-auto dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-blue-800 dark:text-[#00D4FF] flex items-center gap-2 mb-2">
              <Edit className="h-6 w-6" />Editar Compra
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              Modifique los detalles de la compra. El stock se ajustará automáticamente según los cambios.
            </DialogDescription>
          </DialogHeader>

          {editForm && (
            <div className="space-y-6">
              {/* Header Info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg border kairox-border bg-slate-50 dark:bg-slate-900/30 dark:border-slate-800">
                <div className="space-y-2">
                  <Label className="dark:text-white">Proveedor</Label>
                  <select 
                    className="w-full h-9 rounded-md kairox-input px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-[#00D4FF] dark:bg-slate-900 dark:border-slate-700 dark:text-white" 
                    value={editForm.proveedor_id} 
                    onChange={e => setEditForm({...editForm, proveedor_id: e.target.value})}
                  >
                    <option value="">Seleccione...</option>
                    {proveedores.map(p => (<option key={p.id} value={p.id}>{p.nombre}</option>))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-white">N° Factura</Label>
                  <Input 
                    value={editForm.numero_factura} 
                    onChange={e => setEditForm({...editForm, numero_factura: e.target.value})} 
                    className="h-9 kairox-input dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-white">Fecha</Label>
                  <Input 
                    type="date" 
                    value={editForm.fecha} 
                    onChange={e => setEditForm({...editForm, fecha: e.target.value})} 
                    className="h-9 kairox-input dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                  />
                </div>
              </div>

              {/* Add Product Section for Edit */}
              <div className="relative z-20">
                <Label className="mb-2 block dark:text-white">Agregar Producto</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input 
                    ref={editSearchInputRef} 
                    placeholder="Buscar para agregar..." 
                    value={editSearch} 
                    onChange={e => {setEditSearch(e.target.value); setShowEditAutocomplete(true);}} 
                    onFocus={() => setShowEditAutocomplete(true)} 
                    className="pl-9 h-9 kairox-input dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                  />
                  {showEditAutocomplete && editSearch && (
                    <div className="absolute top-full left-0 w-full kairox-bg-card border kairox-border rounded-md mt-1 shadow-xl max-h-60 overflow-y-auto dark:bg-slate-950 dark:border-slate-800">
                      {filteredEditProducts.length === 0 ? (
                        <div className="p-3 text-slate-500 text-sm text-center">No se encontraron productos</div>
                      ) : (
                        filteredEditProducts.map(p => (
                          <div 
                            key={p.id} 
                            className="p-2 flex justify-between items-center border-b kairox-border hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer dark:border-slate-800" 
                            onClick={() => addProductToEdit(p)}
                          >
                            <span className="font-medium text-sm dark:text-white">{p.nombre}</span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">Stock: {p.stock_actual}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {showEditAutocomplete && editSearch && (
                    <div className="fixed inset-0 z-[-1]" onClick={() => setShowEditAutocomplete(false)}></div>
                  )}
                </div>
              </div>

              {/* Items Table */}
              <div className="border kairox-border rounded-lg overflow-hidden dark:border-slate-800">
                <table className="w-full text-sm text-left">
                  <thead className="kairox-table-header font-medium border-b kairox-border dark:bg-slate-900/50 dark:text-slate-300 dark:border-slate-800">
                    <tr>
                      <th className="p-3 pl-4">Producto</th>
                      <th className="p-3 text-center w-24">Cant.</th>
                      <th className="p-3 text-right w-32">Costo ($)</th>
                      <th className="p-3 text-right">Subtotal</th>
                      <th className="p-3 text-center w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {editItems.map((item) => (
                      <tr key={item.internalId} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                        <td className="p-3 pl-4">
                          <div className="font-medium kairox-text-primary dark:text-slate-200">{item.nombre}</div>
                          {item.is_new && <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">NUEVO</span>}
                        </td>
                        <td className="p-3 text-center">
                          <Input 
                            type="number" 
                            min="1" 
                            value={item.cantidad} 
                            onChange={(e) => updateEditItem(item.internalId, 'cantidad', e.target.value)}
                            className="h-8 text-center kairox-input dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                          />
                        </td>
                        <td className="p-3 text-right">
                          <Input 
                            type="number" 
                            step="0.01" 
                            value={item.costo_unitario} 
                            onChange={(e) => updateEditItem(item.internalId, 'costo_unitario', e.target.value)}
                            className="h-8 text-right kairox-input dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                          />
                        </td>
                        <td className="p-3 text-right font-medium dark:text-slate-200">
                          ${((Number(item.cantidad) || 0) * (Number(item.costo_unitario) || 0)).toFixed(2)}
                        </td>
                        <td className="p-3 text-center">
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            className="h-7 w-7 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                            onClick={() => removeEditItem(item.internalId)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {editItems.length === 0 && (
                      <tr><td colSpan="5" className="p-6 text-center text-slate-500 dark:text-slate-400">Sin productos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between items-center mt-6 pt-4 border-t kairox-border dark:border-slate-800">
             <div className="mr-auto">
               <span className="text-sm font-bold text-slate-500 mr-2 dark:text-slate-400">NUEVO TOTAL:</span>
               <span className="text-xl font-bold kairox-text-primary dark:text-white">${calculateEditTotal().toFixed(2)}</span>
             </div>
             <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsEditModalOpen(false)} disabled={isSavingEdit} className="dark:text-white dark:border-slate-700 dark:hover:bg-slate-800">Cancelar</Button>
                <Button onClick={handleSaveEdit} disabled={isSavingEdit} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {isSavingEdit ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Guardando...</> : <><Save className="mr-2 h-4 w-4"/> Guardar Cambios</>}
                </Button>
             </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

       {/* MODAL CONFIRMACIÓN LIMPIAR */}
       <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-md kairox-bg-card border border-red-200 dark:border-red-900/50 shadow-2xl dark:bg-slate-950">
          <DialogHeader><DialogTitle className="text-xl font-bold kairox-text-primary flex items-center gap-2 dark:text-white"><AlertTriangle className="h-5 w-5 text-red-500" />¿Limpiar formulario?</DialogTitle><DialogDescription className="text-slate-500 dark:text-slate-400 mt-2">Esta acción eliminará todos los productos de la lista y los datos del proveedor. <br /><br /><span className="text-red-500 dark:text-red-400 font-medium">No podrás deshacer esta acción.</span></DialogDescription></DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0"><Button variant="ghost" onClick={() => setShowClearConfirm(false)} className="text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Cancelar</Button><Button variant="destructive" onClick={handleClearAll} className="bg-red-600 hover:bg-red-700">Sí, limpiar todo</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ComprasSection;