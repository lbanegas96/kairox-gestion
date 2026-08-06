import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { getNowAR } from '@/lib/dateUtils';
import { parseNumberLocale } from '@/lib/currencyUtils';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import {
  encolarAperturaCaja, listarAperturasPendientes,
  contarVentasPendientes, contarAperturasPendientes,
} from '@/lib/offlineDb';

const CajaContext = createContext(undefined);

// Multi-caja simultánea: qué caja física usa este dispositivo/navegador se
// guarda acá, no en el servidor — cualquier cajero puede cubrir cualquier
// caja un día, no tiene sentido una asignación fija por usuario. Incluye el
// empresa_id en la clave porque el mismo navegador puede loguearse a más de
// un tenant (mismo patrón que `checklist_dismissed_${empresa_id}` en
// ChecklistOnboarding.jsx).
const cajaStorageKey = (empresaId) => `kx_caja_activa_${empresaId}`;

export const CajaProvider = ({ children }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const isOnline = useOnlineStatus();

  const [activeCaja, setActiveCaja] = useState(null);
  const [availableCajas, setAvailableCajas] = useState([]);
  const [needsCajaSelection, setNeedsCajaSelection] = useState(false);
  const [currentSession, setCurrentSession] = useState(null);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const isFetching = useRef(false);
  const activeCajaRef = useRef(null);

  useEffect(() => {
    activeCajaRef.current = activeCaja;
  }, [activeCaja]);

  // Resuelve la caja de este dispositivo (usa ref para evitar re-fetches).
  // Con 1 sola caja activa (caso de la inmensa mayoría de empresas hoy) se
  // auto-selecciona igual que siempre, sin fricción nueva. Con 2+, respeta
  // la elección guardada en este navegador si sigue siendo válida (por si
  // esa caja fue desactivada desde Configuración); si no hay ninguna válida,
  // no elige nada y deja que la UI muestre el selector (needsCajaSelection).
  const resolveActiveCaja = useCallback(async () => {
    if (!user?.empresa_id) return null;
    if (activeCajaRef.current) return activeCajaRef.current;

    const { data, error } = await supabase
      .from('cajas')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching cajas:', error);
      return null;
    }

    const cajas = data ?? [];
    setAvailableCajas(cajas);

    if (cajas.length === 0) {
      setActiveCaja(null);
      activeCajaRef.current = null;
      setNeedsCajaSelection(false);
      return null;
    }

    if (cajas.length === 1) {
      setActiveCaja(cajas[0]);
      activeCajaRef.current = cajas[0];
      setNeedsCajaSelection(false);
      return cajas[0];
    }

    let savedId = null;
    try { savedId = localStorage.getItem(cajaStorageKey(user.empresa_id)); } catch { /* no crítico */ }
    const saved = savedId ? cajas.find(c => c.id === savedId) : null;

    if (saved) {
      setActiveCaja(saved);
      activeCajaRef.current = saved;
      setNeedsCajaSelection(false);
      return saved;
    }

    setActiveCaja(null);
    activeCajaRef.current = null;
    setNeedsCajaSelection(true);
    return null;
  }, [user?.empresa_id]);

  const selectCaja = useCallback((cajaId) => {
    const caja = availableCajas.find(c => c.id === cajaId);
    if (!caja || !user?.empresa_id) return;
    try { localStorage.setItem(cajaStorageKey(user.empresa_id), caja.id); } catch { /* no crítico */ }
    setActiveCaja(caja);
    activeCajaRef.current = caja;
    setNeedsCajaSelection(false);
    // eslint-disable-next-line no-use-before-define
    fetchCurrentSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCajas, user?.empresa_id]);

  // Sólo debe invocarse sin turno abierto (esa regla la aplica quien lo
  // llama, ModoCajaLayout.jsx — mismo criterio que openSession valida
  // isSessionOpen puertas adentro en vez de acá).
  const changeCaja = useCallback(() => {
    try { localStorage.removeItem(cajaStorageKey(user?.empresa_id)); } catch { /* no crítico */ }
    setActiveCaja(null);
    activeCajaRef.current = null;
    setNeedsCajaSelection(true);
  }, [user?.empresa_id]);

  const fetchCurrentSession = useCallback(async () => {
    if (!user?.empresa_id || isFetching.current) {
      setLoading(false);
      return;
    }

    isFetching.current = true;
    try {
      let sesionReal = null;
      const caja = await resolveActiveCaja();
      if (caja) {
        const { data, error } = await supabase
          .from('caja_sesiones')
          .select('*')
          .eq('estado', 'abierta')
          .eq('caja_id', caja.id)
          .maybeSingle();

        if (error && error.code !== 'PGRST116') {
          console.error('Error fetching session:', error);
        }
        sesionReal = data || null;
      }

      if (sesionReal) {
        setCurrentSession(sesionReal);
        setIsSessionOpen(true);
        return;
      }

      // Modo Offline — Fase 3: no hay sesión real abierta del lado del
      // servidor (o ni siquiera se pudo resolver la caja — típico si se
      // recarga la página estando offline). Antes de asumir "caja cerrada",
      // revisar si hay una apertura encolada sin sincronizar todavía — si no
      // se hiciera esto, refrescar la página en medio de un turno offline
      // "perdería" la caja abierta y el cajero terminaría abriendo una
      // segunda por error.
      const pendientes = await listarAperturasPendientes(user.empresa_id);
      const pendiente = pendientes.find(a => a.estado === 'pendiente');
      if (pendiente) {
        setCurrentSession({
          id: null,
          caja_id: pendiente.payload.p_caja_id,
          empresa_id: user.empresa_id,
          user_id: pendiente.payload.p_user_id,
          monto_inicial: pendiente.payload.p_monto_inicial,
          estado: 'abierta',
          apertura_fecha: pendiente.payload.p_apertura_fecha,
          client_uuid: pendiente.client_uuid,
          _pendingSync: true,
        });
        setIsSessionOpen(true);
        return;
      }

      setCurrentSession(null);
      setIsSessionOpen(false);
    } catch (err) {
      console.error('Exception fetching session:', err);
    } finally {
      isFetching.current = false;
      setLoading(false);
    }
  }, [user?.empresa_id, resolveActiveCaja]);

  useEffect(() => {
    fetchCurrentSession();
  }, [fetchCurrentSession]);

  useEffect(() => {
    const interval = setInterval(fetchCurrentSession, 30000);
    return () => clearInterval(interval);
  }, [fetchCurrentSession]);

  const openSession = async (montoInicial) => {
    if (!user?.empresa_id) {
      toast({ title: "Error", description: "No se puede abrir caja: Usuario no identificado.", variant: "destructive" });
      return false;
    }
    if (isSessionOpen) {
      toast({ title: "Error", description: "Ya existe una caja abierta.", variant: "destructive" });
      return false;
    }

    try {
      const caja = await resolveActiveCaja();
      if (!caja) {
        toast({ title: "Error", description: "No se encontró una caja activa para esta empresa.", variant: "destructive" });
        return false;
      }

      const nowAR = getNowAR().toISOString();
      const montoInicialParsed = parseNumberLocale(montoInicial);

      // Modo Offline — Fase 3: sin conexión, la apertura se encola (mig.310
      // todavía no se puede llamar sin red) y se arma una sesión "local" —
      // el cajero puede seguir vendiendo Efectivo/Transferencia contra ella
      // (useConfirmarVenta la reconoce por `client_uuid`, no por `id`) hasta
      // que se sincronice con el servidor al reconectar.
      if (!isOnline) {
        const payload = {
          p_empresa_id: user.empresa_id,
          p_caja_id: caja.id,
          p_user_id: user.id,
          p_monto_inicial: montoInicialParsed,
          p_apertura_fecha: nowAR,
        };
        const filaEncolada = await encolarAperturaCaja(user.empresa_id, payload);
        setCurrentSession({
          id: null,
          caja_id: caja.id,
          empresa_id: user.empresa_id,
          user_id: user.id,
          monto_inicial: montoInicialParsed,
          estado: 'abierta',
          apertura_fecha: nowAR,
          client_uuid: filaEncolada.client_uuid,
          _pendingSync: true,
        });
        setIsSessionOpen(true);
        toast({
          title: "Caja abierta — sin conexión",
          description: "Se guardó localmente y se sincroniza sola en cuanto vuelva la conexión.",
          className: "bg-amber-600 text-white",
        });
        return true;
      }

      const { data, error } = await supabase.rpc('abrir_caja_sesion', {
        p_empresa_id: user.empresa_id,
        p_caja_id: caja.id,
        p_user_id: user.id,
        p_monto_inicial: montoInicialParsed,
        p_apertura_fecha: nowAR,
      });
      if (error) throw error;

      if (data.conflict) {
        // Otro dispositivo (online u offline) abrió esta caja casi al mismo
        // tiempo — se refleja la sesión que de verdad ganó, en vez de un
        // error crudo de Postgres.
        toast({
          title: "Ya había una caja abierta",
          description: "Otro usuario abrió esta caja justo antes. Se actualizó con esa sesión.",
          variant: "destructive",
        });
        await fetchCurrentSession();
        return false;
      }

      const { data: sesion, error: sesionError } = await supabase
        .from('caja_sesiones').select('*').eq('id', data.sesion_id).single();
      if (sesionError) throw sesionError;

      setCurrentSession(sesion);
      setIsSessionOpen(true);
      toast({ title: "Caja Abierta", description: "Se ha iniciado un nuevo turno de caja.", className: "bg-green-600 text-white" });
      return true;
    } catch (error) {
      console.error('Error opening session:', error);
      toast({ title: "Error al abrir caja", description: error.message, variant: "destructive" });
      return false;
    }
  };

  const closeSession = async (montoFinalReal, observaciones, montoFinalEsperado, diferencia) => {
    if (!currentSession) return false;

    // Modo Offline — Fase 3: no se puede cerrar con movimientos que el
    // servidor todavía no reconoce — el arqueo real (useArqueoCaja) no los ve
    // y un cierre ahora grabaría un esperado incompleto. 'conflicto' cuenta
    // igual que 'pendiente': tampoco está resuelto en el servidor.
    const [ventasPend, aperturasPend] = await Promise.all([
      contarVentasPendientes(user.empresa_id),
      contarAperturasPendientes(user.empresa_id),
    ]);
    const totalPendiente = ventasPend + aperturasPend;
    if (totalPendiente > 0) {
      toast({
        title: "Hay movimientos sin sincronizar",
        description: `Quedan ${totalPendiente} movimiento(s) esperando conexión. Esperá a que se sincronicen antes de cerrar caja.`,
        variant: "destructive",
      });
      return false;
    }

    if (currentSession._pendingSync) {
      // No debería pasar (si hubiera pendientes, el check de arriba ya
      // frenó) — pero por las dudas: no hay id real todavía para actualizar.
      toast({
        title: "La apertura de esta caja todavía no se sincronizó",
        description: "Esperá a que haya conexión antes de cerrar.",
        variant: "destructive",
      });
      return false;
    }

    try {
      const nowAR = getNowAR().toISOString();
      const { error } = await supabase
        .from('caja_sesiones')
        .update({
          estado: 'cerrada',
          cierre_fecha: nowAR,
          cerrado_por: user.id,
          monto_final_real: parseFloat(montoFinalReal),
          monto_final_esperado: parseFloat(montoFinalEsperado),
          diferencia: parseFloat(diferencia),
          observaciones,
        })
        .eq('id', currentSession.id);

      if (error) throw error;

      setCurrentSession(null);
      setIsSessionOpen(false);
      toast({ title: "Caja Cerrada", description: "El turno se ha cerrado correctamente.", className: "bg-blue-600 text-white" });
      return true;
    } catch (error) {
      console.error('Error closing session:', error);
      toast({ title: "Error al cerrar caja", description: error.message, variant: "destructive" });
      return false;
    }
  };

  return (
    <CajaContext.Provider value={{
      currentSession,
      activeCaja,
      availableCajas,
      needsCajaSelection,
      isSessionOpen,
      loading,
      refreshSession: fetchCurrentSession,
      openSession,
      closeSession,
      selectCaja,
      changeCaja,
    }}>
      {children}
    </CajaContext.Provider>
  );
};

export const useCaja = () => {
  const context = useContext(CajaContext);
  if (context === undefined) throw new Error('useCaja must be used within a CajaProvider');
  return context;
};
