import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR, getNowAR } from '@/lib/dateUtils';

export const cajaService = {
  async getMovimientos(empresaId, { sesionId, fechaDesde, fechaHasta, tipo, search, page = 1, pageSize = 50 } = {}) {
    let query = supabase
      .from('movimientos_caja')
      .select('*', { count: 'exact' })
      .eq('user_id', empresaId)
      .order('fecha', { ascending: false });

    if (sesionId) query = query.eq('caja_sesion_id', sesionId);
    if (fechaDesde) query = query.gte('fecha', getStartOfDayAR(new Date(fechaDesde)));
    if (fechaHasta) query = query.lte('fecha', getEndOfDayAR(new Date(fechaHasta)));
    if (tipo && tipo !== 'Todos') query = query.eq('tipo', tipo.toLowerCase());
    if (search) query = query.ilike('concepto', `%${search}%`);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0 };
  },

  async getResumenPeriodo(empresaId, { start, end }) {
    const { data, error } = await supabase
      .from('movimientos_caja')
      .select('tipo, monto, categoria')
      .eq('user_id', empresaId)
      .gte('fecha', start)
      .lte('fecha', end);
    if (error) throw error;

    const movimientos = data ?? [];
    const ingresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.monto), 0);
    const egresos = movimientos.filter(m => m.tipo === 'egreso').reduce((s, m) => s + Number(m.monto), 0);

    const byCategoria = movimientos.reduce((acc, m) => {
      if (!acc[m.categoria]) acc[m.categoria] = { ingreso: 0, egreso: 0 };
      acc[m.categoria][m.tipo] += Number(m.monto);
      return acc;
    }, {});

    return { ingresos, egresos, balance: ingresos - egresos, byCategoria };
  },

  async insertMovimiento(empresaId, payload) {
    const { data, error } = await supabase
      .from('movimientos_caja')
      .insert([{ ...payload, user_id: empresaId }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteMovimiento(id, empresaId) {
    const { error } = await supabase
      .from('movimientos_caja')
      .delete()
      .eq('id', id)
      .eq('user_id', empresaId);
    if (error) throw error;
  },

  async getSesiones(empresaId, { page = 1, pageSize = 20 } = {}) {
    const from = (page - 1) * pageSize;
    const { data, error, count } = await supabase
      .from('caja_sesiones')
      .select('*', { count: 'exact' })
      .eq('user_id', empresaId)
      .order('apertura_fecha', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0 };
  },
};

export const CAJA_KEYS = {
  movimientos: (empresaId, filters) => ['caja', 'movimientos', empresaId, filters],
  resumen: (empresaId, periodo) => ['caja', 'resumen', empresaId, periodo],
  sesiones: (empresaId) => ['caja', 'sesiones', empresaId],
};
