import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR } from '@/lib/dateUtils';
import type { MovimientoCaja, CajaSesion, PaginatedResult } from '@/types';

interface GetMovimientosFilters {
  sesionId?: string | null;
  fechaDesde?: string;
  fechaHasta?: string;
  tipo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

interface ResumenPeriodo {
  ingresos: number;
  egresos: number;
  balance: number;
  byCategoria: Record<string, { ingreso: number; egreso: number }>;
}

export const cajaService = {
  async getMovimientos(
    empresaId: string,
    { sesionId, fechaDesde, fechaHasta, tipo, search, page = 1, pageSize = 50 }: GetMovimientosFilters = {}
  ): Promise<PaginatedResult<MovimientoCaja>> {
    let query = supabase
      .from('movimientos_caja')
      .select('*', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('fecha', { ascending: false });

    if (sesionId) query = query.eq('caja_sesion_id', sesionId);
    if (fechaDesde) query = query.gte('fecha', getStartOfDayAR(new Date(fechaDesde)));
    if (fechaHasta) query = query.lte('fecha', getEndOfDayAR(new Date(fechaHasta)));
    if (tipo && tipo !== 'Todos') query = query.eq('tipo', tipo.toLowerCase());
    if (search) query = query.ilike('concepto', `%${search}%`);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: (data ?? []) as MovimientoCaja[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getResumenPeriodo(
    empresaId: string,
    { start, end }: { start: string; end: string }
  ): Promise<ResumenPeriodo> {
    const { data, error } = await supabase
      .from('movimientos_caja')
      .select('tipo, monto, categoria')
      .eq('empresa_id', empresaId)
      .gte('fecha', start)
      .lte('fecha', end);
    if (error) throw new Error(error.message);

    const movimientos = (data ?? []) as Pick<MovimientoCaja, 'tipo' | 'monto' | 'categoria'>[];
    const ingresos = movimientos.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
    const egresos = movimientos.filter((m) => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0);

    const byCategoria: Record<string, { ingreso: number; egreso: number }> = {};
    for (const m of movimientos) {
      if (!byCategoria[m.categoria]) byCategoria[m.categoria] = { ingreso: 0, egreso: 0 };
      byCategoria[m.categoria][m.tipo] += Number(m.monto);
    }

    return { ingresos, egresos, balance: ingresos - egresos, byCategoria };
  },

  async insertMovimiento(
    empresaId: string,
    payload: Partial<MovimientoCaja>
  ): Promise<MovimientoCaja> {
    const { data, error } = await supabase
      .from('movimientos_caja')
      .insert([{ ...payload, user_id: empresaId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as MovimientoCaja;
  },

  async deleteMovimiento(id: string, empresaId: string): Promise<void> {
    const { error } = await supabase
      .from('movimientos_caja')
      .delete()
      .eq('id', id)
      .eq('empresa_id', empresaId);
    if (error) throw new Error(error.message);
  },

  async getSesiones(
    empresaId: string,
    { page = 1, pageSize = 20 }: { page?: number; pageSize?: number } = {}
  ): Promise<PaginatedResult<CajaSesion>> {
    const from = (page - 1) * pageSize;
    const { data, error, count } = await supabase
      .from('caja_sesiones')
      .select('*', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('apertura_fecha', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return { data: (data ?? []) as CajaSesion[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },
};

export const CAJA_KEYS = {
  movimientos: (empresaId: string, filters?: GetMovimientosFilters) =>
    ['caja', 'movimientos', empresaId, filters] as const,
  resumen: (empresaId: string, periodo: { start: string; end: string }) =>
    ['caja', 'resumen', empresaId, periodo] as const,
  sesiones: (empresaId: string) => ['caja', 'sesiones', empresaId] as const,
};
