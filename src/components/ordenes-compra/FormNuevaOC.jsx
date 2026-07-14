import { Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { formatCurrency } from '@/lib/currencyUtils';
import { FORMAS_PAGO, EMPTY_ITEM } from './shared';

function FormNuevaOC({
  form, setForm,
  items, setItems,
  provSearch, provResults,
  searchProveedor, selectProveedor,
  prodResults, searchProducto, selectProducto,
  updateItem,
  unidadesMedida,
  tcMissingOC, setTcMissingOC,
  total,
  handleSubmit, resetForm,
  createMutation,
}) {
  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      <Card className="dark:bg-kx-bg dark:border-kx-border">
        <CardHeader><CardTitle className="text-base dark:text-kx-text">Datos del Pedido</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Proveedor */}
          <div className="space-y-2 relative">
            <Label className="dark:text-kx-text">Proveedor</Label>
            <Input value={provSearch} onChange={e => searchProveedor(e.target.value)}
              placeholder="Buscar proveedor..." className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            {provResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-20 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1">
                {provResults.map(p => (
                  <button key={p.id} type="button" onClick={() => selectProveedor(p)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text">
                    {p.nombre}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label className="dark:text-kx-text">Forma de pago</Label>
            <select value={form.forma_pago} onChange={e => setForm(f => ({ ...f, forma_pago: e.target.value }))}
              className="w-full h-10 rounded-md border border-kx-border dark:border-kx-border bg-kx-surface dark:bg-kx-surface px-3 text-sm text-slate-700 dark:text-slate-300">
              {FORMAS_PAGO.map(fp => <option key={fp}>{fp}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="dark:text-kx-text">Fecha de entrega esperada</Label>
            <Input type="date" value={form.fecha_entrega_esperada}
              onChange={e => setForm(f => ({ ...f, fecha_entrega_esperada: e.target.value }))}
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
          </div>

          <div className="space-y-2">
            <Label className="dark:text-kx-text">Notas internas</Label>
            <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
              placeholder="Instrucciones especiales, referencia, etc."
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
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
        </CardContent>
      </Card>

      {/* Ítems */}
      <Card className="dark:bg-kx-bg dark:border-kx-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base dark:text-kx-text">Productos a pedir</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => setItems(prev => [...prev, { ...EMPTY_ITEM }])}
            className="dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
            <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Header de columnas */}
          <div className="hidden md:grid grid-cols-12 gap-2 text-xs text-kx-text-3 uppercase font-semibold px-1">
            <div className="col-span-5">Producto / Descripción</div>
            <div className="col-span-2">Cantidad</div>
            <div className="col-span-2">Unidad</div>
            <div className="col-span-2">Costo unit.</div>
            <div className="col-span-1"></div>
          </div>

          {items.map((item, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-5 relative">
                <Input value={item._prodSearch ?? item.descripcion}
                  onChange={e => searchProducto(idx, e.target.value)}
                  placeholder="Buscar producto o describir"
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                {(prodResults[idx] ?? []).length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-20 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1 max-h-40 overflow-y-auto">
                    {prodResults[idx].map(p => (
                      <button key={p.id} type="button" onClick={() => selectProducto(idx, p)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text flex justify-between">
                        <span>{p.nombre}</span>
                        <span className="text-kx-text-3 text-xs">Costo: ${p.costo_compra ?? '—'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <Input type="number" min="1" step="1" value={item.cantidad_pedida}
                  onChange={e => updateItem(idx, 'cantidad_pedida', e.target.value.replace(/[^\d]/g, ''))}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
              </div>
              <div className="col-span-2">
                <select
                  value={item.unidad_medida || ''}
                  onChange={e => updateItem(idx, 'unidad_medida', e.target.value)}
                  className="w-full h-10 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Elegí —</option>
                  {unidadesMedida.map(u => (
                    <option key={u.id} value={u.descripcion}>{u.descripcion} ({u.codigo.toLowerCase()})</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <Input type="text" inputMode="decimal" value={item.costo_unitario} placeholder="0,00"
                  onChange={e => updateItem(idx, 'costo_unitario', e.target.value)}
                  className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-kx-text-3 hover:text-kx-red"
                  onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))} disabled={items.length === 1}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}

          <div className="flex justify-end pt-4 border-t border-kx-border dark:border-kx-border">
            <div className="text-right">
              <span className="text-sm text-kx-text-2 mr-4">Total pedido:</span>
              <span className="text-2xl font-bold font-mono text-slate-900 dark:text-kx-text">
                {formatCurrency(total, form.moneda)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3 justify-end">
        <Button type="button" variant="outline" onClick={resetForm} className="dark:border-kx-border dark:text-slate-300">Limpiar</Button>
        <div className="flex flex-col items-end gap-1">
          <Button
            type="submit"
            disabled={createMutation.isPending || (form.moneda !== 'ARS' && tcMissingOC)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
          >
            <ShoppingBag className="w-4 h-4" />
            {createMutation.isPending ? 'Guardando...' : 'Crear Orden de Compra'}
          </Button>
          {form.moneda !== 'ARS' && tcMissingOC && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ Cargá el TC del día para habilitar la creación de la OC
            </p>
          )}
        </div>
      </div>
    </form>
  );
}

export default FormNuevaOC;
