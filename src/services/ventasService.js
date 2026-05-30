import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR } from '@/lib/dateUtils';

export const ventasService = {
  async getHistorial(empresaId, { fechaDesde, fechaHasta, clienteId, page = 1, pageSize = 30 } = {}) {
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
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('comprobantes')
      .select('*, comprobante_items(*, productos(nombre, unidad_medida)), clientes(nombre, documento, telefono)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getMetricsToday(empresaId) {
    const now = new Date();
    const start = getStartOfDayAR(now);
    const end = getEndOfDayAR(now);

    const { data, error } = await supabase
      .from('comprobantes')
      .select('total, created_at')
      .eq('empresa_id', empresaId)
      .gte('created_at', start)
      .lte('created_at', end);

    if (error) throw error;
    const totalHoy = (data ?? []).reduce((s, v) => s + Number(v.total), 0);
    return { totalHoy, cantidadHoy: (data ?? []).length };
  },

  async getTopProductos(empresaId, limit = 5) {
    const { data, error } = await supabase
      .from('comprobante_items')
      .select('producto_id, cantidad, productos(nombre)')
      .eq('empresa_id', empresaId)
      .order('cantidad', { ascending: false })
      .limit(50);

    if (error) throw error;

    const map = {};
    for (const item of data ?? []) {
      if (!map[item.producto_id]) {
        map[item.producto_id] = { nombre: item.productos?.nombre ?? 'Desconocido', total: 0 };
      }
      map[item.producto_id].total += Number(item.cantidad);
    }
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, limit);
  },
};

export const VENTAS_KEYS = {
  historial: (empresaId, filters) => ['ventas', 'historial', empresaId, filters],
  venta: (id) => ['ventas', id],
  metricsToday: (empresaId) => ['ventas', 'metricsToday', empresaId],
  topProductos: (empresaId) => ['ventas', 'topProductos', empresaId],
};
