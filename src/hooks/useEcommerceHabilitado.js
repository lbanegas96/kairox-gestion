import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

/**
 * ¿La empresa tiene habilitado el módulo de ecommerce? (toggle de plan
 * empresas.usa_ecommerce, mig.236). Gatea toda la UI relacionada con la
 * integración de canales de venta (Tiendanube): card de conexión, tilde
 * "Publicar en ecommerce" del producto, estado de publicación.
 *
 * Cacheado con react-query (5 min) para no re-pegarle a la DB en cada render —
 * lo consumen varios componentes (ProductForm, TabIntegraciones).
 */
export function useEcommerceHabilitado() {
  const { user } = useAuth();
  const empresaId = user?.empresa_id;

  const { data, isLoading } = useQuery({
    queryKey: ['usa_ecommerce', empresaId],
    queryFn: async () => {
      const { data } = await supabase
        .from('empresas')
        .select('usa_ecommerce')
        .eq('id', empresaId)
        .single();
      return data?.usa_ecommerce ?? false;
    },
    enabled: !!empresaId,
    staleTime: 1000 * 60 * 5,
  });

  return { habilitado: data ?? false, isLoading };
}
