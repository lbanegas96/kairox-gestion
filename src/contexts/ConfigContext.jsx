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
        const newConfig = { ...config };
        data.forEach(item => {
          if (item.clave === 'nombre_empresa') newConfig.nombre_empresa = item.valor;
          if (item.clave === 'logo_base64') newConfig.logo_base64 = item.valor;
          if (item.clave === 'company_logo') newConfig.company_logo = item.valor;
        });
        setConfig(newConfig);
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
      const updates = Object.entries(newSettings).map(([key, value]) => {
        return supabase
          .from('configuracion')
          .upsert({ clave: key, valor: value }, { onConflict: 'clave' });
      });

      await Promise.all(updates);
      await fetchConfig(); // Refresh to ensure sync
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