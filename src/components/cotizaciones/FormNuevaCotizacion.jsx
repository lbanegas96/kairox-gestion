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
  condicionesPago,
  allClientes, showClienteDropdown, setShowClienteDropdown, clienteWrapperRef,
  tcMissing, setTcMissing,
  totales,
  handleSubmit, resetForm,
  onCancel,
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
      <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col gap-4 overflow-hidden">
        <Card className="dark:bg-kx-bg dark:border-kx-border shrink-0">
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
                        onClick={() => {
                          const condicionCliente = condicionesPago.find(cp => cp.id === c.condicion_pago_id);
                          setForm(f => ({
                            ...f,
                            cliente_id: c.id,
                            cliente_nombre: c.nombre,
                            ...(condicionCliente ? { condiciones_pago: condicionCliente.nombre } : {}),
                          }));
                          setShowClienteDropdown(false);
                        }}
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
              <select
                value={form.condiciones_pago}
                onChange={e => setForm(f => ({ ...f, condiciones_pago: e.target.value }))}
                className="w-full h-10 px-2 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {form.condiciones_pago === '' && <option value="">— Elegí —</option>}
                {condicionesPago.map(c => {
                  const yaMencionaDias = /d[ií]as?/i.test(c.nombre);
                  return (
                    <option key={c.id} value={c.nombre}>
                      {c.nombre}{!yaMencionaDias && c.dias_credito > 0 ? ` (${c.dias_credito} días)` : ''}{c.descuento_pct > 0 ? ` · ${c.descuento_pct}% desc.` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Fecha de Vencimiento</Label>
              <Input
                type="date"
                value={form.fecha_vencimiento}
                onChange={e => setForm(f => ({ ...f, fecha_vencimiento: e.target.value }))}
                // Abre el selector de calendario al clickear en cualquier parte del
                // campo, no solo en el ícono nativo — showPicker() no existe en
                // todos los navegadores (ej. Safari viejo), por eso el optional
                // chaining: si no está disponible, el click simplemente pone el
                // foco en el input como siempre.
                onClick={e => e.currentTarget.showPicker?.()}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
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

        <Card className="dark:bg-kx-bg dark:border-kx-border flex-1 min-h-0 flex flex-col overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between shrink-0">
            <CardTitle className="text-base dark:text-kx-text">Ítems</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addItem} className="dark:border-kx-border dark:text-slate-300 dark:hover:bg-slate-800">
              <Plus className="w-3.5 h-3.5 mr-1" /> Agregar ítem
            </Button>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 flex flex-col gap-3 overflow-hidden">
            {/* Solo esta lista scrollea si hay muchos ítems — el resto del modal
                (datos del cliente, totales, botones de abajo) queda siempre a la
                vista sin tener que scrollear todo el diálogo. */}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
            {items.map((item, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4 space-y-1 relative" data-prod-row>
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
                <div className="col-span-1 space-y-1">
                  <Label className="text-xs dark:text-kx-text-2">% Desc.</Label>
                  <Input type="text" inputMode="decimal" placeholder="0" value={item.descuento_item} onChange={e => updateItem(idx, 'descuento_item', e.target.value)} className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text text-sm" />
                </div>
                <div className="col-span-1 flex justify-end pb-0.5">
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-kx-text-3 hover:text-kx-red" onClick={() => removeItem(idx)} disabled={items.length === 1}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            </div>

            <div className="flex justify-end pt-4 border-t border-kx-border dark:border-kx-border shrink-0">
              <div className="text-right space-y-1 min-w-[220px]">
                <div className="flex justify-between text-sm text-slate-500 dark:text-kx-text-2">
                  <span>Subtotal</span>
                  <span className="font-mono">{formatCurrency(totales.subtotal, form.moneda)}</span>
                </div>
                {totales.descuento > 0 && (
                  <div className="flex justify-between text-sm text-kx-red">
                    <span>Descuento</span>
                    <span className="font-mono">-{formatCurrency(totales.descuento, form.moneda)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1">
                  <span className="text-sm text-slate-500 dark:text-kx-text-2 self-center">Total</span>
                  <span className="text-2xl font-bold text-slate-900 dark:text-kx-text font-mono">
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
