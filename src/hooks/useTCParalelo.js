import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { tipoCambioService } from '@/services/tipoCambioService';

/**
 * Hook para el sistema de Moneda Paralela.
 *
 * Cuando `enabled = true`:
 *  - Todas las transacciones deben registrar su equivalente en `monedaParalela` (ej. USD).
 *  - Si el TC del día no está cargado, bloquea la operación.
 *
 * Returns:
 *  - enabled       — bool: la empresa tiene moneda paralela activada
 *  - monedaParalela— string: 'USD' | 'EUR' | ...
 *  - tcHoy         — number | null: tasa del día para monedaParalela
 *  - tcMissing     — bool: enabled && tcHoy === null (bloquea operaciones)
 *  - loading       — bool: cargando settings iniciales
 *  - calcParalelo  — fn(monto, monedaOp, tasaOp) → monto en moneda paralela | null
 *  - setTC         — fn(tasa) → actualiza tcHoy localmente (llamar después de TipoCambioModal)
 */
export function useTCParalelo() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [monedaParalela, setMonedaParalela] = useState('USD');
  const [tcHoy, setTcHoy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [settingsReady, setSettingsReady] = useState(false);

  useEffect(() => {
    if (!user?.empresa_id) return;

    const init = async () => {
      setLoading(true);
      try {
        // maybeSingle() en vez de single() — si la fila no existe (caso raro),
        // devuelve null sin tirar error 406/PGRST116 ruidoso en consola.
        const { data } = await supabase
          .from('empresas')
          .select('usa_tc_paralelo, moneda_paralela')
          .eq('id', user.empresa_id)
          .maybeSingle();

        const isEnabled  = data?.usa_tc_paralelo  ?? false;
        const moneda     = data?.moneda_paralela   ?? 'USD';

        setEnabled(isEnabled);
        setMonedaParalela(moneda);

        if (isEnabled) {
          const rate = await tipoCambioService.getToday(user.empresa_id, moneda);
          setTcHoy(rate);
        }
      } catch (err) {
        console.error('[TCParalelo] Error al obtener configuración:', err);
      } finally {
        setLoading(false);
        setSettingsReady(true);
      }
    };

    init();
  }, [user?.empresa_id]);

  // true cuando parallel está ON pero aún no hay TC del día
  const tcMissing = enabled && settingsReady && !loading && tcHoy === null;

  /**
   * Calcula el equivalente en moneda paralela.
   * @param {number} monto    — monto de la operación
   * @param {string} monedaOp — moneda en que está expresado el monto ('ARS', 'USD', ...)
   * @param {number} tasaOp   — tasa de la operación (1 si ARS, TCdía si monedaOp es extranjera)
   * @returns {number|null}
   */
  const calcParalelo = useCallback((monto, monedaOp = 'ARS', tasaOp = 1) => {
    if (!enabled) return null;

    // Si la operación ya está en la moneda paralela → el valor es directo
    if (monedaOp === monedaParalela) return Number(monto);

    // Sin TC del día no se puede convertir nada. Nunca se inventa una tasa.
    if (!tcHoy) return null;

    // Llevar el monto a ARS primero. Si la operación es en una tercera moneda
    // (ej. EUR con paralela USD), se usa la tasa de esa operación; sin tasa
    // válida no hay conversión posible y se devuelve null en vez de un número
    // incorrecto.
    let inARS;
    if (monedaOp === 'ARS') {
      inARS = Number(monto);
    } else {
      const tasa = Number(tasaOp);
      if (!Number.isFinite(tasa) || tasa <= 0) return null;
      inARS = Number(monto) * tasa;
    }

    // Redondeo a 2 decimales en JS para limitar el error binario de IEEE 754
    // antes de persistir (la columna en DB es numeric(14,4) desde migration 076).
    return Math.round((inARS / tcHoy) * 100) / 100;
  }, [enabled, tcHoy, monedaParalela]);

  return {
    enabled,
    monedaParalela,
    tcHoy,
    tcMissing,
    loading,
    calcParalelo,
    setTC: setTcHoy,
  };
}
