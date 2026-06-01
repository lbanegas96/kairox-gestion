import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';

const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const { toast } = useToast();

  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  
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
        console.warn("Profile fetch warning:", error.message);
        return null;
      }
      return data;
    } catch (err) {
      console.error("Profile fetch exception:", err);
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

      // Important: Map tenant_id to empresa_id for backward compatibility with components using user.tenant_id
      const empresaId = profileData?.empresa_id;
      
      // CRITICAL FIX: tenant_id must always equal user.id (auth UUID).
      // Tables have FK: tenant_id → profiles(id), so we can never use empresa_id here.
      const tenantId = currentSession.user.id;

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
      console.error("Auth: Critical error in handleSession", error);
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
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        
        if (error) throw error;
        await handleSession(initialSession);

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
          if (!mounted.current) return;
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
             await handleSession(currentSession);
          } else if (event === 'SIGNED_OUT') {
             setUser(null);
             setSession(null);
             lastProcessedToken.current = null;
             setLoading(false);
          }
        });
        authListener = subscription;

      } catch (err) {
        console.error("Auth: Init error", err);
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

  const value = useMemo(() => ({
    user,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    userRole: user?.role,
    getPermissions
  }), [user, session, loading, signUp, signIn, signOut, getPermissions]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};