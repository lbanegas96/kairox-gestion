import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR } from '@/lib/dateUtils';
import type { Comprobante, PaginatedResult } from '@/types';

interface HistorialFilters {
  fechaDesde?: string;
  fechaHasta?: string;
  clienteId?: string | null;
  page?: number;
  pageSize?: number;
}

export const ventasService = {
  async getHistorial(
    empresaId: string,
    { fechaDesde, fechaHasta, clienteId, page = 1, pageSize = 30 }: HistorialFilters = {}
  ): Promise<PaginatedResult<Comprobante>> {
    let query = supabase
      .from('comprobantes')
      .select('*, clientes(nombre)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });

    if (fechaDesde) query = query.gte('created_at', getStartOfDayAR(new Date(fechaDesde)));
    if (fechaHasta) query = query.lte('created_at', getEndOfDayAR(new Date(fechaHasta)));
    if (clienteId) query = query.eq('cliente_id', clienteId);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: (data ?? []) as Comprobante[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id: string): Promise<Comprobante> {
    const { data, error } = await supabase
      .from('comprobantes')
      .select('*, comprobante_items(*, productos(nombre, unidad_medida)), clientes(nombre, documento, telefono)')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as Comprobante;
  },

  async getMetricsToday(empresaId: string): Promise<{ totalHoy: number; cantidadHoy: number }> {
    const now = new Date();
    const start = getStartOfDayAR(now);
    const end = getEndOfDayAR(now);

    const { data, error } = await supabase
      .from('comprobantes')
      .select('total, created_at')
      .eq('empresa_id', empresaId)
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw new Error(error.message);
    const totalHoy = (data ?? []).reduce((s: number, v: { total: number }) => s + Number(v.total), 0);
    return { totalHoy, cantidadHoy: (data ?? []).length };
  },

  async getTopProductos(empresaId: string, limit = 5): Promise<{ nombre: string; total: number }[]> {
    const { data, error } = await supabase
      .from('comprobante_items')
      .select('producto_id, cantidad, productos(nombre)')
      .eq('empresa_id', empresaId)
      .order('cantidad', { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    const map: Record<string, { nombre: string; total: number }> = {};
    for (const item of data ?? []) {
      if (!map[item.producto_id]) {
        map[item.producto_id] = {
          nombre: (item.productos as { nombre: string } | null)?.nombre ?? 'Desconocido',
          total: 0,
        };
      }
      map[item.producto_id].total += Number(item.cantidad);
    }
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, limit);
  },
};

export const VENTAS_KEYS = {
  historial: (empresaId: string, filters?: HistorialFilters) =>
    ['ventas', 'historial', empresaId, filters] as const,
  detail: (id: string) => ['ventas', id] as const,
  metricsToday: (empresaId: string) => ['ventas', 'metricsToday', empresaId] as const,
  topProductos: (empresaId: string) => ['ventas', 'topProductos', empresaId] as const,
};
