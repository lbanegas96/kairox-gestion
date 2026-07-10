import { Calendar, ShoppingBag, PackageOpen, Search, X, Trash2, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { parseNumberLocale } from '@/lib/currencyUtils';

function TabNuevaCompra({
  purchaseForm, setPurchaseForm,
  proveedores,
  centrosCosto = [],
  moneda, setMoneda,
  tipoCambioTasa, setTipoCambioTasa,
  tcMissing, setTcMissing,
  tcParalelo,
  setShowParaleloTCModal,
  cart,
  calculateTotalUnits,
  calculateTotal,
  searchInputRef,
  productSearch, setProductSearch,
  showAutocomplete, setShowAutocomplete,
  handleSearchKeyDown,
  filteredProducts,
  getShortUnit,
  addToCart,
  updateCartItem,
  applyPackConversion,
  removeFromCart,
  isSubmitting,
  setShowClearConfirm,
  handleRegisterPurchase,
  isPurchaseValid,
}) {
  return (
    <div className="mt-0 space-y-4">
      <div className="kairox-bg-card border kairox-border p-6 rounded-xl shadow-sm dark:bg-kx-bg dark:border-kx-border">
        <h3 className="text-lg font-bold text-blue-800 dark:text-[#00D4FF] flex items-center gap-2 mb-4"><ShoppingBag className="h-5 w-5" /> DATOS DE COMPRA</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="space-y-2"><Label className="dark:text-kx-text">Proveedor <span className="text-red-500">*</span></Label><div className="relative"><select className="w-full h-10 rounded-md bg-kx-surface dark:bg-kx-surface border border-slate-300 dark:border-kx-border text-slate-900 dark:text-kx-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-[#00D4FF]" value={purchaseForm.proveedor_id} onChange={e => setPurchaseForm({...purchaseForm, proveedor_id: e.target.value})}><option value="">Seleccione Proveedor...</option>{proveedores.map(p => (<option key={p.id} value={p.id}>{p.nombre}</option>))}</select></div></div>
          <div className="space-y-2"><Label className="dark:text-kx-text">N° Factura / Referencia</Label><Input value={purchaseForm.numero_factura} onChange={e => setPurchaseForm({...purchaseForm, numero_factura: e.target.value})} placeholder="Ej: F-001-2304" className="kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/></div>
          <div className="space-y-2"><Label className="dark:text-kx-text">Fecha de Compra</Label><div className="relative"><Calendar className="absolute left-3 top-2.5 h-4 w-4 text-slate-500"/><Input type="date" value={purchaseForm.fecha} onChange={e => setPurchaseForm({...purchaseForm, fecha: e.target.value})} className="pl-9 kairox-input dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"/></div></div>
          <div className="space-y-2"><Label className="dark:text-kx-text">Forma de Pago</Label><select className="w-full h-10 rounded-md bg-kx-surface dark:bg-kx-surface border border-slate-300 dark:border-kx-border text-slate-900 dark:text-kx-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={purchaseForm.forma_pago} onChange={e => setPurchaseForm({...purchaseForm, forma_pago: e.target.value})}><option value="Efectivo">Efectivo</option><option value="Transferencia">Transferencia</option><option value="Tarjeta">Tarjeta</option><option value="Cuenta Corriente">Cuenta Corriente</option></select></div>
          {centrosCosto.length > 0 && (
            <div className="space-y-2"><Label className="dark:text-kx-text">Centro de costo (opcional)</Label><select className="w-full h-10 rounded-md bg-kx-surface dark:bg-kx-surface border border-slate-300 dark:border-kx-border text-slate-900 dark:text-kx-text px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value={purchaseForm.centro_costo_id || ''} onChange={e => setPurchaseForm({...purchaseForm, centro_costo_id: e.target.value})}><option value="">Sin asignar</option>{centrosCosto.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></div>
          )}
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
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">{cart.length === 0 ? (<tr><td colSpan="5" className="p-12 text-center text-slate-500 dark:text-kx-text-2"><ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-20"/>Agrega productos a la compra usando el buscador</td></tr>) : (cart.map(item => (<tr key={item.cartItemId} className="group hover:bg-slate-100 dark:hover:bg-slate-900/50"><td className="p-4 font-medium kairox-text-primary dark:text-kx-text">{item.nombre}<div className="text-xs text-slate-500 dark:text-kx-text-2 font-mono flex items-center gap-1">{item.codigo_sku}<span className="text-kx-text-3 dark:text-kx-text-2">|</span>{getShortUnit(item.unidad_medida)}</div>{item.unidad_compra_id && (<div className="mt-1.5 flex items-center gap-1 text-[11px] text-kx-text-3"><span>o en {item.unidad_compra?.descripcion || 'unidad de compra'} (x{item.factor_conversion_compra}):</span><Input type="text" inputMode="decimal" placeholder="cant." value={item.packQty} onChange={(e) => updateCartItem(item.cartItemId, 'packQty', e.target.value)} className="w-14 h-6 text-[11px] px-1.5 kairox-input dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"/><span>×</span><Input type="text" inputMode="decimal" placeholder="$/u" value={item.packCosto} onChange={(e) => updateCartItem(item.cartItemId, 'packCosto', e.target.value)} className="w-16 h-6 text-[11px] px-1.5 kairox-input dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"/><Button type="button" size="sm" variant="outline" onClick={() => applyPackConversion(item.cartItemId)} className="h-6 px-1.5 text-[11px]" title="Convertir a unidad de stock">↧</Button></div>)}</td><td className="p-4 text-center"><Input type="number" min="1" value={item.cantidad} onChange={(e) => updateCartItem(item.cartItemId, 'cantidad', e.target.value)} className="w-24 mx-auto text-center h-8 focus:bg-kx-surface dark:focus:bg-slate-700 kairox-input dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"/></td><td className="p-4 text-right"><Input type="text" inputMode="decimal" placeholder="0,00" value={item.costo_unitario} onChange={(e) => updateCartItem(item.cartItemId, 'costo_unitario', e.target.value)} className="w-32 ml-auto text-right h-8 focus:bg-kx-surface dark:focus:bg-slate-700 kairox-input dark:bg-kx-surface-2 dark:border-kx-border dark:text-kx-text"/></td><td className="p-4 text-right font-bold kairox-text-primary dark:text-emerald-400">${((Number(item.cantidad) || 0) * (parseNumberLocale(item.costo_unitario) || 0)).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</td><td className="p-4 text-center"><Button size="icon" variant="ghost" onClick={() => removeFromCart(item.cartItemId)} className="h-8 w-8 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-300"><X className="h-4 w-4" /></Button></td></tr>)))}</tbody>
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
    </div>
  );
}

export default TabNuevaCompra;
