import { Plus, Trash2, Loader2, Check, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

// Mismo patrón que ModalNuevaEntrega.jsx (ventas) — acá no hay advertencia de
// "stock insuficiente" porque una Recepción SUMA stock, nunca lo resta.
function ModalNuevaRecepcion({
  isOpen, onClose,
  proveedores, productos,
  form, setForm,
  addItem, removeItem, updateItem,
  handleSave, saving,
}) {
  return (
    <Dialog open={isOpen} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text">Nueva Recepción</DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Registrá una recepción de mercadería sin partir de una orden de compra. El stock se suma al confirmar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <Label className="dark:text-kx-text">Proveedor (opcional)</Label>
            <select
              value={form.proveedor_id}
              onChange={e => setForm(f => ({ ...f, proveedor_id: e.target.value }))}
              className="w-full h-10 rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-3 text-sm"
            >
              <option value="">Sin proveedor</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <Label className="dark:text-kx-text">Ítems a recibir</Label>
              <Button variant="outline" size="sm" onClick={addItem} className="h-8 dark:text-kx-text dark:border-kx-border">
                <Plus className="h-3.5 w-3.5 mr-1" /> Agregar ítem
              </Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 dark:text-kx-text-2 px-1">
                <span className="col-span-7">Producto</span>
                <span className="col-span-2 text-center">Stock</span>
                <span className="col-span-2 text-center">Cantidad</span>
                <span className="col-span-1"></span>
              </div>
              {form.items.map((item, i) => {
                const prod = productos.find(p => p.id === item.producto_id);
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-7">
                      <select
                        value={item.producto_id}
                        onChange={e => updateItem(i, 'producto_id', e.target.value)}
                        className="w-full h-9 text-sm rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-2"
                      >
                        <option value="">— seleccionar producto —</option>
                        {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 text-center text-xs text-kx-text-2 flex items-center justify-center gap-1">
                      <Package className="h-3 w-3 text-kx-text-3" />
                      {prod ? Number(prod.stock_actual).toLocaleString('es-AR') : '—'}
                    </div>
                    <div className="col-span-2">
                      <Input
                        type="number" min="1" step="1"
                        value={item.cantidad}
                        onChange={e => updateItem(i, 'cantidad', e.target.value.replace(/[^\d]/g, ''))}
                        className="h-9 text-sm text-center dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {form.items.length > 1 && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-kx-red"
                          onClick={() => removeItem(i)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="dark:text-kx-text">Observaciones</Label>
            <Textarea
              placeholder="Motivo de la recepción, referencias, etc."
              value={form.observaciones}
              onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))}
              className="resize-none h-20 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="dark:text-kx-text dark:border-kx-border">
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            Crear Recepción
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevaRecepcion;
