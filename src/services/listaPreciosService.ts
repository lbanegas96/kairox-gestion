import { supabase } from '@/lib/customSupabaseClient';
import { getNowAR } from '@/lib/dateUtils';

export interface ListaPrecio {
  id: string;
  empresa_id: string;
  user_id: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
  _itemCount?: number;
}

export interface ListaPrecioItem {
  id: string;
  lista_precio_id: string;
  empresa_id: string;
  producto_id: string;
  precio: number;
  productos?: { nombre: string; codigo_sku: string; precio_venta: number };
}

// Mapa { producto_id → precio } para aplicar en NuevaVentaModal
export type PrecioMap = Record<string, number>;

export interface AjusteMasivoItem {
  producto_id: string;
  nombre: string;
  precio_actual: number;
  precio_nuevo: number;
}

export interface AjusteMasivoParams {
  listaPrecioId: string;
  tipoAjuste: 'porcentaje' | 'monto_fijo';
  valor: number;
  categoriaId?: string | null;
  busqueda?: string | null;
  redondeo?: 'ninguno' | 'decena' | 'centena' | 'terminar_99';
}

export interface HistorialPrecioEntry {
  fecha: string;
  operacion: 'INSERT' | 'UPDATE' | 'DELETE';
  precioAnterior: number | null;
  precioNuevo: number | null;
  usuario: string;
}

