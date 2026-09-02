import { supabase } from '@/lib/customSupabaseClient';

// Ajuste por Inflación (RT 6, mig.378) — Fase 1. Diseño completo en
// PLAN_AJUSTE_POR_INFLACION.md. Construido sin contador matriculado
// disponible (Nalux no tiene uno) -- ver el artifact "Circuito de Ajuste por
// Inflación" para las 4 decisiones donde la norma deja margen y su fundamento.

export interface IndiceInflacion {
  id: string;
  empresa_id: string;
  periodo: string;   // primer día del mes, ej. '2026-01-01'
  indice: number;
  origen: string;
  created_at: string;
}

export interface LineaAjusteInflacion {
  cuenta_id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  monto_ajuste: number;
}

export interface PreviewAjusteInflacion {
  lineas: LineaAjusteInflacion[];
  recpam_ganancia: number;
  recpam_perdida: number;
  recpam_neto: number;
}

export const indicesInflacionService = {
  async getIndices(empresaId: string): Promise<IndiceInflacion[]> {
    const { data, error } = await supabase
      .from('indices_inflacion')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('periodo', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as IndiceInflacion[];
  },

  /** Alta o corrección de un mes -- mismo mes se pisa (UNIQUE empresa_id+periodo). */
  async upsertIndice(empresaId: string, periodo: string, indice: number): Promise<void> {
    const { error } = await supabase
      .from('indices_inflacion')
      .upsert({ empresa_id: empresaId, periodo, indice, origen: 'manual' }, { onConflict: 'empresa_id,periodo' });
    if (error) throw new Error(error.message);
  },

  async eliminarIndice(id: string): Promise<void> {
    const { error } = await supabase.from('indices_inflacion').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export interface ReexpresionMonedaHomogenea {
  montos: { cuenta_id: string; monto_homogeneo: number }[];
  meses_sin_indice: string[];
  indice_hasta_faltante: boolean;
}

export const ajusteInflacionService = {
  /** Fase 2 — reexpresión de solo lectura para Balance General/Estado de Resultados, sin generar asiento. */
  async calcularReexpresion(empresaId: string, fechaDesde: string | null, fechaHasta: string): Promise<ReexpresionMonedaHomogenea> {
    const { data, error } = await supabase.rpc('calcular_reexpresion_moneda_homogenea', {
      p_empresa_id: empresaId,
      p_fecha_desde: fechaDesde,
      p_fecha_hasta: fechaHasta,
    });
    if (error) throw new Error(error.message);
    return data as ReexpresionMonedaHomogenea;
  },

  async calcularPreview(periodoId: string): Promise<PreviewAjusteInflacion> {
    const { data, error } = await supabase.rpc('calcular_preview_ajuste_por_inflacion', {
      p_periodo_id: periodoId,
    });
    if (error) throw new Error(error.message);
    return data as PreviewAjusteInflacion;
  },

  async generar(periodoId: string, userId: string): Promise<{ ok: boolean; asiento_id: string | null; numero?: string; mensaje?: string }> {
    const { data, error } = await supabase.rpc('generar_ajuste_por_inflacion', {
      p_periodo_id: periodoId,
      p_user_id: userId,
    });
    if (error) throw new Error(error.message);
    return data as { ok: boolean; asiento_id: string | null; numero?: string; mensaje?: string };
  },
};
