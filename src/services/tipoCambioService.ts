import { supabase } from '@/lib/supabase';

export const TC_KEYS = {
  all:     (empresaId: string) => ['tipos_cambio', empresaId] as const,
  current: (empresaId: string, moneda: string) => ['tipos_cambio', empresaId, moneda, 'current'] as const,
};

export interface TipoCambio {
  id: string;
  empresa_id: string;
  moneda: string;
  tasa: number;
  fecha: string;
  created_at: string;
}

/** Obtiene la tasa vigente más reciente para una moneda */
export async function getTasaVigente(empresaId: string, moneda: string, fecha?: string): Promise<number> {
  if (moneda === 'ARS') return 1;
  const targetDate = fecha ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('tipos_cambio')
    .select('tasa')
    .eq('empresa_id', empresaId)
    .eq('moneda', moneda)
    .lte('fecha', targetDate)
    .order('fecha', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return 1;
  return data.tasa;
}

/** Lista el historial de tipos de cambio */
export async function getHistorial(empresaId: string, moneda?: string): Promise<TipoCambio[]> {
  let q = supabase
    .from('tipos_cambio')
    .select('*')
    .eq('empresa_id', empresaId)
    .order('fecha', { ascending: false })
    .limit(100);
  if (moneda) q = q.eq('moneda', moneda);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/** Upsert: inserta o actualiza la tasa para empresa+moneda+fecha */
export async function upsertTasa(
  empresaId: string,
  moneda: string,
  tasa: number,
  fecha: string
): Promise<TipoCambio> {
  const { data, error } = await supabase
    .from('tipos_cambio')
    .upsert(
      { empresa_id: empresaId, moneda, tasa, fecha },
      { onConflict: 'empresa_id,moneda,fecha' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTasa(id: string): Promise<void> {
  const { error } = await supabase.from('tipos_cambio').delete().eq('id', id);
  if (error) throw error;
}
