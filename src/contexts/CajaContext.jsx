import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { getNowAR } from '@/lib/dateUtils';

const CajaContext = createContext(undefined);

export const CajaProvider = ({ children }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [currentSession, setCurrentSession] = useState(null);
  const [isSessionOpen, setIsSessionOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Use a ref to prevent race conditions during refresh
  const isFetching = useRef(false);

  const fetchCurrentSession = useCallback(async () => {
    // CRITICAL FIX: Check if user and tenant_id are defined before querying
    if (!user || !user.tenant_id || isFetching.current) {
      setLoading(false);
      return;
    }
    
    isFetching.current = true;
    try {
      const { data, error } = await supabase
        .from('caja_sesiones')
        .select('*')
        .eq('estado', 'abierta')
        .eq('tenant_id', user.tenant_id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching session:', error);
      }

      if (data) {
        setCurrentSession(data);
        setIsSessionOpen(true);
      } else {
        setCurrentSession(null);
        setIsSessionOpen(false);
      }
    } catch (err) {
      console.error('Exception fetching session:', err);
    } finally {
      isFetching.current = false;
      setLoading(false);
    }
  }, [user]);

  // Initial fetch
  useEffect(() => {
    fetchCurrentSession();
  }, [fetchCurrentSession]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchCurrentSession, 30000);
    return () => clearInterval(interval);
  }, [fetchCurrentSession]);

  const openSession = async (montoInicial) => {
    try {
      if (!user || !user.tenant_id) {
        toast({ title: "Error", description: "No se puede abrir caja: Usuario no identificado.", variant: "destructive" });
        return false;
      }

      if (isSessionOpen) {
        toast({ title: "Error", description: "Ya existe una caja abierta.", variant: "destructive" });
        return false;
      }

      const nowAR = getNowAR().toISOString();
      const newSession = {
        tenant_id: user.tenant_id,
        user_id: user.id,
        abierto_por: user.id,
        monto_inicial: parseFloat(montoInicial),
        estado: 'abierta',
        apertura_fecha: nowAR,
        empresa_id: user.empresa_id // Ensure empresa_id is also set if available
      };

      const { data, error } = await supabase
        .from('caja_sesiones')
        .insert([newSession])
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
    try {
      if (!currentSession) return false;

      const nowAR = getNowAR().toISOString();
      
      const updateData = {
        estado: 'cerrada',
        cierre_fecha: nowAR,
        cerrado_por: user.id,
        monto_final_real: parseFloat(montoFinalReal),
        monto_final_esperado: parseFloat(montoFinalEsperado),
        diferencia: parseFloat(diferencia),
        observaciones: observaciones
      };

      const { error } = await supabase
        .from('caja_sesiones')
        .update(updateData)
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