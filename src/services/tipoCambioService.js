import { supabase } from '@/lib/customSupabaseClient';
import { getTodayAR } from '@/lib/dateUtils';

/**
 * Obtiene la tasa de cambio del día para una moneda dada.
 * Devuelve null si no hay ninguna registrada para hoy.
 */
export async function getTodayTC(empresaId, moneda = 'USD') {
  const today = getTodayAR(); // YYYY-MM-DD, zona horaria Argentina
  // .maybeSingle() devuelve null sin error cuando no hay rows — evita el ruido
  // en consola (PGRST116 / 406 Not Acceptable) cuando no hay TC cargado todavía.
  const { data, error } = await supabase
    .from('tipos_cambio')
    .select('tasa')
    .eq('empresa_id', empresaId)
    .eq('moneda', moneda)
    .eq('fecha', today)
    .maybeSingle();
  if (error) throw error;
  return data?.tasa ?? null;
}

/**
 * Guarda (o actualiza) el tipo de cambio del día.
 * Usa upsert con UNIQUE(empresa_id, moneda, fecha) para evitar duplicados.
 */
export async function upsertTC(empresaId, _userId, moneda, tasa) {
  const today = getTodayAR(); // YYYY-MM-DD, zona horaria Argentina
  const { data, error } = await supabase
    .from('tipos_cambio')
    .upsert(
      {
        empresa_id: empresaId,
        moneda,
        fecha: today,
        tasa: Number(tasa),
      },
      { onConflict: 'empresa_id,moneda,fecha' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export const tipoCambioService = {
  getToday: getTodayTC,
  upsert: upsertTC,
};
