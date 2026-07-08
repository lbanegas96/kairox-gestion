import { Search, Edit, ArrowRightLeft, PowerOff, Power, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function TablaInventario({
  showInactivos,
  searchQuery, setSearchQuery,
  loading,
  filteredProducts,
  setEditProduct,
  setIsEditProductOpen,
  setSelectedProductForMov,
  setIsMovimientoOpen,
  handleDisableProduct,
  handleReactivateProduct,
}) {
  return (
    <div className="space-y-4">
      {showInactivos && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          <PowerOff className="h-4 w-4 shrink-0" />
          Mostrando productos <strong>inactivos</strong>. Usá el botón "Activos" para volver a la vista normal.
        </div>
      )}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-kx-text-3" />
        <Input
          placeholder="Buscar por nombre o SKU..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 bg-kx-surface dark:bg-kx-surface border-kx-border dark:border-kx-border"
        />
      </div>

      <div className="rounded-lg border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-kx-surface-2 dark:bg-slate-800/50 border-b border-kx-border dark:border-kx-border text-slate-500 dark:text-kx-text-2 font-medium">
              <tr>
                <th className="p-4">Producto</th>
                <th className="p-4 text-center">Categoría</th>
                <th className="p-4 text-right">Stock</th>
                <th className="p-4 text-right">Costo</th>
                <th className="p-4 text-right">Precio</th>
                <th className="p-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
               {loading ? (
                 <tr><td colSpan="6" className="p-8 text-center text-slate-500">Cargando inventario...</td></tr>
               ) : filteredProducts.length === 0 ? (
                 <tr><td colSpan="6" className="p-8 text-center text-slate-500">No se encontraron productos.</td></tr>
               ) : (
                 filteredProducts.map(p => {
                    const isLowStock = p.stock_actual <= p.stock_minimo;
                    return (
                      <tr key={p.id} className="hover:bg-kx-surface-2 dark:hover:bg-slate-800/30 transition-colors">
                         <td className="p-4">
                           <div className="font-medium text-slate-900 dark:text-kx-text">{p.nombre}</div>
                           <div className="text-xs text-slate-500 font-mono">{p.codigo_sku}</div>
                         </td>
                         <td className="p-4 text-center">
                           {p.categories?.nombre ? (
                             <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                               {p.categories.nombre}
                             </span>
                           ) : (
                             <span className="text-kx-text-3">-</span>
                           )}
                         </td>
                         <td className="p-4 text-right">
                           <div className={`font-mono font-bold ${isLowStock ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                             {p.stock_actual}
                           </div>
                           {isLowStock && <div className="text-[10px] text-red-500 flex items-center justify-end gap-1"><AlertTriangle className="h-3 w-3" /> Bajo stock</div>}
                         </td>
                         <td className="p-4 text-right text-slate-500">
                           ${p.costo_compra?.toLocaleString('es-AR')}
                         </td>
                         <td className="p-4 text-right font-medium text-slate-900 dark:text-kx-text">
                           ${p.precio_venta?.toLocaleString('es-AR')}
                         </td>
                         <td className="p-4 text-right">
                           <div className="flex items-center justify-end gap-2">
                             {!showInactivos && (
                               <>
                                 <Button
                                   variant="ghost"
                                   size="sm"
                                   className="h-8 w-8 p-0 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                                   onClick={() => {
                                     setEditProduct({
                                       ...p,
                                       categoria_nombre: p.categories?.nombre || '',
                                       proveedor_id: p.proveedor_id || 'none'
                                     });
                                     setIsEditProductOpen(true);
                                   }}
                                   title="Editar"
                                 >
                                   <Edit className="h-4 w-4"/>
                                 </Button>
                                 <Button
                                   variant="ghost"
                                   size="sm"
                                   className="h-8 w-8 p-0 text-slate-500 hover:text-orange-600 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                                   onClick={() => { setSelectedProductForMov(p); setIsMovimientoOpen(true); }}
                                   title="Ajustar Stock"
                                 >
                                   <ArrowRightLeft className="h-4 w-4"/>
                                 </Button>
                                 <Button
                                   variant="ghost"
                                   size="sm"
                                   className="h-8 w-8 p-0 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                                   onClick={() => handleDisableProduct(p)}
                                   title="Desactivar producto"
                                 >
                                   <PowerOff className="h-4 w-4"/>
                                 </Button>
                               </>
                             )}
                             {showInactivos && (
                               <Button
                                 variant="ghost"
                                 size="sm"
                                 className="h-8 w-8 p-0 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                                 onClick={() => handleReactivateProduct(p)}
                                 title="Reactivar producto"
                               >
                                 <Power className="h-4 w-4"/>
                               </Button>
                             )}
                           </div>
                         </td>
                      </tr>
                    );
                 })
               )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default TablaInventario;
