import { useState, useEffect, useRef, useMemo } from 'react';
import { ShoppingCart } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { getNowAR, getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import { precioPackFinal } from '@/lib/unidadesMedida';
import ComprobantePrintModal from './ComprobantePrintModal';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { useMultipago } from '@/hooks/useMultipago';
import { useCreditoCliente } from '@/hooks/useCreditoCliente';
import { listaPreciosService } from '@/services/listaPreciosService';
import { useAfipConfig } from '@/hooks/useAfipConfig';
import PanelCarrito from '@/components/ventas/nueva-venta/PanelCarrito';
import PanelPago from '@/components/ventas/nueva-venta/PanelPago';

const NuevaVentaModal = ({ isOpen, onOpenChange, onSaleSuccess, cotizacion = null, onConvertSuccess, pedido = null }) => {
  const { user } = useAuth();
  const { currentSession, isSessionOpen } = useCaja();
  const { toast } = useToast();

  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [moneda, setMoneda] = useState('ARS');
  const [tipoCambioTasa, setTipoCambioTasa] = useState(1);
  const [loading, setLoading] = useState(false);
  const [tcMissing, setTcMissing] = useState(false);
  const [showParaleloTCModal, setShowParaleloTCModal] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  // Si el pedido que se está facturando ya tuvo una Entrega manual confirmada,
  // el stock de esos ítems ya se movió ahí (ver crear_venta, migration 156) —
  // la pre-validación de stock de más abajo no debe correr para ese caso, o
  // bloquearía facturar un pedido legítimamente entregado si el stock general
  // del depósito bajó por otras ventas después de la entrega.
  const [pedidoYaEntregado, setPedidoYaEntregado] = useState(false);

  // Centro de costo (Fase 1 del plan de 4 frentes contables) — opcional, para
  // reportar por sucursal/línea de negocio. Mismo patrón que NuevaFacturaModal.jsx.
  const [centrosCosto, setCentrosCosto] = useState([]);
  const [centroCostoId, setCentroCostoId] = useState('');

  // Relevancia fiscal (patrón SAP, mismo que NuevaFacturaModal.jsx) — tildado,
  // esta venta nunca se encola para CAE aunque AFIP esté activo.
  const [noRelevanteFiscal, setNoRelevanteFiscal] = useState(false);

  // ── Moneda Paralela ─────────────────────────────────────────────────────────
  const tcParalelo = useTCParalelo();

  // ── Configuración AFIP (hook compartido con el POS / useConfirmarVenta) ─────
  const { afipConfig, afipActivo, determinarTipoComprobante } = useAfipConfig();
  const [lastComprobante, setLastComprobante] = useState(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [lastItems, setLastItems] = useState([]);
  const [lastPagos, setLastPagos] = useState([]);
  const [precioMap, setPrecioMap] = useState({}); // { producto_id → precio lista }
  const [listaNombre, setListaNombre] = useState(''); // nombre de la lista activa

  const searchInputRef = useRef(null);
  const searchWrapperRef = useRef(null);
  const searchDebounceRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !user?.empresa_id) return;

    const init = async () => {
      // Siempre cargar clientes
      const { data: clis } = await supabase
        .from('clientes').select('*').eq('empresa_id', user.empresa_id).eq('activo', true);
      setClients(clis || []);

      const { data: empresaCC } = await supabase
        .from('empresas').select('usa_centros_costo').eq('id', user.empresa_id).single();
      if (empresaCC?.usa_centros_costo) {
        const { data: centros } = await supabase
          .from('centros_costo').select('id, nombre')
          .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre');
        setCentrosCosto(centros || []);
      } else {
        setCentrosCosto([]);
      }

      resetForm();

      // Pre-llenar carrito desde cotización: cargar solo los productos necesarios
      if (cotizacion?.cotizacion_items?.length > 0) {
        const productoIds = cotizacion.cotizacion_items.map(i => i.producto_id).filter(Boolean);
        const { data: prods } = productoIds.length > 0
          ? await supabase.from('productos').select('*').eq('empresa_id', user.empresa_id).in('id', productoIds)
          : { data: [] };
        const prodMap = Object.fromEntries((prods || []).map(p => [p.id, p]));

        const preCart = [];
        let sinProducto = 0;
        for (const item of cotizacion.cotizacion_items) {
          if (item.producto_id) {
            const prod = prodMap[item.producto_id];
            if (prod) {
              preCart.push({ ...prod, precio_venta: Number(item.precio_unitario), cantidad: Number(item.cantidad) });
            } else {
              sinProducto++;
            }
          } else {
            sinProducto++;
          }
        }
        if (preCart.length > 0) setCart(preCart);
        if (sinProducto > 0) {
          toast({ title: `${sinProducto} ítem(s) sin producto vinculado no se cargaron automáticamente.`, variant: 'destructive' });
        }
      }

      // Pre-seleccionar cliente de la cotización (fuera del check de items por si
      // la cotización no tiene ítems).
      // Estrategia: 1) match por cliente_id; 2) fallback a DB si está inactivo;
      // 3) fallback por cliente_nombre (las cotizaciones viejas guardan solo el
      // texto libre sin id — ver CotizacionesSection línea 234).
      if (cotizacion?.cliente_id || cotizacion?.cliente_nombre) {
        let client = null;

        if (cotizacion.cliente_id) {
          client = (clis || []).find(c => c.id === cotizacion.cliente_id);
          if (!client) {
            const { data: clienteCot } = await supabase
              .from('clientes').select('*').eq('id', cotizacion.cliente_id).maybeSingle();
            client = clienteCot;
          }
        }

        // Fallback: buscar por nombre (case-insensitive, trim) en la lista
        if (!client && cotizacion.cliente_nombre) {
          const target = cotizacion.cliente_nombre.trim().toLowerCase();
          client = (clis || []).find(c => (c.nombre || '').trim().toLowerCase() === target);
        }

        if (client) handleSelectClient(client);
      }

      // Pre-llenar carrito desde pedido
      if (pedido?.pedido_items?.length > 0) {
        // ¿Ya hubo una Entrega manual confirmada para este pedido? Mismo criterio
        // que usa crear_venta (migration 156) para decidir si mueve stock o no.
        const { data: entregaPrevia } = await supabase
          .from('entregas')
          .select('id')
          .eq('empresa_id', user.empresa_id)
          .eq('pedido_id', pedido.id)
          .eq('origen', 'manual')
          .eq('estado', 'entregado')
          .limit(1)
          .maybeSingle();
        setPedidoYaEntregado(!!entregaPrevia);

        const productoIds = pedido.pedido_items.map(i => i.producto_id).filter(Boolean);
        const { data: prods } = productoIds.length > 0
          ? await supabase.from('productos').select('*').eq('empresa_id', user.empresa_id).in('id', productoIds)
          : { data: [] };
        const prodMap = Object.fromEntries((prods || []).map(p => [p.id, p]));

        const preCart = [];
        let sinProducto = 0;
        for (const item of pedido.pedido_items) {
          if (item.producto_id) {
            const prod = prodMap[item.producto_id];
            if (prod) {
              preCart.push({ ...prod, precio_venta: Number(item.precio_unitario), cantidad: Number(item.cantidad) });
            } else {
              sinProducto++;
            }
          } else {
            sinProducto++;
          }
        }
        if (preCart.length > 0) setCart(preCart);
        if (sinProducto > 0) {
          toast({ title: `${sinProducto} ítem(s) sin producto vinculado no se cargaron.`, variant: 'destructive' });
        }
        if (pedido.cliente_id) {
          const client = (clis || []).find(c => c.id === pedido.cliente_id);
          if (client) setSelectedClient(client);
        }
      }
    };

    init();
  }, [isOpen, user]);

  // Búsqueda server-side con debounce.
  // Con query vacío trae los primeros 30 productos (así el dropdown muestra
  // opciones al hacer focus sin obligar a tipear). Con texto, filtra server-side.
  useEffect(() => {
    if (!isOpen || !user?.empresa_id) return;
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(async () => {
      let query = supabase
        .from('productos')
        .select('id, nombre, codigo_sku, precio_venta, stock_actual, activo, unidad_medida, alicuota_iva, unidad_venta_id, factor_conversion_venta, precio_venta_pack, descuento_pack_pct, unidad_venta:unidades_medida!unidad_venta_id(codigo, descripcion)')
        .eq('empresa_id', user.empresa_id)
        .eq('activo', true)
        .order('nombre')
        .limit(30);
      if (productSearch.trim().length > 0) {
        query = query.or(`nombre.ilike.%${productSearch}%,codigo_sku.ilike.%${productSearch}%`);
      }
      const { data } = await query;
      setProducts(data || []);
    }, productSearch.trim() ? 300 : 0);
    return () => clearTimeout(searchDebounceRef.current);
  }, [productSearch, isOpen, user?.empresa_id]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(event.target)) {
        setShowProductDropdown(false);
      }
    };
    if (showProductDropdown) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showProductDropdown]);

  const resetForm = () => {
    setCart([]);
    setSelectedClient(null);
    multipago.reset();
    setMoneda('ARS');
    setTipoCambioTasa(1);
    setTcMissing(false);
    setProductSearch('');
    setLoading(false);
    setPrecioMap({});
    setListaNombre('');
    setPedidoYaEntregado(false);
    setCentroCostoId('');
    setNoRelevanteFiscal(false);
  };

  // Cuando cambia el cliente, cargar su lista de precios
  const handleSelectClient = async (client) => {
    setSelectedClient(client);
    if (!client) { setPrecioMap({}); setListaNombre(''); return; }
    try {
      const map = await listaPreciosService.getPrecioMapForCliente(client.id);
      setPrecioMap(map);
      // Buscar el nombre de la lista si hay precios
      if (Object.keys(map).length > 0 && client.lista_precio_id) {
        const { data: lista } = await supabase
          .from('listas_precio')
          .select('nombre')
          .eq('id', client.lista_precio_id)
          .single();
        setListaNombre(lista?.nombre ?? '');
      } else {
        setListaNombre('');
      }
      // Actualizar precios en el carrito si ya tiene productos
      if (Object.keys(map).length > 0) {
        setCart(prev => prev.map(item =>
          map[item.id] !== undefined
            ? { ...item, precio_venta: map[item.id], _precioLista: true }
            : { ...item, _precioLista: false }
        ));
      }
    } catch {
      setPrecioMap({});
      setListaNombre('');
    }
  };

  // Sincronizar tcParalelo.tcHoy cuando la operación es EN la moneda paralela
  // (MonedaSelector guarda el TC en DB; aquí lo refleja en el hook local)
  useEffect(() => {
    if (tcParalelo.enabled && moneda === tcParalelo.monedaParalela && tipoCambioTasa > 0) {
      tcParalelo.setTC(tipoCambioTasa);
    }
  }, [moneda, tipoCambioTasa, tcParalelo.enabled, tcParalelo.monedaParalela]);

  // ── IMPORTANTE: definir calculateTotal ANTES de usarla para evitar TDZ ────
  // Total SIEMPRE en ARS (los productos están cargados en ARS).
  const calculateTotal = () => cart.reduce((sum, item) => sum + (item.precio_venta * item.cantidad), 0);
  // Total convertido a la moneda elegida (solo para mostrar al cliente).
  const totalEnMonedaSeleccionada = () => {
    const totalARS = calculateTotal();
    if (moneda === 'ARS' || !tipoCambioTasa || tipoCambioTasa <= 0) return totalARS;
    return totalARS / tipoCambioTasa;
  };

  // ── Multi-pago (hook) ────────────────────────────────────────────────────────
  const multipago = useMultipago(calculateTotal());
  const {
    selectedMethods,
    methodAmounts,
    setMethodAmounts,
    isCC,
    isMultiPago,
    restante,
    toggleMethod,
  } = multipago;

  // ── Crédito de cliente (hook) ────────────────────────────────────────────────
  const credito = useCreditoCliente();

  const filteredProducts = useMemo(() => {
    let result = products;
    if (productSearch) {
      const lower = productSearch.toLowerCase();
      result = products.filter(p => p.nombre.toLowerCase().includes(lower) || p.codigo_sku.toLowerCase().includes(lower));
    }
    return result.slice(0, 50);
  }, [productSearch, products]);

  const handleAddToCart = (product, qty = 1) => {
    if (product.stock_actual < qty) {
      toast({ title: "Stock insuficiente", description: `Solo hay ${product.stock_actual} disponibles.`, variant: "destructive" });
      return;
    }
    // Aplicar precio de lista si existe
    const precioFinal = precioMap[product.id] !== undefined ? precioMap[product.id] : product.precio_venta;
    const esPrecioLista = precioMap[product.id] !== undefined;
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        if (product.stock_actual < (existing.cantidad + qty)) {
            toast({ title: "Stock insuficiente", description: `No puedes agregar más de ${product.stock_actual}.`, variant: "destructive" });
            return prev;
        }
        return prev.map(item => item.id === product.id ? { ...item, cantidad: item.cantidad + qty } : item);
      }
      return [...prev, { ...product, precio_venta: precioFinal, _precioUnitOriginal: precioFinal, _precioLista: esPrecioLista, cantidad: qty }];
    });
    setProductSearch('');
    setShowProductDropdown(false);
    // Defer focus until AFTER React commits DOM updates to avoid
    // Radix UI FocusScope modifying the DOM mid-commit (insertBefore/removeChild errors)
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const removeFromCart = (productId) => setCart(prev => prev.filter(item => item.id !== productId));

  // ── Venta por pack (mig.189/190) ────────────────────────────────────────────
  // Precio final del pack: fijo (precio_venta_pack) o proporcional (unit × factor),
  // con el descuento fijo del pack aplicado. El vendedor puede sumar descuento manual aparte.
  const packPrecioFinal = (item) => precioPackFinal(item, item._precioUnitOriginal ?? item.precio_venta);

  const togglePackMode = (productId) => {
    setCart(prev => prev.map(item => {
      if (item.id !== productId) return item;
      if (item._packMode) {
        return { ...item, _packMode: false, cantidad: 1, precio_venta: item._precioUnitOriginal ?? item.precio_venta };
      }
      const factor = Number(item.factor_conversion_venta) || 1;
      const packFinal = packPrecioFinal(item);
      const product = products.find(p => p.id === productId);
      if (product && product.stock_actual < factor) {
        toast({ title: 'Stock insuficiente', description: `No alcanza para 1 ${item.unidad_venta?.descripcion || 'pack'} (= ${factor} ${item.unidad_medida || 'u'}).`, variant: 'destructive' });
        return item;
      }
      return {
        ...item, _packMode: true, _packs: 1, _precioUnidadVenta: packFinal,
        cantidad: factor, precio_venta: packFinal / factor,
      };
    }));
  };

  const updatePacks = (productId, nPacks) => {
    const packs = parseInt(nPacks);
    if (isNaN(packs) || packs < 1) return;
    setCart(prev => prev.map(item => {
      if (item.id !== productId || !item._packMode) return item;
      const factor = Number(item.factor_conversion_venta) || 1;
      const baseQty = packs * factor;
      const product = products.find(p => p.id === productId);
      if (product && product.stock_actual < baseQty) {
        toast({ title: 'Stock insuficiente', description: `Solo hay ${product.stock_actual} ${item.unidad_medida || 'u'} (≈ ${Math.floor(product.stock_actual / factor)} ${item.unidad_venta?.codigo || 'packs'}).`, variant: 'destructive' });
        return item;
      }
      return { ...item, _packs: packs, cantidad: baseQty };
    }));
  };

  const updateQuantity = (productId, newQty) => {
    const qty = parseInt(newQty);
    if (isNaN(qty) || qty < 1) return;
    const product = products.find(p => p.id === productId);
    if (!product) return;
    if (product.stock_actual < qty) {
      toast({
        title: 'Stock insuficiente',
        description: `Solo hay ${product.stock_actual} unidades disponibles de ${product.nombre}.`,
        variant: 'destructive',
      });
      return;
    }
    setCart(prev => prev.map(item => item.id === productId ? { ...item, cantidad: qty } : item));
  };

  const generateVentaNumber = async () => {
    const { data, error } = await supabase.rpc('obtener_proximo_numero', {
      p_empresa_id: user.empresa_id,
      p_tipo_documento: 'venta',
    });
    if (error) throw error;
    return data;
  };

  const handleConfirmSale = async () => {
    if (cart.length === 0) return toast({ title: "Carrito vacío", variant: "destructive" });
    if (isCC && !selectedClient) return toast({ title: "Cliente requerido para Cuenta Corriente", variant: "destructive" });

    // Bloquear si la moneda es extranjera y no se cargó el TC del día
    if (moneda !== 'ARS' && tcMissing) {
      return toast({
        title: 'Falta el tipo de cambio del día',
        description: `Cargá la tasa de ${moneda} para hoy antes de confirmar la venta.`,
        variant: 'destructive',
      });
    }
    // Bloquear si la empresa usa moneda paralela y falta el TC (operación en ARS)
    if (tcParalelo.enabled && moneda === 'ARS' && tcParalelo.tcMissing) {
      return toast({
        title: `Falta el TC de paridad ${tcParalelo.monedaParalela}`,
        description: `La empresa usa moneda paralela. Cargá el TC de ${tcParalelo.monedaParalela} antes de confirmar.`,
        variant: 'destructive',
      });
    }

    // ── Calcular monto en moneda paralela ─────────────────────────────────────
    let montoParalelo = null;
    let tcParaleloFinalValue = null;
    if (tcParalelo.enabled) {
      if (moneda === tcParalelo.monedaParalela) {
        // La operación se muestra en la moneda paralela → convertir total ARS a esa moneda
        montoParalelo = tipoCambioTasa > 0 ? calculateTotal() / tipoCambioTasa : calculateTotal();
        tcParaleloFinalValue = tipoCambioTasa;
      } else if (tcParalelo.tcHoy) {
        // calculateTotal() YA está en ARS → solo dividir por tcHoy para obtener paralelo
        montoParalelo = calculateTotal() / tcParalelo.tcHoy;
        tcParaleloFinalValue = tcParalelo.tcHoy;
      }
    }

    // ── Validar que la sesión siga viva ANTES de insertar ────────────────────
    // Si el token expiró, las inserciones con RLS (empresa_id) fallan con 403 y
    // la venta quedaría a medio escribir. Mejor avisar y frenar.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return toast({
        title: "Sesión expirada",
        description: "Tu sesión venció. Volvé a iniciar sesión para registrar la venta.",
        variant: "destructive",
      });
    }

    // Validar multi-pago
    const total = calculateTotal();
    const { pagos: pagosFinales, error: pagoError } = multipago.construirPagosFinales();
    if (pagoError) {
      return toast({ ...pagoError, variant: 'destructive' });
    }

    // ── Bloquear venta si incluye Efectivo y la caja está cerrada ───────────
    // Solo Efectivo requiere caja abierta. Transferencia/Tarjeta/CC operan sin caja.
    const incluyeEfectivo = pagosFinales.some(p => p.metodo === 'Efectivo' && p.monto > 0);
    if (!isSessionOpen && incluyeEfectivo) {
      return toast({
        title: 'Caja cerrada',
        description: 'Abrí la caja para cobrar en efectivo. Podés usar Transferencia, Tarjeta o Cuenta Corriente sin abrir la caja.',
        variant: 'destructive',
      });
    }

    // ── Verificar límite de crédito (CC) ────────────────────────────────────
    if (isCC && selectedClient) {
      const verif = await credito.verificarLimite(selectedClient.id, total);
      if (verif.aplica && verif.excede) {
        if (verif.bloquea) {
          return toast({
            title: '⛔ Límite de crédito excedido',
            description: `${selectedClient.nombre} tiene un límite de $${verif.limite.toLocaleString('es-AR')}. Saldo actual: $${verif.saldoActual.toLocaleString('es-AR')}.`,
            variant: 'destructive',
          });
        } else {
          // Solo advertencia, no bloquea
          toast({
            title: '⚠ Atención: Límite de crédito',
            description: `La venta supera el límite de $${verif.limite.toLocaleString('es-AR')} para ${selectedClient.nombre}.`,
          });
        }
      }
    }

    // Pre-validación de stock (UX): verifica antes de iniciar la transacción.
    // Se salta cuando el pedido ya tuvo una Entrega — ahí el stock de estos
    // ítems ya se movió (y crear_venta no lo vuelve a mover), así que comparar
    // contra el stock_actual general del depósito no tiene sentido y podría
    // bloquear una facturación legítima si el stock bajó por otras ventas.
    if (!pedidoYaEntregado) {
      for (const item of cart) {
        const { data: freshProduct } = await supabase.from('productos').select('stock_actual').eq('id', item.id).single();
        if (!freshProduct || freshProduct.stock_actual < item.cantidad) {
          toast({ title: "Stock Insuficiente", description: `El producto ${item.nombre} cambió su stock.`, variant: "destructive" });
          return;
        }
      }
    }

    setLoading(true);
    try {
      const saleNumber = await generateVentaNumber();
      const now = getNowAR().toISOString();

      const formaPago = pagosFinales.length > 1
        ? pagosFinales.map(p => p.metodo).join(' + ')
        : pagosFinales[0].metodo;

      // Items para la RPC
      const itemsPayload = cart.map(item => ({
        producto_id:     item.id,
        cantidad:        item.cantidad,
        precio_unitario: item.precio_venta,
        subtotal:        item.precio_venta * item.cantidad,
        alicuota_iva:    item.alicuota_iva ?? '21',  // snapshot de la alícuota del producto
        // Venta por pack (mig.190) — solo se manda si la línea está en modo pack.
        unidad_venta_id:     item._packMode ? item.unidad_venta_id : '',
        cantidad_venta:      item._packMode ? item._packs : '',
        precio_unidad_venta: item._packMode ? item._precioUnidadVenta : '',
      }));

      // Pagos para la RPC (monto_paralelo calculado por pago).
      // Se envía '' en lugar de null para que NULLIF(...,'') del SQL resuelva a NULL.
      const pagosPayload = pagosFinales.map(pago => {
        const pagoParalelo = tcParalelo.enabled && tcParaleloFinalValue
          ? tcParalelo.calcParalelo(pago.monto, moneda, tipoCambioTasa)
          : null;
        return {
          metodo:         pago.metodo,
          monto:          pago.monto,
          monto_paralelo: pagoParalelo ?? '',
          tc_paralelo:    pagoParalelo !== null ? tcParaleloFinalValue : '',
        };
      });

      // ── Una sola llamada transaccional: todo o nada (rollback automático) ────
      const { data: rpcResult, error: rpcError } = await supabase.rpc('crear_venta', {
        p_empresa_id:       user.empresa_id,
        p_user_id:          user.id,
        p_numero_venta:     saleNumber,
        p_fecha:            now,
        p_cliente_id:       selectedClient?.id ?? null,
        p_cliente_nombre:   selectedClient?.nombre ?? 'Consumidor Final',
        p_total:            total,
        p_forma_pago:       formaPago,
        p_estado_pago:      isCC ? 'pendiente' : 'pagada',
        p_moneda:           moneda,
        p_tipo_cambio_tasa: tipoCambioTasa,
        p_monto_paralelo:   montoParalelo ?? null,
        p_tc_paralelo:      tcParaleloFinalValue ?? null,
        p_items:            itemsPayload,
        p_pagos:            pagosPayload,
        p_es_cc:            isCC,
        p_caja_sesion_id:   currentSession?.id ?? null,
        p_pedido_id:        pedido?.id ?? null,
        // Valor nominal fijo en moneda extranjera (Fase 3 Multimoneda — diferencia
        // de cambio realizada). Null si la venta es en ARS.
        p_monto_moneda_original: moneda !== 'ARS' ? totalEnMonedaSeleccionada() : null,
        p_centro_costo_id:  centroCostoId || null,
      });

      if (rpcError) throw rpcError;

      // Objeto comprobante para el modal de impresión
      const comprobante = {
        id:                rpcResult.comprobante_id,
        numero_venta:      rpcResult.numero_venta,
        fecha:             now,
        total,
        moneda,
        tipo_cambio_tasa:  tipoCambioTasa,
        forma_pago:        formaPago,
        cliente_nombre:    selectedClient?.nombre ?? 'Consumidor Final',
      };

      // Asiento contable — fire & forget, FUERA de la transacción (no crítico)
      asientosAutoService.crearAsientoVenta(
        user.empresa_id,
        user.id,
        {
          ventaId:     comprobante.id,
          total,
          fecha:       getTodayAR(),
          descripcion: `Venta #${saleNumber}`,
          esCredito:   isCC,
          centroCostoId: centroCostoId || null,
        }
      ).catch(e => {
        if (e.message?.startsWith('Período cerrado:')) {
          toast({ title: 'Asiento contable no generado', description: e.message, variant: 'destructive' });
        } else {
          console.warn('[Contabilidad] Asiento venta (no crítico):', e.message);
        }
      });

      // Relevancia fiscal (patrón SAP, mismo que NuevaFacturaModal.jsx) — crear_venta
      // no acepta este campo como parámetro (default relevante_fiscal=true en la
      // tabla), así que se corrige con un UPDATE de seguimiento antes de decidir si
      // se encola para AFIP. fn_queue_factura_arca también lo guarda como defensa
      // en profundidad, pero evitamos el UPDATE de cae_estado innecesario acá.
      if (noRelevanteFiscal && comprobante?.id) {
        const { error: relevanteErr } = await supabase.from('comprobantes')
          .update({ relevante_fiscal: false }).eq('id', comprobante.id);
        if (relevanteErr) console.warn('[relevante_fiscal]', relevanteErr.message);
      }

      // ── Encolar CAE vía trigger (SAP async posting — no bloquea la venta) ──────
      // El UPDATE a cae_estado='pendiente' dispara fn_queue_factura_arca, que inserta
      // en facturas_pendientes_arca. El arca-worker (cron */5 * * * *) es la única
      // fuente de verdad para llamar a ARCA — nunca desde el frontend.
      if (afipActivo && comprobante?.id && !noRelevanteFiscal) {
        const tipoComp = determinarTipoComprobante(
          afipConfig.condicion_iva,
          selectedClient?.condicion_iva ?? 'CF'
        );
        const { error: afipQueueErr } = await supabase.from('comprobantes').update({
          tipo_comprobante_afip: tipoComp,
          punto_venta_id: afipConfig.punto_venta.id,
          cae_estado: 'pendiente',
        }).eq('id', comprobante.id);
        if (afipQueueErr) console.warn('[AFIP queue]', afipQueueErr.message);
      }

      toast({ title: "¡Venta Exitosa!", description: `Comprobante ${saleNumber} generado.` });
      setLastComprobante(comprobante);
      setLastItems(cart.map(i => ({
        producto_nombre: i.nombre, cantidad: i.cantidad, precio_unitario: i.precio_venta, subtotal: i.precio_venta * i.cantidad,
        _packMode: i._packMode, _packs: i._packs, _precioUnidadVenta: i._precioUnidadVenta, unidad_venta: i.unidad_venta,
      })));
      setLastPagos(pagosFinales);
      setShowPrintModal(true);
      if (onSaleSuccess) onSaleSuccess();
      if (onConvertSuccess) onConvertSuccess(comprobante.id);
      resetForm();
      onOpenChange(false);

    } catch (error) {
      console.error("Sale error:", error);
      toast({ title: "Error al procesar", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl kairox-bg-card kairox-text-primary h-[90vh] flex flex-col p-0 gap-0 overflow-hidden dark:bg-slate-950 dark:border-slate-800">
          <DialogHeader className="p-6 border-b border-slate-200 dark:border-slate-800">
            <DialogTitle className="text-2xl flex items-center gap-2 dark:text-white">
              <ShoppingCart className="h-6 w-6 text-blue-600 dark:text-[#00D4FF]" />
              {cotizacion ? `Convertir Cotización ${cotizacion.numero}` : 'Nueva Venta'}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              {cotizacion ? `Generando venta desde la cotización ${cotizacion.numero}. Revisá los ítems y confirmá.` : 'Registra una nueva venta, controla stock y pagos.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
            <PanelCarrito
              searchInputRef={searchInputRef} searchWrapperRef={searchWrapperRef}
              productSearch={productSearch} setProductSearch={setProductSearch}
              showProductDropdown={showProductDropdown} setShowProductDropdown={setShowProductDropdown}
              filteredProducts={filteredProducts} handleAddToCart={handleAddToCart}
              cart={cart} updateQuantity={updateQuantity} removeFromCart={removeFromCart}
              togglePackMode={togglePackMode} updatePacks={updatePacks}
            />

            <PanelPago
              totalEnMonedaSeleccionada={totalEnMonedaSeleccionada} moneda={moneda} tipoCambioTasa={tipoCambioTasa}
              calculateTotal={calculateTotal}
              setMoneda={setMoneda} setTipoCambioTasa={setTipoCambioTasa} setTcMissing={setTcMissing}
              tcParalelo={tcParalelo} setShowParaleloTCModal={setShowParaleloTCModal}
              selectedMethods={selectedMethods} toggleMethod={toggleMethod} isMultiPago={isMultiPago}
              methodAmounts={methodAmounts} setMethodAmounts={setMethodAmounts} restante={restante}
              listaNombre={listaNombre}
              selectedClient={selectedClient} clients={clients} handleSelectClient={handleSelectClient}
              isCC={isCC}
              loading={loading} cart={cart} tcMissing={tcMissing}
              handleConfirmSale={handleConfirmSale}
              centrosCosto={centrosCosto} centroCostoId={centroCostoId} setCentroCostoId={setCentroCostoId}
              afipActivo={afipActivo}
              noRelevanteFiscal={noRelevanteFiscal} setNoRelevanteFiscal={setNoRelevanteFiscal}
            />
          </div>
        </DialogContent>
      </Dialog>
      <ComprobantePrintModal open={showPrintModal} onOpenChange={setShowPrintModal} comprobante={lastComprobante} items={lastItems} pagos={lastPagos} />
      {/* Modal TC paralelo: se abre cuando la operación es en ARS pero falta el TC de paridad */}
      <TipoCambioModal
        open={showParaleloTCModal}
        onOpenChange={setShowParaleloTCModal}
        moneda={tcParalelo.monedaParalela}
        onConfirm={(t) => { tcParalelo.setTC(t); setShowParaleloTCModal(false); }}
      />
    </>
  );
};

export default NuevaVentaModal;