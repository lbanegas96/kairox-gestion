import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

/**
 * Toggle por empresa (Configuración → Facturación) que oculta el módulo
 * Cotizaciones del sidebar, del tab dentro de Ventas y de Acciones Rápidas.
 * Default true — nunca se oculta hasta que alguien lo apague a propósito.
 */
export function useCotizacionesActivo() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['cotizaciones-activo', user?.empresa_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('empresas')
        .select('cotizaciones_activo')
        .eq('id', user.empresa_id)
        .single();
      return data?.cotizaciones_activo ?? true;
    },
    enabled: !!user?.empresa_id,
    staleTime: 5 * 60 * 1000,
  });

  return data ?? true;
}
