import { supabase } from '@/lib/customSupabaseClient';

/**
 * Obtiene la tasa de cambio del día para una moneda dada.
 * Devuelve null si no hay ninguna registrada para hoy.
 */
export async function getTodayTC(empresaId, moneda = 'USD') {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const { data, error } = await supabase
    .from('tipos_cambio')
    .select('tasa')
    .eq('empresa_id', empresaId)
    .eq('moneda', moneda)
    .eq('fecha', today)
    .single();
  // PGRST116 = "no rows returned" — esperado cuando no hay TC cargado
  if (error && error.code !== 'PGRST116') throw error;
  return data?.tasa ?? null;
}

/**
 * Guarda (o actualiza) el tipo de cambio del día.
 * Usa upsert con UNIQUE(empresa_id, moneda, fecha) para evitar duplicados.
 */
export async function upsertTC(empresaId, userId, moneda, tasa) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  const { data, error } = await supabase
    .from('tipos_cambio')
    .upsert(
      {
        empresa_id: empresaId,
        user_id: userId,
        moneda,
        fecha: today,
        tasa: Number(tasa),
        updated_at: new Date().toISOString(),
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
