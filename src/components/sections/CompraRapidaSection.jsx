import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Calendar, Filter, Eye, ShoppingBag, Search, Eraser, PackageOpen, X, FileText, User, Clock, Loader2, Trash2, AlertTriangle, Edit, Save, Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';
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
import { getTodayAR, getDateFromInputAR, formatDateAR, formatTimeAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { formatCurrency, parseNumberLocale } from '@/lib/currencyUtils';
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
  const [comprasPage, setComprasPage] = useState(1);
  const COMPRAS_PAGE_SIZE = 50;
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

  // Moneda y TC obligatorio
  const [moneda, setMoneda] = useState('ARS');
  const [tipoCambioTasa, setTipoCambioTasa] = useState(1);
  const [tcMissing, setTcMissing] = useState(false);
  const tcParalelo = useTCParalelo();
  const [showParaleloTCModal, setShowParaleloTCModal] = useState(false);

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
      .eq('empresa_id', user.empresa_id)
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
        .eq('empresa_id', user.empresa_id)
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

  // Reset page when filters change
  useEffect(() => { setComprasPage(1); }, [filters]);

  const comprasTotalPages = Math.max(1, Math.ceil(filteredCompras.length / COMPRAS_PAGE_SIZE));
  const paginatedCompras = filteredCompras.slice((comprasPage - 1) * COMPRAS_PAGE_SIZE, comprasPage * COMPRAS_PAGE_SIZE);

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
        if (field === 'costo_unitario') {
          return { ...item, costo_unitario: value };
        }
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
      const cost = parseNumberLocale(item.costo_unitario) || 0;
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
    setMoneda('ARS');
    setTipoCambioTasa(1);
    setTcMissing(false);
    setShowClearConfirm(false);
    toast({ title: "Formulario limpiado" });
  };

  const isPurchaseValid = () => {
    return (
      purchaseForm.proveedor_id &&
      cart.length > 0 &&
      cart.every(item => item.cantidad > 0 && (parseNumberLocale(item.costo_unitario) || 0) >= 0)
    );
  };

  const handleRegisterPurchase = async () => {
    // Regla: solo movimientos de Efectivo requieren caja abierta. Transferencia/Tarjeta/CC no.
    const esEfectivo = purchaseForm.forma_pago === 'Efectivo';
    if (!isSessionOpen && esEfectivo) {
      toast({
        variant: 'destructive',
        title: 'Caja cerrada',
        description: 'Abrí la caja para registrar compras en efectivo. Podés usar Transferencia, Tarjeta o Cuenta Corriente sin abrir la caja.'
      });
      return;
    }

    if (!isPurchaseValid()) return;
    setIsSubmitting(true);

    try {
      const totalCompra = calculateTotal();
      const status = purchaseForm.forma_pago === 'Cuenta Corriente' ? 'pendiente' : 'pagada';

      // Moneda paralela
      const montoParaleloValue = tcParalelo.enabled && tcParalelo.tcHoy
        ? tcParalelo.calcParalelo(totalCompra, moneda, tipoCambioTasa)
        : null;
      const tcParaleloValue = tcParalelo.enabled && montoParaleloValue !== null
        ? (moneda === tcParalelo.monedaParalela ? tipoCambioTasa : tcParalelo.tcHoy)
        : null;

      const { data: newPurchase, error: purchaseError } = await supabase
        .from('compras')
        .insert([{
          user_id: user.id,
          empresa_id: user.empresa_id,
          fecha: getDateFromInputAR(purchaseForm.fecha),
          proveedor_id: purchaseForm.proveedor_id,
          numero_factura: purchaseForm.numero_factura || 'S/N',
          total: totalCompra,
          forma_pago: purchaseForm.forma_pago,
          estado_pago: status,
          moneda,
          tipo_cambio_tasa: tipoCambioTasa,
          ...(montoParaleloValue !== null ? {
            monto_paralelo: montoParaleloValue,
            tc_paralelo: tcParaleloValue,
          } : {}),
        }])
        .select()
        .single();

      if (purchaseError) throw purchaseError;

      const purchaseItems = cart.map(item => ({
        compra_id: newPurchase.id,
        empresa_id: user.empresa_id,
        producto_id: item.id,
        cantidad: parseInt(item.cantidad),
        costo_unitario: parseNumberLocale(item.costo_unitario),
        subtotal: parseInt(item.cantidad) * parseNumberLocale(item.costo_unitario)
      }));

      const { error: detailsError } = await supabase
        .from('detalle_compras')
        .insert(purchaseItems);

      if (detailsError) throw detailsError;

      // No bloqueante — solo documental (recepción implícita para Compra Rápida)
      try {
        await supabase.rpc('crear_recepcion_implicita', {
          p_empresa_id: user.empresa_id,
          p_user_id:    user.id,
          p_compra_id:  newPurchase.id,
        });
      } catch (err) {
        console.error('Error al generar recepción implícita:', err);
      }

      // Update Stock + Costo (Create Mode: Always Add)
      // aplicar_compra_producto centraliza el cálculo del nuevo costo según
      // empresas.metodo_valoracion_stock (último costo o promedio ponderado).
      // Se intentan TODOS los ítems (para minimizar la brecha si uno falla) y se
      // acumulan los errores; si hubo alguno, se corta el flujo ANTES de la caja y
      // del toast de éxito — el stock NO puede quedar "actualizado" en silencio.
      // (Fix sesión 33: antes era `console.error` que tragaba el error y reportaba
      // éxito aunque el stock no se moviera.)
      const stockErrors = [];
      for (const item of cart) {
        const { error: aplicarError } = await supabase.rpc('aplicar_compra_producto', {
          p_producto_id: item.id,
          p_cantidad: parseInt(item.cantidad),
          p_costo_nuevo: parseNumberLocale(item.costo_unitario),
        });
        if (aplicarError) {
          console.error('Error al aplicar compra al producto:', aplicarError);
          stockErrors.push(item.nombre || item.codigo_sku || item.id);
        }
      }
      if (stockErrors.length > 0) {
        throw new Error(
          `La compra quedó registrada pero NO se pudo actualizar el stock de: ${stockErrors.join(', ')}. ` +
          `Revisá el stock de esos productos manualmente antes de seguir operando.`
        );
      }

      // Caja
      const providerName = proveedores.find(p => p.id === purchaseForm.proveedor_id)?.nombre || 'Proveedor';
      if (status === 'pagada') {
        await supabase.from('movimientos_caja').insert([{
          user_id: user.id,
          empresa_id: user.empresa_id,
          caja_sesion_id: currentSession?.id,
          fecha: getDateFromInputAR(purchaseForm.fecha),
          tipo: 'egreso',
          categoria: 'Compra',
          concepto: `Compra a ${providerName} (${purchaseForm.forma_pago})`,
          monto: totalCompra,
          metodo_pago: purchaseForm.forma_pago,
          is_automatic: true
        }]);
      }

      // Asiento contable automático (no bloquea el flujo de compras)
      asientosAutoService.crearAsientoCompra(
        user.empresa_id,
        user.id,
        {
          compraId: newPurchase.id,
          total: totalCompra,
          fecha: purchaseForm.fecha || getTodayAR(),
          descripcion: `Compra a ${providerName} - Fac. ${purchaseForm.numero_factura || 'S/N'}`,
          esCredito: purchaseForm.forma_pago === 'Cuenta Corriente',
        }
      ).catch(e => console.warn('[Contabilidad] Asiento compra (no crítico):', e.message));

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
      setMoneda('ARS');
      setTipoCambioTasa(1);
      setTcMissing(false);

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
        if (field === 'costo_unitario') {
          return { ...item, costo_unitario: value };
        }
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
      return sum + ((Number(item.cantidad) || 0) * (parseNumberLocale(item.costo_unitario) || 0));
    }, 0);
  };

  const handleSaveEdit = async () => {
    setIsSavingEdit(true);
    try {
      // Bajo Promedio Ponderado, el costo de un ítem ya registrado quedó mezclado
      // con el costo previo en el momento de la compra original — no hay forma no
      // ambigua de "revertir" ese promedio sin rejugar todas las operaciones de
      // stock que pasaron desde entonces. Por eso, en ese modo bloqueamos el cambio
      // de cantidad/costo en ítems PREEXISTENTES (no en altas ni bajas, que solo
      // mueven stock sin tocar costo_compra). Sugerimos un ajuste de stock manual.
      const { data: empresaData } = await supabase
        .from('empresas')
        .select('metodo_valoracion_stock')
        .eq('id', user.empresa_id)
        .single();
      const metodoValoracion = empresaData?.metodo_valoracion_stock ?? 'ultimo_costo';

      if (metodoValoracion === 'promedio_ponderado') {
        const itemsBloqueados = editItems.filter(item => {
          if (item.is_new) return false;
          const orig = originalItems.find(o => o.id === item.id);
          if (!orig) return false;
          const cantidadCambio = Number(item.cantidad) !== Number(orig.cantidad);
          const costoCambio = parseNumberLocale(item.costo_unitario) !== parseNumberLocale(orig.costo_unitario);
          return cantidadCambio || costoCambio;
        });

        if (itemsBloqueados.length > 0) {
          toast({
            title: "No se puede editar cantidad/costo con Promedio Ponderado activo",
            description: `${itemsBloqueados.map(i => i.nombre).join(', ')}: revertí el cambio o usá un ajuste de stock manual desde Productos. El promedio ya quedó aplicado al registrar esta compra y no se puede recalcular en forma retroactiva.`,
            variant: "destructive",
          });
          setIsSavingEdit(false);
          return;
        }
      }

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
        const { error: revError } = await supabase.rpc('increment_stock', {
          row_id: item.producto_id,
          quantity: -Number(item.cantidad),
          p_motivo: `Reversión por eliminación de ítem en edición de compra ${editForm.numero_factura || editForm.id}`
        });
        if (revError) throw revError;

        // Delete record
        await supabase.from('detalle_compras').delete().eq('id', item.id);
      }

      // B. New & Modified Items
      for (const item of editItems) {
        if (item.is_new) {
          // Ítem agregado durante la edición = una compra nueva en los hechos.
          // Respeta metodo_valoracion_stock igual que el flujo "Nueva Compra".
          const { error: aplicarError } = await supabase.rpc('aplicar_compra_producto', {
            p_producto_id: item.producto_id,
            p_cantidad: Number(item.cantidad),
            p_costo_nuevo: parseNumberLocale(item.costo_unitario),
          });
          if (aplicarError) throw aplicarError;

          // Insert record
          await supabase.from('detalle_compras').insert({
            compra_id: editForm.id,
            producto_id: item.producto_id,
            cantidad: Number(item.cantidad),
            costo_unitario: parseNumberLocale(item.costo_unitario),
            subtotal: Number(item.cantidad) * parseNumberLocale(item.costo_unitario)
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
              const { error: incError } = await supabase.rpc('increment_stock', {
                row_id: item.producto_id,
                quantity: diff,
                p_motivo: `Ajuste de cantidad por edición de compra ${editForm.numero_factura || editForm.id}`
              });
              if (incError) throw incError;
            }

            // Always update record in case cost changed
            await supabase.from('detalle_compras').update({
              cantidad: Number(item.cantidad),
              costo_unitario: parseNumberLocale(item.costo_unitario),
              subtotal: Number(item.cantidad) * parseNumberLocale(item.costo_unitario)
            }).eq('id', item.id);

            // Costo "último costo" — seguro también bajo PPP, porque la validación de
            // arriba ya garantiza que cantidad/costo no cambiaron para este ítem en ese modo.
            await supabase.from('productos')
              .update({ costo_compra: parseNumberLocale(item.costo_unitario) })
              .eq('id', item.producto_id);
          }
        }
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
      <div className="flex justify-between items-center bg-kx-surface dark:bg-transparent p-6 -mx-6 -mt-6 mb-6 border-b border-kx-border dark:border-kx-border">
        <div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-kx-text mb-1">Gestión de Compras</h2>
          <p className="text-slate-500 dark:text-kx-text-2">Registro y control de compras a proveedores</p>
        </div>
        {!isSessionOpen && (
           <div className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-4 py-2 rounded-lg flex items-center gap-2 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-bold">CAJA CERRADA: Efectivo no disponible. Podés comprar con Transferencia, Tarjeta o Cuenta Corriente.</span>
           </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-transparent p-0 gap-2 mb-4 w-full flex justify-start">
          <TabsTrigger value="nueva" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><ShoppingBag className="w-4 h-4 mr-2"/> Nueva Compra</TabsTrigger>
          <TabsTrigger value="historial" className="data-[state=active]:bg-blue-500 dark:data-[state=active]:bg-[#00D4FF] data-[state=active]:text-white dark:data-[state=active]:text-black bg-slate-100 dark:bg-kx-surface dark:text-kx-text-2 hover:bg-slate-200 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-white rounded-md px-4 py-2"><Calendar className="w-4 h-4 mr-2"/> Historial de Compras</TabsTrigger>
        </TabsList>

        {/* TAB: NUEVA COMPRA */}
        <TabsContent value="nueva" className="mt-0 space-y-4">
          <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm dark:bg-kx-bg dark:border-kx-border">
            <h3 className="text-lg font-bold text-blue-800 dark:text-[#00D4FF] flex items-center gap-2 mb-4"><ShoppingBag className="h-5 w-5" /> DATOS DE COMPRA</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="space-y-2"><Label className="dark:text-kx-text">Proveedor <span className="text-red-500">*</span></Label><div className="relative"><select className="w-full h-10 rounded-md bg-kx-surface dark:bg-kx-surface border border-slate-300 dark:border-kx-border text-slate-900 dark:text-kx-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-[#00D4FF]" value={purchaseForm.proveedor_id} onChange={e => setPurchaseForm({...purchaseForm, proveedor_id: e.target.value})}><option value="">Seleccione Proveedor...</option>{proveedores.map(p => (<option key={p.id} value={p.id}>{p.nombre}</option>))}</select></div></div>
              <div className="space-y-2"><Label className="dark:text-kx-text">N° Factura / Referencia</Label><Input value={purchaseForm.numero_factura} onChange={e => setPurchaseForm({...purchaseForm, numero_factura: e.target.value})} placeholder="Ej: F-001-2304" className="kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/></div>
              <div className="space-y-2"><Label className="dark:text-kx-text">Fecha de Compra</Label><div className="relative"><Calendar className="absolute left-3 top-2.5 h-4 w-4 text-slate-500"/><Input type="date" value={purchaseForm.fecha} onChange={e => setPurchaseForm({...purchaseForm, fecha: e.target.value})} className="pl-9 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/></div></div>
              <div className="space-y-2"><Label className="dark:text-kx-text">Forma de Pago</Label><select className="w-full h-10 rounded-md bg-kx-surface dark:bg-kx-surface border border-slate-300 dark:border-kx-border text-slate-900 dark:text-kx-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={purchaseForm.forma_pago} onChange={e => setPurchaseForm({...purchaseForm, forma_pago: e.target.value})}><option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Cuenta Corriente">Cuenta Corriente</option></select></div>
              <div className="col-span-1 md:col-span-2">
                <MonedaSelector
                  moneda={moneda}
                  tasa={tipoCambioTasa}
                  onMonedaChange={v => {
                    setMoneda(v);
                    if (v === 'ARS') { setTipoCambioTasa(1); setTcMissing(false); }
                  }}
                  onTasaChange={v => setTipoCambioTasa(v)}
                  onTCMissingChange={setTcMissing}
                />
                {/* Banner de paridad: visible cuando la empresa usa moneda paralela y la operación es en ARS */}
                {tcParalelo.enabled && moneda === 'ARS' && !tcParalelo.loading && (
                  <div className="mt-2">
                    {tcParalelo.tcMissing ? (
                      <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>Sin TC de paridad {tcParalelo.monedaParalela} del día</span>
                        <Button type="button" size="sm" variant="outline"
                          className="ml-auto h-6 text-xs px-2 border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                          onClick={() => setShowParaleloTCModal(true)}>
                          Cargar TC
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                        <Check className="h-3.5 w-3.5 flex-shrink-0" />
                        Paridad {tcParalelo.monedaParalela}: 1 {tcParalelo.monedaParalela} = ${Number(tcParalelo.tcHoy || 0).toLocaleString('es-AR')} ARS
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="kairox-bg-card border kairox-border p-6 rounded-xl flex flex-col relative min-h-[400px] shadow-sm dark:bg-kx-bg dark:border-kx-border">
            <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-blue-800 dark:text-[#00D4FF] flex items-center gap-2"><PackageOpen className="h-5 w-5" /> PRODUCTOS</h3>{cart.length > 0 && (<div className="bg-slate-100 dark:bg-kx-surface-2 kairox-text-primary text-xs px-3 py-1 rounded-full border kairox-border font-medium shadow-sm dark:text-slate-300 dark:border-kx-border">{cart.length} filas | {calculateTotalUnits()} unidades</div>)}</div>
            <div className="relative mb-4 z-20"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" /><Input ref={searchInputRef} placeholder="Buscar producto por nombre o SKU..." value={productSearch} onChange={e => {setProductSearch(e.target.value); setShowAutocomplete(true);}} onKeyDown={handleSearchKeyDown} onFocus={() => setShowAutocomplete(true)} className="pl-9 focus:border-blue-500 dark:focus:border-[#00D4FF] kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/>{showAutocomplete && (<div className="absolute top-full left-0 w-full kairox-bg-card border kairox-border rounded-md mt-1 shadow-xl max-h-60 overflow-y-auto dark:bg-kx-bg dark:border-kx-border">{filteredProducts.length === 0 ? (<div className="p-3 text-slate-500 text-sm text-center">No se encontraron productos</div>) : (filteredProducts.slice(0, 30).map(p => {const shortUnit = getShortUnit(p.unidad_medida); return (<div key={p.id} className="p-3 flex justify-between items-center border-b kairox-border last:border-0 hover:bg-kx-surface-2 dark:hover:bg-slate-800 cursor-pointer transition-colors dark:border-kx-border" onClick={() => addToCart(p)}><div><div className="font-medium kairox-text-primary dark:text-kx-text">{p.nombre}</div><div className="text-xs text-slate-500 dark:text-kx-text-2">{p.codigo_sku} | {p.unidad_medida || 'Unidad'}</div></div><div className="text-right text-kx-text-2 dark:text-kx-text-2 text-xs">Costo Actual: ${p.costo_compra?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}<div className="text-slate-500 dark:text-kx-text-3">Stock: {p.stock_actual} {shortUnit}</div></div></div>)}))}</div>)}{showAutocomplete && (<div className="fixed inset-0 z-[-1]" onClick={() => setShowAutocomplete(false)}></div>)}</div>
            <div className="border kairox-border rounded-lg overflow-hidden bg-slate-50/50 dark:bg-slate-950/30 flex-grow dark:border-kx-border">
              <table className="w-full text-sm text-left"><thead className="kairox-table-header border-b kairox-border dark:bg-slate-900/50 dark:text-slate-300 dark:border-kx-border"><tr><th className="p-4">Producto</th><th className="p-4 text-center w-32">Cantidad</th><th className="p-4 text-right w-40">Costo Unit. ($)</th><th className="p-4 text-right">Subtotal</th><th className="p-4 w-16 text-center">Acción</th></tr></thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">{cart.length === 0 ? (<tr><td colSpan="5" className="p-12 text-center text-slate-500 dark:text-kx-text-2"><ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-20"/>Agrega productos a la compra usando el buscador</td></tr>) : (cart.map(item => (<tr key={item.cartItemId} className="group hover:bg-slate-100 dark:hover:bg-slate-900/50"><td className="p-4 font-medium kairox-text-primary dark:text-kx-text">{item.nombre}<div className="text-xs text-slate-500 dark:text-kx-text-2 font-mono flex items-center gap-1">{item.codigo_sku}<span className="text-kx-text-3 dark:text-kx-text-2">|</span>{getShortUnit(item.unidad_medida)}</div></td><td className="p-4 text-center"><Input type="number" min="1" value={item.cantidad} onChange={(e) => updateCartItem(item.cartItemId, 'cantidad', e.target.value)} className="w-24 mx-auto text-center h-8 focus:bg-kx-surface dark:focus:bg-slate-700 kairox-input dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"/></td><td className="p-4 text-right"><Input type="text" inputMode="decimal" placeholder="0,00" value={item.costo_unitario} onChange={(e) => updateCartItem(item.cartItemId, 'costo_unitario', e.target.value)} className="w-32 ml-auto text-right h-8 focus:bg-kx-surface dark:focus:bg-slate-700 kairox-input dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"/></td><td className="p-4 text-right font-bold kairox-text-primary dark:text-emerald-400">${((Number(item.cantidad) || 0) * (parseNumberLocale(item.costo_unitario) || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td><td className="p-4 text-center"><Button size="icon" variant="ghost" onClick={() => removeFromCart(item.cartItemId)} className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"><X className="h-4 w-4" /></Button></td></tr>)))}</tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 justify-end items-center pt-4">
            <div className="kairox-bg-card border kairox-border rounded-xl p-6 flex items-center gap-6 shadow-lg w-full md:w-auto justify-between md:justify-start dark:bg-kx-bg dark:border-kx-border">
              <div className="text-right">
                <div className="text-slate-500 dark:text-kx-text-2 text-sm font-medium uppercase tracking-wider">Total de Compra</div>
                <div className="text-3xl font-black bg-gradient-to-r from-blue-600 to-purple-600 dark:from-[#00D4FF] dark:to-[#A855F7] bg-clip-text text-transparent font-mono">${calculateTotal().toLocaleString('es-AR', { minimumFractionDigits: 2 })}</div>
                {tcParalelo.enabled && tcParalelo.tcHoy && calculateTotal() > 0 && (
                  <p className="text-xs text-kx-text-3 mt-0.5">
                    ≈ {tcParalelo.calcParalelo(calculateTotal(), moneda, tipoCambioTasa)?.toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
                  </p>
                )}
              </div>
              <div className="h-12 w-px bg-slate-200 dark:bg-slate-700 mx-2 hidden md:block"></div>
              <div className="flex gap-2 w-full md:w-auto">
                 <Button variant="destructive" onClick={() => setShowClearConfirm(true)} className="h-14 px-4 bg-red-100 hover:bg-red-200 text-red-600 border border-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 dark:text-red-400 dark:border-red-900/50 w-full md:w-auto" disabled={isSubmitting || cart.length === 0}><Trash2 className="w-5 h-5" /></Button>
                <div className="flex flex-col items-end gap-1 w-full md:w-auto">
                  <Button
                    onClick={handleRegisterPurchase}
                    disabled={!isPurchaseValid() || isSubmitting || (moneda !== 'ARS' && tcMissing)}
                    className="h-14 px-8 text-lg font-bold text-white shadow-lg border-0 transition-all w-full md:w-auto bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-700 hover:to-violet-700 shadow-blue-900/20 hover:scale-105 dark:from-[#00D4FF] dark:to-[#A855F7]"
                  >
                    {isSubmitting ? 'REGISTRANDO...' : 'REGISTRAR COMPRA'}
                  </Button>
                  {moneda !== 'ARS' && tcMissing && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      ⚠ Cargá el TC del día para registrar la compra
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* TAB: HISTORIAL */}
        <TabsContent value="historial" className="mt-0 space-y-4">
          
          {/* ADVANCED FILTERS */}
          <div className="bg-kx-surface dark:bg-kx-surface p-5 rounded-xl border kairox-border shadow-sm space-y-4 dark:border-kx-border">
            <div className="flex justify-between items-center mb-2">
               <h3 className="font-semibold text-slate-700 dark:text-kx-text flex items-center gap-2">
                 <Filter className="h-4 w-4" /> Filtros Avanzados
                 {activeFiltersCount > 0 && <Badge variant="secondary" className="ml-1 px-1.5 h-5 min-w-[20px] dark:bg-kx-surface-2 dark:text-slate-300">{activeFiltersCount}</Badge>}
               </h3>
               {activeFiltersCount > 0 && (
                 <Button variant="ghost" size="sm" onClick={clearFilters} className="h-8 text-xs text-slate-500 hover:text-red-500 dark:text-kx-text-2 dark:hover:text-red-400">
                   <X className="h-3 w-3 mr-1" /> Limpiar filtros
                 </Button>
               )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Desde</Label>
                 <Input type="date" value={filters.dateStart} onChange={e => setFilters({...filters, dateStart: e.target.value})} className="h-9 kairox-input text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Hasta</Label>
                 <Input type="date" value={filters.dateEnd} onChange={e => setFilters({...filters, dateEnd: e.target.value})} className="h-9 kairox-input text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              </div>
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Proveedor</Label>
                 <select 
                   className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
                   value={filters.proveedorId}
                   onChange={e => setFilters({...filters, proveedorId: e.target.value})}
                 >
                   <option value="Todos">Todos</option>
                   {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                 </select>
              </div>
              <div className="space-y-1">
                 <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Forma de Pago</Label>
                 <select 
                   className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
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
                 <Label className="text-xs text-slate-500 font-medium dark:text-kx-text-2">Estado</Label>
                 <select 
                   className="w-full h-9 rounded-md border border-slate-300 dark:border-kx-border bg-transparent px-3 text-sm dark:bg-kx-surface dark:text-kx-text"
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
                    <p className="text-sm text-slate-500 dark:text-kx-text-2 font-medium">Compras Filtradas</p>
                    <p className="text-2xl font-bold text-kx-text dark:text-kx-text">{filteredCompras.length}</p>
                  </div>
                </div>
                <div className="text-center sm:text-right border-t sm:border-t-0 sm:border-l border-blue-200 dark:border-kx-border pt-4 sm:pt-0 sm:pl-8 w-full sm:w-auto">
                   <p className="text-sm text-slate-500 dark:text-kx-text-2 font-medium uppercase tracking-wider mb-1">Total Comprado</p>
                   <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tabular-nums">
                     ${totalPeriodo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                   </p>
                </div>
             </div>
          </Card>

          {/* TABLE */}
          <div className="kairox-bg-card border kairox-border rounded-xl overflow-hidden shadow-sm dark:bg-kx-bg dark:border-kx-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-kx-surface-2 dark:bg-slate-900/50 border-b kairox-border text-xs uppercase font-semibold text-slate-500 dark:text-kx-text-2">
                  <tr>
                    <th className="p-4 w-40">Fecha</th>
                    <th className="p-4 w-32">N° Factura</th>
                    <th className="p-4">Proveedor</th>
                    <th className="p-4 w-32">Forma Pago</th>
                    <th className="p-4 w-28 text-center">Estado</th>
                    <th className="p-4 w-32 text-right">Total</th>
                    {tcParalelo.enabled && (
                      <th className="p-4 w-28 text-right text-kx-text-2">{tcParalelo.monedaParalela}</th>
                    )}
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
                        {tcParalelo.enabled && <td className="p-4"><Skeleton className="h-4 w-16 ml-auto" /></td>}
                        <td className="p-4"><Skeleton className="h-8 w-8 mx-auto" /></td>
                      </tr>
                    ))
                  ) : filteredCompras.length === 0 ? (
                    <tr>
                      <td colSpan={tcParalelo.enabled ? 8 : 7} className="p-12 text-center text-slate-500 bg-slate-50/50 dark:bg-slate-900/20 dark:text-kx-text-2">
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
                    paginatedCompras.map(compra => (
                      <tr key={compra.id} className="group hover:bg-blue-50/50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => { setSelectedCompraId(compra.id); setDetailsOpen(true); }}>
                        <td className="p-4 text-kx-text-2 dark:text-slate-300 font-mono text-xs">
                          {formatDateAR(compra.fecha)} <span className="text-kx-text-3 ml-1">{formatTimeAR(compra.fecha)}</span>
                        </td>
                        <td className="p-4 text-slate-500 font-mono text-xs font-medium dark:text-kx-text-2">
                          {compra.numero_factura}
                        </td>
                        <td className="p-4 font-medium text-kx-text dark:text-kx-text">
                          {compra.proveedores?.nombre || '---'}
                        </td>
                        <td className="p-4 text-kx-text-2 dark:text-kx-text-2 text-xs font-medium uppercase tracking-wide">
                          {compra.forma_pago}
                        </td>
                        <td className="p-4 text-center">
                          <EstadoBadge estado={compra.estado_pago} />
                        </td>
                        <td className="p-4 text-right font-bold text-slate-700 dark:text-kx-text group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                          {formatCurrency(compra.total, compra.moneda ?? 'ARS')}
                          {compra.moneda && compra.moneda !== 'ARS' && (
                            <span className="text-xs text-kx-text-3 dark:text-kx-text-3 ml-1 font-normal">
                              (TC: {compra.tipo_cambio_tasa})
                            </span>
                          )}
                        </td>
                        {tcParalelo.enabled && (
                          <td className="p-4 text-right text-xs text-kx-text-2 tabular-nums">
                            {(() => {
                              if (compra.monto_paralelo) {
                                return `≈ ${Number(compra.monto_paralelo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
                              }
                              const calc = tcParalelo.calcParalelo(Number(compra.total), compra.moneda ?? 'ARS', Number(compra.tipo_cambio_tasa) || 1);
                              return calc !== null ? `≈ ${calc.toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '—';
                            })()}
                          </td>
                        )}
                        <td className="p-4 text-center">
                          <div className="flex justify-center gap-1">
                             <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-kx-text-3 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-full">
                               <Eye className="h-4 w-4" />
                             </Button>
                             <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-kx-text-3 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-full" onClick={(e) => handleEditClick(compra, e)}>
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
          {/* PAGINATION */}
          {comprasTotalPages > 1 && (
            <div className="flex items-center justify-between px-2 pt-2">
              <p className="text-sm text-slate-500 dark:text-kx-text-2">
                Mostrando {(comprasPage - 1) * COMPRAS_PAGE_SIZE + 1}–{Math.min(comprasPage * COMPRAS_PAGE_SIZE, filteredCompras.length)} de {filteredCompras.length} compras
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setComprasPage(p => Math.max(1, p - 1))} disabled={comprasPage === 1} className="h-8 w-8 p-0">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: comprasTotalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === comprasTotalPages || Math.abs(p - comprasPage) <= 1)
                  .reduce((acc, p, idx, arr) => { if (idx > 0 && arr[idx - 1] !== p - 1) acc.push('...'); acc.push(p); return acc; }, [])
                  .map((item, idx) =>
                    item === '...' ? <span key={`e-${idx}`} className="px-2 text-kx-text-3">…</span> :
                    <Button key={item} variant={comprasPage === item ? "default" : "outline"} size="sm" onClick={() => setComprasPage(item)} className="h-8 w-8 p-0">{item}</Button>
                  )}
                <Button variant="outline" size="sm" onClick={() => setComprasPage(p => Math.min(comprasTotalPages, p + 1))} disabled={comprasPage === comprasTotalPages} className="h-8 w-8 p-0">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
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
        <DialogContent className="max-w-4xl kairox-bg-card border kairox-border kairox-text-primary shadow-2xl max-h-[90vh] overflow-y-auto dark:bg-kx-bg dark:border-kx-border">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-blue-800 dark:text-[#00D4FF] flex items-center gap-2 mb-2">
              <Edit className="h-6 w-6" />Editar Compra
            </DialogTitle>
            <DialogDescription className="dark:text-kx-text-2">
              Modifique los detalles de la compra. El stock se ajustará automáticamente según los cambios.
            </DialogDescription>
          </DialogHeader>

          {editForm && (
            <div className="space-y-6">
              {/* Header Info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg border kairox-border bg-kx-surface-2 dark:bg-slate-900/30 dark:border-kx-border">
                <div className="space-y-2">
                  <Label className="dark:text-kx-text">Proveedor</Label>
                  <select 
                    className="w-full h-9 rounded-md kairox-input px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-[#00D4FF] dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" 
                    value={editForm.proveedor_id} 
                    onChange={e => setEditForm({...editForm, proveedor_id: e.target.value})}
                  >
                    <option value="">Seleccione...</option>
                    {proveedores.map(p => (<option key={p.id} value={p.id}>{p.nombre}</option>))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-kx-text">N° Factura</Label>
                  <Input 
                    value={editForm.numero_factura} 
                    onChange={e => setEditForm({...editForm, numero_factura: e.target.value})} 
                    className="h-9 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="dark:text-kx-text">Fecha</Label>
                  <Input 
                    type="date" 
                    value={editForm.fecha} 
                    onChange={e => setEditForm({...editForm, fecha: e.target.value})} 
                    className="h-9 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                  />
                </div>
              </div>

              {/* Add Product Section for Edit */}
              <div className="relative z-20">
                <Label className="mb-2 block dark:text-kx-text">Agregar Producto</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
                  <Input 
                    ref={editSearchInputRef} 
                    placeholder="Buscar para agregar..." 
                    value={editSearch} 
                    onChange={e => {setEditSearch(e.target.value); setShowEditAutocomplete(true);}} 
                    onFocus={() => setShowEditAutocomplete(true)} 
                    className="pl-9 h-9 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                  />
                  {showEditAutocomplete && editSearch && (
                    <div className="absolute top-full left-0 w-full kairox-bg-card border kairox-border rounded-md mt-1 shadow-xl max-h-60 overflow-y-auto dark:bg-kx-bg dark:border-kx-border">
                      {filteredEditProducts.length === 0 ? (
                        <div className="p-3 text-slate-500 text-sm text-center">No se encontraron productos</div>
                      ) : (
                        filteredEditProducts.map(p => (
                          <div 
                            key={p.id} 
                            className="p-2 flex justify-between items-center border-b kairox-border hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer dark:border-kx-border" 
                            onClick={() => addProductToEdit(p)}
                          >
                            <span className="font-medium text-sm dark:text-kx-text">{p.nombre}</span>
                            <span className="text-xs text-slate-500 dark:text-kx-text-2">Stock: {p.stock_actual}</span>
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
              <div className="border kairox-border rounded-lg overflow-hidden dark:border-kx-border">
                <table className="w-full text-sm text-left">
                  <thead className="kairox-table-header font-medium border-b kairox-border dark:bg-slate-900/50 dark:text-slate-300 dark:border-kx-border">
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
                      <tr key={item.internalId} className="hover:bg-kx-surface-2 dark:hover:bg-slate-900/50">
                        <td className="p-3 pl-4">
                          <div className="font-medium kairox-text-primary dark:text-kx-text">{item.nombre}</div>
                          {item.is_new && <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800">NUEVO</span>}
                        </td>
                        <td className="p-3 text-center">
                          <Input 
                            type="number" 
                            min="1" 
                            value={item.cantidad} 
                            onChange={(e) => updateEditItem(item.internalId, 'cantidad', e.target.value)}
                            className="h-8 text-center kairox-input dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"
                          />
                        </td>
                        <td className="p-3 text-right">
                          <Input
                            type="text"
                            inputMode="decimal"
                            placeholder="0,00"
                            value={item.costo_unitario}
                            onChange={(e) => updateEditItem(item.internalId, 'costo_unitario', e.target.value)}
                            className="h-8 text-right kairox-input dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"
                          />
                        </td>
                        <td className="p-3 text-right font-medium dark:text-kx-text">
                          ${((Number(item.cantidad) || 0) * (parseNumberLocale(item.costo_unitario) || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
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
                      <tr><td colSpan="5" className="p-6 text-center text-slate-500 dark:text-kx-text-2">Sin productos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <DialogFooter className="flex justify-between items-center mt-6 pt-4 border-t kairox-border dark:border-kx-border">
             <div className="mr-auto">
               <span className="text-sm font-bold text-slate-500 mr-2 dark:text-kx-text-2">NUEVO TOTAL:</span>
               <span className="text-xl font-bold kairox-text-primary dark:text-kx-text">${calculateEditTotal().toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
             </div>
             <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsEditModalOpen(false)} disabled={isSavingEdit} className="dark:text-kx-text dark:border-kx-border dark:hover:bg-slate-800">Cancelar</Button>
                <Button onClick={handleSaveEdit} disabled={isSavingEdit} className="bg-blue-600 hover:bg-blue-700 text-white">
                  {isSavingEdit ? <><Loader2 className="mr-2 h-4 w-4 animate-spin"/> Guardando...</> : <><Save className="mr-2 h-4 w-4"/> Guardar Cambios</>}
                </Button>
             </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

       {/* MODAL CONFIRMACIÓN LIMPIAR */}
       <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-md kairox-bg-card border border-red-200 dark:border-red-900/50 shadow-2xl dark:bg-kx-bg">
          <DialogHeader><DialogTitle className="text-xl font-bold kairox-text-primary flex items-center gap-2 dark:text-kx-text"><AlertTriangle className="h-5 w-5 text-red-500" />¿Limpiar formulario?</DialogTitle><DialogDescription className="text-slate-500 dark:text-kx-text-2 mt-2">Esta acción eliminará todos los productos de la lista y los datos del proveedor. <br /><br /><span className="text-red-500 dark:text-red-400 font-medium">No podrás deshacer esta acción.</span></DialogDescription></DialogHeader>
          <DialogFooter className="mt-4 gap-2 sm:gap-0"><Button variant="ghost" onClick={() => setShowClearConfirm(false)} className="text-kx-text-2 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Cancelar</Button><Button variant="destructive" onClick={handleClearAll} className="bg-red-600 hover:bg-red-700">Sí, limpiar todo</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <TipoCambioModal
        open={showParaleloTCModal}
        onOpenChange={setShowParaleloTCModal}
        moneda={tcParalelo.monedaParalela}
        onConfirm={(t) => { tcParalelo.setTC(t); setShowParaleloTCModal(false); }}
      />
    </div>
  );
}

export default ComprasSection;