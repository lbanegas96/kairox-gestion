import { useState, useEffect, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2, FileText, Info, AlertTriangle, Check } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useToast } from '@/components/ui/use-toast';
import { getTodayAR, getNowAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';
import ProveedorSelector from '@/components/shared/ProveedorSelector';

const ALICUOTAS = [
  { value: 0,    label: 'Exento 0%' },
  { value: 10.5, label: '10.5%'     },
  { value: 21,   label: '21%'       },
  { value: 27,   label: '27%'       },
];

const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'CC Proveedor'];

const newItem = () => ({
  _id:          Math.random().toString(36).slice(2),
  producto_id:  null,
  descripcion:  '',
  cantidad:     1,
  precio_unit:  0,
  alicuota_iva: 21,
});

const calcNeto = (item) => {
  const n = Number(item.cantidad) * (parseNumberLocale(item.precio_unit) || 0);
  return isNaN(n) ? 0 : n;
};

function NuevaFacturaProveedorModal({ open, onOpenChange, compraOrigen = null, onSuccess }) {
  const { user }                          = useAuth();
  const { currentSession, isSessionOpen } = useCaja();
  const { toast }                         = useToast();

  const [proveedores, setProveedores]     = useState([]);
  const [proveedorId, setProveedorId]     = useState('');
  const [numeroFactura, setNumeroFactura] = useState('');
  const [fecha, setFecha]                 = useState(getTodayAR());
  const [formaPago, setFormaPago]         = useState('CC Proveedor');
  const [items, setItems]                 = useState([newItem()]);
  const [productosCache, setProductosCache] = useState([]);
  const [searchFocusId, setSearchFocusId] = useState(null);
  const [loading, setLoading]             = useState(false);
  const tcParalelo                        = useTCParalelo();
  const [showParaleloTCModal, setShowParaleloTCModal] = useState(false);

  // ── Carga al abrir ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open || !user?.empresa_id) return;

    supabase.from('proveedores').select('id, nombre')
      .eq('empresa_id', user.empresa_id).neq('activo', false).order('nombre')
      .then(({ data }) => setProveedores(data || []));

    if (compraOrigen?.id) {
      setProveedorId(compraOrigen.proveedor_id || '');
      supabase.from('detalle_compras')
        .select('id, producto_id, cantidad, costo_unitario, alicuota_iva, productos(nombre)')
        .eq('compra_id', compraOrigen.id)
        .eq('empresa_id', user.empresa_id)
        .then(({ data }) => {
          if (data?.length > 0) {
            setItems(data.map(i => ({
              _id:          Math.random().toString(36).slice(2),
              producto_id:  i.producto_id,
              descripcion:  i.productos?.nombre || '',
              cantidad:     Number(i.cantidad),
              precio_unit:  Number(i.costo_unitario),
              alicuota_iva: Number(i.alicuota_iva ?? 21),
            })));
          }
        });
    }
  }, [open, user?.empresa_id, compraOrigen?.id]);

  // ── Reset al cerrar ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setProveedorId('');
      setNumeroFactura('');
      setFecha(getTodayAR());
      setFormaPago('CC Proveedor');
      setItems([newItem()]);
      setSearchFocusId(null);
    }
  }, [open]);

  // ── Búsqueda de productos ───────────────────────────────────────────────────
  const loadProductos = async () => {
    if (productosCache.length > 0) return;
    const { data } = await supabase.from('productos')
      .select('id, nombre, costo_compra, alicuota_iva')
      .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre').limit(500);
    setProductosCache(data || []);
  };

  const getProductosFiltrados = (query) => {
    if (!query || query.length < 2) return [];
    return productosCache.filter(p => p.nombre.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
  };

  const selectProducto = (rowId, producto) => {
    setItems(prev => prev.map(i =>
      i._id === rowId
        ? { ...i, producto_id: producto.id, descripcion: producto.nombre,
            precio_unit: Number(producto.costo_compra || 0),
            alicuota_iva: Number(producto.alicuota_iva ?? 21) }
        : i
    ));
    setSearchFocusId(null);
  };

  const updateItem = (id, field, value) =>
    setItems(prev => prev.map(i => i._id === id ? { ...i, [field]: value } : i));
  const removeItem = (id) => setItems(prev => prev.filter(i => i._id !== id));
  const addItem    = ()   => setItems(prev => [...prev, newItem()]);

  // ── Cálculos ────────────────────────────────────────────────────────────────
  const subtotalNeto = useMemo(() => items.reduce((s, i) => s + calcNeto(i), 0), [items]);
  const totalIva     = useMemo(() =>
    items.reduce((s, i) => s + calcNeto(i) * Number(i.alicuota_iva) / 100, 0), [items]);
  const total        = subtotalNeto + totalIva;
  const isCC         = formaPago === 'CC Proveedor';

  // ── Confirmar ───────────────────────────────────────────────────────────────
  const handleConfirmar = async () => {
    if (!proveedorId && isCC) {
      toast({ title: 'Proveedor requerido para Cuenta Corriente', variant: 'destructive' });
      return;
    }
    const itemsValidos = items.filter(i => i.descripcion.trim());
    if (itemsValidos.length === 0) {
      toast({ title: 'Agregá al menos un ítem con descripción', variant: 'destructive' });
      return;
    }
    if (total <= 0) {
      toast({ title: 'El total debe ser mayor a cero', variant: 'destructive' });
      return;
    }
    if (formaPago === 'Efectivo' && !isSessionOpen) {
      toast({ title: 'Abrí la caja para registrar pago en Efectivo', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const now = getNowAR().toISOString();
      const provNombre = proveedores.find(p => p.id === proveedorId)?.nombre || 'Proveedor';

      // Moneda paralela: equivalente en la moneda paralela de la empresa (este flujo es ARS-only)
      const montoParaleloValue = tcParalelo.enabled && tcParalelo.tcHoy
        ? tcParalelo.calcParalelo(total, 'ARS', 1)
        : null;

      // Items sin producto (servicios) → descripción en observaciones
      const serviciosDesc = itemsValidos
        .filter(i => !i.producto_id)
        .map(i => `${i.descripcion} (x${i.cantidad} × $${i.precio_unit})`)
        .join(' | ');

      // 1. INSERT compras
      const { data: compra, error: compraErr } = await supabase.from('compras').insert([{
        empresa_id:       user.empresa_id,
        user_id:          user.id,
        proveedor_id:     proveedorId || null,
        numero_factura:   numeroFactura.trim() || null,
        fecha:            now,
        forma_pago:       formaPago,
        estado_pago:      isCC ? 'pendiente' : 'pagada',
        total,
        neto_gravado:     subtotalNeto,
        iva_discriminado: totalIva,
        moneda:           'ARS',
        tipo_cambio_tasa: 1,
        observaciones:    serviciosDesc || null,
        ...(montoParaleloValue !== null ? {
          monto_paralelo: montoParaleloValue,
          tc_paralelo:    tcParalelo.tcHoy,
        } : {}),
      }]).select('id').single();
      if (compraErr) throw compraErr;

      // 2. INSERT detalle_compras — solo ítems con producto_id (columna NOT NULL)
      const itemsConProducto = itemsValidos.filter(i => i.producto_id);
      if (itemsConProducto.length > 0) {
        const { error: itemsErr } = await supabase.from('detalle_compras').insert(
          itemsConProducto.map(i => ({
            compra_id:      compra.id,
            empresa_id:     user.empresa_id,
            producto_id:    i.producto_id,
            cantidad:       Number(i.cantidad),
            costo_unitario: parseNumberLocale(i.precio_unit) || 0,
            subtotal:       calcNeto(i),
            alicuota_iva:   String(i.alicuota_iva),
          }))
        );
        if (itemsErr) throw itemsErr;
      }

      // 3. CC Proveedor → cargo (aumenta deuda con proveedor)
      if (isCC && proveedorId) {
        const { error: ccErr } = await supabase.from('cuenta_corriente_proveedores').insert([{
          empresa_id:      user.empresa_id,
          user_id:         user.id,
          proveedor_id:    proveedorId,
          tipo:            'compra',
          monto:           total,
          descripcion:     `Factura ${numeroFactura || 'S/N'} — ${provNombre}`,
          referencia_id:   compra.id,
          referencia_tipo: 'factura_compra',
          fecha:           now,
        }]);
        if (ccErr) throw ccErr;
      }

      // 4. Efectivo + caja abierta → movimientos_caja (egreso)
      if (formaPago === 'Efectivo' && isSessionOpen && currentSession?.id) {
        const { error: cajaErr } = await supabase.from('movimientos_caja').insert([{
          empresa_id:     user.empresa_id,
          user_id:        user.id,
          caja_sesion_id: currentSession.id,
          tipo:           'egreso',
          categoria:      'Compra',
          concepto:       `Factura proveedor ${numeroFactura || 'S/N'} — ${provNombre}`,
          monto:          total,
          metodo_pago:    'Efectivo',
          is_automatic:   true,
          fecha:          now,
          ...(montoParaleloValue !== null ? {
            monto_paralelo: montoParaleloValue,
            tc_paralelo:    tcParalelo.tcHoy,
          } : {}),
        }]);
        if (cajaErr) throw cajaErr;
      }

      toast({ title: `Factura de proveedor registrada${numeroFactura ? ` — ${numeroFactura}` : ''}` });
      onSuccess?.({ id: compra.id, total });
      onOpenChange(false);
    } catch (err) {
      console.error('[NuevaFacturaProveedor]', err);
      toast({ title: 'Error al registrar la factura', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const fmt = (n) => Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl bg-kx-surface border-kx-border text-kx-text max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b border-kx-border shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <FileText className="w-5 h-5 text-kx-blue" />
            {compraOrigen
              ? `Copiar a Factura — ${compraOrigen.numero_factura || 'S/N'}`
              : 'Nueva Factura de Proveedor'}
          </DialogTitle>
          <DialogDescription className="text-kx-text-2 text-xs">
            Factura financiera — no afecta stock. Para registrar mercadería recibida, usá el flujo OC → Recepción.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Banner */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/30 text-xs text-blue-700 dark:text-blue-300">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Esta factura <strong>no modifica el inventario</strong>. Para registrar mercadería recibida, usá el flujo OC → Recepción.
            </span>
          </div>

          {/* Datos básicos */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="sm:col-span-2 space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Proveedor</Label>
              <ProveedorSelector
                proveedores={proveedores}
                value={proveedorId}
                onChange={setProveedorId}
                onProveedorCreado={p => { setProveedores(prev => [...prev, p]); setProveedorId(p.id); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">N° Factura del Proveedor</Label>
              <Input
                placeholder="A-0001-00012345"
                value={numeroFactura}
                onChange={e => setNumeroFactura(e.target.value)}
                className="h-10 bg-kx-surface border-kx-border text-kx-text font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-kx-text-2">Fecha</Label>
              <Input
                type="date"
                value={fecha}
                onChange={e => setFecha(e.target.value)}
                className="h-10 bg-kx-surface border-kx-border text-kx-text"
              />
            </div>
          </div>

          {/* Tabla de ítems */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-kx-text">Ítems</h3>
              <Button size="sm" variant="outline" onClick={addItem}
                className="h-7 gap-1 text-xs border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
                <Plus className="w-3.5 h-3.5" /> Agregar ítem
              </Button>
            </div>

            <div className="border border-kx-border rounded-xl overflow-visible">
              <table className="w-full text-sm">
                <thead className="bg-kx-surface-2 border-b border-kx-border">
                  <tr className="text-[11px] text-kx-text-2 font-semibold uppercase tracking-wide">
                    <th className="text-left px-3 py-2.5 w-[38%]">Descripción</th>
                    <th className="text-center px-3 py-2.5 w-16">Cant.</th>
                    <th className="text-right px-3 py-2.5 w-32">Costo Unit.</th>
                    <th className="text-center px-3 py-2.5 w-24">IVA</th>
                    <th className="text-right px-3 py-2.5 w-28">Subtotal</th>
                    <th className="px-3 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-kx-border">
                  {items.map(item => {
                    const filtrados = getProductosFiltrados(item.descripcion);
                    return (
                      <tr key={item._id} className="hover:bg-kx-surface-2/50 transition-colors">
                        <td className="px-2 py-1.5">
                          <div className="relative">
                            <Input
                              placeholder="Descripción o buscar producto..."
                              value={item.descripcion}
                              onChange={e => {
                                updateItem(item._id, 'descripcion', e.target.value);
                                if (item.producto_id) updateItem(item._id, 'producto_id', null);
                              }}
                              onFocus={() => { setSearchFocusId(item._id); loadProductos(); }}
                              onBlur={() => setTimeout(() => setSearchFocusId(null), 200)}
                              className="h-8 text-xs bg-transparent border-kx-border text-kx-text pr-14"
                            />
                            <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              item.producto_id
                                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                                : 'bg-kx-surface-2 text-kx-text-3'
                            }`}>
                              {item.producto_id ? 'PROD' : 'SERV'}
                            </span>
                            {searchFocusId === item._id && item.descripcion.length >= 2 && filtrados.length > 0 && (
                              <div className="absolute top-full left-0 z-50 w-72 bg-kx-surface border border-kx-border rounded-xl shadow-2xl mt-1 max-h-48 overflow-y-auto">
                                {filtrados.map(p => (
                                  <button
                                    key={p.id}
                                    className="w-full text-left px-3 py-2 text-xs text-kx-text hover:bg-kx-surface-2 transition-colors first:rounded-t-xl last:rounded-b-xl"
                                    onMouseDown={() => selectProducto(item._id, p)}
                                  >
                                    <div className="font-medium">{p.nombre}</div>
                                    <div className="text-kx-text-3">Costo: ${fmt(p.precio_costo || 0)}</div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="number" min="1" step="1" value={item.cantidad}
                            onChange={e => updateItem(item._id, 'cantidad', e.target.value.replace(/[^\d]/g, ''))}
                            className="h-8 text-xs text-center bg-transparent border-kx-border text-kx-text w-full"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Input
                            type="text" inputMode="decimal" placeholder="0,00" value={item.precio_unit}
                            onChange={e => updateItem(item._id, 'precio_unit', e.target.value)}
                            className="h-8 text-xs text-right bg-transparent border-kx-border text-kx-text w-full"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={item.alicuota_iva}
                            onChange={e => updateItem(item._id, 'alicuota_iva', Number(e.target.value))}
                            className="w-full h-8 rounded-md border border-kx-border bg-kx-surface px-1.5 text-xs text-kx-text"
                          >
                            {ALICUOTAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs font-semibold text-kx-text tabular-nums">
                          ${fmt(calcNeto(item))}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          {items.length > 1 && (
                            <Button size="icon" variant="ghost" onClick={() => removeItem(item._id)}
                              className="h-7 w-7 text-kx-text-3 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {items.some(i => !i.producto_id && i.descripcion.trim()) && (
              <p className="text-[10px] text-kx-text-3 mt-1.5">
                Los ítems SERV no afectan inventario — su descripción se guarda en observaciones.
              </p>
            )}
          </div>

          {/* Totales + Pago */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-kx-surface-2 rounded-xl border border-kx-border p-4 space-y-2 text-sm">
              <div className="flex justify-between text-kx-text-2">
                <span>Subtotal neto</span>
                <span className="tabular-nums">${fmt(subtotalNeto)}</span>
              </div>
              {totalIva > 0 && (
                <div className="flex justify-between text-kx-text-2">
                  <span>IVA</span>
                  <span className="tabular-nums">${fmt(totalIva)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-base text-kx-text border-t border-kx-border pt-2 mt-2">
                <span>TOTAL A PAGAR</span>
                <span className="tabular-nums text-kx-blue">${fmt(total)}</span>
              </div>
              {tcParalelo.enabled && tcParalelo.tcHoy && total > 0 && (
                <div className="flex justify-between text-xs text-kx-text-3">
                  <span>Equivalente:</span>
                  <span>≈ {fmt(tcParalelo.calcParalelo(total, 'ARS', 1))} {tcParalelo.monedaParalela}</span>
                </div>
              )}
            </div>

            <div className="bg-kx-surface-2 rounded-xl border border-kx-border p-4 space-y-3">
              <Label className="text-xs font-medium text-kx-text-2 block">Forma de pago</Label>
              <div className="grid grid-cols-3 gap-2">
                {FORMAS_PAGO.map(fp => (
                  <button
                    key={fp}
                    type="button"
                    onClick={() => setFormaPago(fp)}
                    className={`p-2.5 rounded-lg border text-xs font-medium transition-all ${
                      formaPago === fp
                        ? 'border-[rgb(var(--kx-blue))] bg-[rgb(var(--kx-blue)/0.08)] text-[rgb(var(--kx-blue))]'
                        : 'border-kx-border text-kx-text-2 hover:bg-kx-surface hover:border-kx-text-3'
                    }`}
                  >
                    {fp}
                  </button>
                ))}
              </div>
              {isCC && (
                <div className="flex items-center gap-1.5 text-xs text-kx-amber">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  Genera deuda en Cuenta Corriente del proveedor
                </div>
              )}
              {/* Banner de paridad: visible cuando la empresa usa moneda paralela */}
              {tcParalelo.enabled && !tcParalelo.loading && (
                tcParalelo.tcMissing ? (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2 border border-amber-200 dark:border-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>Sin TC de paridad {tcParalelo.monedaParalela} del día</span>
                    <Button type="button" size="sm" variant="outline"
                      className="ml-auto h-6 text-xs px-2 border-amber-400 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                      onClick={() => setShowParaleloTCModal(true)}>
                      Cargar TC
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg px-3 py-2 border border-emerald-200 dark:border-emerald-800">
                    <Check className="h-3.5 w-3.5 flex-shrink-0" />
                    Paridad {tcParalelo.monedaParalela}: 1 {tcParalelo.monedaParalela} = ${Number(tcParalelo.tcHoy || 0).toLocaleString('es-AR')} ARS
                  </div>
                )
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-kx-border shrink-0">
          <div className="flex gap-3 w-full justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}
              className="border-kx-border text-kx-text-2 hover:bg-kx-surface-2">
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmar}
              disabled={loading || total <= 0}
              style={{ background: 'rgb(var(--kx-blue))', color: '#fff' }}
              className="gap-2 hover:opacity-90"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Registrando...</>
                : <><FileText className="w-4 h-4" /> Registrar Factura</>}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>

      <TipoCambioModal
        open={showParaleloTCModal}
        onOpenChange={setShowParaleloTCModal}
        moneda={tcParalelo.monedaParalela}
        onConfirm={(t) => { tcParalelo.setTC(t); setShowParaleloTCModal(false); }}
      />
    </Dialog>
  );
}

export default NuevaFacturaProveedorModal;
