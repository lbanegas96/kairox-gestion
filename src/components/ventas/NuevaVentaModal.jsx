import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShoppingCart, Search, Trash2, X, Check, Loader2, Package, ChevronDown, AlertTriangle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getNowAR, getTodayAR } from '@/lib/dateUtils';
import { asientosAutoService } from '@/services/planCuentasService';
import ComprobantePrintModal from './ComprobantePrintModal';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';
import { formatCurrency } from '@/lib/currencyUtils';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { listaPreciosService } from '@/services/listaPreciosService';

const NuevaVentaModal = ({ isOpen, onOpenChange, onSaleSuccess, cotizacion = null, onConvertSuccess }) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  // Multi-pago: Set de métodos activos + montos por método
  const [selectedMethods, setSelectedMethods] = useState(new Set(['Efectivo']));
  const [methodAmounts, setMethodAmounts] = useState({});
  const [moneda, setMoneda] = useState('ARS');
  const [tipoCambioTasa, setTipoCambioTasa] = useState(1);
  const [loading, setLoading] = useState(false);
  const [tcMissing, setTcMissing] = useState(false);
  const [showParaleloTCModal, setShowParaleloTCModal] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);

  // ── Moneda Paralela (SAP-style parallel currency) ───────────────────────────
  const tcParalelo = useTCParalelo();
  const [lastComprobante, setLastComprobante] = useState(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [lastItems, setLastItems] = useState([]);
  const [lastPagos, setLastPagos] = useState([]);
  const [precioMap, setPrecioMap] = useState({}); // { producto_id → precio lista }
  const [listaNombre, setListaNombre] = useState(''); // nombre de la lista activa

  const searchInputRef = useRef(null);
  const searchWrapperRef = useRef(null);

  useEffect(() => {
    if (!isOpen || !user?.empresa_id) return;

    const init = async () => {
      const [{ data: prods }, { data: clis }] = await Promise.all([
        supabase.from('productos').select('*').eq('empresa_id', user.empresa_id).eq('activo', true),
        supabase.from('clientes').select('*').eq('empresa_id', user.empresa_id).eq('activo', true),
      ]);
      setProducts(prods || []);
      setClients(clis || []);
      resetForm();

      // Pre-llenar carrito desde cotización
      if (cotizacion?.cotizacion_items?.length > 0) {
        const preCart = [];
        let sinProducto = 0;
        for (const item of cotizacion.cotizacion_items) {
          if (item.producto_id) {
            const prod = (prods || []).find(p => p.id === item.producto_id);
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
        if (cotizacion.cliente_id) {
          const client = (clis || []).find(c => c.id === cotizacion.cliente_id);
          if (client) setSelectedClient(client);
        }
      }
    };

    init();
  }, [isOpen, user]);

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
    setSelectedMethods(new Set(['Efectivo']));
    setMethodAmounts({});
    setMoneda('ARS');
    setTipoCambioTasa(1);
    setTcMissing(false);
    setProductSearch('');
    setLoading(false);
    setPrecioMap({});
    setListaNombre('');
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

  // ── Helpers multi-pago ──────────────────────────────────────────────────────
  const isCC = selectedMethods.has('Cuenta Corriente');
  const isMultiPago = !isCC && selectedMethods.size > 1;

  const totalPagado = useMemo(() => {
    if (!isMultiPago) return 0;
    return Array.from(selectedMethods).reduce(
      (sum, m) => sum + (parseFloat(methodAmounts[m]) || 0), 0
    );
  }, [isMultiPago, selectedMethods, methodAmounts]);

  const restante = calculateTotal() - totalPagado;

  const toggleMethod = (method) => {
    if (method === 'Cuenta Corriente') {
      setSelectedMethods(new Set(['Cuenta Corriente']));
      setMethodAmounts({});
      return;
    }
    // Salir de CC
    if (selectedMethods.has('Cuenta Corriente')) {
      setSelectedMethods(new Set([method]));
      setMethodAmounts({});
      return;
    }
    if (selectedMethods.has(method)) {
      if (selectedMethods.size === 1) return; // No deseleccionar el último
      const next = new Set(selectedMethods);
      next.delete(method);
      setSelectedMethods(next);
      setMethodAmounts(prev => {
        const copy = { ...prev };
        delete copy[method];
        return copy;
      });
    } else {
      setSelectedMethods(new Set([...selectedMethods, method]));
    }
  };

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
      return [...prev, { ...product, precio_venta: precioFinal, _precioLista: esPrecioLista, cantidad: qty }];
    });
    setProductSearch('');
    setShowProductDropdown(false);
    // Defer focus until AFTER React commits DOM updates to avoid
    // Radix UI FocusScope modifying the DOM mid-commit (insertBefore/removeChild errors)
    setTimeout(() => searchInputRef.current?.focus(), 0);
  };

  const removeFromCart = (productId) => setCart(prev => prev.filter(item => item.id !== productId));

  const updateQuantity = (productId, newQty) => {
    const qty = parseInt(newQty);
    if (isNaN(qty) || qty < 1) return;
    const product = products.find(p => p.id === productId);
    if (!product || product.stock_actual < qty) return;
    setCart(prev => prev.map(item => item.id === productId ? { ...item, cantidad: qty } : item));
  };

  const generateVentaNumber = async () => {
    const todayStr = getTodayAR().replace(/-/g, '');
    const { data } = await supabase.from('comprobantes').select('numero_venta').eq('empresa_id', user.empresa_id).ilike('numero_venta', `${todayStr}-%`).order('numero_venta', { ascending: false }).limit(1);
    let sequence = 1;
    if (data && data.length > 0) sequence = parseInt(data[0].numero_venta.split('-')[1]) + 1;
    return `${todayStr}-${String(sequence).padStart(3, '0')}`;
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
    let pagosFinales;
    if (isCC) {
      pagosFinales = [{ metodo: 'Cuenta Corriente', monto: total }];
    } else if (isMultiPago) {
      pagosFinales = Array.from(selectedMethods).map(m => ({
        metodo: m,
        monto: parseFloat(methodAmounts[m]) || 0,
      }));
      const suma = pagosFinales.reduce((s, p) => s + p.monto, 0);
      if (Math.abs(suma - total) > 0.01) {
        return toast({
          title: "Pago incompleto",
          description: `Asignado: $${suma.toFixed(2)} de $${total.toFixed(2)}. Completá todos los montos.`,
          variant: "destructive",
        });
      }
    } else {
      const [singleMethod] = Array.from(selectedMethods);
      pagosFinales = [{ metodo: singleMethod, monto: total }];
    }

    // ── Verificar límite de crédito (CC) ────────────────────────────────────
    if (isCC && selectedClient) {
      const { data: clienteActual } = await supabase
        .from('clientes').select('saldo_actual, limite_credito, bloquear_en_limite')
        .eq('id', selectedClient.id).single();
      const limite = Number(clienteActual?.limite_credito || 0);
      if (limite > 0) {
        const nuevoSaldo = Number(clienteActual?.saldo_actual || 0) + total;
        if (nuevoSaldo > limite) {
          if (clienteActual?.bloquear_en_limite) {
            return toast({
              title: '⛔ Límite de crédito excedido',
              description: `${selectedClient.nombre} tiene un límite de $${limite.toLocaleString('es-AR')}. Saldo actual: $${Number(clienteActual.saldo_actual).toLocaleString('es-AR')}.`,
              variant: 'destructive',
            });
          } else {
            // Solo advertencia, no bloquea
            toast({
              title: '⚠ Atención: Límite de crédito',
              description: `La venta supera el límite de $${limite.toLocaleString('es-AR')} para ${selectedClient.nombre}.`,
            });
          }
        }
      }
    }

    const freshProductMap = new Map();
    for (const item of cart) {
      const { data: freshProduct } = await supabase.from('productos').select('stock_actual').eq('id', item.id).single();
      if (!freshProduct || freshProduct.stock_actual < item.cantidad) {
         toast({ title: "Stock Insuficiente", description: `El producto ${item.nombre} cambió su stock.`, variant: "destructive" });
         return;
      }
      freshProductMap.set(item.id, freshProduct);
    }

    setLoading(true);
    try {
      const saleNumber = await generateVentaNumber();
      const now = getNowAR().toISOString();

      const formaPago = pagosFinales.length > 1
        ? pagosFinales.map(p => p.metodo).join(' + ')
        : pagosFinales[0].metodo;

      const { data: comprobante, error: compError } = await supabase.from('comprobantes').insert([{
          tenant_id: user.tenant_id, // Keep legacy tenant_id populated
          empresa_id: user.empresa_id,
          numero_venta: saleNumber,
          fecha: now,
          cliente_id: selectedClient?.id || null,
          cliente_nombre: selectedClient?.nombre || 'Consumidor Final',
          total: total,
          forma_pago: formaPago,
          // Una venta en Cuenta Corriente NO está pagada: queda como deuda pendiente.
          // El resto de medios de pago se cobran en el acto.
          estado_pago: isCC ? 'pendiente' : 'pagada',
          moneda,
          tipo_cambio_tasa: tipoCambioTasa,
          // Moneda paralela (SAP parallel currency)
          ...(tcParalelo.enabled && montoParalelo !== null ? {
            monto_paralelo: montoParalelo,
            tc_paralelo: tcParaleloFinalValue,
          } : {}),
        }]).select().single();

      if (compError) throw compError;

      const itemsPayload = cart.map(item => ({
         comprobante_id: comprobante.id,
         empresa_id: user.empresa_id,
         producto_id: item.id,
         cantidad: item.cantidad,
         precio_unitario: item.precio_venta,
         subtotal: item.precio_venta * item.cantidad
      }));
      const { error: itemsError } = await supabase.from('comprobante_items').insert(itemsPayload);
      if (itemsError) throw itemsError;

      for (const item of cart) {
        const { error: stockError } = await supabase.from('productos').update({ stock_actual: freshProductMap.get(item.id).stock_actual - item.cantidad }).eq('id', item.id);
        if (stockError) throw stockError;
        const { error: movInvError } = await supabase.from('movimientos_inventario').insert([{
           tenant_id: user.tenant_id,
           empresa_id: user.empresa_id,
           producto_id: item.id,
           tipo: 'salida',
           cantidad: item.cantidad,
           motivo: `Venta #${saleNumber}`,
           fecha: now
        }]);
        if (movInvError) throw movInvError;
      }

      // Multi-pago: registrar un movimiento de caja por cada método (excepto CC)
      const pagosEfectivos = pagosFinales.filter(p => p.metodo !== 'Cuenta Corriente');
      for (const pago of pagosEfectivos) {
        const pagoParalelo = tcParalelo.enabled && tcParaleloFinalValue
          ? tcParalelo.calcParalelo(pago.monto, moneda, tipoCambioTasa)
          : null;
        const { error: cajaError } = await supabase.from('movimientos_caja').insert([{
          user_id: user.id,
          empresa_id: user.empresa_id,
          fecha: now,
          tipo: 'ingreso',
          categoria: 'Venta',
          concepto: `Venta #${saleNumber}`,
          monto: pago.monto,
          metodo_pago: pago.metodo,
          is_automatic: true,
          ...(pagoParalelo !== null ? { monto_paralelo: pagoParalelo, tc_paralelo: tcParaleloFinalValue } : {}),
        }]);
        if (cajaError) throw cajaError;
      }
      // Si hay pago en CC, registrar en cuenta corriente (DEBE)
      if (isCC && selectedClient) {
        const { error: ccError } = await supabase.from('cuenta_corriente_movimientos').insert([{
          user_id: user.id,
          empresa_id: user.empresa_id,
          cliente_id: selectedClient.id,
          tipo: 'DEBE',
          monto: total,
          descripcion: `Venta #${saleNumber}`,
          fecha: now
        }]);
        if (ccError) throw ccError;
      }

      // Asiento contable automático (no bloquea el flujo de ventas)
      asientosAutoService.crearAsientoVenta(
        user.empresa_id,
        user.id,
        {
          ventaId: comprobante.id,
          total,
          fecha: getTodayAR(),
          descripcion: `Venta #${saleNumber}`,
          esCredito: isCC,
        }
      ).catch(e => console.warn('[Contabilidad] Asiento venta (no crítico):', e.message));

      toast({ title: "¡Venta Exitosa!", description: `Comprobante ${saleNumber} generado.` });
      setLastComprobante(comprobante);
      setLastItems(cart.map(i => ({ producto_nombre: i.nombre, cantidad: i.cantidad, precio_unitario: i.precio_venta, subtotal: i.precio_venta * i.cantidad })));
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
            <div className="flex-1 flex flex-col min-h-0 border-r border-slate-200 dark:border-slate-800">
              <div ref={searchWrapperRef} className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input ref={searchInputRef} placeholder="Buscar producto..." value={productSearch} onChange={(e) => { setProductSearch(e.target.value); setShowProductDropdown(true); }} onFocus={() => setShowProductDropdown(true)} className="pl-10 h-12 text-lg kairox-input pr-10 dark:bg-slate-900 dark:border-slate-700 dark:text-white" autoComplete="off" />
                  <div className={`absolute top-full left-0 w-full z-50 bg-white dark:bg-slate-950 border kairox-border shadow-xl rounded-md mt-1 overflow-hidden max-h-80 overflow-y-auto ${showProductDropdown ? '' : 'hidden'}`}>
                    {filteredProducts.map(p => (
                      <div key={p.id} className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 grid grid-cols-12 gap-2 items-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20" onClick={() => handleAddToCart(p)}>
                        <div className="col-span-3 text-xs text-slate-500 font-mono truncate">{p.codigo_sku}</div>
                        <div className="col-span-5 font-medium truncate text-sm text-slate-800 dark:text-slate-200">{p.nombre}</div>
                        <div className="col-span-2 text-right text-xs font-bold dark:text-slate-300">{p.stock_actual}</div>
                        <div className="col-span-2 text-right font-bold text-emerald-600 dark:text-emerald-400 text-sm">${p.precio_venta}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-4 dark:bg-slate-950 min-h-[200px]">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400"><Package className="h-16 w-16 mb-4 opacity-20" /><p>El carrito está vacío</p></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-slate-500 dark:text-slate-400 border-b dark:border-slate-800"><th className="text-left pb-2">Producto</th><th className="text-center pb-2 w-20">Cant.</th><th className="text-right pb-2">Subtotal</th><th className="w-8"></th></tr></thead>
                    <tbody className="dark:text-slate-200">
                      {cart.map(item => (
                        <tr key={item.id} className="group hover:bg-slate-50 dark:hover:bg-slate-900/20">
                          <td className="py-3 pl-2">
                            <div className="font-medium">{item.nombre}</div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-slate-400">${item.precio_venta}</span>
                              {item._precioLista && (
                                <span className="text-[9px] font-bold bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-1 py-0.5 rounded">LISTA</span>
                              )}
                            </div>
                          </td>
                          <td className="py-3 text-center"><Input type="number" value={item.cantidad} onChange={(e) => updateQuantity(item.id, e.target.value)} className="h-8 w-16 text-center mx-auto dark:bg-slate-800 dark:border-slate-700" /></td>
                          <td className="py-3 text-right font-bold">${(item.precio_venta * item.cantidad).toFixed(2)}</td>
                          <td className="py-3 text-right pr-2"><Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => removeFromCart(item.id)}><Trash2 className="h-4 w-4" /></Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="w-full md:w-96 bg-slate-50 dark:bg-slate-900/30 p-6 flex flex-col gap-6 overflow-y-auto border-l border-slate-200 dark:border-slate-800">
               <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border kairox-border">
                  <div className="flex justify-between items-center text-xl font-bold pt-2 dark:text-white"><span>Total</span><span className="text-blue-600 dark:text-[#00D4FF]">{formatCurrency(totalEnMonedaSeleccionada(), moneda)}</span></div>
                  {moneda !== 'ARS' && tipoCambioTasa > 0 && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 text-right">
                      Equivale a {formatCurrency(calculateTotal(), 'ARS')} (TC ${Number(tipoCambioTasa).toLocaleString('es-AR')})
                    </div>
                  )}
                  <div className="mt-3">
                    <MonedaSelector
                      moneda={moneda}
                      tasa={tipoCambioTasa}
                      onMonedaChange={v => { setMoneda(v); if (v === 'ARS') setTipoCambioTasa(1); }}
                      onTasaChange={setTipoCambioTasa}
                      onTCMissingChange={setTcMissing}
                    />
                  </div>
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
               <div className="space-y-3 dark:text-white">
                 <div className="flex items-center justify-between">
                   <Label>Método de Pago</Label>
                   {isMultiPago && (
                     <span className="text-xs text-slate-400 dark:text-slate-500">Seleccioná varios métodos</span>
                   )}
                 </div>
                 <div className="grid grid-cols-2 gap-2">
                   {['Efectivo', 'Transferencia', 'Tarjeta', 'Cuenta Corriente'].map(method => (
                     <div key={method}
                       className={`cursor-pointer border rounded-lg p-3 text-center text-sm transition-colors select-none ${
                         selectedMethods.has(method)
                           ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'
                           : 'hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-300'
                       }`}
                       onClick={() => toggleMethod(method)}
                     >
                       <div className="flex items-center justify-center gap-1">
                         {selectedMethods.has(method) && <Check className="h-3.5 w-3.5 shrink-0" />}
                         <span>{method}</span>
                       </div>
                       {/* Amount input for multi-pago (not CC) */}
                       {isMultiPago && selectedMethods.has(method) && method !== 'Cuenta Corriente' && (
                         <div className="mt-2" onClick={e => e.stopPropagation()}>
                           <input
                             type="number"
                             step="0.01"
                             min="0"
                             placeholder="$0.00"
                             value={methodAmounts[method] || ''}
                             onChange={e => setMethodAmounts(prev => ({ ...prev, [method]: e.target.value }))}
                             className="w-full h-7 text-center text-xs rounded border border-blue-300 dark:border-blue-700 dark:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-500 px-1"
                           />
                         </div>
                       )}
                     </div>
                   ))}
                 </div>
                 {/* Restante indicator */}
                 {isMultiPago && (
                   <div className={`text-sm font-semibold text-center py-2 px-3 rounded-lg ${
                     Math.abs(restante) < 0.01
                       ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                       : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
                   }`}>
                     {Math.abs(restante) < 0.01
                       ? '✓ Pago completo'
                       : `Restante a asignar: $${restante.toFixed(2)}`}
                   </div>
                 )}
               </div>
               <div className="space-y-2 dark:text-white">
                 <Label>Cliente</Label>
                 {listaNombre && (
                   <div className="text-xs text-violet-600 dark:text-violet-400 flex items-center gap-1 mb-1">
                     <span className="inline-block w-2 h-2 rounded-full bg-violet-500"></span>
                     Lista activa: <strong>{listaNombre}</strong>
                   </div>
                 )}
                 <select
                   className="w-full h-10 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-white px-3 text-sm focus:border-blue-500 dark:focus:border-[#00D4FF]"
                   value={selectedClient?.id || ''}
                   onChange={e => handleSelectClient(clients.find(c => c.id === e.target.value) || null)}
                 >
                   <option value="">Consumidor Final</option>
                   {clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                 </select>
                 {/* Condiciones de pago + límite CC */}
                 {isCC && selectedClient && (selectedClient.condiciones_pago || selectedClient.limite_credito > 0) && (
                   <div className="text-xs rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-2 space-y-0.5">
                     {selectedClient.condiciones_pago && (
                       <p className="text-blue-700 dark:text-blue-300">📋 {selectedClient.condiciones_pago}</p>
                     )}
                     {selectedClient.limite_credito > 0 && (
                       <p className="text-blue-600 dark:text-blue-400">
                         Límite: ${Number(selectedClient.limite_credito).toLocaleString('es-AR')}
                         {' · '}Saldo: ${Number(selectedClient.saldo_actual || 0).toLocaleString('es-AR')}
                       </p>
                     )}
                   </div>
                 )}
               </div>
               <div className="mt-auto">
                 <Button
                   className="w-full h-12 text-lg font-bold bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50"
                   disabled={
                     loading ||
                     cart.length === 0 ||
                     (moneda !== 'ARS' && tcMissing) ||
                     (tcParalelo.enabled && moneda === 'ARS' && tcParalelo.tcMissing)
                   }
                   onClick={handleConfirmSale}
                 >
                   {loading ? <Loader2 className="animate-spin mr-2" /> : <Check className="mr-2" />}
                   Confirmar Venta
                 </Button>
                 {(moneda !== 'ARS' && tcMissing) || (tcParalelo.enabled && moneda === 'ARS' && tcParalelo.tcMissing) ? (
                   <p className="text-xs text-center text-amber-600 dark:text-amber-400 mt-1.5">
                     ⚠ Cargá el TC del día para habilitar la venta
                   </p>
                 ) : null}
               </div>
            </div>
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