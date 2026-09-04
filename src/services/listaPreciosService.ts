import { supabase } from '@/lib/customSupabaseClient';
import { getNowAR } from '@/lib/dateUtils';

export interface ListaPrecio {
  id: string;
  empresa_id: string;
  user_id: string;
  nombre: string;
  descripcion: string | null;
  tipo: 'fija' | 'factor';
  activo: boolean;
  created_at: string;
  updated_at: string;
  _itemCount?: number;
}

export interface FactorCategoria {
  id: string;
  lista_precio_id: string;
  empresa_id: string;
  categoria_id: string | null; // null = factor por defecto
  factor: number;
}

export interface RecalculoFactorItem {
  producto_id: string;
  nombre: string;
  costo_compra: number;
  factor_aplicado: number;
  precio_actual: number;
  precio_nuevo: number;
}

export interface ListaPrecioItem {
  id: string;
  lista_precio_id: string;
  empresa_id: string;
  producto_id: string;
  precio: number;
  precio_programado: number | null;
  fecha_vigencia_programada: string | null;
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

  async create(empresaId: string, userId: string, nombre: string, descripcion?: string, tipo: 'fija' | 'factor' = 'fija'): Promise<ListaPrecio> {
    const { data, error } = await supabase
      .from('listas_precio')
      .insert([{ empresa_id: empresaId, user_id: userId, nombre, descripcion: descripcion ?? null, tipo }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as ListaPrecio;
  },

  async update(id: string, nombre: string, descripcion?: string, tipo?: 'fija' | 'factor'): Promise<ListaPrecio> {
    const { data, error } = await supabase
      .from('listas_precio')
      .update({ nombre, descripcion: descripcion ?? null, ...(tipo ? { tipo } : {}), updated_at: getNowAR().toISOString() })
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
      .select('id, lista_precio_id, empresa_id, producto_id, precio, precio_programado, fecha_vigencia_programada, created_at')
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

  // ── Vigencia futura ───────────────────────────────────────────────────────────

  async programarPrecioFuturo(listaPrecioId: string, productoId: string, precio: number, fechaVigencia: string): Promise<void> {
    const { error } = await supabase.rpc('programar_precio_futuro', {
      p_lista_precio_id: listaPrecioId,
      p_producto_id: productoId,
      p_precio: precio,
      p_fecha_vigencia: fechaVigencia,
    });
    if (error) throw new Error(error.message);
  },

  async cancelarPrecioProgramado(listaPrecioId: string, productoId: string): Promise<void> {
    const { error } = await supabase.rpc('cancelar_precio_programado', {
      p_lista_precio_id: listaPrecioId,
      p_producto_id: productoId,
    });
    if (error) throw new Error(error.message);
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

  // ── Listas "por Factor" (costo × margen) ────────────────────────────────────
  // Fase A del rediseño (02/09) — investigado contra el mecanismo de SAP B1
  // (Último Precio de Compra + listas vinculadas por Factor).

  async getFactoresCategoria(listaPrecioId: string): Promise<FactorCategoria[]> {
    const { data, error } = await supabase
      .from('lista_precio_factores_categoria')
      .select('id, lista_precio_id, empresa_id, categoria_id, factor')
      .eq('lista_precio_id', listaPrecioId);
    if (error) throw new Error(error.message);
    return (data ?? []) as FactorCategoria[];
  },

  async upsertFactorCategoria(listaPrecioId: string, empresaId: string, categoriaId: string | null, factor: number): Promise<void> {
    // categoria_id NULL (factor por defecto) no entra en el onConflict normal
    // porque Postgres no matchea NULL en un ON CONFLICT sobre columnas
    // nullable con un UNIQUE normal -- por eso hay un índice parcial
    // dedicado (idx_factor_categoria_default_unico) para ese caso.
    if (categoriaId === null) {
      const { data: existing } = await supabase
        .from('lista_precio_factores_categoria')
        .select('id')
        .eq('lista_precio_id', listaPrecioId)
        .is('categoria_id', null)
        .maybeSingle();
      if (existing) {
        const { error } = await supabase
          .from('lista_precio_factores_categoria')
          .update({ factor, updated_at: getNowAR().toISOString() })
          .eq('id', existing.id);
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await supabase
        .from('lista_precio_factores_categoria')
        .insert([{ lista_precio_id: listaPrecioId, empresa_id: empresaId, categoria_id: null, factor }]);
      if (error) throw new Error(error.message);
      return;
    }
    const { error } = await supabase
      .from('lista_precio_factores_categoria')
      .upsert(
        [{ lista_precio_id: listaPrecioId, empresa_id: empresaId, categoria_id: categoriaId, factor }],
        { onConflict: 'lista_precio_id,categoria_id' }
      );
    if (error) throw new Error(error.message);
  },

  async deleteFactorCategoria(id: string): Promise<void> {
    const { error } = await supabase.from('lista_precio_factores_categoria').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  // aplicar=false → preview (no escribe nada); aplicar=true → hace upsert en
  // lista_precio_items (mismo destino que las listas "fija", el resto del
  // sistema no necesita distinguir de dónde salió el precio).
  async recalcularPreciosFactor(listaPrecioId: string, aplicar: boolean): Promise<RecalculoFactorItem[]> {
    const { data, error } = await supabase.rpc('recalcular_precios_lista_factor', {
      p_lista_precio_id: listaPrecioId,
      p_aplicar: aplicar,
    });
    if (error) throw new Error(error.message);
    return ((data as any)?.items ?? []) as RecalculoFactorItem[];
  },

  // ── Lista base para Modo Caja (Fase B, 02/09) ───────────────────────────────
  // A diferencia de recalcularPreciosFactor (que escribe en lista_precio_items,
  // para listas secundarias), esta escribe directo en productos.precio_venta --
  // es LA lista que alimenta el catálogo. También se recalcula sola en cada
  // compra (trigger + aplicar_compra_producto en el backend, sin acción del
  // usuario) — este método es solo para el recálculo manual/inicial.

  async getListaBaseId(empresaId: string): Promise<string | null> {
    const { data, error } = await supabase
      .from('empresas')
      .select('lista_precio_base_id')
      .eq('id', empresaId)
      .single();
    if (error) throw new Error(error.message);
    return (data as any)?.lista_precio_base_id ?? null;
  },

  async setListaBase(empresaId: string, listaPrecioId: string | null): Promise<void> {
    const { error } = await supabase
      .from('empresas')
      .update({ lista_precio_base_id: listaPrecioId })
      .eq('id', empresaId);
    if (error) throw new Error(error.message);
  },

  async recalcularCatalogoBase(listaPrecioId: string, aplicar: boolean): Promise<RecalculoFactorItem[]> {
    const { data, error } = await supabase.rpc('recalcular_catalogo_lista_base', {
      p_lista_precio_id: listaPrecioId,
      p_aplicar: aplicar,
    });
    if (error) throw new Error(error.message);
    return ((data as any)?.items ?? []) as RecalculoFactorItem[];
  },
};
