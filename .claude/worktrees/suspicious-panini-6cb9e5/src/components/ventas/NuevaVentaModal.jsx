import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShoppingCart, Search, Trash2, X, Check, Loader2, Package, Plus, AlertCircle } from 'lucide-react';
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

const METODOS_PAGO = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cuenta Corriente'];

const NuevaVentaModal = ({ isOpen, onOpenChange, onSaleSuccess, initialPedido, onPedidoConverted }) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);

  // Multi-pago
  const [pagos, setPagos] = useState([]);
  const [pagoMetodo, setPagoMetodo] = useState('Efectivo');
  const [pagoMonto, setPagoMonto] = useState('');

  const [loading, setLoading] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [lastComprobante, setLastComprobante] = useState(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [lastItems, setLastItems] = useState([]);
  const [lastPagos, setLastPagos] = useState([]);

  const searchInputRef = useRef(null);
  const searchWrapperRef = useRef(null);

  useEffect(() => {
    if (isOpen && user?.empresa_id) {
      if (initialPedido) {
        // Pre-populate cart and client from pedido
        setPagos([]);
        setPagoMetodo('Efectivo');
        setPagoMonto('');
        setProductSearch('');
        setLoading(false);
        Promise.all([loadProducts(), loadClients()]).then(([_prods, cls]) => {
          const cartItems = (initialPedido.pedido_items ?? [])
            .filter(item => item.producto_id)
            .map(item => {
              const prod = item.productos;
              const qty = Number(item.cantidad);
              return {
                id: item.producto_id,
                nombre: prod?.nombre ?? item.descripcion,
                precio_venta: prod?.precio_venta ?? Number(item.precio_unitario),
                stock_actual: prod?.stock_actual ?? 9999,
                codigo_sku: prod?.codigo_sku ?? '',
                unidad_medida: prod?.unidad_medida ?? '',
                cantidad: qty,
                quantidade: qty,
              };
            });
          setCart(cartItems);
          if (initialPedido.cliente_id) {
            const client = cls.find(c => c.id === initialPedido.cliente_id);
            if (client) setSelectedClient(client);
          }
        });
      } else {
        loadProducts();
        loadClients();
        resetForm();
      }
    }
  }, [isOpen, user]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target))
        setShowProductDropdown(false);
    };
    if (showProductDropdown) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showProductDropdown]);

  const loadProducts = async () => {
    const { data } = await supabase.from('productos').select('*').eq('empresa_id', user.empresa_id).eq('activo', true);
    setProducts(data || []);
    return data || [];
  };

  const loadClients = async () => {
    const { data } = await supabase.from('clientes').select('*').eq('empresa_id', user.empresa_id).eq('activo', true);
    setClients(data || []);
    return data || [];
  };

  const resetForm = () => {
    setCart([]);
    setSelectedClient(null);
    setPagos([]);
    setPagoMetodo('Efectivo');
    setPagoMonto('');
    setProductSearch('');
    setLoading(false);
  };

  const filteredProducts = useMemo(() => {
    let result = products;
    if (productSearch) {
      const lower = productSearch.toLowerCase();
      result = products.filter(p =>
        p.nombre.toLowerCase().includes(lower) || p.codigo_sku.toLowerCase().includes(lower)
      );
    }
    return result.slice(0, 50);
  }, [productSearch, products]);

  const handleAddToCart = (product, qty = 1) => {
    if (product.stock_actual < qty) {
      toast({ title: 'Stock insuficiente', description: `Solo hay ${product.stock_actual} disponibles.`, variant: 'destructive' });
      return;
    }
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        if (product.stock_actual < existing.cantidad + qty) {
          toast({ title: 'Stock insuficiente', description: `No puedes agregar más de ${product.stock_actual}.`, variant: 'destructive' });
          return prev;
        }
        return prev.map(item => item.id === product.id ? { ...item, cantidad: item.cantidad + qty } : item);
      }
      return [...prev, { ...product, cantidad: qty }];
    });
    setProductSearch('');
    setShowProductDropdown(false);
    searchInputRef.current?.focus();
  };

  const removeFromCart = (productId) => setCart(prev => prev.filter(item => item.id !== productId));

  const updateQuantity = (productId, newQty) => {
    const qty = parseInt(newQty);
    if (isNaN(qty) || qty < 1) return;
    const product = products.find(p => p.id === productId);
    if (!product || product.stock_actual < qty) return;
    setCart(prev => prev.map(item => item.id === productId ? { ...item, cantidad: qty } : item));
  };

  const calculateTotal = () => cart.reduce((sum, item) => sum + item.precio_venta * item.cantidad, 0);

  // Payment derived values
  const total = calculateTotal();
  const totalPagado = pagos.reduce((s, p) => s + p.monto, 0);
  const saldoPendiente = Math.max(0, total - totalPagado);
  const cambio = Math.max(0, totalPagado - total);
  const hasCC = pagos.some(p => p.metodo === 'Cuenta Corriente');

  const addPago = (metodoOverride, montoOverride) => {
    const metodo = metodoOverride ?? pagoMetodo;
    const monto = montoOverride !== undefined ? montoOverride : parseFloat(pagoMonto);
    if (!monto || monto <= 0) return;
    setPagos(prev => [...prev, { metodo, monto }]);
    setPagoMonto('');
  };

  const quickAddPago = (metodo) => {
    if (saldoPendiente <= 0) return;
    addPago(metodo, saldoPendiente);
  };

  const removePago = (index) => setPagos(prev => prev.filter((_, i) => i !== index));

  const generateVentaNumber = async () => {
    const todayStr = getTodayAR().replace(/-/g, '');
    const { data } = await supabase
      .from('comprobantes')
      .select('numero_venta')
      .eq('empresa_id', user.empresa_id)
      .ilike('numero_venta', `${todayStr}-%`)
      .order('numero_venta', { ascending: false })
      .limit(1);
    let sequence = 1;
    if (data?.length > 0) sequence = parseInt(data[0].numero_venta.split('-')[1]) + 1;
    return `${todayStr}-${String(sequence).padStart(3, '0')}`;
  };

  const handleConfirmSale = async () => {
    if (cart.length === 0) return toast({ title: 'Carrito vacío', variant: 'destructive' });
    if (pagos.length === 0) return toast({ title: 'Seleccioná una forma de pago', variant: 'destructive' });
    if (totalPagado < total) return toast({
      title: 'Pago incompleto',
      description: `Faltan $${(total - totalPagado).toFixed(2)} para cubrir el total.`,
      variant: 'destructive'
    });
    if (hasCC && !selectedClient) return toast({
      title: 'Cliente requerido',
      description: 'La Cuenta Corriente requiere seleccionar un cliente.',
      variant: 'destructive'
    });

    // Verificar límite de crédito
    if (hasCC && selectedClient && Number(selectedClient.limite_credito) > 0) {
      const montoCC = pagos.filter(p => p.metodo === 'Cuenta Corriente').reduce((s, p) => s + p.monto, 0);
      const saldoActual = Number(selectedClient.saldo_actual || 0);
      if (saldoActual + montoCC > Number(selectedClient.limite_credito)) {
        return toast({
          title: 'Límite de crédito superado',
          description: `${selectedClient.nombre} tiene un límite de $${Number(selectedClient.limite_credito).toFixed(2)} y ya debe $${saldoActual.toFixed(2)}.`,
          variant: 'destructive'
        });
      }
    }

    const freshProductMap = new Map();
    for (const item of cart) {
      const { data: freshProduct } = await supabase.from('productos').select('stock_actual').eq('id', item.id).single();
      if (!freshProduct || freshProduct.stock_actual < item.cantidad) {
        toast({ title: 'Stock Insuficiente', description: `El producto ${item.nombre} cambió su stock.`, variant: 'destructive' });
        return;
      }
      freshProductMap.set(item.id, freshProduct);
    }

    setLoading(true);
    try {
      const saleNumber = await generateVentaNumber();
      const now = getNowAR().toISOString();

      const metodos = [...new Set(pagos.map(p => p.metodo))];
      const formaPagoResumen = metodos.length === 1 ? metodos[0] : 'Mixto';

      const { data: comprobante, error: compError } = await supabase
        .from('comprobantes')
        .insert([{
          tenant_id: user.tenant_id,
          empresa_id: user.empresa_id,
          numero_venta: saleNumber,
          fecha: now,
          cliente_id: selectedClient?.id || null,
          cliente_nombre: selectedClient?.nombre || 'Consumidor Final',
          total,
          forma_pago: formaPagoResumen
        }])
        .select()
        .single();

      if (compError) throw compError;

      // Items
      await supabase.from('comprobante_items').insert(
        cart.map(item => ({
          comprobante_id: comprobante.id,
          empresa_id: user.empresa_id,
          producto_id: item.id,
          cantidad: item.cantidad,
          precio_unitario: item.precio_venta,
          subtotal: item.precio_venta * item.cantidad
        }))
      );

      // Pagos breakdown
      await supabase.from('comprobante_pagos').insert(
        pagos.map(p => ({
          comprobante_id: comprobante.id,
          empresa_id: user.empresa_id,
          metodo: p.metodo,
          monto: p.monto
        }))
      );

      // Stock + movimientos inventario
      for (const item of cart) {
        await supabase.from('productos')
          .update({ stock_actual: freshProductMap.get(item.id).stock_actual - item.cantidad })
          .eq('id', item.id);
        await supabase.from('movimientos_inventario').insert([{
          tenant_id: user.tenant_id,
          empresa_id: user.empresa_id,
          producto_id: item.id,
          tipo: 'salida',
          cantidad: item.cantidad,
          motivo: `Venta #${saleNumber}`,
          fecha: now
        }]);
      }

      // Caja: un movimiento por cada método no-CC
      for (const pago of pagos.filter(p => p.metodo !== 'Cuenta Corriente')) {
        await supabase.from('movimientos_caja').insert([{
          user_id: user.id,
          empresa_id: user.empresa_id,
          fecha: now,
          tipo: 'ingreso',
          categoria: 'Venta',
          concepto: `Venta #${saleNumber}`,
          monto: pago.monto,
          metodo_pago: pago.metodo,
          is_automatic: true
        }]);
      }

      // Cuenta Corriente: suma de pagos CC
      const montoCC = pagos
        .filter(p => p.metodo === 'Cuenta Corriente')
        .reduce((s, p) => s + p.monto, 0);
      if (montoCC > 0 && selectedClient) {
        await supabase.from('cuenta_corriente_movimientos').insert([{
          user_id: user.tenant_id,
          empresa_id: user.empresa_id,
          cliente_id: selectedClient.id,
          tipo: 'DEBE',
          monto: montoCC,
          descripcion: `Venta #${saleNumber}`,
          fecha: now
        }]);
      }

      asientosAutoService.crearAsientoVenta(
        user.empresa_id,
        user.id,
        {
          ventaId: comprobante.id,
          total,
          fecha: getTodayAR(),
          descripcion: `Venta #${saleNumber}`,
          esCredito: montoCC > 0 && montoCC === total,
        }
      ).catch(e => console.warn('[Contabilidad] Asiento venta (no crítico):', e.message));

      toast({ title: '¡Venta Exitosa!', description: `Comprobante ${saleNumber} generado.` });
      setLastComprobante(comprobante);
      setLastItems(cart.map(i => ({
        producto_nombre: i.nombre,
        cantidad: i.cantidad,
        precio_unitario: i.precio_venta,
        subtotal: i.precio_venta * i.cantidad
      })));
      setLastPagos([...pagos]);
      setShowPrintModal(true);
      if (onPedidoConverted) onPedidoConverted(comprobante.id);
      if (onSaleSuccess) onSaleSuccess();
      resetForm();
      onOpenChange(false);

    } catch (error) {
      console.error('Sale error:', error);
      toast({ title: 'Error al procesar', description: error.message, variant: 'destructive' });
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
              {initialPedido ? `Convertir Pedido ${initialPedido.numero} a Venta` : 'Nueva Venta'}
            </DialogTitle>
            <DialogDescription className="dark:text-slate-400">
              Registra una nueva venta, controla stock y pagos.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* ── Columna izquierda: productos ── */}
            <div className="flex-1 flex flex-col border-r border-slate-200 dark:border-slate-800">
              <div ref={searchWrapperRef} className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input
                    ref={searchInputRef}
                    placeholder="Buscar producto..."
                    value={productSearch}
                    onChange={(e) => { setProductSearch(e.target.value); setShowProductDropdown(true); }}
                    onFocus={() => setShowProductDropdown(true)}
                    className="pl-10 h-12 text-lg kairox-input pr-10 dark:bg-slate-900 dark:border-slate-700 dark:text-white"
                    autoComplete="off"
                  />
                  {showProductDropdown && (
                    <div className="absolute top-full left-0 w-full z-50 bg-white dark:bg-slate-950 border kairox-border shadow-xl rounded-md mt-1 overflow-hidden max-h-80 overflow-y-auto">
                      {filteredProducts.map(p => (
                        <div
                          key={p.id}
                          className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 grid grid-cols-12 gap-2 items-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20"
                          onClick={() => handleAddToCart(p)}
                        >
                          <div className="col-span-3 text-xs text-slate-500 font-mono truncate">{p.codigo_sku}</div>
                          <div className="col-span-5 font-medium truncate text-sm text-slate-800 dark:text-slate-200">{p.nombre}</div>
                          <div className="col-span-2 text-right text-xs font-bold dark:text-slate-300">{p.stock_actual}</div>
                          <div className="col-span-2 text-right font-bold text-emerald-600 dark:text-emerald-400 text-sm">${p.precio_venta}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 dark:bg-slate-950">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <Package className="h-16 w-16 mb-4 opacity-20" />
                    <p>El carrito está vacío</p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 dark:text-slate-400 border-b dark:border-slate-800">
                        <th className="text-left pb-2">Producto</th>
                        <th className="text-center pb-2 w-20">Cant.</th>
                        <th className="text-right pb-2">Subtotal</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="dark:text-slate-200">
                      {cart.map(item => (
                        <tr key={item.id} className="group hover:bg-slate-50 dark:hover:bg-slate-900/20">
                          <td className="py-3 pl-2">
                            <div className="font-medium">{item.nombre}</div>
                            <div className="text-xs text-slate-400">${item.precio_venta}</div>
                          </td>
                          <td className="py-3 text-center">
                            <Input
                              type="number"
                              value={item.cantidad}
                              onChange={(e) => updateQuantity(item.id, e.target.value)}
                              className="h-8 w-16 text-center mx-auto dark:bg-slate-800 dark:border-slate-700"
                            />
                          </td>
                          <td className="py-3 text-right font-bold">${(item.precio_venta * item.cantidad).toFixed(2)}</td>
                          <td className="py-3 text-right pr-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                              onClick={() => removeFromCart(item.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* ── Columna derecha: pago ── */}
            <div className="w-full md:w-96 bg-slate-50 dark:bg-slate-900/30 p-5 flex flex-col gap-4 overflow-y-auto border-l border-slate-200 dark:border-slate-800">
              {/* Total */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border kairox-border">
                <div className="flex justify-between items-center text-xl font-bold dark:text-white">
                  <span>Total</span>
                  <span className="text-blue-600 dark:text-[#00D4FF]">${total.toFixed(2)}</span>
                </div>
              </div>

              {/* Formas de pago */}
              <div className="space-y-3 dark:text-white">
                <Label className="text-sm font-semibold">Formas de Pago</Label>

                {/* Botones rápidos: agregan el saldo pendiente con ese método */}
                <div className="grid grid-cols-2 gap-2">
                  {METODOS_PAGO.map(method => (
                    <button
                      key={method}
                      type="button"
                      disabled={saldoPendiente <= 0}
                      onClick={() => quickAddPago(method)}
                      className={`rounded-lg border p-2.5 text-center text-sm transition-colors ${
                        saldoPendiente > 0
                          ? 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-200 dark:border-blue-800 dark:hover:bg-blue-900/40 cursor-pointer'
                          : 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-500'
                      }`}
                    >
                      <div className="font-medium">{method}</div>
                      {saldoPendiente > 0 && (
                        <div className="text-xs opacity-70">${saldoPendiente.toFixed(2)}</div>
                      )}
                    </button>
                  ))}
                </div>

                {/* Entrada manual de monto parcial */}
                <div className="flex gap-2 items-center">
                  <select
                    value={pagoMetodo}
                    onChange={e => setPagoMetodo(e.target.value)}
                    className="h-9 flex-1 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-white px-2 text-xs focus:border-blue-500"
                  >
                    {METODOS_PAGO.map(m => <option key={m}>{m}</option>)}
                  </select>
                  <Input
                    type="number"
                    placeholder="Monto"
                    value={pagoMonto}
                    onChange={e => setPagoMonto(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addPago()}
                    className="h-9 w-24 dark:bg-slate-900 dark:border-slate-700 dark:text-white text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 dark:border-slate-700 dark:text-white"
                    onClick={() => addPago()}
                    disabled={!pagoMonto || parseFloat(pagoMonto) <= 0}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Lista de pagos registrados */}
                {pagos.length > 0 && (
                  <div className="bg-white dark:bg-slate-900 rounded-lg border kairox-border overflow-hidden">
                    {pagos.map((p, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between px-3 py-2 border-b last:border-b-0 dark:border-slate-800"
                      >
                        <span className="text-sm text-slate-600 dark:text-slate-400">{p.metodo}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                            ${p.monto.toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removePago(i)}
                            className="text-red-400 hover:text-red-600 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="px-3 py-2 bg-slate-50 dark:bg-slate-800/50 flex justify-between text-xs">
                      <span className="text-slate-500 dark:text-slate-400">Total pagado</span>
                      <span className="font-bold text-slate-700 dark:text-slate-300">${totalPagado.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {/* Indicadores de saldo */}
                {pagos.length > 0 && saldoPendiente > 0 && (
                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm font-medium">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>Pendiente: ${saldoPendiente.toFixed(2)}</span>
                  </div>
                )}
                {cambio > 0 && (
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium">
                    <Check className="h-4 w-4 flex-shrink-0" />
                    <span>Cambio a entregar: ${cambio.toFixed(2)}</span>
                  </div>
                )}
              </div>

              {/* Cliente */}
              <div className="space-y-2 dark:text-white">
                <Label className="text-sm font-semibold">
                  Cliente {hasCC && <span className="text-red-500 ml-1">*</span>}
                </Label>
                <select
                  className="w-full h-10 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-white px-3 text-sm focus:border-blue-500 dark:focus:border-[#00D4FF]"
                  value={selectedClient?.id || ''}
                  onChange={(e) => setSelectedClient(clients.find(c => c.id === e.target.value) || null)}
                >
                  <option value="">Consumidor Final</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                {selectedClient && (
                  <div className="space-y-0.5 mt-1">
                    {selectedClient.condicion_pago && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Condición: {selectedClient.condicion_pago}
                        {selectedClient.dias_credito ? ` (${selectedClient.dias_credito} días)` : ''}
                      </p>
                    )}
                    {Number(selectedClient.limite_credito) > 0 && (
                      <p className={`text-xs font-medium ${
                        Number(selectedClient.saldo_actual || 0) >= Number(selectedClient.limite_credito)
                          ? 'text-red-500 dark:text-red-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}>
                        Crédito: ${Number(selectedClient.saldo_actual || 0).toFixed(2)} / ${Number(selectedClient.limite_credito).toFixed(2)}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Confirmar */}
              <div className="mt-auto pt-2">
                <Button
                  className="w-full h-12 text-lg font-bold bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600 disabled:opacity-50"
                  disabled={loading || cart.length === 0 || pagos.length === 0 || totalPagado < total}
                  onClick={handleConfirmSale}
                >
                  {loading ? <Loader2 className="animate-spin mr-2" /> : <Check className="mr-2" />}
                  Confirmar Venta
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ComprobantePrintModal
        open={showPrintModal}
        onOpenChange={setShowPrintModal}
        comprobante={lastComprobante}
        items={lastItems}
        pagos={lastPagos}
      />
    </>
  );
};

export default NuevaVentaModal;
