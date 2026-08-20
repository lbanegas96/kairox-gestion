import { supabase } from '@/lib/customSupabaseClient';

export interface RecuentoInventarioItem {
  id: string;
  recuento_id: string;
  producto_id: string;
  stock_sistema: number;
  costo_unitario: number;
  cantidad_contada: number | null;
  productos?: { nombre: string; codigo_sku: string; unidad_medida: string };
}

export interface RecuentoInventario {
  id: string;
  empresa_id: string;
  numero: string;
  fecha: string;
  estado: 'borrador' | 'confirmado' | 'anulado';
  categoria_id: string | null;
  observaciones: string | null;
  asiento_id: string | null;
  categorias?: { nombre: string } | null;
}

export const recuentoInventarioService = {
  async getAll(empresaId: string): Promise<RecuentoInventario[]> {
    const { data, error } = await supabase
      .from('recuentos_inventario')
      .select('*, categorias(nombre)')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RecuentoInventario[];
  },

  async getById(id: string): Promise<{ header: RecuentoInventario; items: RecuentoInventarioItem[] }> {
    const [{ data: header, error: e1 }, { data: items, error: e2 }] = await Promise.all([
      supabase.from('recuentos_inventario').select('*, categorias(nombre)').eq('id', id).single(),
      supabase
        .from('recuento_inventario_items')
        .select('*, productos(nombre, codigo_sku, unidad_medida)')
        .eq('recuento_id', id)
        .order('id'),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    return { header: header as RecuentoInventario, items: (items ?? []) as RecuentoInventarioItem[] };
  },

  async crear(categoriaId: string | null): Promise<string> {
    const { data, error } = await supabase.rpc('crear_recuento_inventario', { p_categoria_id: categoriaId });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async guardarConteo(itemId: string, cantidadContada: number | null): Promise<void> {
    const { error } = await supabase
      .from('recuento_inventario_items')
      .update({ cantidad_contada: cantidadContada })
      .eq('id', itemId);
    if (error) throw new Error(error.message);
  },

  async confirmar(id: string): Promise<{ total_faltante: number; total_sobrante: number }> {
    const { data, error } = await supabase.rpc('confirmar_recuento_inventario', { p_recuento_id: id });
    if (error) throw new Error(error.message);
    return data as { total_faltante: number; total_sobrante: number };
  },

  async anular(id: string): Promise<void> {
    const { error } = await supabase.rpc('anular_recuento_inventario', { p_recuento_id: id });
    if (error) throw new Error(error.message);
  },

  async setAsiento(id: string, asientoId: string): Promise<void> {
    const { error } = await supabase.rpc('set_asiento_recuento_inventario', {
      p_recuento_id: id, p_asiento_id: asientoId,
    });
    if (error) throw new Error(error.message);
  },
};

export const RECUENTO_INVENTARIO_KEYS = {
  list: (empresaId: string) => ['recuentos_inventario', empresaId] as const,
  detail: (id: string) => ['recuentos_inventario', 'detail', id] as const,
};
