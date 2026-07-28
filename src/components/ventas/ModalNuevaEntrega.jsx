import { Plus, Trash2, Loader2, Check, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

function ModalNuevaEntrega({
  isOpen, onClose,
  clientes, productos,
  form, setForm,
  addItem, removeItem, updateItem,
  handleSave, saving,
}) {
  return (
    <Dialog open={isOpen} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text">Nueva Entrega</DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            Registrá una entrega de mercadería sin partir de un pedido. El stock se descuenta al confirmar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-1.5">
            <Label className="dark:text-kx-text">Cliente (opcional)</Label>
            <select
              value={form.cliente_id}
              onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}
              className="w-full h-10 rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-3 text-sm"
            >
              <option value="">Sin cliente</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <Label className="dark:text-kx-text">Ítems a entregar</Label>
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
                const stockInsuficiente = prod && Number(item.cantidad) > Number(prod.stock_actual);
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
                        className={`h-9 text-sm text-center dark:bg-kx-surface dark:border-kx-border dark:text-kx-text ${stockInsuficiente ? 'border-kx-red text-kx-red' : ''}`}
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
                    {stockInsuficiente && (
                      <div className="col-span-12 text-2xs text-kx-red -mt-1">
                        Stock insuficiente: hay {prod.stock_actual}, se pidieron {item.cantidad}.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="dark:text-kx-text">Observaciones</Label>
            <Textarea
              placeholder="Motivo de la entrega, referencias, etc."
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
            Crear Entrega
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevaEntrega;
