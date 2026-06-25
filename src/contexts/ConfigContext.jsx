import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

const ConfigContext = createContext();

export const ConfigProvider = ({ children }) => {
  const [config, setConfig] = useState({
    nombre_empresa: 'KAIROX Gestión',
    logo_base64: '',
    company_logo: '' // Added for URL support
  });
  const [loading, setLoading] = useState(true);

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('configuracion')
        .select('clave, valor');

      if (error) {
        console.error('Error fetching config:', error);
        return;
      }

      if (data) {
        const overrides = {};
        data.forEach(item => {
          if (['nombre_empresa', 'logo_base64', 'company_logo'].includes(item.clave)) {
            overrides[item.clave] = item.valor;
          }
        });
        setConfig(prev => ({ ...prev, ...overrides }));
      }
    } catch (err) {
      console.error('Unexpected error fetching config:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = async (newSettings) => {
    // Optimistic update
    setConfig(prev => ({ ...prev, ...newSettings }));

    try {
      const { data: empresaId, error: rpcError } = await supabase.rpc('get_my_empresa_id');
      if (rpcError || !empresaId) throw rpcError || new Error('No se pudo obtener empresa_id');

      const updates = Object.entries(newSettings).map(([key, value]) => {
        return supabase
          .from('configuracion')
          .upsert({ empresa_id: empresaId, clave: key, valor: value }, { onConflict: 'empresa_id,clave' });
      });

      const results = await Promise.all(updates);
      for (const { error } of results) {
        if (error) throw error;
      }

      await fetchConfig(); // Refresh to ensure sync
      return { success: true };
    } catch (error) {
      console.error('Error updating config:', error);
      return { success: false, error };
    }
  };

  useEffect(() => {
    let mounted = true;

    // Espera la sesión antes de fetchear; si no hay, no toca la DB.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      if (session) {
        fetchConfig();
      } else {
        setLoading(false);
      }
    });

    // Re-fetch en login/logout para mantener config sincronizada
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN' && session) {
        fetchConfig();
      } else if (event === 'SIGNED_OUT') {
        setConfig({ nombre_empresa: 'KAIROX Gestión', logo_base64: '', company_logo: '' });
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <ConfigContext.Provider value={{ config, loading, updateConfig }}>
      {children}
    </ConfigContext.Provider>
  );
};

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (context === undefined) {
    throw new Error('useConfig must be used within a ConfigProvider');
  }
  return context;
};