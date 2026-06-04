import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { getNowAR } from '@/lib/dateUtils';

const CajaContext = createContext(undefined);

export const CajaProvider = ({ children }) => {
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeCaja, setActiveCaja] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const isFetching = useRef(false);
  const activeCajaRef = useRef(null);

  useEffect(() => {
    activeCajaRef.current = activeCaja;
  }, [activeCaja]);

  // Resuelve la caja activa de la empresa (usa ref para evitar re-fetches)
  const resolveActiveCaja = useCallback(async () => {
    if (!user?.empresa_id) return null;
    if (activeCajaRef.current) return activeCajaRef.current;

    const { data, error } = await supabase
      .from('cajas')
      .select('*')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Error fetching caja:', error);
      return null;
    }

    setActiveCaja(data);
    activeCajaRef.current = data;
    return data;
  }, [user?.empresa_id]);

  const fetchCurrentSession = useCallback(async () => {
    if (!user?.empresa_id || isFetching.current) {
      setLoading(false);
      return;
    }

    isFetching.current = true;
    try {
      const caja = await resolveActiveCaja();
      if (!caja) {
        setCurrentSession(null);
        setIsSessionOpen(false);
        return;
      }

      const { data, error } = await supabase
        .from('caja_sesiones')
        .select('*')
        .eq('estado', 'abierta')
        .eq('caja_id', caja.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching session:', error);
      }

      setCurrentSession(data || null);
      setIsSessionOpen(!!data);
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
      const { data, error } = await supabase
        .from('caja_sesiones')
        .insert([{
          caja_id: caja.id,
          empresa_id: user.empresa_id,
          tenant_id: user.tenant_id,
          user_id: user.id,
          abierto_por: user.id,
          monto_inicial: parseFloat(montoInicial),
          estado: 'abierta',
          apertura_fecha: nowAR,
        }])
        .select()
        .single();

      if (error) throw error;

      setCurrentSession(data);
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
      isSessionOpen,
      loading,
      refreshSession: fetchCurrentSession,
      openSession,
      closeSession
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
