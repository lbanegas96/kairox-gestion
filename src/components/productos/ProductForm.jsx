import { useEffect, useState } from 'react';
import { Loader2, Boxes, ShoppingCart, ShoppingBag, Wrench, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { factorEntreUnidades, sonConvertibles, getMagnitudLabel } from '@/lib/unidadesMedida';
import ProductoImagenes from '@/components/productos/ProductoImagenes';
import EstadoPublicacionEcommerce from '@/components/productos/EstadoPublicacionEcommerce';
import ConfigMercadoLibreModal from '@/components/productos/ConfigMercadoLibreModal';
import { useEcommerceHabilitado } from '@/hooks/useEcommerceHabilitado';
import { supabase } from '@/lib/customSupabaseClient';

// Fila de toggle tipo de artículo (estilo SAP B1 OITM) — ícono + label + descripción + Switch.
const ToggleTipoArticulo = ({ icon: Icon, label, hint, checked, onCheckedChange, disabled }) => (
  <div className={`flex items-center justify-between gap-3 rounded-lg border border-kx-border p-3 ${disabled ? 'opacity-50' : ''}`}>
    <div className="flex items-start gap-2.5 min-w-0">
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-kx-text-2" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-kx-text">{label}</p>
        <p className="text-xs text-kx-text-3 leading-snug">{hint}</p>
      </div>
    </div>
    <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
  </div>
);

// Defined outside ProductosSection to keep a stable component identity across renders.
// If defined inside, React creates a new function reference every render, causing
// Radix UI portal (Select, Dialog) DOM nodes to unmount/remount and throw removeChild errors.
const ProductForm = ({ data, setData, onSubmit, isEdit = false, providers, categories, isSubmitting, unidadesMedida = [] }) => {
  // Gate de plan: si la empresa no tiene ecommerce (mig.236), se oculta el tilde
  // "Publicar en ecommerce" y su estado — el resto del maestro (flags SAP, imágenes) sigue.
  const { habilitado: ecommerceHabilitado } = useEcommerceHabilitado();

  // MercadoLibre exige categoría + atributos por producto (a diferencia de
  // Tiendanube): mostramos el botón de configurar solo si hay una integración
  // MELI activa (Fase 5).
  const [meliConectado, setMeliConectado] = useState(false);
  const [showConfigMeli, setShowConfigMeli] = useState(false);
  useEffect(() => {
    if (!ecommerceHabilitado) return;
    let vivo = true;
    supabase
      .from('integraciones_canales')
      .select('id')
      .eq('canal', 'mercadolibre')
      .eq('activo', true)
      .maybeSingle()
      .then(({ data }) => { if (vivo) setMeliConectado(!!data); });
    return () => { vivo = false; };
  }, [ecommerceHabilitado]);

  // En alta (no edit), si todavía no se eligió unidad y ya cargó el maestro, default a "Unidad".
  useEffect(() => {
    if (!isEdit && !data.unidad_medida_id && unidadesMedida.length > 0) {
      const def = unidadesMedida.find(u => u.descripcion === 'Unidad') || unidadesMedida[0];
      if (def) setData(prev => ({ ...prev, unidad_medida_id: def.id, unidad_medida: def.descripcion }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, unidadesMedida]);

  // Conversión general (migration 188): si la unidad de stock y la de compra son de
  // la misma magnitud, el factor de conversión se autocalcula desde el maestro.
  const stockUnit = unidadesMedida.find(u => u.id === data.unidad_medida_id) || null;
  const compraUnit = unidadesMedida.find(u => u.id === data.unidad_compra_id) || null;
  const autoFactor = factorEntreUnidades(compraUnit, stockUnit); // 1 compra = autoFactor stock
  const mismaMagnitud = sonConvertibles(compraUnit, stockUnit);

  // Al elegir unidad de compra, si comparte magnitud con la de stock, precargar el factor.
  const handleUnidadCompraChange = (val) => {
    const newId = val || null;
    const nextCompra = unidadesMedida.find(u => u.id === newId) || null;
    const factor = factorEntreUnidades(nextCompra, stockUnit);
    setData({
      ...data,
      unidad_compra_id: newId,
      ...(factor != null ? { factor_conversion_compra: String(factor) } : {}),
    });
  };

  // Unidad de VENTA por pack (migration 189/190) — mismo patrón que compra.
  const ventaUnit = unidadesMedida.find(u => u.id === data.unidad_venta_id) || null;
  const autoFactorVenta = factorEntreUnidades(ventaUnit, stockUnit); // 1 venta = autoFactorVenta stock
  const mismaMagnitudVenta = sonConvertibles(ventaUnit, stockUnit);
  const handleUnidadVentaChange = (val) => {
    const newId = val || null;
    const nextVenta = unidadesMedida.find(u => u.id === newId) || null;
    const factor = factorEntreUnidades(nextVenta, stockUnit);
    setData({
      ...data,
      unidad_venta_id: newId,
      ...(factor != null ? { factor_conversion_venta: String(factor) } : {}),
    });
  };
  // Preview del precio del pack: fijo si está cargado, si no proporcional (factor × precio unit).
  const factorVentaNum = parseFloat(String(data.factor_conversion_venta ?? '').replace(',', '.'));
  const precioUnitNum = parseFloat(String(data.precio_venta ?? '').replace(',', '.'));
  const precioPackFijo = parseFloat(String(data.precio_venta_pack ?? '').replace(',', '.'));
  const descPackNum = parseFloat(String(data.descuento_pack_pct ?? '').replace(',', '.')) || 0;
  const precioPackBase = Number.isFinite(precioPackFijo) && precioPackFijo > 0
    ? precioPackFijo
    : (Number.isFinite(precioUnitNum) && Number.isFinite(factorVentaNum) ? precioUnitNum * factorVentaNum : NaN);
  const precioPackFinal = Number.isFinite(precioPackBase) ? precioPackBase * (1 - descPackNum / 100) : NaN;

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
        disabled={isEdit}
        className="bg-kx-surface dark:bg-kx-bg disabled:opacity-60"
      />
      {isEdit && (
        <p className="text-xs text-kx-text-3">
          El stock se ajusta desde "Ajustar Stock" en la tabla de inventario, no desde acá — así queda
          registrado en el historial de movimientos.
        </p>
      )}
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

    {/* Factor de conversión de unidad de compra (roadmap SAP) — opcional. Si no se
        configura, la compra sigue siendo en la misma unidad que el stock, sin cambios. */}
    <div className="space-y-2">
      <Label htmlFor="unidad_compra">Unidad de Compra (opcional)</Label>
      <select
        id="unidad_compra"
        value={data.unidad_compra_id || ''}
        onChange={e => handleUnidadCompraChange(e.target.value)}
        className="w-full h-10 px-3 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-bg dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Igual que la unidad de stock</option>
        {unidadesMedida.map(u => (
          <option key={u.id} value={u.id}>{u.codigo} — {u.descripcion}</option>
        ))}
      </select>
      <p className="text-xs text-kx-text-3">
        Elegí esto si comprás en una unidad distinta a la que manejás en stock (ej: comprás por Caja, stockeás por Unidad).
      </p>
    </div>
    {data.unidad_compra_id && (
      <div className="space-y-2">
        <Label htmlFor="factor_conversion">Factor de conversión</Label>
        <Input
          id="factor_conversion"
          type="text"
          inputMode="decimal"
          placeholder="12"
          value={data.factor_conversion_compra}
          onChange={e => setData({ ...data, factor_conversion_compra: e.target.value })}
          className="bg-kx-surface dark:bg-kx-bg"
        />
        {mismaMagnitud && autoFactor != null ? (
          <p className="text-xs text-blue-600 dark:text-blue-400">
            Autocompletado desde el maestro: 1 {compraUnit?.codigo} = {Number(autoFactor).toLocaleString('es-AR', { maximumFractionDigits: 6 })} {stockUnit?.codigo}
            {' '}(misma magnitud: {getMagnitudLabel(compraUnit?.magnitud)}). Ajustá solo si tu empaque difiere.
          </p>
        ) : (
          <p className="text-xs text-kx-text-3">
            1 unidad de compra = cuántas unidades de stock. Ej: 1 Caja = 12 Unidades → poné 12.
          </p>
        )}
      </div>
    )}

    {/* Unidad de VENTA por pack (roadmap SAP, mig.189/190) — opcional. Si no se
        configura, la venta sigue en la unidad de stock, sin cambios. */}
    <div className="space-y-2">
      <Label htmlFor="unidad_venta">Unidad de Venta / Pack (opcional)</Label>
      <select
        id="unidad_venta"
        value={data.unidad_venta_id || ''}
        onChange={e => handleUnidadVentaChange(e.target.value)}
        className="w-full h-10 px-3 rounded-md border border-kx-border bg-kx-surface text-slate-900 dark:bg-kx-bg dark:border-kx-border dark:text-kx-text text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Igual que la unidad de stock</option>
        {unidadesMedida.map(u => (
          <option key={u.id} value={u.id}>{u.codigo} — {u.descripcion}</option>
        ))}
      </select>
      <p className="text-xs text-kx-text-3">
        Elegí esto si vendés en una unidad/pack distinta a la de stock (ej: stockeás por Unidad, vendés por Six-pack).
      </p>
    </div>
    {data.unidad_venta_id && (
      <div className="space-y-2">
        <Label htmlFor="factor_conversion_venta">Factor de conversión</Label>
        <Input
          id="factor_conversion_venta"
          type="text"
          inputMode="decimal"
          placeholder="6"
          value={data.factor_conversion_venta ?? ''}
          onChange={e => setData({ ...data, factor_conversion_venta: e.target.value })}
          className="bg-kx-surface dark:bg-kx-bg"
        />
        {mismaMagnitudVenta && autoFactorVenta != null ? (
          <p className="text-xs text-blue-600 dark:text-blue-400">
            Autocompletado: 1 {ventaUnit?.codigo} = {Number(autoFactorVenta).toLocaleString('es-AR', { maximumFractionDigits: 6 })} {stockUnit?.codigo}
            {' '}(misma magnitud: {getMagnitudLabel(ventaUnit?.magnitud)}). Ajustá si tu pack difiere.
          </p>
        ) : (
          <p className="text-xs text-kx-text-3">
            1 pack = cuántas unidades de stock. Ej: 1 Six-pack = 6 Unidades → poné 6.
          </p>
        )}
      </div>
    )}
    {data.unidad_venta_id && (
      <>
        <div className="space-y-2">
          <Label htmlFor="precio_venta_pack">Precio del pack ($) — opcional</Label>
          <Input
            id="precio_venta_pack"
            type="text"
            inputMode="decimal"
            placeholder="dejalo vacío = proporcional"
            value={data.precio_venta_pack ?? ''}
            onChange={e => setData({ ...data, precio_venta_pack: e.target.value })}
            className="bg-kx-surface dark:bg-kx-bg"
          />
          <p className="text-xs text-kx-text-3">
            Precio fijo del pack. Si lo dejás vacío, se calcula proporcional (factor × precio unitario).
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="descuento_pack_pct">Descuento fijo del pack (%) — opcional</Label>
          <Input
            id="descuento_pack_pct"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={data.descuento_pack_pct ?? ''}
            onChange={e => setData({ ...data, descuento_pack_pct: e.target.value })}
            className="bg-kx-surface dark:bg-kx-bg"
          />
          <p className="text-xs text-kx-text-3">
            Se aplica automático al vender por pack (encima del precio). El vendedor puede sumar un descuento manual en el momento.
          </p>
          {Number.isFinite(precioPackFinal) && (
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Precio final del pack: ${precioPackFinal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {descPackNum > 0 && Number.isFinite(precioPackBase) ? ` (${descPackNum}% off de $${precioPackBase.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : ''}
            </p>
          )}
        </div>
      </>
    )}

    {/* ── Tipo de artículo (SAP B1 OITM) — en qué procesos participa ────────── */}
    <div className="col-span-1 md:col-span-2 space-y-2">
      <Label>Tipo de artículo</Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <ToggleTipoArticulo
          icon={Wrench}
          label="Es un servicio"
          hint="Mano de obra, flete, honorarios. No maneja stock."
          checked={!!data.es_servicio}
          onCheckedChange={(v) => setData({
            ...data,
            es_servicio: v,
            // Un servicio nunca es inventariable (lo fuerza el CHECK en DB).
            ...(v ? { es_inventariable: false } : {}),
          })}
        />
        <ToggleTipoArticulo
          icon={Boxes}
          label="Inventariable"
          hint="Mueve stock. Se descuenta al vender, se suma al comprar."
          checked={!!data.es_inventariable}
          disabled={!!data.es_servicio}
          onCheckedChange={(v) => setData({ ...data, es_inventariable: v })}
        />
        <ToggleTipoArticulo
          icon={ShoppingCart}
          label="Artículo de venta"
          hint="Aparece en cotizaciones, pedidos y facturas de venta."
          checked={!!data.es_articulo_venta}
          onCheckedChange={(v) => setData({ ...data, es_articulo_venta: v })}
        />
        <ToggleTipoArticulo
          icon={ShoppingBag}
          label="Artículo de compra"
          hint="Aparece en órdenes de compra y facturas de proveedor."
          checked={!!data.es_articulo_compra}
          onCheckedChange={(v) => setData({ ...data, es_articulo_compra: v })}
        />
      </div>
    </div>

    {/* ── Exposición a ecommerce (Tiendanube) — solo si el plan tiene ecommerce ── */}
    {ecommerceHabilitado && (
      <div className="col-span-1 md:col-span-2">
        <ToggleTipoArticulo
          icon={Globe}
          label="Publicar en ecommerce"
          hint="Expone este artículo a los canales conectados (Tiendanube y MercadoLibre). KAIROX es la fuente de verdad: los cambios de acá se publican allá."
          checked={!!data.publicar_ecommerce}
          onCheckedChange={(v) => setData({ ...data, publicar_ecommerce: v })}
        />
        {isEdit && data.id && (
          <EstadoPublicacionEcommerce productoId={data.id} publicarEcommerce={!!data.publicar_ecommerce} />
        )}

        {/* MercadoLibre: configurar categoría + atributos obligatorios (Fase 5). */}
        {isEdit && data.id && data.publicar_ecommerce && meliConectado && (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-8 text-xs gap-1.5"
              onClick={() => setShowConfigMeli(true)}
            >
              <span className="w-4 h-4 rounded bg-[#FFE600] text-[#2D3277] text-[10px] font-bold flex items-center justify-center">ML</span>
              Configurar publicación en MercadoLibre
            </Button>
            <ConfigMercadoLibreModal
              open={showConfigMeli}
              onOpenChange={setShowConfigMeli}
              producto={{ id: data.id, nombre: data.nombre }}
            />
          </>
        )}
      </div>
    )}

    {/* ── Imágenes ─────────────────────────────────────────────────────────── */}
    {isEdit && data.id ? (
      <ProductoImagenes productoId={data.id} publicarEcommerce={!!data.publicar_ecommerce} />
    ) : (
      <div className="col-span-1 md:col-span-2 text-xs text-kx-text-3 border border-dashed border-kx-border rounded-lg p-3">
        📷 Guardá el producto primero para poder agregarle imágenes.
      </div>
    )}

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
