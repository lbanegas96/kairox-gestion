import { supabase } from '@/lib/customSupabaseClient';
import type { Cliente, CuentaCorrienteMovimiento, PaginatedResult } from '@/types';

interface GetAllFilters {
  search?: string;
  conDeuda?: boolean | null;
  page?: number;
  pageSize?: number;
}

interface GetMovimientosFilters {
  page?: number;
  pageSize?: number;
}

export const clientesService = {
  async getAll(
    empresaId: string,
    { search = '', conDeuda = null, page = 1, pageSize = 50 }: GetAllFilters = {}
  ): Promise<PaginatedResult<Cliente>> {
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
    if (error) throw new Error(error.message);
    return { data: (data ?? []) as Cliente[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id: string): Promise<Cliente> {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as Cliente;
  },

  async getMovimientos(
    clienteId: string,
    { page = 1, pageSize = 30 }: GetMovimientosFilters = {}
  ): Promise<PaginatedResult<CuentaCorrienteMovimiento>> {
    const from = (page - 1) * pageSize;
    const { data, error, count } = await supabase
      .from('cuenta_corriente_movimientos')
      .select('*', { count: 'exact' })
      .eq('cliente_id', clienteId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return { data: (data ?? []) as CuentaCorrienteMovimiento[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async create(empresaId: string, payload: Partial<Cliente>): Promise<Cliente> {
    const { data, error } = await supabase
      .from('clientes')
      .insert([{ ...payload, user_id: empresaId, empresa_id: empresaId }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Cliente;
  },

  async update(id: string, payload: Partial<Cliente>): Promise<Cliente> {
    const { data, error } = await supabase
      .from('clientes')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Cliente;
  },

  async getTotalDeuda(empresaId: string): Promise<number> {
    const { data, error } = await supabase
      .from('clientes')
      .select('saldo_actual')
      .eq('user_id', empresaId)
      .gt('saldo_actual', 0);
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((s: number, c: { saldo_actual: number }) => s + Number(c.saldo_actual), 0);
  },
};

export const CLIENTES_KEYS = {
  list: (empresaId: string, filters?: GetAllFilters) => ['clientes', empresaId, filters] as const,
  detail: (id: string) => ['cliente', id] as const,
  movimientos: (clienteId: string, filters?: GetMovimientosFilters) =>
    ['clientes', 'movimientos', clienteId, filters] as const,
  totalDeuda: (empresaId: string) => ['clientes', 'totalDeuda', empresaId] as const,
};
