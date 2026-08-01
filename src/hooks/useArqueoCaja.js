import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/customSupabaseClient';
import { useCaja } from '@/contexts/CajaContext';
import { useAuth } from '@/contexts/SupabaseAuthContext';

// Fuente única del cálculo de arqueo de caja.
//
// Antes esta lógica vivía sólo dentro de CajaCierre.jsx (cierre desde el panel
// administrativo), y el cierre desde el POS (ModoCajaLayout) mandaba
// esperado=0 / diferencia=0 hardcodeados — grabando un arqueo falso en
// caja_sesiones. Extraído acá para que ambos caminos de cierre calculen igual
// por construcción y no puedan volver a divergir.

const EMPTY = {
  inicial: 0,
  ingresosEfectivo: 0,
  egresosEfectivo: 0,
  otrosIngresos: 0, // Tarjetas, transferencias, etc. — no cuentan para el efectivo en caja
  esperado: 0,
};

export const ARQUEO_KEY = (sesionId) => ['arqueo_caja', sesionId];

export function useArqueoCaja() {
  const { currentSession } = useCaja();
  const { user } = useAuth();

  const { data: totals = EMPTY, isLoading, refetch } = useQuery({
    queryKey: ARQUEO_KEY(currentSession?.id),
    queryFn: async () => {
      // Filtrar por caja_sesion_id + empresa_id (no user_id — los movimientos se insertan con user.id)
      const { data: movements, error } = await supabase
        .from('movimientos_caja')
        .select('monto, tipo, metodo_pago')
        .eq('caja_sesion_id', currentSession.id)
        .eq('empresa_id', user.empresa_id);

      if (error) throw new Error(error.message);

      let ingresosEf = 0;
      let egresosEf = 0;
      let otros = 0;

      (movements ?? []).forEach((m) => {
        const monto = Number(m.monto);
        const isEfectivo = !m.metodo_pago || m.metodo_pago.toLowerCase() === 'efectivo';

        if (m.tipo === 'ingreso') {
          if (isEfectivo) ingresosEf += monto;
          else otros += monto;
        } else if (m.tipo === 'egreso') {
          // Los egresos no-efectivo no se restan del efectivo en el cajón
          if (isEfectivo) egresosEf += monto;
        }
      });

      const inicial = Number(currentSession.monto_inicial || 0);

      return {
        inicial,
        ingresosEfectivo: ingresosEf,
        egresosEfectivo: egresosEf,
        otrosIngresos: otros,
        esperado: inicial + ingresosEf - egresosEf,
      };
    },
    enabled: !!currentSession?.id && !!user?.empresa_id,
    // El staleTime global (2 min) no sirve acá: cada venta cambia el esperado y
    // un arqueo viejo grabaría una diferencia falsa. Siempre revalidar.
    staleTime: 0,
  });

  return { totals, loading: isLoading, refetch };
}
