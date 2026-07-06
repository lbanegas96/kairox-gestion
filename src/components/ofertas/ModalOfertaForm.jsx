import React from 'react';
import { Tag, Percent, DollarSign, Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { DIAS, MEDIOS_PAGO } from './shared';

function ModalOfertaForm({
  modalOpen, setModalOpen,
  editingOferta,
  form, setForm,
  prodSearch, setProdSearch,
  productos, filteredProductos,
  toggleDia,
  handleSave, isSaving,
}) {
  return (
    <Dialog open={modalOpen} onOpenChange={setModalOpen}>
      <DialogContent className="max-w-lg dark:bg-kx-bg dark:border-kx-border max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="dark:text-kx-text flex items-center gap-2">
            <Tag className="w-5 h-5 text-emerald-500" />
            {editingOferta ? 'Editar oferta' : 'Nueva oferta'}
          </DialogTitle>
          <DialogDescription className="dark:text-kx-text-2">
            {editingOferta
              ? 'Modificá los datos de la oferta.'
              : 'Configurá un descuento automático que se aplique en el POS.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
          {/* Nombre */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Nombre *</Label>
            <Input
              value={form.nombre}
              onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder="ej: 10% en Ferretería, Promo Efectivo"
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              autoFocus
            />
          </div>

          {/* Descripción */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">
              Descripción <span className="text-kx-text-3 font-normal">(opcional)</span>
            </Label>
            <textarea
              value={form.descripcion}
              onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
              placeholder="Descripción interna de la oferta"
              rows={2}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-kx-surface dark:border-kx-border dark:text-kx-text resize-none"
            />
          </div>

          {/* Tipo de descuento */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Tipo de descuento</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, tipo_descuento: 'porcentaje' }))}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                  form.tipo_descuento === 'porcentaje'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400'
                    : 'bg-white border-slate-200 text-slate-500 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text-2 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Percent className="w-4 h-4" /> Porcentaje %
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, tipo_descuento: 'monto_fijo' }))}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md border text-sm font-medium transition-colors ${
                  form.tipo_descuento === 'monto_fijo'
                    ? 'bg-blue-50 border-blue-300 text-blue-700 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-400'
                    : 'bg-white border-slate-200 text-slate-500 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text-2 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <DollarSign className="w-4 h-4" /> Monto fijo $
              </button>
            </div>
          </div>

          {/* Valor del descuento */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">
              {form.tipo_descuento === 'porcentaje' ? 'Porcentaje de descuento (%)' : 'Monto a descontar ($)'} *
            </Label>
            <Input
              type="number"
              min="0"
              max={form.tipo_descuento === 'porcentaje' ? '100' : undefined}
              step="0.01"
              value={form.valor_descuento}
              onChange={e => setForm(f => ({ ...f, valor_descuento: e.target.value }))}
              placeholder={form.tipo_descuento === 'porcentaje' ? 'Ej: 10' : 'Ej: 500'}
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
          </div>

          {/* Separador: Condiciones */}
          <div className="flex items-center gap-3 pt-2">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-kx-text-3 uppercase font-medium">Condiciones (opcionales)</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          {/* Producto específico */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Producto específico</Label>
            <div className="space-y-2">
              {form.producto_id && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                  <span className="text-sm text-emerald-700 dark:text-emerald-400 flex-1 truncate">
                    {productos.find(p => p.id === form.producto_id)?.nombre ?? 'Producto seleccionado'}
                  </span>
                  <button onClick={() => setForm(f => ({ ...f, producto_id: null }))}
                    className="text-emerald-500 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <Input
                value={prodSearch}
                onChange={e => setProdSearch(e.target.value)}
                placeholder="Buscar producto..."
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
              {prodSearch && (
                <div className="max-h-32 overflow-y-auto rounded-md border border-slate-200 dark:border-kx-border bg-white dark:bg-kx-surface">
                  {filteredProductos.length === 0 ? (
                    <p className="p-2 text-xs text-kx-text-3 text-center">Sin resultados</p>
                  ) : filteredProductos.slice(0, 20).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setForm(f => ({ ...f, producto_id: p.id }));
                        setProdSearch('');
                      }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 text-kx-text dark:text-kx-text truncate"
                    >
                      {p.nombre} {p.categorias?.nombre && <span className="text-kx-text-3 text-xs">· {p.categorias.nombre}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Categoría */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Categoría</Label>
            <Input
              value={form.categoria_nombre}
              onChange={e => setForm(f => ({ ...f, categoria_nombre: e.target.value }))}
              placeholder="Ej: Tecnología, Ferretería"
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
            <p className="text-xs text-kx-text-3">
              Debe coincidir exactamente con la categoría del producto.
              {form.producto_id && ' Si ya elegiste un producto específico arriba, este campo se ignora.'}
            </p>
          </div>

          {/* Medio de pago */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Medio de pago</Label>
            <select
              value={form.medio_pago}
              onChange={e => setForm(f => ({ ...f, medio_pago: e.target.value }))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            >
              {MEDIOS_PAGO.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Días de la semana */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Días de la semana</Label>
            <div className="flex flex-wrap gap-2">
              {DIAS.map(dia => (
                <label key={dia.value}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm cursor-pointer transition-colors ${
                    form.dia_semana.includes(dia.value)
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-400'
                      : 'bg-white border-slate-200 text-slate-500 dark:bg-kx-surface dark:border-kx-border dark:text-kx-text-2'
                  }`}
                >
                  <Checkbox
                    checked={form.dia_semana.includes(dia.value)}
                    onCheckedChange={() => toggleDia(dia.value)}
                    className="h-3.5 w-3.5"
                  />
                  {dia.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-kx-text-3">Sin selección = todos los días</p>
          </div>

          {/* Monto mínimo carrito */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Monto mínimo del carrito</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.monto_minimo_carrito}
              onChange={e => setForm(f => ({ ...f, monto_minimo_carrito: e.target.value }))}
              placeholder="Ej: 50000"
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
          </div>

          {/* Cantidad mínima */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Cantidad mínima del producto</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.cantidad_minima}
              onChange={e => setForm(f => ({ ...f, cantidad_minima: e.target.value }))}
              placeholder="Ej: 3"
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
          </div>

          {/* Separador: Vigencia */}
          <div className="flex items-center gap-3 pt-2">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-kx-text-3 uppercase font-medium">Vigencia (opcional)</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Fecha desde</Label>
              <Input
                type="date"
                value={form.fecha_desde}
                onChange={e => setForm(f => ({ ...f, fecha_desde: e.target.value }))}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
            <div className="space-y-2">
              <Label className="dark:text-kx-text">Fecha hasta</Label>
              <Input
                type="date"
                value={form.fecha_hasta}
                onChange={e => setForm(f => ({ ...f, fecha_hasta: e.target.value }))}
                className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
              />
            </div>
          </div>

          {/* Separador: Configuración */}
          <div className="flex items-center gap-3 pt-2">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-kx-text-3 uppercase font-medium">Configuración</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          {/* Prioridad */}
          <div className="space-y-2">
            <Label className="dark:text-kx-text">Prioridad</Label>
            <Input
              type="number"
              min="0"
              value={form.prioridad}
              onChange={e => setForm(f => ({ ...f, prioridad: e.target.value }))}
              className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text"
            />
            <p className="text-xs text-kx-text-3">Mayor número = se aplica primero si hay conflictos</p>
          </div>

          {/* Acumulable */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-kx-border p-3">
            <div>
              <p className="text-sm font-medium text-kx-text dark:text-kx-text">¿Acumulable con descuento manual?</p>
              <p className="text-xs text-kx-text-3">Permitir que el cajero agregue descuento adicional</p>
            </div>
            <Switch
              checked={form.acumulable}
              onCheckedChange={v => setForm(f => ({ ...f, acumulable: v }))}
            />
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={() => setModalOpen(false)} className="dark:border-kx-border dark:text-slate-300">
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !form.nombre.trim() || !form.valor_descuento || parseFloat(form.valor_descuento) <= 0}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isSaving ? <Loader2 className="animate-spin w-4 h-4 mr-2" /> : <Check className="w-4 h-4 mr-2" />}
            {editingOferta ? 'Guardar cambios' : 'Crear oferta'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ModalOfertaForm;
