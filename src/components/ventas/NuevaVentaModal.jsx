import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShoppingCart, Search, Trash2, X, Check, Loader2, Package, ChevronDown, AlertTriangle } from 'lucide-react';
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

const NuevaVentaModal = ({ isOpen, onOpenChange, onSaleSuccess }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('Efectivo');
  const [loading, setLoading] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [lastComprobante, setLastComprobante] = useState(null);
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [lastItems, setLastItems] = useState([]);

  const searchInputRef = useRef(null);
  const searchWrapperRef = useRef(null);

  useEffect(() => {
    if (isOpen && user && user.empresa_id) {
      loadProducts();
      loadClients();
      resetForm();
    }
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

  const loadProducts = async () => {
    const { data } = await supabase.from('productos').select('*').eq('empresa_id', user.empresa_id).eq('activo', true);
    setProducts(data || []);
  };

  const loadClients = async () => {
    const { data } = await supabase.from('clientes').select('*').eq('empresa_id', user.empresa_id).eq('activo', true);
    setClients(data || []);
  };

  const resetForm = () => {
    setCart([]);
    setSelectedClient(null);
    setPaymentMethod('Efectivo');
    setProductSearch('');
    setLoading(false);
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
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        if (product.stock_actual < (existing.cantidad + qty)) {
            toast({ title: "Stock insuficiente", description: `No puedes agregar más de ${product.stock_actual}.`, variant: "destructive" });
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

  const calculateTotal = () => cart.reduce((sum, item) => sum + (item.precio_venta * item.cantidad), 0);

  const generateVentaNumber = async () => {
    const todayStr = getTodayAR().replace(/-/g, '');
    const { data } = await supabase.from('comprobantes').select('numero_venta').eq('empresa_id', user.empresa_id).ilike('numero_venta', `${todayStr}-%`).order('numero_venta', { ascending: false }).limit(1);
    let sequence = 1;
    if (data && data.length > 0) sequence = parseInt(data[0].numero_venta.split('-')[1]) + 1;
    return `${todayStr}-${String(sequence).padStart(3, '0')}`;
  };

  const handleConfirmSale = async () => {
    if (cart.length === 0) return toast({ title: "Carrito vacío", variant: "destructive" });
    if (paymentMethod === 'Cuenta Corriente' && !selectedClient) return toast({ title: "Cliente requerido", variant: "destructive" });

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
      const total = calculateTotal();
      const now = getNowAR().toISOString();

      const { data: comprobante, error: compError } = await supabase.from('comprobantes').insert([{
          tenant_id: user.tenant_id, // Keep legacy tenant_id populated
          empresa_id: user.empresa_id,
          numero_venta: saleNumber,
          fecha: now,
          cliente_id: selectedClient?.id || null,
          cliente_nombre: selectedClient?.nombre || 'Consumidor Final',
          total: total,
          forma_pago: paymentMethod
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
      await supabase.from('comprobante_items').insert(itemsPayload);

      for (const item of cart) {
        await supabase.from('productos').update({ stock_actual: freshProductMap.get(item.id).stock_actual - item.cantidad }).eq('id', item.id);
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

      // Also create record in 'ventas' table for legacy/dashboard compatibility
      const { data: venta } = await supabase.from('ventas').insert([{
          user_id: user.tenant_id,
          empresa_id: user.empresa_id,
          fecha: now,
          cliente: selectedClient?.nombre || 'Consumidor Final',
          cliente_id: selectedClient?.id,
          metodo_pago: paymentMethod,
          subtotal: total,
          total: total,
          descuento: 0
      }]).select().single();
      
      if(venta) {
          const detailPayload = cart.map(item => ({
              venta_id: venta.id,
              empresa_id: user.empresa_id,
              producto_id: item.id,
              cantidad: item.cantidad,
              precio_unitario: item.precio_venta,
              subtotal: item.precio_venta * item.cantidad
          }));
          await supabase.from('detalle_ventas').insert(detailPayload);
      }

      // If Payment is Received (not Cta Cte), add to Caja
      if (paymentMethod !== 'Cuenta Corriente') {
          await supabase.from('movimientos_caja').insert([{
              user_id: user.tenant_id,
              empresa_id: user.empresa_id,
              fecha: now,
              tipo: 'ingreso',
              categoria: 'Venta',
              concepto: `Venta #${saleNumber}`,
              monto: total,
              metodo_pago: paymentMethod,
              is_automatic: true
          }]);
      } else if (selectedClient) {
          // If Cta Cte, add movement to Cta Cte table (DEBE)
          await supabase.from('cuenta_corriente_movimientos').insert([{
              user_id: user.tenant_id,
              empresa_id: user.empresa_id,
              cliente_id: selectedClient.id,
              tipo: 'DEBE',
              monto: total,
              descripcion: `Venta #${saleNumber}`,
              fecha: now
          }]);
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
          esCredito: paymentMethod === 'Cuenta Corriente',
        }
      ).catch(e => console.warn('[Contabilidad] Asiento venta (no crítico):', e.message));

      toast({ title: "¡Venta Exitosa!", description: `Comprobante ${saleNumber} generado.` });
      setLastComprobante(comprobante);
      setLastItems(cart.map(i => ({ producto_nombre: i.nombre, cantidad: i.cantidad, precio_unitario: i.precio_venta, subtotal: i.precio_venta * i.cantidad })));
      setShowPrintModal(true);
      if (onSaleSuccess) onSaleSuccess();
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
            <DialogTitle className="text-2xl flex items-center gap-2 dark:text-white"><ShoppingCart className="h-6 w-6 text-blue-600 dark:text-[#00D4FF]" /> Nueva Venta</DialogTitle>
            <DialogDescription className="dark:text-slate-400">Registra una nueva venta, controla stock y pagos.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            <div className="flex-1 flex flex-col border-r border-slate-200 dark:border-slate-800">
              <div ref={searchWrapperRef} className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input ref={searchInputRef} placeholder="Buscar producto..." value={productSearch} onChange={(e) => setProductSearch(e.target.value)} className="pl-10 h-12 text-lg kairox-input pr-10 dark:bg-slate-900 dark:border-slate-700 dark:text-white" autoComplete="off" />
                </div>
              </div>
              <div className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 max-h-64 overflow-y-auto">
                <div className="sticky top-0 px-3 py-1.5 text-[11px] uppercase font-semibold tracking-wider text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
                  Productos disponibles ({filteredProducts.length})
                </div>
                {filteredProducts.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-slate-400">No hay productos {productSearch && 'que coincidan'}</div>
                ) : (
                  filteredProducts.map(p => (
                    <div key={p.id} className="px-3 py-2.5 border-b border-slate-100 dark:border-slate-800 grid grid-cols-12 gap-2 items-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/20" onClick={() => handleAddToCart(p)}>
                      <div className="col-span-3 text-xs text-slate-500 font-mono truncate">{p.codigo_sku}</div>
                      <div className="col-span-5 font-medium truncate text-sm text-slate-800 dark:text-slate-200">{p.nombre}</div>
                      <div className="col-span-2 text-right text-xs font-bold dark:text-slate-300">{p.stock_actual}</div>
                      <div className="col-span-2 text-right font-bold text-emerald-600 dark:text-emerald-400 text-sm">${p.precio_venta}</div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4 dark:bg-slate-950">
                {cart.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400"><Package className="h-16 w-16 mb-4 opacity-20" /><p>El carrito está vacío</p></div>
                ) : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-slate-500 dark:text-slate-400 border-b dark:border-slate-800"><th className="text-left pb-2">Producto</th><th className="text-center pb-2 w-20">Cant.</th><th className="text-right pb-2">Subtotal</th><th className="w-8"></th></tr></thead>
                    <tbody className="dark:text-slate-200">
                      {cart.map(item => (
                        <tr key={item.id} className="group hover:bg-slate-50 dark:hover:bg-slate-900/20">
                          <td className="py-3 pl-2"><div className="font-medium">{item.nombre}</div><div className="text-xs text-slate-400">${item.precio_venta}</div></td>
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
                  <div className="flex justify-between items-center text-xl font-bold pt-2 dark:text-white"><span>Total</span><span className="text-blue-600 dark:text-[#00D4FF]">${calculateTotal().toFixed(2)}</span></div>
               </div>
               <div className="space-y-3 dark:text-white"><Label>Método de Pago</Label><div className="grid grid-cols-2 gap-2">{['Efectivo', 'Transferencia', 'Tarjeta', 'Cuenta Corriente'].map(method => (<div key={method} className={`cursor-pointer border rounded-lg p-3 text-center text-sm transition-colors ${paymentMethod === method ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200' : 'hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800'}`} onClick={() => setPaymentMethod(method)}>{method}</div>))}</div></div>
               <div className="space-y-3 dark:text-white"><Label>Cliente</Label><select className="w-full h-10 rounded-md border bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-white px-3 text-sm focus:border-blue-500 dark:focus:border-[#00D4FF]" value={selectedClient?.id || ''} onChange={(e) => setSelectedClient(clients.find(c => c.id === e.target.value) || null)}><option value="">Consumidor Final</option>{clients.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
               <div className="mt-auto"><Button className="w-full h-12 text-lg font-bold bg-green-600 hover:bg-green-700 text-white dark:bg-green-700 dark:hover:bg-green-600" disabled={loading || cart.length === 0} onClick={handleConfirmSale}>{loading ? <Loader2 className="animate-spin mr-2" /> : <Check className="mr-2" />} Confirmar Venta</Button></div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <ComprobantePrintModal open={showPrintModal} onOpenChange={setShowPrintModal} comprobante={lastComprobante} items={lastItems} />
    </>
  );
};

export default NuevaVentaModal;