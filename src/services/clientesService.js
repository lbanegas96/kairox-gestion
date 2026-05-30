import { supabase } from '@/lib/customSupabaseClient';

export const clientesService = {
  async getAll(empresaId, { search = '', conDeuda = null, page = 1, pageSize = 50 } = {}) {
    let query = supabase
      .from('clientes')
      .select('*', { count: 'exact' })
      .eq('user_id', empresaId)
      .order('nombre');

    if (search) query = query.ilike('nombre', `%${search}%`);
    if (conDeuda === true) query = query.gt('saldo_actual', 0);
    if (conDeuda === false) query = query.lte('saldo_actual', 0);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async getMovimientos(clienteId, { page = 1, pageSize = 30 } = {}) {
    const from = (page - 1) * pageSize;
    const { data, error, count } = await supabase
      .from('cuenta_corriente_movimientos')
      .select('*', { count: 'exact' })
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0 };
  },

  async create(empresaId, payload) {
    const { data, error } = await supabase
      .from('clientes')
      .insert([{ ...payload, user_id: empresaId, empresa_id: empresaId }])
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, payload) {
    const { data, error } = await supabase
      .from('clientes')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getTotalDeuda(empresaId) {
    const { data, error } = await supabase
      .from('clientes')
      .select('saldo_actual')
      .eq('user_id', empresaId)
      .gt('saldo_actual', 0);
    if (error) throw error;
    return (data ?? []).reduce((s, c) => s + Number(c.saldo_actual), 0);
  },
};

export const CLIENTES_KEYS = {
  list: (empresaId, filters) => ['clientes', empresaId, filters],
  cliente: (id) => ['cliente', id],
  movimientos: (clienteId, filters) => ['clientes', 'movimientos', clienteId, filters],
  totalDeuda: (empresaId) => ['clientes', 'totalDeuda', empresaId],
};
