import { Plus, Trash2, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { formatCurrency } from '@/lib/currencyUtils';

function ModalPedidoForm({
  isModalOpen, setIsModalOpen,
  editingPedido,
  form, setForm,
  clientes,
  productos,
  addItem,
  removeItem,
  updateItem,
  totales,
  tcMissing, setTcMissing,
  handleSave,
  saving,
}) {
  return (
    <Dialog open={isModalOpen} onOpenChange={v => { if (!v) setIsModalOpen(false); }}>
      <DialogContent className="max-w-3xl dark:bg-kx-bg dark:border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text">
            {editingPedido ? `Editar ${editingPedido.numero}` : 'Nuevo Pedido'}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {editingPedido ? 'Modificá los ítems del pedido en borrador.' : 'Cargá los productos y datos del pedido.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="dark:text-kx-text">Cliente</Label>
              <select
                value={form.cliente_id}
                onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}
                className="w-full h-10 rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-3 text-sm"
              >
                <option value="">Sin cliente</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="dark:text-kx-text">Fecha de Entrega (opcional)</Label>
              <Input
                type="date"
                value={form.fecha_entrega}
                onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="dark:text-kx-text">N° Referencia del Cliente (PO)</Label>
              <Input
                value={form.referencia_cliente}
                onChange={e => setForm(f => ({ ...f, referencia_cliente: e.target.value }))}
                placeholder="Ej. orden de compra del cliente"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
            <div>
              <MonedaSelector
                moneda={form.moneda}
                tasa={form.tipoCambioTasa}
                onMonedaChange={v => setForm(f => ({ ...f, moneda: v, tipoCambioTasa: v === 'ARS' ? 1 : f.tipoCambioTasa }))}
                onTasaChange={v => setForm(f => ({ ...f, tipoCambioTasa: v }))}
                onTCMissingChange={setTcMissing}
              />
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <Label className="dark:text-kx-text">Ítems del Pedido</Label>
              <Button variant="outline" size="sm" onClick={addItem} className="h-8 dark:text-kx-text dark:border-kx-border">
                <Plus className="h-3.5 w-3.5 mr-1" /> Agregar ítem
              </Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-slate-500 dark:text-kx-text-2 px-1">
                <span className="col-span-4">Producto / Descripción</span>
                <span className="col-span-3">Descripción libre</span>
                <span className="col-span-1 text-center">Cant.</span>
                <span className="col-span-2 text-right">Precio Unit.</span>
                <span className="col-span-1 text-right">% Desc.</span>
                <span className="col-span-1"></span>
              </div>
              {form.items.map((item, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <select
                      value={item.producto_id}
                      onChange={e => updateItem(i, 'producto_id', e.target.value)}
                      className="w-full h-9 text-sm rounded-md border border-slate-300 dark:border-kx-border bg-kx-surface dark:bg-kx-surface dark:text-kx-text px-2"
                    >
                      <option value="">— sin producto —</option>
                      {productos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-span-3">
                    <Input
                      placeholder="Descripción"
                      value={item.descripcion}
                      onChange={e => updateItem(i, 'descripcion', e.target.value)}
                      className="h-9 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                    />
                  </div>
                  <div className="col-span-1">
                    <Input
                      type="number" min="1" step="1"
                      value={item.cantidad}
                      onChange={e => updateItem(i, 'cantidad', e.target.value.replace(/[^\d]/g, ''))}
                      className="h-9 text-sm text-center dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      type="text" inputMode="decimal" placeholder="0,00"
                      value={item.precio_unitario}
                      onChange={e => updateItem(i, 'precio_unitario', e.target.value)}
                      className="h-9 text-sm text-right dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                    />
                  </div>
                  <div className="col-span-1">
                    <Input
                      type="text" inputMode="decimal" placeholder="0"
                      value={item.descuento_item}
                      onChange={e => updateItem(i, 'descuento_item', e.target.value)}
                      className="h-9 text-sm text-right dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
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
              ))}
            </div>
            <div className="flex justify-end mt-3">
              <div className="text-right space-y-1 min-w-[220px]">
                {totales.descuento > 0.005 && (
                  <>
                    <div className="flex justify-between text-sm text-slate-500 dark:text-kx-text-2">
                      <span>Subtotal</span>
                      <span className="font-mono">{formatCurrency(totales.subtotal, form.moneda)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-kx-red">
                      <span>Descuento</span>
                      <span className="font-mono">-{formatCurrency(totales.descuento, form.moneda)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between pt-1">
                  <span className="text-sm text-slate-500 dark:text-kx-text-2 self-center">Total</span>
                  <span className="text-lg font-bold text-slate-900 dark:text-kx-text font-mono">
                    {formatCurrency(totales.total, form.moneda)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="dark:text-kx-text">Notas internas</Label>
            <Textarea
              placeholder="Instrucciones especiales, referencias, etc."
              value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              className="resize-none h-20 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsModalOpen(false)} className="dark:text-kx-text dark:border-kx-border">
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || (form.moneda !== 'ARS' && tcMissing)}
            className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            title={form.moneda !== 'ARS' && tcMissing ? `Cargá el tipo de cambio ${form.moneda} del día para continuar` : undefined}
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
            {editingPedido ? 'Guardar cambios' : 'Crear Pedido'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalPedidoForm;
