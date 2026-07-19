import { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

const ConfigContext = createContext();

// EGRESS-FIX (sesión 78): el logo de la empresa se guarda como base64 (~960KB) en
// configuracion.valor. Antes este contexto hacía `select('clave, valor')` SIN filtro
// en cada montaje de la app y en cada login, arrastrando ese blob app-wide para algo
// que solo se muestra en la pantalla de login — que además, al no haber sesión, nunca
// lo llegaba a usar. Era el multiplicador que disparó el egress a 6.4GB.
//
// Ahora el contexto SOLO trae las claves chicas que consume el shell autenticado
// (Header/Dashboard/Reportes usan `nombre_empresa`). El logo NO viaja más por acá:
//  - Los tickets/PDF lo buscan por su cuenta, filtrado por clave (ModoCajaLayout,
//    empresaUtils.getEmpresaParaPDF).
//  - La pantalla de login (AuthPage) lo lee de un cache en localStorage que puebla
//    ConfiguracionSection al cargar/guardar — cero egress para mostrar el branding.
const SMALL_CONFIG_KEYS = ['nombre_empresa'];
export const LOGO_CACHE_KEY = 'kx_logo_base64_v1';

const readLogoCache = () => {
  try { return localStorage.getItem(LOGO_CACHE_KEY) || ''; } catch { return ''; }
};

export const ConfigProvider = ({ children }) => {
  const [config, setConfig] = useState({
    nombre_empresa: 'KAIROX Gestión',
    // Hidratado desde localStorage: la pantalla de login muestra el branding del
    // usuario recurrente sin pegarle a la DB. Vacío en un dispositivo nuevo (igual
    // que antes: sin sesión no había fetch de config).
    logo_base64: readLogoCache(),
  });
  const [loading, setLoading] = useState(true);

  const fetchConfig = async () => {
    try {
      const { data, error } = await supabase
        .from('configuracion')
        .select('clave, valor')
        .in('clave', SMALL_CONFIG_KEYS); // nunca trae el blob del logo

      if (error) {
        console.error('Error fetching config:', error);
        return;
      }

      if (data) {
        const overrides = {};
        data.forEach(item => {
          if (SMALL_CONFIG_KEYS.includes(item.clave)) {
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
    // EGRESS-FIX: el logo se persiste bajo la clave `logo_base64`. Nunca escribimos
    // `company_logo` (era una copia byte-a-byte que duplicaba el peso en la DB). Si
    // llega un logo, además lo cacheamos en localStorage para el branding del login.
    const { company_logo, logo_base64, ...rest } = newSettings;
    const logo = logo_base64 ?? company_logo;

    // Optimistic update — solo mantenemos en memoria las claves chicas + el logo cacheado.
    setConfig(prev => ({
      ...prev,
      ...Object.fromEntries(Object.entries(rest).filter(([k]) => SMALL_CONFIG_KEYS.includes(k))),
      ...(logo !== undefined ? { logo_base64: logo } : {}),
    }));

    if (logo !== undefined) {
      try {
        if (logo) localStorage.setItem(LOGO_CACHE_KEY, logo);
        else localStorage.removeItem(LOGO_CACHE_KEY);
      } catch { /* localStorage lleno o no disponible — no es crítico */ }
    }

    try {
      const { data: empresaId, error: rpcError } = await supabase.rpc('get_my_empresa_id');
      if (rpcError || !empresaId) throw rpcError || new Error('No se pudo obtener empresa_id');

      // Solo persistir `logo_base64` (nunca `company_logo`) + el resto de claves.
      const toPersist = { ...rest };
      if (logo !== undefined) toPersist.logo_base64 = logo;

      const updates = Object.entries(toPersist).map(([key, value]) => {
        return supabase
          .from('configuracion')
          .upsert({ empresa_id: empresaId, clave: key, valor: value }, { onConflict: 'empresa_id,clave' });
      });

      const results = await Promise.all(updates);
      for (const { error } of results) {
        if (error) throw error;
      }

      await fetchConfig(); // Refresh de las claves chicas (no re-trae el logo)
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
        // No borramos el cache del logo: el branding sigue en la pantalla de login.
        setConfig({ nombre_empresa: 'KAIROX Gestión', logo_base64: readLogoCache() });
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
