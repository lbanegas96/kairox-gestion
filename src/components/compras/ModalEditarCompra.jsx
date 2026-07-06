import React from 'react';
import { Search, X, Edit, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { parseNumberLocale } from '@/lib/currencyUtils';

function ModalEditarCompra({
  isEditModalOpen, setIsEditModalOpen,
  editForm, setEditForm,
  proveedores,
  editSearchInputRef,
  editSearch, setEditSearch,
  showEditAutocomplete, setShowEditAutocomplete,
  filteredEditProducts,
  addProductToEdit,
  editItems,
  updateEditItem,
  removeEditItem,
  calculateEditTotal,
  isSavingEdit,
  handleSaveEdit,
}) {
  return (
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
  );
}

export default ModalEditarCompra;
