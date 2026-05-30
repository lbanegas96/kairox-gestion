import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR } from '@/lib/dateUtils';

export const comprasService = {
  async getAll(empresaId, { fechaDesde, fechaHasta, proveedorId, estado, page = 1, pageSize = 30 } = {}) {
    let query = supabase
      .from('compras')
      .select('*, proveedores(nombre)', { count: 'exact' })
      .eq('user_id', empresaId)
      .order('fecha', { ascending: false });

    if (fechaDesde) query = query.gte('fecha', getStartOfDayAR(new Date(fechaDesde)));
    if (fechaHasta) query = query.lte('fecha', getEndOfDayAR(new Date(fechaHasta)));
    if (proveedorId) query = query.eq('proveedor_id', proveedorId);
    if (estado) query = query.eq('estado_pago', estado);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('compras')
      .select('*, proveedores(nombre), detalle_compras(*, productos(nombre, unidad_medida))')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(empresaId, { compra, items, currentSessionId }) {
    const { data: newCompra, error: compraError } = await supabase
      .from('compras')
      .insert([{ ...compra, user_id: empresaId, empresa_id: empresaId }])
      .select()
      .single();
    if (compraError) throw compraError;

    const detalles = items.map(item => ({
      compra_id: newCompra.id,
      empresa_id: empresaId,
      producto_id: item.producto_id,
      cantidad: parseInt(item.cantidad),
      costo_unitario: parseFloat(item.costo_unitario),
      subtotal: parseInt(item.cantidad) * parseFloat(item.costo_unitario),
    }));

    const { error: detError } = await supabase.from('detalle_compras').insert(detalles);
    if (detError) throw detError;

    return newCompra;
  },

  async updateEstadoPago(id, estado) {
    const { data, error } = await supabase
      .from('compras')
      .update({ estado_pago: estado })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export const COMPRAS_KEYS = {
  list: (empresaId, filters) => ['compras', empresaId, filters],
  compra: (id) => ['compra', id],
};
