import { supabase } from '@/lib/customSupabaseClient';

export interface RevalorizacionInventarioItem {
  id: string;
  revalorizacion_id: string;
  producto_id: string;
  stock_al_momento: number;
  costo_anterior: number;
  costo_nuevo: number | null;
  productos?: { nombre: string; codigo_sku: string; unidad_medida: string };
}

export interface RevalorizacionInventario {
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

export const revalorizacionInventarioService = {
  async getAll(empresaId: string): Promise<RevalorizacionInventario[]> {
    const { data, error } = await supabase
      .from('revalorizaciones_inventario')
      .select('*, categorias(nombre)')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as RevalorizacionInventario[];
  },

  async getById(id: string): Promise<{ header: RevalorizacionInventario; items: RevalorizacionInventarioItem[] }> {
    const [{ data: header, error: e1 }, { data: items, error: e2 }] = await Promise.all([
      supabase.from('revalorizaciones_inventario').select('*, categorias(nombre)').eq('id', id).single(),
      supabase
        .from('revalorizacion_inventario_items')
        .select('*, productos(nombre, codigo_sku, unidad_medida)')
        .eq('revalorizacion_id', id)
        .order('id'),
    ]);
    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    return { header: header as RevalorizacionInventario, items: (items ?? []) as RevalorizacionInventarioItem[] };
  },

  async crear(categoriaId: string | null): Promise<string> {
    const { data, error } = await supabase.rpc('crear_revalorizacion_inventario', { p_categoria_id: categoriaId });
    if (error) throw new Error(error.message);
    return data as string;
  },

  async guardarCosto(itemId: string, costoNuevo: number | null): Promise<void> {
    const { error } = await supabase
      .from('revalorizacion_inventario_items')
      .update({ costo_nuevo: costoNuevo })
      .eq('id', itemId);
    if (error) throw new Error(error.message);
  },

  async confirmar(id: string): Promise<{ total_perdida: number; total_ganancia: number }> {
    const { data, error } = await supabase.rpc('confirmar_revalorizacion_inventario', { p_revalorizacion_id: id });
    if (error) throw new Error(error.message);
    return data as { total_perdida: number; total_ganancia: number };
  },

  async anular(id: string): Promise<void> {
    const { error } = await supabase.rpc('anular_revalorizacion_inventario', { p_revalorizacion_id: id });
    if (error) throw new Error(error.message);
  },

  async setAsiento(id: string, asientoId: string): Promise<void> {
    const { error } = await supabase.rpc('set_asiento_revalorizacion_inventario', {
      p_revalorizacion_id: id, p_asiento_id: asientoId,
    });
    if (error) throw new Error(error.message);
  },
};

export const REVALORIZACION_INVENTARIO_KEYS = {
  list: (empresaId: string) => ['revalorizaciones_inventario', empresaId] as const,
  detail: (id: string) => ['revalorizaciones_inventario', 'detail', id] as const,
};
