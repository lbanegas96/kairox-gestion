import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { logger, safeErrorMessage } from '@/lib/securityUtils';
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsPasswordReset, setNeedsPasswordReset] = useState(false);
  const mounted = useRef(true);
  const isRecoveryFlow = useRef(false);
  
  const lastProcessedToken = useRef(null);

  // FETCH PROFILE
  const fetchProfile = async (userId) => {
    try {
      // Fetch profile AND associated company details
      const { data, error } = await supabase
        .from('profiles')
        .select('*, empresas(nombre)')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        logger.warn("Profile fetch warning:", error.message);
        return null;
      }
      return data;
    } catch (err) {
      logger.error("Profile fetch exception:", err);
      return null;
    }
  };

  // HANDLE SESSION
  const handleSession = useCallback(async (currentSession) => {
    if (!mounted.current) return;

    try {
      if (!currentSession) {
        if (lastProcessedToken.current !== null) {
          setUser(null);
          setSession(null);
          lastProcessedToken.current = null;
        }
        setLoading(false);
        return;
      }

      if (currentSession.access_token === lastProcessedToken.current) {
        setLoading(false);
        return;
      }

      lastProcessedToken.current = currentSession.access_token;
      setSession(currentSession);

      // Registrar último acceso
      supabase.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', currentSession.user.id).then(() => {});

      const profileData = await fetchProfile(currentSession.user.id);
      
      if (profileData && profileData.active === false) {
          await supabase.auth.signOut();
          setUser(null);
          setSession(null);
          lastProcessedToken.current = null;
          toast({
             title: "Cuenta inactiva",
             description: "Tu cuenta está inactiva. Contacta al administrador.",
             variant: "destructive"
          });
          setLoading(false);
          return;
      }

      const empresaId = profileData?.empresa_id;
      const tenantId = empresaId;

      const newUser = {
        ...currentSession.user,
        ...profileData,
        role: profileData?.role || currentSession.user?.user_metadata?.role || 'staff',
        empresa_id: empresaId,
        empresa_nombre: profileData?.empresas?.nombre,
        tenant_id: tenantId // Ensure this is never undefined
      };

      if (mounted.current) {
        setUser(newUser);
      }

    } catch (error) {
      logger.error("Auth: Critical error in handleSession", error);
    } finally {
      if (mounted.current) {
        setLoading(false);
      }
    }
  }, [toast]); 

  useEffect(() => {
    mounted.current = true;
    let authListener = null;

    const init = async () => {
      try {
        // Leer hash ANTES de cualquier operación async — es la única forma confiable
        const hash = window.location.hash.substring(1);
        const hashParams = Object.fromEntries(new URLSearchParams(hash));
        if (hashParams.type === 'recovery' || hashParams.type === 'invite') {
          isRecoveryFlow.current = true;
          setNeedsPasswordReset(true);
        }

        const { data: { session: initialSession }, error } = await supabase.auth.getSession();

        if (error) throw error;

        // Si es recovery, guardamos la sesión pero NO logueamos
        if (isRecoveryFlow.current) {
          setSession(initialSession);
          setLoading(false);
          // Limpiar el hash de la URL para que no se reprocese
          window.history.replaceState(null, '', window.location.pathname);
        } else {
          await handleSession(initialSession);
        }

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
          if (!mounted.current) return;
          if (event === 'PASSWORD_RECOVERY') {
            isRecoveryFlow.current = true;
            setNeedsPasswordReset(true);
            setSession(currentSession);
            setLoading(false);
          } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
            if (isRecoveryFlow.current) return; // Bloquear login durante recovery
            await handleSession(currentSession);
          } else if (event === 'SIGNED_OUT') {
            isRecoveryFlow.current = false;
            setUser(null);
            setSession(null);
            setNeedsPasswordReset(false);
            lastProcessedToken.current = null;
            setLoading(false);
          }
        });
        authListener = subscription;

      } catch (err) {
        logger.error("Auth: Init error", err);
        if (mounted.current) setLoading(false);
      }
    };

    init();

    return () => {
      mounted.current = false;
      if (authListener) authListener.unsubscribe();
    };
  }, [handleSession]);

  const signUp = useCallback(async (email, password, options) => {
    try {
      // Pass metadata including company name
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: options // This contains data: { first_name, last_name, nombre_empresa }
      });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const isEmailNotConfirmed = error.message?.toLowerCase().includes('email not confirmed');
      toast({
        variant: "destructive",
        title: "Error al iniciar sesión",
        description: isEmailNotConfirmed
          ? "Tu email no está confirmado. Revisá tu casilla de correo."
          : "Credenciales inválidas."
      });
    }
    return { data, error };
  }, [toast]);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (!error) {
      setUser(null);
      setSession(null);
      lastProcessedToken.current = null;
    }
    return { error };
  }, []);

  const getPermissions = useCallback(() => {
     if (!user) return [];
     if (user.role === 'admin') return ['ALL'];
     return Object.keys(user.permissions || {}).filter(k => user.permissions[k] === true);
  }, [user]);

  // ─── Inactividad: cerrar sesión luego de 30 min sin actividad ─────────────
  useInactivityTimeout(signOut, {
    minutes: 30,
    enabled: !!user,   // Solo cuando hay sesión activa
    onWarning: () => {
      toast({
        title: '⚠️ Sesión por expirar',
        description: 'Tu sesión se cerrará en 1 minuto por inactividad. Hacé click en cualquier lugar para mantenerla.',
        duration: 55_000,
      });
    },
  });

  const value = useMemo(() => ({
    user,
    session,
    loading,
    needsPasswordReset,
    setNeedsPasswordReset,
    signUp,
    signIn,
    signOut,
    userRole: user?.role,
    getPermissions
  }), [user, session, loading, needsPasswordReset, signUp, signIn, signOut, getPermissions]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};