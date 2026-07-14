import { useState, useMemo, useEffect } from 'react';
import { ShoppingCart, Trash2, Plus, Minus, CheckCircle, Loader2, AlertTriangle, Tag, Boxes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ClienteSelector from '@/components/shared/ClienteSelector';
import { useConfirmarVenta } from '@/hooks/useConfirmarVenta';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const fmt = (n) =>
  Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const METODOS = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cuenta Corriente'];

// OFERTAS — calcula precio final de un item considerando oferta automática + descuento manual
function getPrecioConDescuento(item, oferta, descuentoManualPct) {
  let precio = item.precio_venta;
  if (oferta) {
    precio = oferta.precio_final;
    if (oferta.acumulable && descuentoManualPct > 0) {
      precio = precio * (1 - descuentoManualPct / 100);
    }
  } else if (descuentoManualPct > 0) {
    precio = precio * (1 - descuentoManualPct / 100);
  }
  return Math.round(precio * 100) / 100;
}

function CarritoItem({ item, onModificar, onEliminar, oferta, descuentoManual, onDescuentoManualChange, onTogglePack, onUpdatePacks }) {
  const precioFinal = getPrecioConDescuento(item, oferta, descuentoManual);
  const tieneDescuento = oferta || descuentoManual > 0;
  const subtotal = precioFinal * item.cantidad;
  const packMode = !!item._packMode;

  return (
    <div className="bg-kx-surface-2 rounded-xl px-3 py-2 space-y-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-kx-text truncate">{item.nombre}</p>
          {tieneDescuento ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-kx-text-3 line-through tabular-nums">${fmt(item.precio_venta)}</span>
              <span className="text-xs font-semibold text-emerald-500 tabular-nums">${fmt(precioFinal)} c/u</span>
            </div>
          ) : (
            <p className="text-xs text-kx-text-3 tabular-nums">${fmt(item.precio_venta)} c/u</p>
          )}
          {packMode && (
            <p className="text-2xs text-amber-500 tabular-nums">${fmt(item._precioUnidadVenta)} / {item.unidad_venta?.codigo || 'pack'}</p>
          )}
          {/* OFERTAS — badge con nombre de la oferta */}
          {oferta && (
            <span className="inline-flex items-center gap-1 text-2xs font-medium text-emerald-500 mt-0.5">
              <Tag className="w-2.5 h-2.5" /> {oferta.oferta_nombre}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {packMode ? (
            <div className="flex flex-col items-center">
              <Input
                type="number" min="1"
                value={item._packs}
                onChange={e => onUpdatePacks?.(item.id, e.target.value)}
                className="w-14 h-7 text-center text-sm bg-kx-surface border-kx-border text-kx-text p-0"
              />
              <span className="text-[9px] text-kx-text-3">= {item.cantidad} u</span>
            </div>
          ) : (
            <>
              <button
                onClick={() => onModificar(item.id, item.cantidad - 1)}
                className="w-6 h-6 rounded-full bg-kx-border flex items-center justify-center hover:bg-kx-text-3/20 transition-colors"
              >
                <Minus className="w-3 h-3 text-kx-text" />
              </button>
              <Input
                type="number"
                value={item.cantidad}
                onChange={e => onModificar(item.id, parseInt(e.target.value) || 1)}
                className="w-12 h-7 text-center text-sm bg-kx-surface border-kx-border text-kx-text p-0"
              />
              <button
                onClick={() => onModificar(item.id, item.cantidad + 1)}
                className="w-6 h-6 rounded-full bg-kx-border flex items-center justify-center hover:bg-kx-text-3/20 transition-colors"
              >
                <Plus className="w-3 h-3 text-kx-text" />
              </button>
            </>
          )}
          <button
            onClick={() => onEliminar(item.id)}
            className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors ml-1"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
        <div className="w-20 text-right flex-shrink-0">
          <span className={`text-sm font-bold tabular-nums ${tieneDescuento ? 'text-emerald-500' : 'text-kx-text'}`}>
            ${fmt(subtotal)}
          </span>
        </div>
      </div>
      {/* Toggle venta por pack — solo si el producto tiene unidad de venta configurada */}
      {item.unidad_venta_id && onTogglePack && (
        <button
          type="button"
          onClick={() => onTogglePack(item.id)}
          className={`inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded border transition-colors ${packMode ? 'border-amber-400 text-amber-500 bg-amber-500/10' : 'border-kx-border text-kx-text-3 hover:bg-kx-border/40'}`}
        >
          <Boxes className="w-3 h-3" />
          {packMode
            ? `Vendiendo por ${item.unidad_venta?.descripcion || 'pack'} (x${item.factor_conversion_venta}) — volver a unidad`
            : `Vender por ${item.unidad_venta?.descripcion || 'pack'} (x${item.factor_conversion_venta})`}
        </button>
      )}
      {/* OFERTAS — input de descuento manual (visible si no hay oferta, o si la oferta es acumulable) */}
      {(!oferta || oferta.acumulable) && (
        <div className="flex items-center gap-1.5 pl-0.5">
          <span className="text-2xs text-kx-text-3">Dto:</span>
          <input
            type="number"
            min="0"
            max="100"
            value={descuentoManual || ''}
            onChange={e => onDescuentoManualChange?.(item.id, parseFloat(e.target.value) || 0)}
            placeholder="0"
            className="w-12 h-5 text-2xs text-center rounded border border-kx-border bg-kx-surface text-kx-text px-1"
          />
          <span className="text-2xs text-kx-text-3">%</span>
        </div>
      )}
    </div>
  );
}

function PanelCarrito({
  carrito, onModificarCarrito, onVentaExitosa,
  onTogglePack, onUpdatePacks,
  ofertasCarrito = {}, descuentosManuales = {},
  onDescuentoManualChange, medioPago = 'Efectivo', onMedioPagoChange,
}) {
  const { user }    = useAuth();
  const [clientes, setClientes]     = useState([]);
  const [clienteId, setClienteId]   = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [centrosCosto, setCentrosCosto]     = useState([]);
  const [centroCostoId, setCentroCostoId]   = useState('');
  const { confirmar, loading }      = useConfirmarVenta();

  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase
      .from('clientes')
      .select('id, nombre, condicion_iva, documento, telefono, limite_credito, saldo_actual')
      .eq('empresa_id', user.empresa_id)
      .neq('activo', false)
      .order('nombre')
      .then(({ data }) => setClientes(data || []));
  }, [user?.empresa_id]);

  // Centro de Costo (opcional, toggle empresas.usa_centros_costo) — igual patrón
  // que NuevaVentaModal.jsx: solo se muestra el selector si la empresa lo activó.
  useEffect(() => {
    if (!user?.empresa_id) return;
    supabase.from('empresas').select('usa_centros_costo').eq('id', user.empresa_id).single()
      .then(({ data: emp }) => {
        if (!emp?.usa_centros_costo) { setCentrosCosto([]); return; }
        supabase.from('centros_costo').select('id, nombre')
          .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre')
          .then(({ data }) => setCentrosCosto(data || []));
      });
  }, [user?.empresa_id]);

  // OFERTAS — total con descuentos aplicados
  const { total, totalSinDescuento } = useMemo(() => {
    let conDesc = 0;
    let sinDesc = 0;
    carrito.forEach(item => {
      const oferta = ofertasCarrito[item.id];
      const manual = descuentosManuales[item.id] || 0;
      conDesc += getPrecioConDescuento(item, oferta, manual) * item.cantidad;
      sinDesc += item.precio_venta * item.cantidad;
    });
    return {
      total: Math.round(conDesc * 100) / 100,
      totalSinDescuento: Math.round(sinDesc * 100) / 100,
    };
  }, [carrito, ofertasCarrito, descuentosManuales]);

  const ahorro = totalSinDescuento - total;
  const isCC = medioPago === 'Cuenta Corriente';

  const modificarItem = (id, nuevaCantidad) => {
    if (nuevaCantidad < 1) {
      onModificarCarrito(prev => prev.filter(i => i.id !== id));
      return;
    }
    onModificarCarrito(prev =>
      prev.map(i => i.id === id ? { ...i, cantidad: nuevaCantidad } : i)
    );
  };

  const eliminarItem = (id) => {
    onModificarCarrito(prev => prev.filter(i => i.id !== id));
  };

  const handleSelectCliente = async (cliente) => {
    setSelectedClient(cliente);
    setClienteId(cliente?.id ?? '');
  };

  const handleConfirmar = async () => {
    const pagos = [{ metodo: medioPago, monto: total }];
    const result = await confirmar({
      cart: carrito, selectedClient, pagos,
      ofertasCarrito, descuentosManuales,
      centroCostoId: centroCostoId || null,
    });
    if (result) {
      const itemsSnapshot = carrito;
      onModificarCarrito([]);
      setSelectedClient(null);
      setClienteId('');
      setCentroCostoId('');
      onMedioPagoChange?.('Efectivo');
      onVentaExitosa?.({ comprobante: result, items: itemsSnapshot });
    }
  };

  return (
    <div
      className="w-full md:w-[360px] lg:w-[420px] flex-shrink-0 flex flex-col"
      style={{ borderLeft: '1px solid rgb(var(--kx-border))' }}
    >
      {/* Selector de cliente */}
      <div className="p-3 border-b border-kx-border bg-kx-surface flex-shrink-0">
        <ClienteSelector
          clientes={clientes}
          value={clienteId}
          onChange={(id) => {
            setClienteId(id);
            setSelectedClient(id ? (clientes.find(c => c.id === id) ?? null) : null);
          }}
          onClienteCreado={async (c) => {
            setClientes(p => [...p, c]);
            await handleSelectCliente(c);
          }}
        />
        {isCC && !selectedClient && (
          <p className="text-xs text-kx-amber mt-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> CC requiere cliente seleccionado
          </p>
        )}
        {centrosCosto.length > 0 && (
          <select
            value={centroCostoId}
            onChange={(e) => setCentroCostoId(e.target.value)}
            className="w-full mt-2 h-9 rounded-lg border border-kx-border bg-kx-surface-2 text-sm text-kx-text px-2"
          >
            <option value="">Centro de costo: sin asignar</option>
            {centrosCosto.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        )}
      </div>

      {/* Items del carrito */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {carrito.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-kx-text-3 py-12">
            <ShoppingCart className="w-12 h-12 mb-3 opacity-20" />
            <p className="text-sm">Seleccioná productos del panel izquierdo</p>
          </div>
        ) : (
          carrito.map(item => (
            <CarritoItem
              key={item.id}
              item={item}
              onModificar={modificarItem}
              onEliminar={eliminarItem}
              oferta={ofertasCarrito[item.id]}
              descuentoManual={descuentosManuales[item.id] || 0}
              onDescuentoManualChange={onDescuentoManualChange}
              onTogglePack={onTogglePack}
              onUpdatePacks={onUpdatePacks}
            />
          ))
        )}
      </div>

      {/* Totales + método de pago + confirmar */}
      <div className="p-3 border-t border-kx-border space-y-3 flex-shrink-0 bg-kx-surface">
        {/* Método de pago */}
        <div className="grid grid-cols-2 gap-1.5">
          {METODOS.map(m => (
            <button
              key={m}
              onClick={() => onMedioPagoChange?.(m)}
              className={[
                'py-2 px-3 rounded-xl text-xs font-semibold transition-all border',
                medioPago === m
                  ? m === 'Cuenta Corriente'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-600 dark:text-amber-400'
                    : 'bg-[rgb(var(--kx-violet)/0.15)] border-[rgb(var(--kx-violet))] text-[rgb(var(--kx-violet))]'
                  : 'bg-kx-surface-2 border-kx-border text-kx-text-2 hover:border-kx-text-3',
              ].join(' ')}
            >
              {m}
            </button>
          ))}
        </div>

        {isCC && (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Se registrará como deuda en cuenta corriente del cliente.
          </div>
        )}

        {/* OFERTAS — línea de ahorro */}
        {ahorro > 0 && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-kx-text-3">Subtotal</span>
            <span className="text-kx-text-3 tabular-nums line-through">${fmt(totalSinDescuento)}</span>
          </div>
        )}
        {ahorro > 0 && (
          <div className="flex justify-between items-center text-sm">
            <span className="text-emerald-500 font-medium flex items-center gap-1">
              <Tag className="w-3 h-3" /> Ahorro
            </span>
            <span className="text-emerald-500 font-semibold tabular-nums">-${fmt(ahorro)}</span>
          </div>
        )}

        {/* Total */}
        <div className="flex justify-between items-center py-1">
          <span className="text-kx-text-2 font-medium">Total</span>
          <span className="text-2xl font-bold text-kx-text tabular-nums">${fmt(total)}</span>
        </div>

        {/* Botón confirmar */}
        <Button
          onClick={handleConfirmar}
          disabled={carrito.length === 0 || loading || (isCC && !selectedClient)}
          className="w-full h-12 text-base font-bold rounded-xl gap-2 text-white"
          style={{ background: 'rgb(var(--kx-green))' }}
        >
          {loading
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando...</>
            : <><CheckCircle className="w-5 h-5" /> Confirmar Venta</>
          }
        </Button>

        {carrito.length > 0 && (
          <button
            onClick={() => onModificarCarrito([])}
            className="w-full text-xs text-kx-text-3 hover:text-kx-red transition-colors py-1"
          >
            Limpiar carrito
          </button>
        )}
      </div>
    </div>
  );
}

export default PanelCarrito;
