import React, { useState, useEffect } from 'react';
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
      return [...prev, { ...producto, cantidad: 1 }];
    });
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
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${
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

      {/* ── Body: POS expandido ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        <PanelProductos onAgregarAlCarrito={handleAgregarAlCarrito} />
        <PanelCarrito
          carrito={carrito}
          onModificarCarrito={setCarrito}
          onVentaExitosa={(payload) => setVentaExitosa(payload)}
        />
      </div>

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
      />
    </div>
  );
}

export default ModoCajaLayout;
