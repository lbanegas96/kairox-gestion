import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';

// Fase 5 (interruptor comercial, mig.383) — empresas.usa_ajuste_inflacion
// gatea TODO el módulo de Ajuste por Inflación (Fases 1-4): clasificación
// de cuentas, índices, asiento de ajuste en Cierre de Ejercicio, toggle
// "moneda homogénea" en Balance/EERR, calculadora impositiva en Impuestos.
// Mismo patrón que usa_impuestos_avanzados/usa_centros_costo, consumido acá
// vía hook en vez de prop-drilling porque el módulo toca 5 componentes en
// secciones distintas del sistema.
export function useAjusteInflacionHabilitado() {
  const { user } = useAuth();
  const empresaId = user?.empresa_id;

  const { data, isLoading } = useQuery({
    queryKey: ['usa_ajuste_inflacion', empresaId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('empresas')
        .select('usa_ajuste_inflacion')
        .eq('id', empresaId)
        .single();
      if (error) throw new Error(error.message);
      return data?.usa_ajuste_inflacion ?? false;
    },
    enabled: !!empresaId,
    staleTime: 60_000,
  });

  return { habilitado: data ?? false, isLoading };
}
