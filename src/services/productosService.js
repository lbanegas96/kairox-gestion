import { supabase } from '@/lib/customSupabaseClient';

export const productosService = {
  async getAll(empresaId, { search = '', categoriaId = null, page = 1, pageSize = 50 } = {}) {
    let query = supabase
      .from('productos')
      .select('*, categorias(nombre), proveedores(nombre)', { count: 'exact' })
      .eq('user_id', empresaId)
      .eq('activo', true)
      .order('nombre');

    if (search) query = query.ilike('nombre', `%${search}%`);
    if (categoriaId) query = query.eq('categoria_id', categoriaId);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('productos')
      .select('*, categorias(nombre), proveedores(nombre)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getLowStock(empresaId) {
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, stock_actual, stock_minimo, unidad_medida')
      .eq('user_id', empresaId)
      .eq('activo', true)
      .filter('stock_actual', 'lte', supabase.rpc('get_stock_minimo'));

    // Fallback: manual filter
    const { data: all, error: e2 } = await supabase
      .from('productos')
      .select('id, nombre, stock_actual, stock_minimo, unidad_medida')
      .eq('user_id', empresaId)
      .eq('activo', true);
    if (e2) throw e2;
    return (all ?? []).filter(p => (p.stock_actual ?? 0) <= (p.stock_minimo ?? 0));
  },

  async create(empresaId, payload) {
    const { data, error } = await supabase
      .from('productos')
      .insert([{ ...payload, user_id: empresaId, activo: true }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, payload) {
    const { data, error } = await supabase
      .from('productos')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async softDelete(id) {
    const { error } = await supabase
      .from('productos')
      .update({ activo: false })
      .eq('id', id);
    if (error) throw error;
  },

  async adjustStock(id, cantidad, tipo, motivo, empresaId) {
    const { data: prod, error: pe } = await supabase
      .from('productos')
      .select('stock_actual')
      .eq('id', id)
      .single();
    if (pe) throw pe;

    const delta = tipo === 'entrada' ? cantidad : tipo === 'salida' ? -cantidad : cantidad;
    const newStock = (prod.stock_actual ?? 0) + delta;

    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      supabase.from('productos').update({ stock_actual: newStock }).eq('id', id),
      supabase.from('movimientos_inventario').insert([{
        producto_id: id,
        user_id: empresaId,
        tipo,
        cantidad: Math.abs(cantidad),
        motivo,
      }]),
    ]);
    if (e1) throw e1;
    if (e2) throw e2;
  },
};

export const QUERY_KEYS = {
  productos: (empresaId, filters) => ['productos', empresaId, filters],
  producto: (id) => ['producto', id],
  productosLowStock: (empresaId) => ['productos', 'lowStock', empresaId],
};
