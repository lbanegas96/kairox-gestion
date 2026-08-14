import { useRef, useEffect } from 'react';
import { Plus, Trash2, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { formatCurrency } from '@/lib/currencyUtils';
import ProductoAutocomplete from '@/components/shared/ProductoAutocomplete';

// Mismo set que el CHECK de pedido_items.alicuota_iva (mig.320) — mismo criterio
// que ALICUOTAS_COT en FormNuevaCotizacion.jsx.
const ALICUOTAS_PED = [
  { value: '21', label: '21%' },
  { value: '10.5', label: '10.5%' },
  { value: '0', label: '0%' },
  { value: 'exento', label: 'Exento' },
  { value: 'no_gravado', label: 'No gravado' },
];

function ModalPedidoForm({
  isModalOpen, setIsModalOpen,
  editingPedido,
  form, setForm,
  clientes,
  addItem,
  removeItem,
  updateItem,
  prodSearch, prodResults, prodOpen, setProdOpen, searchProducto, selectProducto,
  totales, discrimina,
  tcMissing, setTcMissing,
  handleSave,
  saving,
}) {
  // Mismo patrón que FormNuevaCotizacion.jsx: Enter agrega una fila nueva y le
  // pasa el foco, salvo en Descripción/Producto con el desplegable de
  // autocompletar abierto — ahí Enter elige el producto resaltado en vez de
  // agregar fila, y reenfoca Cantidad a mano (el <button> del desplegable se
  // desmonta al elegir y el navegador perdía el foco sin este fix).
  const descRefs = useRef([]);
  const cantRefs = useRef([]);
  const prevItemsLength = useRef(form.items.length);
  useEffect(() => {
    if (form.items.length > prevItemsLength.current) {
      descRefs.current[form.items.length - 1]?.focus();
    }
    prevItemsLength.current = form.items.length;
  }, [form.items.length]);

  const handleItemRowKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addItem();
    }
  };

  const selectProductoYAvanzar = (idx, prod) => {
    selectProducto(idx, prod);
    cantRefs.current[idx]?.focus();
    cantRefs.current[idx]?.select?.();
  };

  const handleDescripcionKeyDown = (idx) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const results = prodOpen[idx] ? (prodResults[idx] ?? []) : [];
      if (results.length > 0) {
        selectProductoYAvanzar(idx, results[0]);
        return;
      }
      addItem();
    }
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={v => { if (!v) setIsModalOpen(false); }}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[92vh] flex flex-col dark:bg-kx-bg dark:border-kx-border">
        <DialogHeader className="shrink-0">
          <DialogTitle className="dark:text-kx-text">
            {editingPedido ? `Editar ${editingPedido.numero}` : 'Nuevo Pedido'}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {editingPedido ? 'Modificá los ítems del pedido en borrador.' : 'Cargá los productos y datos del pedido.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
          {/* Datos del pedido — una sola fila de 12 columnas, mismo criterio
              densidad SAP que FormNuevaCotizacion.jsx. */}
          <div className="dark:bg-kx-bg dark:border-kx-border border border-kx-border rounded-lg p-3 shrink-0">
            <div className="grid grid-cols-12 gap-3 items-start">
              <div className="col-span-4 space-y-1">
                <Label className="text-xs dark:text-kx-text">Cliente</Label>
                <select
                  value={form.cliente_id}
                  onChange={e => setForm(f => ({ ...f, cliente_id: e.target.value }))}
                  className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Sin cliente</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs dark:text-kx-text">Fecha de Entrega</Label>
                <Input
                  type="date"
                  value={form.fecha_entrega}
                  onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))}
                  className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
              <div className="col-span-3 space-y-1">
                <Label className="text-xs dark:text-kx-text">N° Referencia del Cliente (PO)</Label>
                <Input
                  value={form.referencia_cliente}
                  onChange={e => setForm(f => ({ ...f, referencia_cliente: e.target.value }))}
                  placeholder="Ej. orden de compra del cliente"
                  className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
              <div className="col-span-2">
                <MonedaSelector
                  moneda={form.moneda}
                  tasa={form.tipoCambioTasa}
                  onMonedaChange={v => setForm(f => ({ ...f, moneda: v, tipoCambioTasa: v === 'ARS' ? 1 : f.tipoCambioTasa }))}
                  onTasaChange={v => setForm(f => ({ ...f, tipoCambioTasa: v }))}
                  onTCMissingChange={setTcMissing}
                />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs dark:text-kx-text" title="Se aplica sobre el subtotal, después de los descuentos por línea">Desc. Global %</Label>
                <Input
                  type="text" inputMode="decimal" placeholder="0"
                  value={form.descuentoGlobalPct}
                  onChange={e => setForm(f => ({ ...f, descuentoGlobalPct: e.target.value }))}
                  className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                />
              </div>
            </div>
          </div>

          <div className="dark:bg-kx-bg dark:border-kx-border border border-kx-border rounded-lg flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between shrink-0 p-3 pb-2">
              <Label className="text-sm dark:text-kx-text">Ítems del Pedido</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
                <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
              </Button>
            </div>
            <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden p-3 pt-0">
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                {form.items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-5 space-y-1" data-prod-row>
                      <Label className="text-xs dark:text-kx-text-2">Descripción / Producto</Label>
                      <ProductoAutocomplete
                        inputRef={el => { descRefs.current[idx] = el; }}
                        value={prodSearch[idx] ?? item.descripcion}
                        onChange={e => { searchProducto(idx, e.target.value); updateItem(idx, 'descripcion', e.target.value); setProdOpen(prev => ({ ...prev, [idx]: true })); }}
                        onFocus={() => { searchProducto(idx, prodSearch[idx] ?? item.descripcion ?? ''); setProdOpen(prev => ({ ...prev, [idx]: true })); }}
                        onKeyDown={handleDescripcionKeyDown(idx)}
                        open={prodOpen[idx]}
                        results={prodResults[idx] ?? []}
                        onSelect={p => selectProductoYAvanzar(idx, p)}
                      />
                    </div>
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Cant.</Label>
                      <Input
                        ref={el => { cantRefs.current[idx] = el; }}
                        type="number" min="1" step="1" value={item.cantidad}
                        onChange={e => updateItem(idx, 'cantidad', e.target.value.replace(/[^\d]/g, ''))}
                        onKeyDown={handleItemRowKeyDown}
                        className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm"
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">Precio Unit.</Label>
                      <Input type="text" inputMode="decimal" placeholder="0,00" value={item.precio_unitario} onChange={e => updateItem(idx, 'precio_unitario', e.target.value)} onKeyDown={handleItemRowKeyDown} className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">IVA</Label>
                      <select
                        value={item.alicuota_iva || '21'}
                        onChange={e => updateItem(idx, 'alicuota_iva', e.target.value)}
                        className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {ALICUOTAS_PED.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                      </select>
                    </div>
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs dark:text-kx-text-2">% Desc.</Label>
                      <Input type="text" inputMode="decimal" placeholder="0" value={item.descuento_item} onChange={e => updateItem(idx, 'descuento_item', e.target.value)} onKeyDown={handleItemRowKeyDown} className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                    </div>
                    <div className="col-span-1 flex justify-end pb-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-kx-red" onClick={() => removeItem(idx)} disabled={form.items.length === 1}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2 border-t border-kx-border dark:border-kx-border shrink-0">
                <div className="text-right space-y-0.5 min-w-[220px]">
                  <div className="flex justify-between text-xs text-slate-500 dark:text-kx-text-2">
                    <span>Subtotal</span>
                    <span className="font-mono">{formatCurrency(totales.subtotal, form.moneda)}</span>
                  </div>
                  {totales.descuento > 0.005 && (
                    <div className="flex justify-between text-xs text-kx-red">
                      <span>Descuento</span>
                      <span className="font-mono">-{formatCurrency(totales.descuento, form.moneda)}</span>
                    </div>
                  )}
                  {discrimina && (
                    <>
                      <div className="flex justify-between text-xs text-slate-500 dark:text-kx-text-2">
                        <span>Neto gravado</span>
                        <span className="font-mono">{formatCurrency(totales.neto, form.moneda)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-slate-500 dark:text-kx-text-2">
                        <span>IVA</span>
                        <span className="font-mono">{formatCurrency(totales.iva, form.moneda)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between pt-0.5">
                    <span className="text-xs text-slate-500 dark:text-kx-text-2 self-center">Total</span>
                    <span className="text-lg font-bold text-slate-900 dark:text-kx-text font-mono">
                      {formatCurrency(totales.total, form.moneda)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-1 shrink-0">
            <Label className="text-xs dark:text-kx-text">Notas internas</Label>
            <Textarea
              placeholder="Instrucciones especiales, referencias, etc."
              value={form.notas}
              onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              className="resize-none h-16 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
          </div>
        </div>

        <DialogFooter className="shrink-0">
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
