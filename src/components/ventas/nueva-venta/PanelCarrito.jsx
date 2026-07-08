import { Search, Trash2, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function PanelCarrito({
  searchInputRef, searchWrapperRef,
  productSearch, setProductSearch,
  showProductDropdown, setShowProductDropdown,
  filteredProducts, handleAddToCart,
  cart, updateQuantity, removeFromCart,
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0 border-r border-slate-200 dark:border-slate-800">
      <div ref={searchWrapperRef} className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input ref={searchInputRef} placeholder="Buscar producto o elegí de la lista..." value={productSearch} onChange={(e) => { setProductSearch(e.target.value); setShowProductDropdown(true); }} onFocus={() => setShowProductDropdown(true)} className="pl-10 h-12 text-lg kairox-input pr-10 dark:bg-slate-900 dark:border-slate-700 dark:text-white" autoComplete="off" />
          <div className={`absolute top-full left-0 w-full z-50 bg-white dark:bg-slate-950 border kairox-border shadow-xl rounded-md mt-1 overflow-hidden max-h-80 overflow-y-auto ${showProductDropdown ? '' : 'hidden'}`}>
            {filteredProducts.length === 0 && (
              <div className="px-3 py-4 text-sm text-slate-400 text-center">
                {productSearch.trim() ? 'No se encontraron productos' : 'Cargando productos...'}
              </div>
            )}
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
                  <td className="py-3 text-right font-bold">${(item.precio_venta * item.cantidad).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="py-3 text-right pr-2"><Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => removeFromCart(item.id)}><Trash2 className="h-4 w-4" /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default PanelCarrito;
