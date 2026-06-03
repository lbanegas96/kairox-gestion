import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

const ConfigContext = createContext();

// IDs de todos los módulos del sistema
export const ALL_MODULES = [
  { id: 'dashboard',       label: 'Dashboard',          required: true  },
  { id: 'productos',       label: 'Inventario',          required: false },
  { id: 'ventas',          label: 'Ventas',              required: false },
  { id: 'cotizaciones',    label: 'Cotizaciones',        required: false },
  { id: 'compras',         label: 'Compras',             required: false },
  { id: 'ordenes_compra',  label: 'Órdenes de Compra',   required: false },
  { id: 'caja',            label: 'Caja',                required: false },
  { id: 'movimientos-uala',label: 'Ualá',                required: false },
  { id: 'clientes',        label: 'Clientes',            required: false },
  { id: 'cuentacorriente', label: 'Cta. Corriente',      required: false },
  { id: 'plan_cuentas',    label: 'Contabilidad',        required: false },
  { id: 'reportes',        label: 'Reportes',            required: false },
  { id: 'usuarios',        label: 'Usuarios',            required: true  },
  { id: 'configuracion',   label: 'Configuración',       required: true  },
];

const ALL_MODULE_IDS = ALL_MODULES.map(m => m.id);

export const ConfigProvider = ({ children }) => {
  const [config, setConfig] = useState({
    nombre_empresa: 'KAIROX Gestión',
    logo_base64: '',
    company_logo: '',
    modulos_activos: null, // null = todos activos (default)
    oc_requiere_aprobacion: 'false',
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
          if (['nombre_empresa', 'logo_base64', 'company_logo', 'oc_requiere_aprobacion'].includes(item.clave)) {
            overrides[item.clave] = item.valor;
          }
          if (item.clave === 'modulos_activos') {
            try { overrides.modulos_activos = JSON.parse(item.valor); }
            catch { overrides.modulos_activos = null; }
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

  // Devuelve true si el módulo está activo (null = todos activos)
  const isModuloActivo = useCallback((moduleId) => {
    const mod = ALL_MODULES.find(m => m.id === moduleId);
    if (mod?.required) return true; // siempre activos
    if (!config.modulos_activos) return true; // sin configuración = todos activos
    return config.modulos_activos.includes(moduleId);
  }, [config.modulos_activos]);

  const updateConfig = async (newSettings) => {
    // Optimistic update
    setConfig(prev => ({ ...prev, ...newSettings }));

    try {
      const { data: empresaId, error: rpcError } = await supabase.rpc('get_my_empresa_id');
      if (rpcError || !empresaId) throw rpcError || new Error('No se pudo obtener empresa_id');

      for (const [key, value] of Object.entries(newSettings)) {
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
            .insert({ empresa_id: empresaId, clave: key, valor: value });
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
    <ConfigContext.Provider value={{ config, loading, updateConfig, isModuloActivo, ALL_MODULES }}>
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