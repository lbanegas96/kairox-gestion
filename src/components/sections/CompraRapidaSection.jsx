import { useState, useEffect, useRef, useMemo } from 'react';
import { AlertTriangle, ShoppingBag, Calendar } from 'lucide-react';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getTodayAR, getDateFromInputAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { parseNumberLocale } from '@/lib/currencyUtils';
import CompraDetailModal from '../ventas/CompraDetailModal';
import TabNuevaCompra from '../compras/TabNuevaCompra';
import TabHistorialCompras from '../compras/TabHistorialCompras';
import ModalEditarCompra from '../compras/ModalEditarCompra';

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
    forma_pago: 'Efectivo',
    centro_costo_id: ''
  });
  // Centro de costo (Fase 1 del plan de 4 frentes contables) — opcional.
  const [centrosCosto, setCentrosCosto] = useState([]);
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
      loadCentrosCosto();
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

  const loadCentrosCosto = async () => {
    const { data: emp } = await supabase
      .from('empresas').select('usa_centros_costo').eq('id', user.empresa_id).single();
    if (!emp?.usa_centros_costo) { setCentrosCosto([]); return; }
    const { data } = await supabase
      .from('centros_costo')
      .select('id, nombre')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .order('nombre');
    if (data) setCentrosCosto(data);
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
      forma_pago: 'Efectivo',
      centro_costo_id: ''
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
          centro_costo_id: purchaseForm.centro_costo_id || null,
          moneda,
          tipo_cambio_tasa: tipoCambioTasa,
          // Valor nominal fijo en moneda extranjera (Fase 3 Multimoneda —
          // diferencia de cambio realizada). Null si la compra es en ARS.
          monto_moneda_original: moneda !== 'ARS' && tipoCambioTasa > 0
            ? totalCompra / tipoCambioTasa
            : null,
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

      const providerName = proveedores.find(p => p.id === purchaseForm.proveedor_id)?.nombre || 'Proveedor';

      // Cuenta Corriente → cargo en el sub-libro del proveedor (aumenta su deuda).
      // Sin esto la compra a crédito quedaba registrada y con asiento contable, pero
      // la deuda NO aparecía en Proveedores → Cuenta Corriente (mismo patrón que
      // NuevaFacturaProveedorModal).
      if (purchaseForm.forma_pago === 'Cuenta Corriente') {
        const { error: ccErr } = await supabase.from('cuenta_corriente_proveedores').insert([{
          empresa_id:      user.empresa_id,
          user_id:         user.id,
          proveedor_id:    purchaseForm.proveedor_id,
          tipo:            'compra',
          monto:           totalCompra,
          descripcion:     `Compra ${purchaseForm.numero_factura || 'S/N'} — ${providerName}`,
          referencia_id:   newPurchase.id,
          referencia_tipo: 'compra_rapida',
          fecha:           getDateFromInputAR(purchaseForm.fecha),
        }]);
        if (ccErr) throw ccErr;
      }

      // Caja
      if (status === 'pagada') {
        const { error: cajaErr } = await supabase.from('movimientos_caja').insert([{
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
        if (cajaErr) throw cajaErr;
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
          centroCostoId: purchaseForm.centro_costo_id || null,
        }
      ).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento compra (no crítico):', e.message);
        }
      });

      toast({
        title: "¡Compra registrada correctamente! Stock actualizado.",
        className: "bg-green-600 text-white border-green-500"
      });

      setPurchaseForm({
        proveedor_id: '',
        numero_factura: '',
        fecha: getTodayAR(),
        forma_pago: 'Efectivo',
        centro_costo_id: ''
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
        const { error: stockError } = await supabase.rpc('decrement_stock', {
          p_producto_id: item.producto_id,
          p_cantidad: Number(item.cantidad),
          p_motivo: `Reversión por eliminación de ítem en edición de compra ${editForm.numero_factura || editForm.id}`
        });
        if (stockError) throw stockError;

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
          const { error: insertError } = await supabase.from('detalle_compras').insert({
            compra_id: editForm.id,
            producto_id: item.producto_id,
            cantidad: Number(item.cantidad),
            costo_unitario: parseNumberLocale(item.costo_unitario),
            subtotal: Number(item.cantidad) * parseNumberLocale(item.costo_unitario),
            empresa_id: user.empresa_id
          });
          if (insertError) {
            console.error('[Edit Compra] Error insertando ítem nuevo:', insertError);
            throw insertError;
          }
        } else {
          // Existing Item: Check for changes
          const orig = originalItems.find(o => o.id === item.id);
          if (orig) {
            const diff = Number(item.cantidad) - Number(orig.cantidad);

            // Only update stock if quantity changed
            // If new qty (15) > old qty (10), diff is +5. We add 5 to stock.
            // If new qty (5) < old qty (10), diff is -5. We subtract 5 from stock.
            if (diff !== 0) {
              if (diff > 0) {
                const { error: stockError } = await supabase.rpc('increment_stock', {
                  row_id: item.producto_id,
                  quantity: diff,
                  p_motivo: `Ajuste de cantidad por edición de compra ${editForm.numero_factura || editForm.id}`
                });
                if (stockError) throw stockError;
              } else {
                const { error: stockError } = await supabase.rpc('decrement_stock', {
                  p_producto_id: item.producto_id,
                  p_cantidad: Math.abs(diff),
                  p_motivo: `Ajuste de cantidad por edición de compra ${editForm.numero_factura || editForm.id}`
                });
                if (stockError) throw stockError;
              }
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
          <TabNuevaCompra
            purchaseForm={purchaseForm} setPurchaseForm={setPurchaseForm}
            proveedores={proveedores}
            centrosCosto={centrosCosto}
            moneda={moneda} setMoneda={setMoneda}
            tipoCambioTasa={tipoCambioTasa} setTipoCambioTasa={setTipoCambioTasa}
            tcMissing={tcMissing} setTcMissing={setTcMissing}
            tcParalelo={tcParalelo}
            setShowParaleloTCModal={setShowParaleloTCModal}
            cart={cart}
            calculateTotalUnits={calculateTotalUnits}
            calculateTotal={calculateTotal}
            searchInputRef={searchInputRef}
            productSearch={productSearch} setProductSearch={setProductSearch}
            showAutocomplete={showAutocomplete} setShowAutocomplete={setShowAutocomplete}
            handleSearchKeyDown={handleSearchKeyDown}
            filteredProducts={filteredProducts}
            getShortUnit={getShortUnit}
            addToCart={addToCart}
            updateCartItem={updateCartItem}
            removeFromCart={removeFromCart}
            isSubmitting={isSubmitting}
            setShowClearConfirm={setShowClearConfirm}
            handleRegisterPurchase={handleRegisterPurchase}
            isPurchaseValid={isPurchaseValid}
          />
        </TabsContent>

        {/* TAB: HISTORIAL */}
        <TabsContent value="historial" className="mt-0 space-y-4">
          <TabHistorialCompras
            filters={filters} setFilters={setFilters}
            activeFiltersCount={activeFiltersCount}
            clearFilters={clearFilters}
            proveedores={proveedores}
            totalPeriodo={totalPeriodo}
            filteredCompras={filteredCompras}
            loading={loading}
            tcParalelo={tcParalelo}
            compras={compras}
            paginatedCompras={paginatedCompras}
            comprasTotalPages={comprasTotalPages}
            comprasPage={comprasPage} setComprasPage={setComprasPage}
            COMPRAS_PAGE_SIZE={COMPRAS_PAGE_SIZE}
            setSelectedCompraId={setSelectedCompraId}
            setDetailsOpen={setDetailsOpen}
            handleEditClick={handleEditClick}
          />
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
      <ModalEditarCompra
        isEditModalOpen={isEditModalOpen} setIsEditModalOpen={setIsEditModalOpen}
        editForm={editForm} setEditForm={setEditForm}
        proveedores={proveedores}
        editSearchInputRef={editSearchInputRef}
        editSearch={editSearch} setEditSearch={setEditSearch}
        showEditAutocomplete={showEditAutocomplete} setShowEditAutocomplete={setShowEditAutocomplete}
        filteredEditProducts={filteredEditProducts}
        addProductToEdit={addProductToEdit}
        editItems={editItems}
        updateEditItem={updateEditItem}
        removeEditItem={removeEditItem}
        calculateEditTotal={calculateEditTotal}
        isSavingEdit={isSavingEdit}
        handleSaveEdit={handleSaveEdit}
      />

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