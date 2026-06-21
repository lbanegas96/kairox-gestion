import React, { useState, useEffect } from 'react';
import { Landmark, History, LogOut, Loader2, X, CheckCircle } from 'lucide-react';
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

// Layout pantalla completa para usuarios cajeros (role='solo_caja' o modo_caja=true).
// No tiene sidebar ni header estándar.
function ModoCajaLayout({ onLogout }) {
  const { user }                                       = useAuth();
  const { isSessionOpen, currentSession, openSession,
          closeSession, loading: cajaLoading }          = useCaja();
  const { toast }                                      = useToast();

  const [carrito, setCarrito]       = useState([]);
  const [logoUrl, setLogoUrl]       = useState('');
  const [empresaNombre, setEmpresaNombre] = useState('');
  const [showCaja, setShowCaja]     = useState(false);
  const [showHistorial, setShowHistorial] = useState(false);
  const [montoApertura, setMontoApertura] = useState('');
  const [montoCierre, setMontoCierre]     = useState('');
  const [savingCaja, setSavingCaja]       = useState(false);

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
        .select('nombre')
        .eq('id', user.empresa_id)
        .single(),
    ]).then(([{ data: logoRow }, { data: empresa }]) => {
      if (logoRow?.valor) setLogoUrl(logoRow.valor);
      if (empresa?.nombre) setEmpresaNombre(empresa.nombre);
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

          <Button
            size="sm"
            variant="ghost"
            onClick={onLogout}
            className="h-7 text-xs text-kx-text-3 hover:text-kx-red gap-1"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </div>
      </div>

      {/* ── Body: POS expandido ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        <PanelProductos onAgregarAlCarrito={handleAgregarAlCarrito} />
        <PanelCarrito
          carrito={carrito}
          onModificarCarrito={setCarrito}
          onVentaExitosa={() => {/* carrito ya se limpia en PanelCarrito */}}
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
    </div>
  );
}

export default ModoCajaLayout;
