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
      for (const [key, value] of Object.entries(newSettings)) {
        // Verificar si la clave ya existe (RLS filtra por empresa automáticamente)
        const { data: existing } = await supabase
          .from('configuracion')
          .select('clave')
          .eq('clave', key)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase
            .from('configuracion')
            .update({ valor: value })
            .eq('clave', key);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('configuracion')
            .insert({ clave: key, valor: value });
          if (error) throw error;
        }
      }

      await fetchConfig();
      return { success: true };
    } catch (error) {
      console.error('Error updating config:', error);
      return { success: false, error };
    }
  };

  useEffect(() => {
    fetchConfig();
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