import { useState, useEffect, useCallback } from 'react';
import { Landmark, History, LogOut, Loader2, X, CheckCircle, ArrowLeft, Printer, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useCaja } from '@/contexts/CajaContext';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { precioPackFinal } from '@/lib/unidadesMedida';
import PanelProductos from './PanelProductos';
import PanelCarrito from './PanelCarrito';
import HistorialTurnoModal from './HistorialTurnoModal';
import TicketPrint from './TicketPrint';

// Layout pantalla completa para usuarios cajeros (role='solo_caja' o modo_caja=true).
// No tiene sidebar ni header estándar.
function ModoCajaLayout({ onLogout, onBack = null }) {
  const { user }                                       = useAuth();
  const { isSessionOpen, currentSession, openSession,
          closeSession, loading: cajaLoading }          = useCaja();
  const { toast }                                      = useToast();

  const [carrito, setCarrito]       = useState([]);
  const [logoUrl, setLogoUrl]       = useState('');
  const [empresaNombre, setEmpresaNombre] = useState('');
  // TICKET-PRINT — datos de empresa para encabezado del ticket
  const [empresaData, setEmpresaData] = useState({});
  const [showCaja, setShowCaja]     = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [montoApertura, setMontoApertura] = useState('');
  const [montoCierre, setMontoCierre]     = useState('');
  const [savingCaja, setSavingCaja]       = useState(false);
  // TICKET-PRINT — payload de la última venta exitosa (comprobante + items snapshot)
  const [ventaExitosa, setVentaExitosa] = useState(null);
  const [formatoTicket, setFormatoTicket] = useState('80mm');
  // OFERTAS — estado del motor de descuentos
  const [ofertasCarrito, setOfertasCarrito] = useState({});
  const [descuentosManuales, setDescuentosManuales] = useState({});
  const [medioPagoSeleccionado, setMedioPagoSeleccionado] = useState('Efectivo');
  // RESPONSIVE-MOBILE
  const [tabMobile, setTabMobile] = useState('productos'); // 'productos' | 'carrito'

  // Cargar logo y nombre empresa
  useEffect(() => {
    if (!user?.empresa_id) return;
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
    });
  }, [user?.empresa_id]);

  // OFERTAS — llamar al RPC cuando cambia el carrito o medio de pago
  const calcularOfertas = useCallback(async (carritoActual, medioPago) => {
    if (!carritoActual.length || !user?.empresa_id) {
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
  }, [user?.empresa_id]);

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
    setCarrito(prev => {
      const existente = prev.find(i => i.id === producto.id);
      if (existente) {
        if (producto.stock_actual < existente.cantidad + 1) {
          toast({
            title: 'Stock insuficiente',
            description: `Solo hay ${producto.stock_actual} u. de "${producto.nombre}"`,
            variant: 'destructive',
          });
          return prev;
        }
        return prev.map(i => i.id === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i);
      }
      return [...prev, { ...producto, cantidad: 1, _precioUnitOriginal: producto.precio_venta }];
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
    const monto = parseNumberLocale(montoCierre) || 0;
    setSavingCaja(true);
    const ok = await closeSession(monto, '', 0, 0);
    setSavingCaja(false);
    if (ok) {
      setShowCaja(false);
      setMontoCierre('');
    }
  };

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
          <PanelProductos onAgregarAlCarrito={handleAgregarAlCarrito} />
        </div>
        {/* RESPONSIVE-MOBILE */}
        <div className={`${tabMobile === 'carrito' ? 'flex' : 'hidden'} md:flex flex-col w-full md:w-[360px] lg:w-[420px] flex-shrink-0`}>
          <PanelCarrito
            carrito={carrito}
            onModificarCarrito={setCarrito}
            onTogglePack={togglePackMode}
            onUpdatePacks={updatePacks}
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

      {/* ── Modal Abrir / Cerrar Caja ───────────────────────────────────────── */}
      <Dialog open={showCaja} onOpenChange={setShowCaja}>
        <DialogContent className="max-w-sm bg-kx-surface border-kx-border text-kx-text">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-kx-violet" />
              {isSessionOpen ? 'Cerrar Caja' : 'Abrir Caja'}
            </DialogTitle>
            <DialogDescription className="text-kx-text-2 text-xs">
              {isSessionOpen
                ? 'Indicá el monto final en efectivo para cerrar el turno.'
                : 'Indicá el monto inicial en efectivo para comenzar el turno.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-kx-text-2">
                {isSessionOpen ? 'Monto final real ($)' : 'Monto de apertura ($)'}
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
                className="bg-kx-surface border-kx-border text-kx-text"
                autoFocus
              />
            </div>
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
              disabled={savingCaja}
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
        <DialogContent className="max-w-md bg-kx-surface border-kx-border text-kx-text">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-kx-green">
              <CheckCircle className="w-5 h-5" />
              ¡Venta confirmada!
            </DialogTitle>
            <DialogDescription className="text-kx-text-2 text-xs">
              Comprobante {ventaExitosa?.comprobante?.numero_venta} generado correctamente.
            </DialogDescription>
          </DialogHeader>

          {ventaExitosa && (
            <div className="space-y-3 py-2">
              <div className="bg-kx-surface-2 rounded-xl p-4 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-kx-text-2">Cliente</span>
                  <span className="text-kx-text font-medium">
                    {ventaExitosa.comprobante.cliente_nombre || 'Consumidor Final'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-kx-text-2">Forma de pago</span>
                  <span className="text-kx-text font-medium">{ventaExitosa.comprobante.forma_pago}</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-kx-border">
                  <span className="text-kx-text-2 text-sm">Total</span>
                  <span className="text-2xl font-bold text-kx-text tabular-nums">
                    ${Number(ventaExitosa.comprobante.total).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

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
