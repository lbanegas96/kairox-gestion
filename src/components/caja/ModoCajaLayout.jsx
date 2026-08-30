import { useState, useEffect, useCallback, useRef } from 'react';
import { Landmark, History, LogOut, Loader2, X, CheckCircle, ArrowLeft, Printer, FileText, WifiOff, Gift } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { useArqueoCaja } from '@/hooks/useArqueoCaja';
import { useAfipConfig } from '@/hooks/useAfipConfig';
import { useAtajosPOS } from '@/hooks/useAtajosPOS';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useFinalizarVentaPosterior } from '@/hooks/useFinalizarVentaPosterior';
import { useSyncEngine } from '@/hooks/useSyncEngine';
import { useVentaOfflineQueue } from '@/hooks/useVentaOfflineQueue';
import { guardarSnapshot, leerSnapshot, guardarEmpresaMeta, leerEmpresaMeta } from '@/lib/offlineDb';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { precioPackFinal } from '@/lib/unidadesMedida';
import PanelProductos from './PanelProductos';
import PanelCarrito from './PanelCarrito';
import HistorialTurnoModal from './HistorialTurnoModal';
import TicketPrint from './TicketPrint';
import SyncStatusPanel from './SyncStatusPanel';
import SeleccionarCajaModal from './SeleccionarCajaModal';

