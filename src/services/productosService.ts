import { supabase } from '@/lib/customSupabaseClient';
import type { Producto, PaginatedResult } from '@/types';

interface GetAllFilters {
  search?: string;
  categoriaId?: string | null;
  page?: number;
  pageSize?: number;
}

interface AdjustStockOptions {
  id: string;
  cantidad: number;
  tipo: 'entrada' | 'salida' | 'ajuste';
  motivo: string;
  empresaId: string;
}

export const productosService = {
  async getAll(
    empresaId: string,
    { search = '', categoriaId = null, page = 1, pageSize = 50 }: GetAllFilters = {}
  ): Promise<PaginatedResult<Producto>> {
    let query = supabase
      .from('productos')
      .select('*, categorias(nombre), proveedores(nombre)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .eq('activo', true)
      .order('nombre');

    if (search) query = query.ilike('nombre', `%${search}%`);
    if (categoriaId) query = query.eq('categoria_id', categoriaId);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: (data ?? []) as Producto[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id: string): Promise<Producto> {
    const { data, error } = await supabase
      .from('productos')
      .select('*, categorias(nombre), proveedores(nombre)')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as Producto;
  },

  async getLowStock(empresaId: string): Promise<Producto[]> {
    const { data, error } = await supabase
      .from('productos')
      .select('id, nombre, stock_actual, stock_minimo, unidad_medida')
      .eq('empresa_id', empresaId)
      .eq('activo', true);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Producto[]).filter(
      (p) => (p.stock_actual ?? 0) <= (p.stock_minimo ?? 0)
    );
  },

  async create(empresaId: string, payload: Partial<Producto>): Promise<Producto> {
    const { data, error } = await supabase
      .from('productos')
      .insert([{ ...payload, user_id: empresaId, activo: true }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Producto;
  },

  async update(id: string, payload: Partial<Producto>): Promise<Producto> {
    const { data, error } = await supabase
      .from('productos')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Producto;
  },

  async softDelete(id: string): Promise<void> {
    const { error } = await supabase
      .from('productos')
      .update({ activo: false })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async adjustStock({ id, cantidad, tipo, motivo, empresaId }: AdjustStockOptions): Promise<void> {
    const { data: prod, error: pe } = await supabase
      .from('productos')
      .select('stock_actual')
      .eq('id', id)
      .single();
    if (pe) throw new Error(pe.message);

    const delta = tipo === 'entrada' ? cantidad : tipo === 'salida' ? -cantidad : cantidad;
    const newStock = ((prod as Producto).stock_actual ?? 0) + delta;

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
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
  },
};

export const PRODUCTOS_KEYS = {
  list: (empresaId: string, filters?: GetAllFilters) => ['productos', empresaId, filters] as const,
  detail: (id: string) => ['producto', id] as const,
  lowStock: (empresaId: string) => ['productos', 'lowStock', empresaId] as const,
};
