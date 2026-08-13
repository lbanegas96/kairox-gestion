import { useRef, useEffect } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { formatCurrency } from '@/lib/currencyUtils';
import { FORMAS_PAGO, EMPTY_ITEM } from './shared';

// Mismo set que el CHECK de ordenes_compra_items.alicuota_iva (mig.322) — igual
// criterio que ALICUOTAS_COT/ALICUOTAS_PED en Cotizaciones/Pedidos.
const ALICUOTAS_OC = [
  { value: '21', label: '21%' },
  { value: '10.5', label: '10.5%' },
  { value: '0', label: '0%' },
  { value: 'exento', label: 'Exento' },
  { value: 'no_gravado', label: 'No gravado' },
];

function FormNuevaOC({
  form, setForm,
  items, setItems,
  provSearch, provResults, selectedProv,
  searchProveedor, selectProveedor,
  prodResults, prodOpen, setProdOpen, searchProducto, selectProducto,
  updateItem,
  unidadesMedida,
  tcMissingOC, setTcMissingOC,
  totales,
  handleSubmit, resetForm,
  onCancel,
  createMutation,
  isEditing = false,
}) {
  // Mismo patrón que FormNuevaCotizacion.jsx/ModalPedidoForm.jsx: Enter agrega
  // una fila nueva y le pasa el foco a su Descripción, salvo que el desplegable
  // de autocompletar esté abierto con resultados — ahí Enter elige el producto
  // resaltado y reenfoca Cantidad a mano (el <button> del desplegable se
  // desmonta al elegir y el navegador perdería el foco sin este fix, bug real
  // ya corregido en Cotizaciones/Pedidos).
  const descRefs = useRef([]);
  const cantRefs = useRef([]);
  const prevItemsLength = useRef(items.length);
  useEffect(() => {
    if (items.length > prevItemsLength.current) {
      descRefs.current[items.length - 1]?.focus();
    }
    prevItemsLength.current = items.length;
  }, [items.length]);

  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

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
    <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
      <Card className="dark:bg-kx-bg dark:border-kx-border shrink-0">
        <CardContent className="p-3">
          <div className="grid grid-cols-12 gap-3 items-start">
            <div className="col-span-3 space-y-1 relative">
              <Label className="text-xs dark:text-kx-text">Proveedor</Label>
              <Input value={provSearch} onChange={e => searchProveedor(e.target.value)}
                placeholder="Buscar proveedor..." className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
              {provResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-30 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1">
                  {provResults.map(p => (
                    <button key={p.id} type="button" onClick={() => selectProveedor(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text">
                      {p.nombre}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs dark:text-kx-text">Forma de pago</Label>
              <select value={form.forma_pago} onChange={e => setForm(f => ({ ...f, forma_pago: e.target.value }))}
                className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {FORMAS_PAGO.map(fp => <option key={fp}>{fp}</option>)}
              </select>
            </div>

            <div className="col-span-2 space-y-1">
              <Label className="text-xs dark:text-kx-text">Entrega esperada</Label>
              <Input type="date" value={form.fecha_entrega_esperada}
                onChange={e => setForm(f => ({ ...f, fecha_entrega_esperada: e.target.value }))}
                className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            </div>

            <div className="col-span-2">
              <MonedaSelector
                moneda={form.moneda}
                tasa={form.tipoCambioTasa}
                onMonedaChange={v => {
                  setForm(f => ({ ...f, moneda: v, tipoCambioTasa: v === 'ARS' ? 1 : f.tipoCambioTasa }));
                  if (v === 'ARS') setTcMissingOC(false);
                }}
                onTasaChange={v => setForm(f => ({ ...f, tipoCambioTasa: v }))}
                onTCMissingChange={setTcMissingOC}
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

            <div className="col-span-2 space-y-1">
              <Label className="text-xs dark:text-kx-text">Notas internas</Label>
              <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                placeholder="Instrucciones especiales, referencia, etc."
                className="h-8 text-sm dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="dark:bg-kx-bg dark:border-kx-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between shrink-0 p-3">
          <CardTitle className="text-sm dark:text-kx-text">Productos a pedir</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 text-xs dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
            <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
          </Button>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden p-3 pt-0">
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4 space-y-1 relative" data-prod-row>
                  <Label className="text-xs dark:text-kx-text-2">Producto / Descripción</Label>
                  <Input
                    ref={el => { descRefs.current[idx] = el; }}
                    value={item._prodSearch ?? item.descripcion}
                    onChange={e => { searchProducto(idx, e.target.value); setProdOpen(prev => ({ ...prev, [idx]: true })); }}
                    onFocus={() => setProdOpen(prev => ({ ...prev, [idx]: true }))}
                    onKeyDown={handleDescripcionKeyDown(idx)}
                    placeholder="Buscar producto o describir"
                    className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm"
                    autoComplete="off"
                  />
                  {prodOpen[idx] && (prodResults[idx] ?? []).length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-30 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1 max-h-40 overflow-y-auto">
                      {prodResults[idx].map(p => (
                        <button key={p.id} type="button" onClick={() => selectProductoYAvanzar(idx, p)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text flex justify-between">
                          <span>{p.nombre}</span>
                          <span className="text-kx-text-3 text-xs">Costo: ${p.costo_compra ?? '—'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">Cant.</Label>
                  <Input
                    ref={el => { cantRefs.current[idx] = el; }}
                    type="number" min="1" step="1" value={item.cantidad_pedida}
                    onChange={e => updateItem(idx, 'cantidad_pedida', e.target.value.replace(/[^\d]/g, ''))}
                    onKeyDown={handleItemRowKeyDown}
                    className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">Unidad</Label>
                  <select
                    value={item.unidad_medida || ''}
                    onChange={e => updateItem(idx, 'unidad_medida', e.target.value)}
                    className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Elegí —</option>
                    {unidadesMedida.map(u => (
                      <option key={u.id} value={u.descripcion}>{u.descripcion} ({u.codigo.toLowerCase()})</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">Costo unit.</Label>
                  <Input type="text" inputMode="decimal" value={item.costo_unitario} placeholder="0,00"
                    onChange={e => updateItem(idx, 'costo_unitario', e.target.value)}
                    onKeyDown={handleItemRowKeyDown}
                    className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">IVA</Label>
                  <select
                    value={item.alicuota_iva || '21'}
                    onChange={e => updateItem(idx, 'alicuota_iva', e.target.value)}
                    className="w-full h-8 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {ALICUOTAS_OC.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">% Desc.</Label>
                  <Input type="text" inputMode="decimal" placeholder="0" value={item.descuento_item}
                    onChange={e => updateItem(idx, 'descuento_item', e.target.value)}
                    onKeyDown={handleItemRowKeyDown}
                    className="h-8 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                </div>
                <div className="col-span-1 flex justify-end pb-0.5">
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-kx-text-3 hover:text-kx-red"
                    onClick={() => removeItem(idx)} disabled={items.length === 1}>
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
              {/* Neto/IVA siempre visible en Compras — a diferencia de Ventas, no
                  se condiciona a ninguna letra (ver nota en OrdenesCompraSection.jsx). */}
              <div className="flex justify-between text-xs text-slate-500 dark:text-kx-text-2">
                <span>Neto gravado</span>
                <span className="font-mono">{formatCurrency(totales.neto, form.moneda)}</span>
              </div>
              <div className="flex justify-between text-xs text-slate-500 dark:text-kx-text-2">
                <span>IVA</span>
                <span className="font-mono">{formatCurrency(totales.iva, form.moneda)}</span>
              </div>
              <div className="flex justify-between pt-0.5">
                <span className="text-xs text-slate-500 dark:text-kx-text-2 self-center">Total</span>
                <span className="text-lg font-bold text-slate-900 dark:text-kx-text font-mono">
                  {formatCurrency(totales.total, form.moneda)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end shrink-0">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="dark:border-kx-border dark:text-slate-300">Cancelar</Button>
        )}
        <Button type="button" variant="outline" onClick={resetForm} className="dark:border-kx-border dark:text-slate-300">Limpiar</Button>
        <div className="flex flex-col items-end gap-1">
          <Button
            type="submit"
            disabled={createMutation.isPending || (form.moneda !== 'ARS' && tcMissingOC)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
          >
            {createMutation.isPending ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Orden de Compra'}
          </Button>
          {form.moneda !== 'ARS' && tcMissingOC && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ Cargá el TC del día para habilitar el guardado
            </p>
          )}
        </div>
      </div>
    </form>
  );
}

export default FormNuevaOC;