export const listaPreciosService = {
  // ── Listas ──────────────────────────────────────────────────────────────────

  async getAll(empresaId: string): Promise<ListaPrecio[]> {
    const { data, error } = await supabase
      .from('listas_precio')
      .select('*, lista_precio_items(id)')
      .eq('empresa_id', empresaId)
      .order('nombre');
    if (error) throw new Error(error.message);
    return (data ?? []).map((l: any) => ({
      ...l,
      _itemCount: Array.isArray(l.lista_precio_items) ? l.lista_precio_items.length : 0,
      lista_precio_items: undefined,
    })) as ListaPrecio[];
  },

  async create(empresaId: string, userId: string, nombre: string, descripcion?: string): Promise<ListaPrecio> {
    const { data, error } = await supabase
      .from('listas_precio')
      .insert([{ empresa_id: empresaId, user_id: userId, nombre, descripcion: descripcion ?? null }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ListaPrecio;
  },

  async update(id: string, nombre: string, descripcion?: string): Promise<ListaPrecio> {
    const { data, error } = await supabase
      .from('listas_precio')
      .update({ nombre, descripcion: descripcion ?? null, updated_at: getNowAR().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ListaPrecio;
  },

  async toggleActivo(id: string, activo: boolean): Promise<void> {
    const { error } = await supabase
      .from('listas_precio')
      .update({ activo, updated_at: getNowAR().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('listas_precio').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ── Ítems de lista ──────────────────────────────────────────────────────────

  async getItems(listaPrecioId: string): Promise<ListaPrecioItem[]> {
    const { data, error } = await supabase
      .from('lista_precio_items')
      .select('id, lista_precio_id, empresa_id, producto_id, precio, created_at')
      .eq('lista_precio_id', listaPrecioId)
      .order('created_at');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return [];

    const productoIds = (data as any[]).map((i) => i.producto_id);
    const { data: prods, error: pErr } = await supabase
      .from('productos')
      .select('id, nombre, codigo_sku, precio_venta')
      .in('id', productoIds);
    if (pErr) throw new Error(pErr.message);

    const prodMap: Record<string, any> = Object.fromEntries(
      (prods ?? []).map((p: any) => [p.id, p])
    );

    return (data as any[]).map((i) => ({
      ...i,
      productos: prodMap[i.producto_id] ?? undefined,
    })) as ListaPrecioItem[];
  },

  async upsertItem(listaPrecioId: string, empresaId: string, productoId: string, precio: number): Promise<void> {
    const { error } = await supabase
      .from('lista_precio_items')
      .upsert(
        [{ lista_precio_id: listaPrecioId, empresa_id: empresaId, producto_id: productoId, precio }],
        { onConflict: 'lista_precio_id,producto_id' }
      );
    if (error) throw new Error(error.message);
  },

  async deleteItem(itemId: string): Promise<void> {
    const { error } = await supabase.from('lista_precio_items').delete().eq('id', itemId);
    if (error) throw new Error(error.message);
  },

  // ── Ajuste masivo ────────────────────────────────────────────────────────────
  // aplicar=false → preview (no escribe nada); aplicar=true → graba el resultado

  async ajustarPreciosMasivo(params: AjusteMasivoParams, aplicar: boolean): Promise<AjusteMasivoItem[]> {
    const { data, error } = await supabase.rpc('ajustar_precios_masivo', {
      p_lista_precio_id: params.listaPrecioId,
      p_tipo_ajuste: params.tipoAjuste,
      p_valor: params.valor,
      p_categoria_id: params.categoriaId ?? null,
      p_busqueda: params.busqueda ?? null,
      p_redondeo: params.redondeo ?? 'ninguno',
      p_aplicar: aplicar,
    });
    if (error) throw new Error(error.message);
    return ((data as any)?.items ?? []) as AjusteMasivoItem[];
  },

  // ── Historial de cambios de precio ───────────────────────────────────────────

  async getHistorialPrecio(listaPrecioId: string, productoId: string): Promise<HistorialPrecioEntry[]> {
    const { data, error } = await supabase
      .from('audit_log')
      .select('created_at, operacion, old_data, new_data, user_id')
      .eq('tabla', 'lista_precio_items')
      .or(`new_data->>producto_id.eq.${productoId},old_data->>producto_id.eq.${productoId}`)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const rows = (data ?? []).filter((r: any) => {
      const d = r.new_data ?? r.old_data;
      return d?.lista_precio_id === listaPrecioId && d?.producto_id === productoId;
    });
    if (rows.length === 0) return [];

    const userIds = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000']);
    const nombreMap: Record<string, string> = Object.fromEntries(
      (profiles ?? []).map((p: any) => [
        p.id,
        [p.first_name, p.last_name].filter(Boolean).join(' ') || p.email || 'Usuario',
      ])
    );

    return rows.map((r: any) => ({
      fecha: r.created_at,
      operacion: r.operacion,
      precioAnterior: r.old_data?.precio != null ? Number(r.old_data.precio) : null,
      precioNuevo: r.new_data?.precio != null ? Number(r.new_data.precio) : null,
      usuario: r.user_id ? (nombreMap[r.user_id] ?? 'Usuario') : 'Sistema',
    }));
  },

  // ── Asignar lista a cliente ─────────────────────────────────────────────────

  async assignToCliente(clienteId: string, listaPrecioId: string | null): Promise<void> {
    const { error } = await supabase
      .from('clientes')
      .update({ lista_precio_id: listaPrecioId })
      .eq('id', clienteId);
    if (error) throw new Error(error.message);
  },

  // ── Obtener mapa de precios para un cliente ─────────────────────────────────
  // Retorna { producto_id: precio } — solo si el cliente tiene lista asignada

  async getPrecioMapForCliente(clienteId: string): Promise<PrecioMap> {
    // 1. Obtener lista_precio_id del cliente
    const { data: cliente, error: cErr } = await supabase
      .from('clientes')
      .select('lista_precio_id')
      .eq('id', clienteId)
      .single();
    if (cErr || !cliente?.lista_precio_id) return {};

    // 2. Obtener items de la lista
    const { data: items, error: iErr } = await supabase
      .from('lista_precio_items')
      .select('producto_id, precio')
      .eq('lista_precio_id', cliente.lista_precio_id);
    if (iErr || !items) return {};

    return Object.fromEntries(items.map((i: any) => [i.producto_id, Number(i.precio)]));
  },
};
