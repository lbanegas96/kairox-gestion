import { useState, useMemo, useEffect, useRef } from 'react';
import { ShoppingCart, Trash2, Plus, Minus, CheckCircle, Loader2, AlertTriangle, Tag, Boxes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ClienteSelector from '@/components/shared/ClienteSelector';
import { useToast } from '@/components/ui/use-toast';
import { useConfirmarVenta } from '@/hooks/useConfirmarVenta';
import { useMultipago } from '@/hooks/useMultipago';
import { useTCParalelo } from '@/hooks/useTCParalelo';
import { useCobroQR } from '@/hooks/useCobroQR';
import { TipoCambioModal } from '@/components/ui/TipoCambioModal';
import ModalCobroQR from '@/components/caja/ModalCobroQR';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { guardarSnapshot, leerSnapshot, medioPagoDisponibleOffline } from '@/lib/offlineDb';

// Nombre exacto de la forma de pago que dispara el circuito de QR Dinámico
// (la siembra mig.297). Si el cajero elige ésta, la venta NO va por crear_venta:
// va por mp-qr-crear, que la deja en `pendiente` hasta que MP confirme el pago.
const FORMA_PAGO_QR = 'QR MercadoPago';

const fmt = (n) =>
  Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Fallback si la empresa todavía no tiene el maestro formas_pago seedeado.
const METODOS_FALLBACK = ['Efectivo', 'Transferencia', 'Tarjeta', 'Cuenta Corriente'];

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
              <span className="text-xs font-semibold text-kx-green tabular-nums">${fmt(precioFinal)} c/u</span>
            </div>
          ) : (
            <p className="text-xs text-kx-text-3 tabular-nums">${fmt(item.precio_venta)} c/u</p>
          )}
          {packMode && (
            <p className="text-2xs text-kx-amber tabular-nums">${fmt(item._precioUnidadVenta)} / {item.unidad_venta?.codigo || 'pack'}</p>
          )}
          {/* OFERTAS — badge con nombre de la oferta */}
          {oferta && (
            <span className="inline-flex items-center gap-1 text-2xs font-medium text-kx-green mt-0.5">
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
            <Trash2 className="w-3.5 h-3.5 text-kx-red" />
          </button>
        </div>
        <div className="w-20 text-right flex-shrink-0">
          <span className={`text-sm font-bold tabular-nums ${tieneDescuento ? 'text-kx-green' : 'text-kx-text'}`}>
            ${fmt(subtotal)}
          </span>
        </div>
      </div>
      {/* Toggle venta por pack — solo si el producto tiene unidad de venta configurada */}
      {item.unidad_venta_id && onTogglePack && (
        <button
          type="button"
          onClick={() => onTogglePack(item.id)}
          className={`inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded border transition-colors ${packMode ? 'border-kx-amber text-kx-amber bg-kx-amber/10' : 'border-kx-border text-kx-text-3 hover:bg-kx-border/40'}`}
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
  apiRef,
  carrito, onModificarCarrito, onVentaExitosa,
  onTogglePack, onUpdatePacks,
  formasPago = [],
  ofertasCarrito = {}, descuentosManuales = {},
  onDescuentoManualChange, medioPago = 'Efectivo', onMedioPagoChange,
}) {
  const METODOS = formasPago.length > 0
    ? [...formasPago.map(f => f.nombre), 'Cuenta Corriente']
    : METODOS_FALLBACK;
  const { user }    = useAuth();
  const { toast }   = useToast();
  // Modo Offline — Fase 2: sin conexión, clientes/centros de costo se leen del
  // último snapshot guardado en Dexie en vez de esperar/fallar contra Supabase.
  const isOnline    = useOnlineStatus();
  const [clientes, setClientes]     = useState([]);
  const [clienteId, setClienteId]   = useState('');
  const [selectedClient, setSelectedClient] = useState(null);
  const [centrosCosto, setCentrosCosto]     = useState([]);
  const [centroCostoId, setCentroCostoId]   = useState('');
  const [showParaleloTCModal, setShowParaleloTCModal] = useState(false);
  const clienteWrapperRef = useRef(null);
  const tcParalelo = useTCParalelo();
  const { confirmar, loading }      = useConfirmarVenta(tcParalelo, formasPago);
  const { currentSession }          = useCaja();
  const cobroQR                     = useCobroQR();
  const [cancelandoQR, setCancelandoQR] = useState(false);

  useEffect(() => {
    if (!user?.empresa_id) return;
    if (!isOnline) {
      leerSnapshot('clientes', user.empresa_id).then(setClientes);
      return;
    }
    supabase
      .from('clientes')
      .select('id, nombre, condicion_iva, documento, telefono, limite_credito, saldo_actual')
      .eq('empresa_id', user.empresa_id)
      .neq('activo', false)
      .order('nombre')
      .then(({ data }) => {
        const filas = data || [];
        setClientes(filas);
        guardarSnapshot('clientes', user.empresa_id, filas);
      });
  }, [user?.empresa_id, isOnline]);

  // Centro de Costo (opcional, toggle empresas.usa_centros_costo) — igual patrón
  // que NuevaVentaModal.jsx: solo se muestra el selector si la empresa lo activó.
  useEffect(() => {
    if (!user?.empresa_id) return;
    if (!isOnline) {
      leerSnapshot('centrosCosto', user.empresa_id).then(setCentrosCosto);
      return;
    }
    supabase.from('empresas').select('usa_centros_costo').eq('id', user.empresa_id).single()
      .then(({ data: emp }) => {
        if (!emp?.usa_centros_costo) {
          setCentrosCosto([]);
          guardarSnapshot('centrosCosto', user.empresa_id, []);
          return;
        }
        supabase.from('centros_costo').select('id, nombre')
          .eq('empresa_id', user.empresa_id).eq('activo', true).order('nombre')
          .then(({ data }) => {
            const filas = data || [];
            setCentrosCosto(filas);
            guardarSnapshot('centrosCosto', user.empresa_id, filas);
          });
      });
  }, [user?.empresa_id, isOnline]);

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

  // Pago mixto — MISMA lógica que NuevaVentaModal (ERP): `useMultipago` es la
  // capa compartida entre ambos caminos de venta. Sólo cambia la presentación
  // (acá compacta y táctil; allá el sidebar con moneda/centro de costo/AFIP).
  // Ambos terminan produciendo el mismo array `pagos` → misma RPC crear_venta →
  // mismo asiento contable.
  const multipago = useMultipago(total, formasPago);
  const { isCC, isMultiPago, selectedMethods, methodAmounts, setMethodAmounts, toggleMethod, restante } = multipago;

  // Ofertas por medio de pago: sólo aplican cuando ese medio cubre el 100% de la
  // venta (decisión de negocio de Luciano). En pago mixto se manda null para que
  // el motor no las aplique — si no, pagar $1 por transferencia desbloquearía el
  // "Descuento transferencia" sobre todo el carrito.
  const medioParaOfertas = selectedMethods.size === 1 ? Array.from(selectedMethods)[0] : null;

  // El QR sólo puede cubrir el 100% de la venta: la venta queda `pendiente`
  // hasta que MP confirme, así que no hay forma de mezclarlo con un medio que ya
  // se cobró. Si el cajero lo combina con otro, se bloquea con un mensaje claro.
  const qrSeleccionado = selectedMethods.has(FORMA_PAGO_QR);
  const esCobroQR      = qrSeleccionado && selectedMethods.size === 1;
  const qrEnMixto      = qrSeleccionado && selectedMethods.size > 1;
  useEffect(() => {
    if (medioParaOfertas !== medioPago) onMedioPagoChange?.(medioParaOfertas);
  }, [medioParaOfertas]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Cierra el modal de QR. Si el pago se acreditó, recién ahí se vacía el
  // carrito y se dispara el ticket — mismo camino que una venta normal.
  const handleCerrarModalQR = () => {
    const pagado = cobroQR.estado === 'pagado';
    const d = cobroQR.datos;
    const itemsSnapshot = carrito;
    cobroQR.reset();
    if (pagado && d) {
      onModificarCarrito([]);
      setSelectedClient(null);
      setClienteId('');
      setCentroCostoId('');
      multipago.reset();
      onVentaExitosa?.({
        comprobante: {
          id: d.comprobante_id,
          numero_venta: d.numero_venta,
          fecha: new Date().toISOString(),
          total: d.total,
          moneda: 'ARS',
          tipo_cambio_tasa: 1,
          forma_pago: FORMA_PAGO_QR,
          cliente_nombre: selectedClient?.nombre ?? 'Consumidor Final',
          // Resuelto en useCobroQR.iniciar() con el mismo criterio que
          // useConfirmarVenta — para que TicketPrint no diga "CAE pendiente"
          // sobre un comprobante que nunca va a tener CAE (PdV no fiscal).
          cae_estado: d.cae_estado,
        },
        items: itemsSnapshot,
      });
    }
  };

  const handleCancelarQR = async () => {
    setCancelandoQR(true);
    const res = await cobroQR.cancelar();
    setCancelandoQR(false);
    if (res?.yaPagado) {
      toast({
        title: 'El cliente ya había pagado',
        description: 'El cobro se acreditó justo antes de cancelar — la venta quedó registrada.',
      });
    } else if (res?.error) {
      toast({ title: 'No se pudo cancelar', description: res.error, variant: 'destructive' });
    }
  };

  const handleConfirmar = async () => {
    // El QR deja la venta en `pendiente` hasta que MP confirme; no se puede
    // combinar con un medio que ya se cobró en el momento.
    if (qrEnMixto) {
      toast({
        title: 'El QR no se puede combinar',
        description: 'El cobro con QR MercadoPago tiene que cubrir el total de la venta. Dejalo como único medio de pago.',
        variant: 'destructive',
      });
      return;
    }
    // Moneda paralela: mismo gate que NuevaVentaModal. Antes esta pantalla (Modo
    // Caja) ni siquiera intentaba calcular el equivalente — mandaba moneda ARS
    // y monto_paralelo=null fijos, sin importar la configuración de la empresa.
    if (tcParalelo.enabled && tcParalelo.tcMissing) {
      toast({
        title: `Falta el TC de paridad ${tcParalelo.monedaParalela}`,
        description: `La empresa usa moneda paralela. Cargá el TC de ${tcParalelo.monedaParalela} para poder confirmar la venta.`,
        variant: 'destructive',
      });
      setShowParaleloTCModal(true);
      return;
    }
    // ── Cobro por QR: circuito aparte ────────────────────────────────────────
    // No pasa por crear_venta. La venta se crea en `pendiente` (con el stock ya
    // descontado) y sólo se confirma cuando MP avisa que el cliente pagó, vía
    // webhook o vía el cron mp-qr-poller. Por eso tiene su propio modal y no
    // cierra el carrito hasta que el pago esté acreditado.
    // Sólo aplica cuando el QR cubre el 100% de la venta: en pago mixto no hay
    // forma de conciliar una parte pendiente con otra ya cobrada.
    if (esCobroQR) {
      // Modo Offline — Fase 3: el botón ya debería estar deshabilitado sin
      // red (ver METODOS.map más abajo) — este guard es defensivo, para el
      // caso borde de perder la conexión entre seleccionar QR y tocar
      // "Confirmar". Evita colgar esperando una llamada de red condenada.
      if (!isOnline) {
        toast({ title: 'El QR necesita conexión', description: 'Sin internet no se puede generar el QR de MercadoPago.', variant: 'destructive' });
        return;
      }
      const { error: qrError } = await cobroQR.iniciar({
        carrito,
        selectedClient,
        centroCostoId: centroCostoId || null,
        cajaSesionId: currentSession?.id ?? null,
        getPrecio: (item) => getPrecioConDescuento(item, ofertasCarrito[item.id], descuentosManuales[item.id] || 0),
      });
      if (qrError) {
        toast({ title: 'No se pudo generar el QR', description: qrError, variant: 'destructive' });
      }
      return;
    }

    // Misma construcción + validaciones que el ERP (montos que suman el total,
    // formato argentino, exclusividad de Cuenta Corriente).
    const { pagos, error: pagoError } = multipago.construirPagosFinales();
    if (pagoError) {
      toast({ ...pagoError, variant: 'destructive' });
      return;
    }
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
      multipago.reset();
      onVentaExitosa?.({ comprobante: result, items: itemsSnapshot });
    }
  };

  // ATAJOS — F2 cobra, F8 enfoca el cliente, Alt+1..4 elige medio de pago por
  // posición (ver useAtajosPOS). Sin dependencias: se re-registra en cada
  // render para no arrastrar closures viejas del carrito/total/multipago.
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      ...apiRef.current,
      confirmar: () => {
        const bloqueado = carrito.length === 0 || loading
          || (isCC && !selectedClient)
          || (isMultiPago && Math.abs(restante) >= 0.01);
        if (!bloqueado) handleConfirmar();
      },
      focusCliente: () => clienteWrapperRef.current?.querySelector('select')?.focus(),
      // Modo Offline — Fase 3: el atajo no pasa por el botón (que ya tiene
      // `disabled`), así que necesita su propio guard.
      seleccionarMedioPago: (idx) => {
        const m = METODOS[idx];
        if (!m) return;
        if (!isOnline && !medioPagoDisponibleOffline(m, formasPago)) return;
        toggleMethod(m);
      },
    };
  });

  return (
    <div
      // min-h-0: sin esto, el listado de items (flex-1 más abajo) no se achica
      // aunque haya poco espacio vertical — el mismo bug clásico de flexbox que
      // ya está resuelto en el PanelCarrito hermano del ERP (nueva-venta/PanelCarrito.jsx).
      // Al faltar acá, en ventanas de navegador bajas el contenido de abajo
      // (medio de pago, totales, botón Confirmar Venta) quedaba tapado por el
      // overflow-hidden del layout padre (ModoCajaLayout, h-screen).
      className="w-full md:w-[360px] lg:w-[420px] flex-shrink-0 flex flex-col min-h-0"
      style={{ borderLeft: '1px solid rgb(var(--kx-border))' }}
    >
      {/* Selector de cliente */}
      <div className="p-3 border-b border-kx-border bg-kx-surface flex-shrink-0">
        <div ref={clienteWrapperRef} title="Atajo: F8">
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
        </div>
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
        {/* Método de pago — tocá varios para dividir el cobro */}
        <div className="flex items-center justify-between">
          <span className="text-2xs uppercase tracking-wide text-kx-text-3">Medio de pago</span>
          {isMultiPago && (
            <span className="text-2xs text-kx-text-3">{selectedMethods.size} medios · asigná los montos</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {METODOS.map((m, idx) => {
            const activo = selectedMethods.has(m);
            // Modo Offline — Fase 3: Tarjeta/QR MercadoPago/Cuenta Corriente
            // necesitan hablar con un tercero (banco, MP) o validar datos
            // actualizados del cliente en el momento — no se pueden ofrecer
            // sin conexión. Se decide por tipo_instrumento (mig.214), no por
            // el nombre (ver medioPagoDisponibleOffline en offlineDb.js).
            const necesitaConexion = !isOnline && !medioPagoDisponibleOffline(m, formasPago);
            return (
              <button
                key={m}
                onClick={() => !necesitaConexion && toggleMethod(m)}
                disabled={necesitaConexion}
                title={necesitaConexion
                  ? 'Necesita conexión a internet'
                  : idx < 4 ? `Atajo: Alt+${idx + 1}` : undefined}
                className={[
                  'relative py-2 px-3 rounded-xl text-xs font-semibold transition-all border text-left',
                  necesitaConexion
                    ? 'bg-kx-surface-2 border-kx-border text-kx-text-3 opacity-40 cursor-not-allowed'
                    : activo
                      ? m === 'Cuenta Corriente'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-600 dark:text-amber-400'
                        : 'bg-[rgb(var(--kx-violet)/0.15)] border-[rgb(var(--kx-violet))] text-[rgb(var(--kx-violet))]'
                      : 'bg-kx-surface-2 border-kx-border text-kx-text-2 hover:border-kx-text-3',
                ].join(' ')}
              >
                {idx < 4 && (
                  <span className="absolute top-1 right-1.5 text-[9px] font-normal text-kx-text-3 tabular-nums">
                    {idx + 1}
                  </span>
                )}
                <span className="flex items-center gap-1 justify-center">
                  {activo && <CheckCircle className="w-3 h-3 shrink-0" />}
                  {m}
                </span>
                {/* Monto por medio — sólo en pago mixto */}
                {isMultiPago && activo && (
                  <span className="block mt-1.5" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="$0,00"
                      value={methodAmounts[m] || ''}
                      onChange={e => setMethodAmounts(prev => ({ ...prev, [m]: e.target.value }))}
                      className="w-full h-7 text-center text-xs rounded-md border border-[rgb(var(--kx-violet))] bg-kx-surface text-kx-text tabular-nums focus:outline-none focus:ring-1 focus:ring-violet-500 px-1"
                    />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Restante a asignar */}
        {isMultiPago && (
          <div className={[
            'text-xs font-semibold text-center py-2 px-3 rounded-lg tabular-nums',
            Math.abs(restante) < 0.01
              ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
          ].join(' ')}>
            {Math.abs(restante) < 0.01
              ? '✓ Pago completo'
              : restante > 0
                ? `Falta asignar $${fmt(restante)}`
                : `Te pasaste por $${fmt(Math.abs(restante))}`}
          </div>
        )}

        {isCC && (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            Se registrará como deuda en cuenta corriente del cliente.
          </div>
        )}

        {/* Modo Offline — Fase 3: el motor de ofertas depende de red (lo salta
            ModoCajaLayout.calcularOfertas); se avisa acá para no vender en
            silencio sin un descuento que hubiera aplicado con conexión. */}
        {!isOnline && carrito.length > 0 && (
          <div className="text-2xs text-kx-text-3 bg-kx-surface-2 border border-kx-border rounded-lg px-3 py-2">
            Ofertas no disponibles sin conexión.
          </div>
        )}

        {isMultiPago && ahorro > 0 && (
          <div className="text-2xs text-kx-text-3 bg-kx-surface-2 border border-kx-border rounded-lg px-3 py-2">
            Los descuentos por medio de pago sólo aplican cuando ese medio cubre toda la venta.
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
            <span className="text-kx-green font-medium flex items-center gap-1">
              <Tag className="w-3 h-3" /> Ahorro
            </span>
            <span className="text-kx-green font-semibold tabular-nums">-${fmt(ahorro)}</span>
          </div>
        )}

        {/* Total */}
        <div className="flex justify-between items-center py-1">
          <span className="text-kx-text-2 font-medium">Total</span>
          <span className="text-2xl font-bold text-kx-text tabular-nums">${fmt(total)}</span>
        </div>

        {/* Moneda paralela: equivalente si hay TC del día, o aviso + acceso al modal si falta */}
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
          ) : tcParalelo.tcHoy && total > 0 && (
            <p className="text-xs text-kx-text-3 text-right -mt-2">
              ≈ {tcParalelo.calcParalelo(total, 'ARS', 1)?.toLocaleString('es-AR', { minimumFractionDigits: 2 })} {tcParalelo.monedaParalela}
            </p>
          )
        )}

        {/* Botón confirmar — atajo F2 (ver useAtajosPOS) */}
        <Button
          onClick={handleConfirmar}
          disabled={
            carrito.length === 0 || loading ||
            (isCC && !selectedClient) ||
            (isMultiPago && Math.abs(restante) >= 0.01)
          }
          title="Atajo: F2"
          className="w-full h-12 text-base font-bold rounded-xl gap-2 text-white"
          style={{ background: 'rgb(var(--kx-green))' }}
        >
          {loading
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Procesando...</>
            : <>
                <CheckCircle className="w-5 h-5" /> Confirmar Venta
                <span className="text-2xs font-normal opacity-70 ml-1">F2</span>
              </>
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

      {/* Carga del TC de paridad cuando falta — el gate de handleConfirmar lo abre */}
      <TipoCambioModal
        open={showParaleloTCModal}
        onOpenChange={setShowParaleloTCModal}
        moneda={tcParalelo.monedaParalela}
        onConfirm={(t) => { tcParalelo.setTC(t); setShowParaleloTCModal(false); }}
      />

      {/* Cobro por QR MercadoPago — circuito aparte de crear_venta (ver handleConfirmar) */}
      <ModalCobroQR
        open={cobroQR.estado !== 'idle'}
        estado={cobroQR.estado}
        qrDataUrl={cobroQR.qrDataUrl}
        datos={cobroQR.datos}
        error={cobroQR.error}
        segundosRestantes={cobroQR.segundosRestantes}
        cancelando={cancelandoQR}
        onCancelar={handleCancelarQR}
        onCerrar={handleCerrarModalQR}
      />
    </div>
  );
}

export default PanelCarrito;