// Layout pantalla completa para usuarios cajeros (role='solo_caja' o modo_caja=true).
// No tiene sidebar ni header estándar.
function ModoCajaLayout({ onLogout, onBack = null }) {
  const { user }                                       = useAuth();
  const { isSessionOpen, currentSession, openSession,
          closeSession, refreshSession,
          activeCaja, availableCajas, changeCaja,
          loading: cajaLoading }                        = useCaja();
  const { toast }                                      = useToast();
  // Arqueo real del turno — mismo cálculo que el cierre desde el panel administrativo.
  // Modo Offline — Fase 3: pendienteSyncEfectivo/Transferencia son ventas
  // encoladas de este turno que el servidor todavía no reconoce — informativo,
  // nunca se suma al esperado (ver useArqueoCaja.js).
  const { totals: arqueo, loading: arqueoLoading,
          refetch: refetchArqueo,
          pendienteSyncEfectivo, pendienteSyncTransferencia }  = useArqueoCaja();
  // Punto de venta del POS — SOLO LECTURA. Se configura únicamente desde
  // Configuración → Facturación (admin). Acá se muestra para que el cajero
  // pueda avisar si está emitiendo por el PdV equivocado. react-query dedupe
  // esta lectura con la que hace useConfirmarVenta (misma queryKey).
  const { afipConfig: afipPos }                        = useAfipConfig('pos');
  const pdvPos                                         = afipPos?.punto_venta ?? null;
  // Modo Offline — Fase 1: sólo avisa. Fase 3: dispara el motor de
  // sincronización apenas vuelve la conexión (ver useSyncEngine más abajo).
  const isOnline                                       = useOnlineStatus();
  // Modo Offline — Fase 3: post-proceso compartido (asiento contable +
  // encolado a ARCA) que useSyncEngine corre tras sincronizar una venta que
  // se había encolado offline — misma función que usa el camino online
  // dentro de useConfirmarVenta, sin duplicar la lógica.
  const { finalizarVentaPosterior, puntoVentaId }      = useFinalizarVentaPosterior();
  const { sincronizarAhora }                           = useSyncEngine({
    empresaId: user?.empresa_id,
    isOnline,
    puntoVentaId,
    onVentaSincronizada: finalizarVentaPosterior,
  });
  // Badge "N sin sincronizar" en la topbar — oculto si no hay nada pendiente.
  const { cantidadPendiente }                          = useVentaOfflineQueue(user?.empresa_id);
  const huboOfflineRef                                 = useRef(false);

  // En cuanto la cola de pendientes se vacía (todo sincronizado), refresca la
  // sesión de caja — si la apertura también estaba encolada, esto reemplaza
  // la sesión "local" (_pendingSync) por la real ya sincronizada, sin
  // esperar los hasta 30s del polling periódico de CajaContext.
  useEffect(() => {
    if (cantidadPendiente > 0) huboOfflineRef.current = true;
    if (cantidadPendiente === 0 && huboOfflineRef.current) {
      huboOfflineRef.current = false;
      refreshSession?.();
    }
  }, [cantidadPendiente, refreshSession]);

  const [carrito, setCarrito]       = useState([]);
  const [logoUrl, setLogoUrl]       = useState('');
  const [empresaNombre, setEmpresaNombre] = useState('');
  // TICKET-PRINT — datos de empresa para encabezado del ticket
  const [empresaData, setEmpresaData] = useState({});
  const [showCaja, setShowCaja]     = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [montoApertura, setMontoApertura] = useState('');
  const [montoCierre, setMontoCierre]     = useState('');
  const [observacionesCierre, setObservacionesCierre] = useState('');
  const [savingCaja, setSavingCaja]       = useState(false);
  // TICKET-PRINT — payload de la última venta exitosa (comprobante + items snapshot)
  const [ventaExitosa, setVentaExitosa] = useState(null);
  const [formatoTicket, setFormatoTicket] = useState('80mm');
  // OFERTAS — estado del motor de descuentos
  const [ofertasCarrito, setOfertasCarrito] = useState({});
  const [descuentosManuales, setDescuentosManuales] = useState({});
  const [medioPagoSeleccionado, setMedioPagoSeleccionado] = useState('Efectivo');
  // Formas de pago (maestro de ConfiguracionSection → Finanzas, mig.214) — reemplaza
  // la lista hardcodeada que tenía PanelCarrito.
  const [formasPago, setFormasPago] = useState([]);
  // RESPONSIVE-MOBILE
  const [tabMobile, setTabMobile] = useState('productos'); // 'productos' | 'carrito'
  // ATAJOS — ref mutable que PanelProductos/PanelCarrito completan con sus
  // propias funciones (focusBuscador, confirmar, focusCliente, seleccionarMedioPago).
  // Ver src/hooks/useAtajosPOS.js para el mapeo de teclas.
  const posApiRef = useRef({});
  useAtajosPOS({ apiRef: posApiRef });

  // Cargar logo y nombre empresa. Modo Offline — Fase 2: sin conexión se lee
  // el último snapshot guardado en Dexie en vez de esperar/fallar contra
  // Supabase; con conexión se refresca y ese refresco pisa el snapshot.
  useEffect(() => {
    if (!user?.empresa_id) return;
    if (!isOnline) {
      leerEmpresaMeta(user.empresa_id).then(meta => {
        if (!meta) return;
        setLogoUrl(meta.logoUrl ?? '');
        setEmpresaNombre(meta.nombre ?? '');
        setEmpresaData(meta.empresaData ?? {});
      });
      return;
    }
    Promise.all([
      supabase.from('configuracion')
        .select('valor')
        .eq('empresa_id', user.empresa_id)
        .eq('clave', 'logo_base64')
        .maybeSingle(),
      supabase.from('empresas')
        // TICKET-PRINT — traer también cuit/direccion/telefono para el encabezado
        .select('nombre, afip_cuit, direccion, telefono, usa_factura_electronica')
        .eq('id', user.empresa_id)
        .single(),
    ]).then(([{ data: logoRow }, { data: empresa }]) => {
      if (logoRow?.valor) setLogoUrl(logoRow.valor);
      if (empresa?.nombre) setEmpresaNombre(empresa.nombre);
      if (empresa) setEmpresaData(empresa);
      guardarEmpresaMeta(user.empresa_id, {
        logoUrl: logoRow?.valor ?? '',
        nombre: empresa?.nombre ?? '',
        empresaData: empresa ?? {},
      });
    });
  }, [user?.empresa_id, isOnline]);

  // Formas de pago activas de la empresa (maestro, mig.214). Mismo patrón
  // offline: snapshot Dexie como fallback de lectura sin red.
  useEffect(() => {
    if (!user?.empresa_id) return;
    if (!isOnline) {
      leerSnapshot('formasPago', user.empresa_id).then(setFormasPago);
      return;
    }
    supabase
      .from('formas_pago')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => {
        const filas = data ?? [];
        setFormasPago(filas);
        guardarSnapshot('formasPago', user.empresa_id, filas);
      });
  }, [user?.empresa_id, isOnline]);

  // OFERTAS — llamar al RPC cuando cambia el carrito o medio de pago.
  // Modo Offline — Fase 3: el motor de ofertas depende 100% de la red
  // (calcular_ofertas_carrito). Sin conexión no se intenta (evita una llamada
  // condenada a fallar) y se avisa explícitamente en la UI — nunca se vende
  // en silencio sin el descuento que hubiera aplicado online.
  const calcularOfertas = useCallback(async (carritoActual, medioPago) => {
    if (!carritoActual.length || !user?.empresa_id || !isOnline) {
      setOfertasCarrito({});
      return;
    }
    const items = carritoActual.map(item => ({
      producto_id: item.id,
      categoria_nombre: item.categorias?.nombre ?? null,
      precio_unitario: item.precio_venta,
      cantidad: item.cantidad,
    }));
    const totalCarrito = carritoActual.reduce(
      (sum, i) => sum + i.precio_venta * i.cantidad, 0
    );
    const { data, error } = await supabase.rpc('calcular_ofertas_carrito', {
      p_empresa_id: user.empresa_id,
      p_items: items,
      p_medio_pago: medioPago || null,
      p_total_carrito: totalCarrito,
    });
    if (!error && data) {
      const map = {};
      data.forEach(r => { if (r.oferta_id) map[r.producto_id] = r; });
      setOfertasCarrito(map);
    }
  }, [user?.empresa_id, isOnline]);

  useEffect(() => {
    const timer = setTimeout(() => {
      calcularOfertas(carrito, medioPagoSeleccionado);
    }, 300);
    return () => clearTimeout(timer);
  }, [carrito, medioPagoSeleccionado, calcularOfertas]);

  const horaInicio = currentSession?.apertura_fecha
    ? new Date(currentSession.apertura_fecha).toLocaleTimeString('es-AR', {
        hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Argentina/Buenos_Aires',
      })
    : null;

  const nombreUsuario = [user?.first_name, user?.last_name].filter(Boolean).join(' ')
    || user?.email?.split('@')[0]
    || 'Cajero';

  // TICKET-PRINT — inyecta @media print, llama window.print(), limpia el style.
  // Cambiar formato dispara re-render de <TicketPrint>; el setTimeout da margen
  // a React para que el DOM esté actualizado antes de imprimir.
  const handlePrint = (fmt) => {
    setFormatoTicket(fmt);
    const style = document.createElement('style');
    style.id = 'kx-print-style';
    style.textContent = `
      @media print {
        @page {
          size: ${fmt === '80mm' ? '80mm auto' : 'A4'};
          margin: ${fmt === '80mm' ? '3mm' : '15mm'};
        }
        body * { visibility: hidden !important; }
        #kx-ticket-print, #kx-ticket-print * { visibility: visible !important; }
        #kx-ticket-print {
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          width: 100% !important;
        }
      }
    `;
    document.head.appendChild(style);
    setTimeout(() => {
      window.print();
      document.getElementById('kx-print-style')?.remove();
    }, 100);
  };

  const handleAgregarAlCarrito = (producto) => {
    // Venta por peso/volumen (mig.338): para estos productos precio_venta
    // vive en 0 (el precio real es precio_por_kg_litro, ver Bloque 2) — se
    // normaliza acá, una sola vez al entrar al carrito, para que el resto de
    // la lógica de precio/descuento/subtotal (getPrecioConDescuento, ofertas,
    // useConfirmarVenta) siga tratando "precio_venta" como "precio por la
    // unidad de cantidad que sea", sin tener que tocar cada cálculo.
    const esPesable = producto.tipo_venta && producto.tipo_venta !== 'unidad';
    const precioBase = esPesable ? (Number(producto.precio_por_kg_litro) || 0) : producto.precio_venta;
    setCarrito(prev => {
      const existente = prev.find(i => i.id === producto.id);
      if (existente) {
        if (producto.stock_actual < existente.cantidad + 1) {
          const unidadCorta = producto.tipo_venta === 'volumen' ? 'lt' : esPesable ? 'kg' : 'u.';
          toast({
            title: 'Stock insuficiente',
            description: `Solo hay ${producto.stock_actual} ${unidadCorta} de "${producto.nombre}"`,
            variant: 'destructive',
          });
          return prev;
        }
        return prev.map(i => i.id === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i);
      }
      return [...prev, { ...producto, cantidad: 1, precio_venta: precioBase, _precioUnitOriginal: precioBase }];
    });
  };

  // ── Venta por pack (mig.189/190) ────────────────────────────────────────────
  const togglePackMode = (id) => {
    setCarrito(prev => prev.map(item => {
      if (item.id !== id) return item;
      if (item._packMode) {
        return { ...item, _packMode: false, cantidad: 1, precio_venta: item._precioUnitOriginal ?? item.precio_venta };
      }
      const factor = Number(item.factor_conversion_venta) || 1;
      if (item.stock_actual < factor) {
        toast({ title: 'Stock insuficiente', description: `No alcanza para 1 ${item.unidad_venta?.descripcion || 'pack'} (= ${factor} u).`, variant: 'destructive' });
        return item;
      }
      const packFinal = precioPackFinal(item, item._precioUnitOriginal ?? item.precio_venta);
      return { ...item, _packMode: true, _packs: 1, _precioUnidadVenta: packFinal, cantidad: factor, precio_venta: packFinal / factor };
    }));
  };

  const updatePacks = (id, nPacks) => {
    const packs = parseInt(nPacks);
    if (isNaN(packs) || packs < 1) return;
    setCarrito(prev => prev.map(item => {
      if (item.id !== id || !item._packMode) return item;
      const factor = Number(item.factor_conversion_venta) || 1;
      const baseQty = packs * factor;
      if (item.stock_actual < baseQty) {
        toast({ title: 'Stock insuficiente', description: `Solo hay ${item.stock_actual} u (≈ ${Math.floor(item.stock_actual / factor)} ${item.unidad_venta?.codigo || 'packs'}).`, variant: 'destructive' });
        return item;
      }
      return { ...item, _packs: packs, cantidad: baseQty };
    }));
  };

  // Refrescar el arqueo al abrir el modal de cierre: entre la carga inicial y el
  // cierre hubo ventas, y el esperado tiene que reflejarlas.
  useEffect(() => {
    if (showCaja && isSessionOpen) refetchArqueo();
  }, [showCaja, isSessionOpen, refetchArqueo]);

  const handleAbrirCaja = async () => {
    const monto = parseNumberLocale(montoApertura) || 0;
    setSavingCaja(true);
    const ok = await openSession(monto);
    setSavingCaja(false);
    if (ok) {
      setShowCaja(false);
      setMontoApertura('');
    }
  };

  const handleCerrarCaja = async () => {
    const monto = parseNumberLocale(montoCierre);
    if (isNaN(monto) || monto < 0) {
      toast({
        title: 'Monto inválido',
        description: 'Usá formato argentino: punto para miles y coma para decimales (ej: 500.000,00).',
        variant: 'destructive',
      });
      return;
    }
    setSavingCaja(true);
    // Arqueo real: esperado calculado desde movimientos_caja (mismo cálculo que
    // el cierre desde el panel administrativo, vía useArqueoCaja).
    const ok = await closeSession(monto, observacionesCierre, arqueo.esperado, monto - arqueo.esperado);
    setSavingCaja(false);
    if (ok) {
      setShowCaja(false);
      setMontoCierre('');
      setObservacionesCierre('');
    }
  };

  // Arqueo — derivados para el modal de cierre
  const montoCierreParsed = parseNumberLocale(montoCierre);
  const diferenciaCierre  = (isNaN(montoCierreParsed) ? 0 : montoCierreParsed) - arqueo.esperado;
  const arqueoPerfecto    = Math.abs(diferenciaCierre) < 0.01;
  const arqueoSobrante    = diferenciaCierre > 0.01;

  return (
    <div className="h-screen bg-kx-bg flex flex-col overflow-hidden">
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div className="h-12 flex-shrink-0 bg-kx-surface border-b border-kx-border flex items-center px-4 gap-3">
        {logoUrl && (
          <img src={logoUrl} className="h-6 object-contain" alt="Logo" />
        )}
        <span className="text-sm font-semibold text-kx-text">{empresaNombre}</span>

        {/* Badge estado caja */}
        {!cajaLoading && (
          <span className={`text-2xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
            isSessionOpen
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
          }`}>
            {isSessionOpen ? 'Caja abierta' : 'Caja cerrada'}
          </span>
        )}

        {/* Sin conexión — Fase 1. Desde la Fase 3, Efectivo/Transferencia
            siguen cobrándose offline (se encolan) — este badge es sólo el
            aviso de conectividad; el estado de la cola lo muestra
            SyncStatusPanel, al lado. */}
        {!isOnline && (
          <span
            title="Sin conexión a internet. Efectivo y Transferencia se siguen cobrando (se guardan y sincronizan solos); Tarjeta/QR/Cuenta Corriente quedan deshabilitados."
            className="text-2xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1"
          >
            <WifiOff className="w-3 h-3" /> Sin conexión
          </span>
        )}

        {/* Modo Offline — Fase 3: ventas/aperturas de caja esperando conexión
            o en conflicto. Oculto si no hay nada pendiente. */}
        <SyncStatusPanel empresaId={user?.empresa_id} onSincronizarAhora={sincronizarAhora} />

        {/* Multi-caja simultánea: qué caja física usa este dispositivo. Sólo
            visible con 2+ cajas activas — cero ruido para el caso de hoy (1
            sola caja). No se puede cambiar con un turno abierto, hay que
            cerrarlo primero (mismo criterio que el resto del módulo). */}
        {activeCaja && availableCajas.length > 1 && (
          <button
            type="button"
            onClick={changeCaja}
            disabled={isSessionOpen}
            title={isSessionOpen ? 'Cerrá el turno actual para cambiar de caja' : 'Cambiar de caja'}
            className={`text-2xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 hidden sm:inline-flex items-center gap-1 bg-kx-surface-2 text-kx-text-2 ${
              isSessionOpen ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 cursor-pointer'
            }`}
          >
            <Landmark className="w-3 h-3" /> {activeCaja.nombre}
          </button>
        )}

        {/* Punto de venta — informativo, no editable desde el POS */}
        {pdvPos && (
          <span
            title={pdvPos.envia_arca === false
              ? 'Comprobante interno — no se factura ante ARCA. Se configura en Configuración → Facturación.'
              : 'Emite factura electrónica ante ARCA. Se configura en Configuración → Facturación.'}
            className={`text-2xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 hidden sm:inline ${
              pdvPos.envia_arca === false
                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                : 'bg-kx-surface-2 text-kx-text-2'
            }`}
          >
            PdV {pdvPos.numero}{pdvPos.envia_arca === false ? ' · interno' : ''}
          </span>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-kx-text-2 hidden sm:block">
            {nombreUsuario}{horaInicio ? ` · Turno desde ${horaInicio}` : ''}
          </span>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowCaja(true)}
            className="h-7 text-xs border-kx-border text-kx-text-2 hover:text-kx-text gap-1"
          >
            <Landmark className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isSessionOpen ? 'Cerrar caja' : 'Abrir caja'}</span>
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowHistorial(true)}
            className="h-7 text-xs text-kx-text-2 hover:text-kx-text gap-1"
          >
            <History className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Mi turno</span>
          </Button>

          {onBack ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onBack}
              className="h-7 text-xs text-kx-text-2 hover:text-kx-text gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Volver al panel</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={onLogout}
              className="h-7 text-xs text-kx-text-3 hover:text-kx-red gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Salir</span>
            </Button>
          )}
        </div>
      </div>

      {/* RESPONSIVE-MOBILE — tab bar Productos/Carrito */}
      <div className="flex md:hidden border-b border-kx-border">
        <button onClick={() => setTabMobile('productos')}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
            tabMobile === 'productos'
              ? 'border-[rgb(var(--kx-violet))] text-kx-text'
              : 'border-transparent text-kx-text-2'}`}>
          Productos
        </button>
        <button onClick={() => setTabMobile('carrito')}
          className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors relative ${
            tabMobile === 'carrito'
              ? 'border-[rgb(var(--kx-violet))] text-kx-text'
              : 'border-transparent text-kx-text-2'}`}>
          Carrito
          {carrito.length > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full bg-[rgb(var(--kx-violet))] text-white">
              {carrito.reduce((sum, i) => sum + i.cantidad, 0)}
            </span>
          )}
        </button>
      </div>

      {/* ── Body: POS expandido ─────────────────────────────────────────────── */}
      {/* RESPONSIVE-MOBILE — flex-col en mobile, flex-row en desktop (idéntico al actual ≥md) */}
      <div className="flex-1 overflow-hidden flex flex-col md:flex-row min-h-0">
        {/* RESPONSIVE-MOBILE */}
        <div className={`${tabMobile === 'productos' ? 'flex' : 'hidden'} md:flex flex-1 min-w-0 overflow-hidden`}>
          <PanelProductos onAgregarAlCarrito={handleAgregarAlCarrito} apiRef={posApiRef} />
        </div>
        {/* RESPONSIVE-MOBILE */}
        {/* Carrito más ancho a pedido de Luciano (26/08). Primer intento con
            anchos fijos por breakpoint (420px/600px) — Luciano lo rechazó con
            razón: en cualquier resolución que no coincida con un breakpoint
            exacto, sobra una franja negra sin usar en vez de dársela al
            carrito (esto es web, tiene que ajustarse a CUALQUIER resolución,
            no a un puñado de anchos fijos). Fix: ancho fluido en % del ancho
            disponible (no de la pantalla — el panel de productos, hermano
            flex-1, se acomoda solo con lo que sobra, sin espacio muerto
            posible), con piso y techo para que nunca quede ni aplastado en
            una laptop chica ni absurdamente ancho en un monitor ultrawide. */}
        <div className={`${tabMobile === 'carrito' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[38%] md:min-w-[380px] md:max-w-[640px] flex-shrink-0 min-h-0`}>
          <PanelCarrito
            apiRef={posApiRef}
            carrito={carrito}
            onModificarCarrito={setCarrito}
            onTogglePack={togglePackMode}
            onUpdatePacks={updatePacks}
            formasPago={formasPago}
            ofertasCarrito={ofertasCarrito}
            descuentosManuales={descuentosManuales}
            onDescuentoManualChange={(productoId, pct) =>
              setDescuentosManuales(prev => ({ ...prev, [productoId]: pct }))
            }
            medioPago={medioPagoSeleccionado}
            onMedioPagoChange={setMedioPagoSeleccionado}
            onVentaExitosa={(payload) => {
              setVentaExitosa({ ...payload, ofertasCarrito: { ...ofertasCarrito } });
              setOfertasCarrito({});
              setDescuentosManuales({});
              setMedioPagoSeleccionado('Efectivo');
            }}
          />
        </div>
      </div>

      {/* RESPONSIVE-MOBILE — CTA flotante para saltar al carrito */}
      {tabMobile === 'productos' && carrito.length > 0 && (
        <button onClick={() => setTabMobile('carrito')}
          className="md:hidden fixed bottom-4 left-4 right-4 z-20 bg-[rgb(var(--kx-violet))] text-white rounded-lg py-3 px-4 flex items-center justify-between shadow-lg">
          <span className="font-medium">
            Ver carrito ({carrito.reduce((sum, i) => sum + i.cantidad, 0)})
          </span>
          <span className="font-bold">
            ${carrito.reduce((sum, i) => sum + i.precio_venta * i.cantidad, 0).toLocaleString('es-AR')}
          </span>
        </button>
      )}

      {/* Multi-caja simultánea: elegir con cuál trabajar en este dispositivo. */}
      <SeleccionarCajaModal />

      {/* ── Modal Abrir / Cerrar Caja ───────────────────────────────────────── */}
      <Dialog open={showCaja} onOpenChange={setShowCaja}>
        <DialogContent className={`${isSessionOpen ? 'max-w-md' : 'max-w-sm'} bg-kx-surface border-kx-border text-kx-text`}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-kx-violet" />
              {isSessionOpen ? 'Arqueo y Cierre de Caja' : 'Abrir Caja'}
            </DialogTitle>
            <DialogDescription className="text-kx-text-2 text-xs">
              {isSessionOpen
                ? 'Contá el efectivo físico y compará con el saldo esperado por el sistema.'
                : 'Indicá el monto inicial en efectivo para comenzar el turno.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Resumen del arqueo — sólo al cerrar */}
            {isSessionOpen && (
              arqueoLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-kx-text-3" />
                </div>
              ) : (
                <div className="bg-kx-bg rounded-lg p-3 space-y-2 border border-kx-border">
                  <div className="flex justify-between text-xs">
                    <span className="text-kx-text-2">Saldo inicial</span>
                    <span className="font-mono">${arqueo.inicial.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-kx-green">Ingresos en efectivo</span>
                    <span className="font-mono text-kx-green">+${arqueo.ingresosEfectivo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-kx-red">Egresos en efectivo</span>
                    <span className="font-mono text-kx-red">-${arqueo.egresosEfectivo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-kx-border">
                    <span className="text-sm font-bold text-kx-text">Esperado en caja</span>
                    <span className="font-mono font-bold">${arqueo.esperado.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                  </div>
                  {arqueo.otrosIngresos > 0 && (
                    <p className="text-2xs text-kx-text-3 pt-1 border-t border-dashed border-kx-border">
                      * Otros medios (tarjeta/transf.): ${arqueo.otrosIngresos.toLocaleString('es-AR', { minimumFractionDigits: 2 })} — no cuentan para el efectivo
                    </p>
                  )}
                  {/* Modo Offline — Fase 3: ventas encoladas de este turno que
                      el servidor todavía no reconoce — no están en el
                      "esperado" de arriba. En la práctica el cierre ya está
                      bloqueado mientras exista esta cola (ver CajaContext). */}
                  {(pendienteSyncEfectivo > 0 || pendienteSyncTransferencia > 0) && (
                    <p className="text-2xs text-amber-600 dark:text-amber-400 pt-1 border-t border-dashed border-kx-border">
                      ⚠ Sin sincronizar todavía — Efectivo: ${pendienteSyncEfectivo.toLocaleString('es-AR', { minimumFractionDigits: 2 })},
                      {' '}Transferencia: ${pendienteSyncTransferencia.toLocaleString('es-AR', { minimumFractionDigits: 2 })}. No está en el esperado de arriba.
                    </p>
                  )}
                </div>
              )
            )}

            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-kx-text-2">
                {isSessionOpen ? 'Efectivo contado ($)' : 'Monto de apertura ($)'}
              </Label>
              <Input
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={isSessionOpen ? montoCierre : montoApertura}
                onChange={e => isSessionOpen
                  ? setMontoCierre(e.target.value)
                  : setMontoApertura(e.target.value)
                }
                className="bg-kx-surface border-kx-border text-kx-text font-mono"
                autoFocus
              />
            </div>

            {/* Diferencia — sólo al cerrar y con monto ingresado */}
            {isSessionOpen && !arqueoLoading && montoCierre !== '' && (
              <div className={`flex items-center justify-between px-3 py-2 rounded-md border text-sm font-bold font-mono ${
                arqueoPerfecto
                  ? 'bg-green-50 text-green-600 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
                  : arqueoSobrante
                  ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800'
                  : 'bg-red-50 text-red-700 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
              }`}>
                <span>{diferenciaCierre > 0 ? '+' : ''}{diferenciaCierre.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                <span className="text-2xs font-normal">
                  {arqueoPerfecto ? '✓ Cuadra' : arqueoSobrante ? '↑ Sobrante' : '↓ Faltante'}
                </span>
              </div>
            )}

            {/* Observaciones — sólo al cerrar */}
            {isSessionOpen && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium text-kx-text-2">
                  Observaciones {!arqueoPerfecto && montoCierre !== '' && <span className="text-kx-red">(anotá el motivo de la diferencia)</span>}
                </Label>
                <Input
                  type="text"
                  placeholder="Incidencias del turno..."
                  value={observacionesCierre}
                  onChange={e => setObservacionesCierre(e.target.value)}
                  className="bg-kx-surface border-kx-border text-kx-text"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-kx-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCaja(false)}
              disabled={savingCaja}
              className="border-kx-border text-kx-text-2"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Cancelar
            </Button>
            <Button
              size="sm"
              disabled={savingCaja || (isSessionOpen && arqueoLoading)}
              onClick={isSessionOpen ? handleCerrarCaja : handleAbrirCaja}
              className={isSessionOpen
                ? 'bg-red-500 hover:bg-red-600 text-white'
                : 'bg-[rgb(var(--kx-green))] hover:opacity-90 text-white'
              }
            >
              {savingCaja
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> Procesando...</>
                : isSessionOpen
                  ? <><X className="w-3.5 h-3.5 mr-1" /> Cerrar caja</>
                  : <><CheckCircle className="w-3.5 h-3.5 mr-1" /> Abrir caja</>
              }
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Modal Historial del Turno ────────────────────────────────────────── */}
      <HistorialTurnoModal
        open={showHistorial}
        onOpenChange={setShowHistorial}
      />

      {/* TICKET-PRINT — Modal de éxito post-venta ──────────────────────────── */}
      <Dialog open={!!ventaExitosa} onOpenChange={(open) => !open && setVentaExitosa(null)}>
        <DialogContent className="max-w-lg bg-kx-surface border-kx-border text-kx-text">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-kx-green">
              <CheckCircle className="w-5 h-5" />
              ¡Venta confirmada!
            </DialogTitle>
            <DialogDescription className="text-kx-text-2 text-xs">
              Comprobante {ventaExitosa?.comprobante?.numero_venta} generado correctamente.
            </DialogDescription>
          </DialogHeader>

          {/* Modo Offline — Fase 3: aviso de que este número es provisorio */}
          {ventaExitosa?.comprobante?._offline && (
            <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
              Guardada sin conexión — el número es provisorio, se sincroniza sola en cuanto vuelva internet.
            </div>
          )}

          {ventaExitosa && (
            <div className="space-y-3 py-2">
              <div className="bg-kx-surface-2 rounded-xl p-4 space-y-2.5">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-kx-text-2">Cliente</span>
                  <span className="text-kx-text font-medium text-right">
                    {ventaExitosa.comprobante.cliente_nombre || 'Consumidor Final'}
                  </span>
                </div>
                {/* Forma de pago — hallazgo Luciano (29/08): con pago mixto (Cuenta
                    Corriente combinada, ver mig.372) esto puede listar 4-5 métodos
                    ("Efectivo + Tarjeta Crédito + Transferencia + Cuenta Corriente +
                    Tarjeta Débito") — en una sola fila lado a lado se amontonaba
                    contra el label. Va apilado (label arriba, valor abajo) para que
                    tenga todo el ancho del modal para envolver. */}
                <div className="text-sm">
                  <span className="text-kx-text-2">Forma de pago</span>
                  <p className="text-kx-text font-medium mt-0.5">{ventaExitosa.comprobante.forma_pago}</p>
                </div>
                {/* Fidelización por puntos (Fase 3) — canje aplicado en esta venta */}
                {ventaExitosa.comprobante.descuento_puntos_pesos > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-kx-text-2">Descuento por puntos ({ventaExitosa.comprobante.puntos_canjeados})</span>
                    <span className="text-kx-green font-medium">
                      -${Number(ventaExitosa.comprobante.descuento_puntos_pesos).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-kx-border">
                  <span className="text-kx-text-2 text-sm">Total</span>
                  <span className="text-2xl font-bold text-kx-text tabular-nums">
                    ${Number(ventaExitosa.comprobante.total).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              {/* Fidelización por puntos (Fase 2) — acá y no sólo en el toast,
                  que es efímero y fácil de no ver. */}
              {ventaExitosa.comprobante.puntos_ganados > 0 && (
                <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-3 py-2">
                  <Gift className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                    ¡Ganaste {ventaExitosa.comprobante.puntos_ganados} puntos!
                  </span>
                </div>
              )}

              {/* TICKET-PRINT — botones de impresión */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => handlePrint('80mm')}
                  className="gap-2 border-kx-border"
                >
                  <Printer className="w-4 h-4" />
                  Ticket 80mm
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handlePrint('A4')}
                  className="gap-2 border-kx-border"
                >
                  <FileText className="w-4 h-4" />
                  Imprimir A4
                </Button>
              </div>

              <Button
                onClick={() => setVentaExitosa(null)}
                className="w-full bg-[rgb(var(--kx-green))] hover:opacity-90 text-white"
              >
                Nueva venta
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* TICKET-PRINT — el ticket vive permanentemente en el DOM, oculto fuera
          de pantalla. Solo se vuelve visible cuando handlePrint inyecta el
          <style> @media print y dispara window.print(). */}
      <TicketPrint
        venta={ventaExitosa?.comprobante}
        items={ventaExitosa?.items}
        empresa={empresaData}
        formato={formatoTicket}
        ofertasCarrito={ventaExitosa?.ofertasCarrito ?? {}}
      />
    </div>
  );
}

export default ModoCajaLayout;
