import { useRef, useEffect } from 'react';
import { Plus, Trash2, Loader2, Check, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { getTodayAR } from '@/lib/dateUtils';

// Mismo patrón que ModalNuevaEntrega.jsx (ventas) — acá no hay advertencia de
// "stock insuficiente" porque una Recepción SUMA stock, nunca lo resta.
//
// Reestructurado 11/09 (hallazgo Luciano): usaba un tamaño de modal ad-hoc
// (max-w-2xl) y muy pocos datos para lo que en realidad es un documento —
// ahora usa el mismo shell size="wide" que Nueva OC/Nuevo Pedido y el mismo
// layout de 2 Cards (datos del encabezado + grilla de ítems), y suma "Fecha
// de recepción" (mig.394) para poder backdatear una recepción que
// físicamente pasó otro día, igual que "Entrega esperada" en Nueva OC.
//
// Segunda vuelta 11/09: faltaba el atajo Enter-agrega-fila (patrón ya
// confirmado en FormNuevaOC/FormNuevaCotizacion/ModalPedidoForm) y el modal
// se cerraba solo al crear, sin mostrar qué quedó registrado (mismo bug ya
// corregido en GenerarMovimientoModal) — `resultado` (controlado por
// RecepcionesSection) reemplaza el formulario por un resumen hasta que el
// usuario cierra a propósito.
function ModalNuevaRecepcion({
  isOpen, onClose,
  proveedores, productos,
  form, setForm,
  addItem, removeItem, updateItem,
  handleSave, saving,
  resultado,
}) {
  const prodRefs = useRef([]);
  const prevItemsLength = useRef(form.items.length);
  useEffect(() => {
    if (form.items.length > prevItemsLength.current) {
      prodRefs.current[form.items.length - 1]?.focus();
    }
    prevItemsLength.current = form.items.length;
  }, [form.items.length]);

  const handleItemRowKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={v => !v && onClose()}>
      <DialogContent size="wide" className="dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="shrink-0">
          <DialogTitle className="dark:text-kx-text">Nueva Recepción</DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {resultado
              ? 'Recepción confirmada. Esto fue lo que quedó registrado.'
              : 'Registrá una recepción de mercadería sin partir de una orden de compra. El stock se suma al confirmar.'}
          </DialogDescription>
        </DialogHeader>

        {resultado ? (
          <div className="flex-1 min-h-0 overflow-y-auto py-2">
            <div className="flex items-center gap-3 pb-4">
              <Check className="h-8 w-8 shrink-0 text-[rgb(var(--kx-green))]" />
              <div>
                <p className="font-semibold text-kx-text">Recepción {resultado.numero} registrada</p>
                <p className="text-sm text-kx-text-2">El stock se sumó correctamente.</p>
              </div>
            </div>
            <div className="border border-kx-border rounded-lg divide-y divide-kx-border">
              {resultado.items.map((it, i) => (
                <div key={`${it.id}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-kx-text truncate pr-2">{it.nombre}</span>
                  <span className="font-mono text-kx-text-2 shrink-0">{it.cantidad} u.</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          <Card className="dark:bg-kx-bg dark:border-kx-border shrink-0">
            <CardContent className="p-3">
              <div className="grid grid-cols-12 gap-3 items-start">
                <div className="col-span-4 space-y-1">
                  <Label className="text-xs dark:text-kx-text">Proveedor (opcional)</Label>
                  <select
                    value={form.proveedor_id}
                    onChange={e => setForm(f => ({ ...f, proveedor_id: e.target.value }))}
                    className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Sin proveedor</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>

                <div className="col-span-3 space-y-1">
                  <Label className="text-xs dark:text-kx-text">Fecha de recepción</Label>
                  <Input
                    type="date"
                    value={form.fecha ?? getTodayAR()}
                    max={getTodayAR()}
                    onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                    className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text dark:[color-scheme:dark]"
                  />
                </div>

                <div className="col-span-5 space-y-1">
                  <Label className="text-xs dark:text-kx-text">Observaciones</Label>
                  <Input
                    placeholder="Motivo de la recepción, referencias, etc."
                    value={form.observaciones}
                    onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))}
                    className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="dark:bg-kx-bg dark:border-kx-border flex-1 min-h-0 flex flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between shrink-0 p-3">
              <CardTitle className="text-sm dark:text-kx-text">Ítems a recibir</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
                <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
              </Button>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden p-3 pt-0">
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
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
                          ref={el => { prodRefs.current[i] = el; }}
                          value={item.producto_id}
                          onChange={e => updateItem(i, 'producto_id', e.target.value)}
                          onKeyDown={handleItemRowKeyDown}
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
                          onKeyDown={handleItemRowKeyDown}
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
            </CardContent>
          </Card>
        </div>
        )}

        <DialogFooter className="shrink-0">
          {resultado ? (
            <Button onClick={onClose} className="bg-[rgb(var(--kx-violet))] hover:opacity-90 text-white">
              Cerrar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} className="dark:text-kx-text dark:border-kx-border">
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white">
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Crear Recepción
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalNuevaRecepcion;
