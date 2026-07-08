import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MonedaSelector } from '@/components/ui/MonedaSelector';
import { formatCurrency } from '@/lib/currencyUtils';

function FormNuevaCotizacion({
  form, setForm,
  items, addItem, removeItem, updateItem,
  prodSearch, prodResults, prodOpen, setProdOpen, searchProducto, selectProducto,
  unidadesMedida,
  allClientes, showClienteDropdown, setShowClienteDropdown, clienteWrapperRef,
  tcMissing, setTcMissing,
  total,
  handleSubmit, resetForm,
  createMutation,
}) {
  return (
    <>
      {/* Opciones globales de unidad de medida para los <input list="..."> de los ítems */}
      <datalist id="unidades-medida">
        <option value="un" />
        <option value="kg" />
        <option value="g" />
        <option value="l" />
        <option value="ml" />
        <option value="m" />
        <option value="cm" />
        <option value="mm" />
        <option value="m²" />
        <option value="m³" />
        <option value="caja" />
        <option value="paquete" />
        <option value="docena" />
        <option value="par" />
        <option value="hora" />
        <option value="día" />
        <option value="servicio" />
      </datalist>
      <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
        <Card className="dark:bg-kx-bg dark:border-kx-border">
          <CardHeader><CardTitle className="text-base dark:text-kx-text">Datos del Cliente</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 relative" ref={clienteWrapperRef}>
              <Label className="dark:text-kx-text">Nombre del Cliente</Label>
              <Input
                value={form.cliente_nombre}
                onChange={e => { setForm(f => ({ ...f, cliente_nombre: e.target.value, cliente_id: '' })); setShowClienteDropdown(true); }}
                onFocus={() => setShowClienteDropdown(true)}
                placeholder="Buscar cliente existente o escribir uno nuevo"
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
                autoComplete="off"
              />
              {showClienteDropdown && (() => {
                const q = form.cliente_nombre.toLowerCase().trim();
                const filtered = q ? allClientes.filter(c => c.nombre.toLowerCase().includes(q)) : allClientes;
                const shown = filtered.slice(0, 8);
                if (shown.length === 0) return null;
                return (
                  <div className="absolute top-full left-0 right-0 z-30 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1 max-h-56 overflow-y-auto">
                    {shown.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text"
                        onClick={() => { setForm(f => ({ ...f, cliente_id: c.id, cliente_nombre: c.nombre })); setShowClienteDropdown(false); }}
                      >
                        {c.nombre}
                      </button>
                    ))}
                    {q && !allClientes.some(c => c.nombre.toLowerCase() === q) && (
                      <div className="px-3 py-2 text-xs text-slate-500 dark:text-kx-text-2 border-t border-slate-100 dark:border-kx-border italic">
                        O tipeá un nombre nuevo y se guardará como texto libre.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Condiciones de Pago</Label>
              <Input value={form.condiciones_pago} onChange={e => setForm(f => ({ ...f, condiciones_pago: e.target.value }))} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            </div>
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Fecha de Vencimiento</Label>
              <Input type="date" value={form.fecha_vencimiento} onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            </div>
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Notas</Label>
              <Input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones opcionales" className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text" />
            </div>
            <div className="space-y-2 col-span-2">
              <MonedaSelector
                moneda={form.moneda}
                tasa={form.tipoCambioTasa}
                onMonedaChange={v => setForm(f => ({ ...f, moneda: v, tipoCambioTasa: v === 'ARS' ? 1 : f.tipoCambioTasa }))}
                onTasaChange={v => setForm(f => ({ ...f, tipoCambioTasa: v }))}
                onTCMissingChange={setTcMissing}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="dark:bg-kx-bg dark:border-kx-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base dark:text-kx-text">Ítems</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addItem} className="dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
              <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-5 space-y-1 relative" data-prod-row>
                  <Label className="text-xs dark:text-kx-text-2">Descripción / Producto</Label>
                  <Input
                    value={prodSearch[idx] ?? item.descripcion}
                    onChange={e => { searchProducto(idx, e.target.value); updateItem(idx, 'descripcion', e.target.value); setProdOpen(prev => ({ ...prev, [idx]: true })); }}
                    onFocus={() => { searchProducto(idx, prodSearch[idx] ?? item.descripcion ?? ''); setProdOpen(prev => ({ ...prev, [idx]: true })); }}
                    placeholder="Buscar producto o escribir descripción"
                    className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm"
                    autoComplete="off"
                  />
                  {prodOpen[idx] && (prodResults[idx] ?? []).length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-30 bg-kx-surface dark:bg-kx-surface border border-kx-border dark:border-kx-border rounded-lg shadow-xl mt-1 max-h-56 overflow-y-auto">
                      {prodResults[idx].map(p => (
                        <button key={p.id} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-kx-surface-2 dark:hover:bg-slate-800 dark:text-kx-text flex justify-between items-center" onClick={() => selectProducto(idx, p)}>
                          <span className="truncate">{p.nombre}</span>
                          <span className="text-kx-text-3 text-xs ml-2 flex-shrink-0">${Number(p.precio_venta ?? 0).toLocaleString('es-AR')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">Cantidad</Label>
                  <Input type="number" min="1" step="1" value={item.cantidad} onChange={e => updateItem(idx, 'cantidad', e.target.value.replace(/[^\d]/g, ''))} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">Unidad</Label>
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
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">Precio Unit.</Label>
                  <Input type="text" inputMode="decimal" placeholder="0,00" value={item.precio_unitario} onChange={e => updateItem(idx, 'precio_unitario', e.target.value)} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                </div>
                <div className="col-span-1 flex justify-end pb-0.5">
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-kx-text-3 hover:text-red-500" onClick={() => removeItem(idx)} disabled={items.length === 1}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}

            <div className="flex justify-end pt-4 border-t border-kx-border dark:border-kx-border">
              <div className="text-right">
                <span className="text-sm text-slate-500 dark:text-kx-text-2 mr-4">Total:</span>
                <span className="text-2xl font-bold text-slate-900 dark:text-kx-text font-mono">
                  {formatCurrency(total, form.moneda)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={resetForm} className="dark:border-kx-border dark:text-slate-300">Limpiar</Button>
          <Button
            type="submit"
            disabled={createMutation.isPending || (form.moneda !== 'ARS' && tcMissing)}
            className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
            title={form.moneda !== 'ARS' && tcMissing ? `Cargá el tipo de cambio ${form.moneda} del día para continuar` : undefined}
          >
            {createMutation.isPending ? 'Guardando...' : 'Guardar Cotización'}
          </Button>
        </div>
      </form>
    </>
  );
}

export default FormNuevaCotizacion;
