import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// Defined outside ProductosSection to keep a stable component identity across renders.
// If defined inside, React creates a new function reference every render, causing
// Radix UI portal (Select, Dialog) DOM nodes to unmount/remount and throw removeChild errors.
const ProductForm = ({ data, setData, onSubmit, isEdit = false, providers, categories, isSubmitting, unidadesMedida = [] }) => {
  // En alta (no edit), si todavía no se eligió unidad y ya cargó el maestro, default a "Unidad".
  useEffect(() => {
    if (!isEdit && !data.unidad_medida_id && unidadesMedida.length > 0) {
      const def = unidadesMedida.find(u => u.descripcion === 'Unidad') || unidadesMedida[0];
      if (def) setData(prev => ({ ...prev, unidad_medida_id: def.id, unidad_medida: def.descripcion }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, unidadesMedida]);

  return (
  <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
    <div className="space-y-2">
      <Label htmlFor="nombre">Nombre del Producto *</Label>
      <Input
        id="nombre"
        value={data.nombre}
        onChange={e => setData({...data, nombre: e.target.value})}
        required
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="sku">Código SKU *</Label>
      <Input
        id="sku"
        value={data.codigo_sku}
        onChange={e => setData({...data, codigo_sku: e.target.value})}
        required
        className="bg-kx-surface dark:bg-kx-bg font-mono"
      />
    </div>

    {/* SCANNER — código de barras leído por scanner USB/Bluetooth en el POS */}
    <div className="space-y-2">
      <Label htmlFor="codigo_barras">Código de barras (EAN/UPC)</Label>
      <Input
        id="codigo_barras"
        value={data.codigo_barras || ''}
        onChange={e => setData({...data, codigo_barras: e.target.value})}
        placeholder="Ej: 7790895000443"
        className="bg-kx-surface dark:bg-kx-bg font-mono"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="categoria">Categoría</Label>
      <div className="relative">
        <Input
          id="categoria"
          value={data.categoria_nombre}
          onChange={e => setData({...data, categoria_nombre: e.target.value})}
          list="categories-list"
          placeholder="Escribe o selecciona..."
          className="bg-kx-surface dark:bg-kx-bg"
        />
        <datalist id="categories-list">
          {categories.map(c => <option key={c.id} value={c.nombre} />)}
        </datalist>
      </div>
    </div>

    <div className="space-y-2">
      <Label htmlFor="proveedor">Proveedor</Label>
      <Select
        value={data.proveedor_id || "none"}
        onValueChange={(val) => setData({...data, proveedor_id: val === "none" ? null : val})}
      >
        <SelectTrigger id="proveedor" className="bg-kx-surface dark:bg-kx-bg">
          <SelectValue placeholder="Seleccionar proveedor" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Sin proveedor</SelectItem>
          {providers.map(p => (
            <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    <div className="space-y-2">
      <Label htmlFor="costo">Costo Compra ($)</Label>
      <Input
        id="costo"
        type="text"
        inputMode="decimal"
        placeholder="0,00"
        value={data.costo_compra}
        onChange={e => setData({...data, costo_compra: e.target.value})}
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="precio">Precio Venta ($) *</Label>
      <Input
        id="precio"
        type="text"
        inputMode="decimal"
        placeholder="0,00"
        value={data.precio_venta}
        onChange={e => setData({...data, precio_venta: e.target.value})}
        required
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="stock">Stock Actual</Label>
      <Input
        id="stock"
        type="number"
        min="0"
        step="1"
        value={data.stock_actual}
        onChange={e => setData({...data, stock_actual: e.target.value.replace(/[^\d]/g, '')})}
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="min_stock">Stock Mínimo</Label>
      <Input
        id="min_stock"
        type="number"
        min="0"
        step="1"
        value={data.stock_minimo}
        onChange={e => setData({...data, stock_minimo: e.target.value.replace(/[^\d]/g, '')})}
        className="bg-kx-surface dark:bg-kx-bg"
      />
    </div>

    <div className="space-y-2">
      <Label htmlFor="unidad">Unidad de Medida</Label>
      <select
        id="unidad"
        value={data.unidad_medida_id || ''}
        onChange={e => {
          const id = e.target.value;
          const um = unidadesMedida.find(u => u.id === id);
          setData({
            ...data,
            unidad_medida_id: id || null,
            unidad_medida: um?.descripcion ?? data.unidad_medida,
          });
        }}
        className="w-full h-10 px-3 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-bg dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">— Elegí —</option>
        {unidadesMedida.map(u => (
          <option key={u.id} value={u.id}>{u.codigo} — {u.descripcion}</option>
        ))}
      </select>
      {!data.unidad_medida_id && data.unidad_medida && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Valor actual: "{data.unidad_medida}" — no coincide con el maestro, seleccioná una unidad.
        </p>
      )}
    </div>

    <div className="col-span-1 md:col-span-2 space-y-2">
      <Label htmlFor="desc">Descripción</Label>
      <Textarea
        id="desc"
        value={data.descripcion}
        onChange={e => setData({...data, descripcion: e.target.value})}
        className="bg-kx-surface dark:bg-kx-bg resize-none h-20"
      />
    </div>

    <div className="col-span-1 md:col-span-2 pt-4 flex justify-end gap-2">
      <Button
        type="submit"
        disabled={isSubmitting}
        className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 text-white"
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isEdit ? 'Guardar Cambios' : 'Crear Producto'}
      </Button>
    </div>
  </form>
  );
};

export default ProductForm;
