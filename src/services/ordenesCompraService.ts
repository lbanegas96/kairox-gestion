import { supabase } from '@/lib/customSupabaseClient';
import type { OrdenCompra, OrdenCompraEstado, OrdenCompraItem, PaginatedResult, EstadoPago, FacturaProveedor } from '@/types';

interface GetAllFilters {
  estado?: OrdenCompraEstado;
  proveedorId?: string | null;
  page?: number;
  pageSize?: number;
}

interface CreateOCPayload {
  proveedor_id?: string | null;
  proveedor_nombre?: string | null;
  fecha_entrega_esperada?: string | null;
  forma_pago: string;
  notas?: string;
  moneda?: string;
  tipoCambioTasa?: number;
  items: {
    producto_id?: string | null;
    descripcion: string;
    cantidad_pedida: number;
    costo_unitario: number;
    unidad_medida?: string | null;
  }[];
}

export const ordenesCompraService = {
  async getAll(
    empresaId: string,
    { estado, proveedorId, page = 1, pageSize = 30 }: GetAllFilters = {}
  ): Promise<PaginatedResult<OrdenCompra>> {
    let query = supabase
      .from('ordenes_compra')
      .select('*, proveedores(nombre)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });

    if (estado) query = query.eq('estado', estado);
    if (proveedorId) query = query.eq('proveedor_id', proveedorId);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return {
      data: (data ?? []) as OrdenCompra[],
      count: count ?? 0,
      pages: Math.ceil((count ?? 0) / pageSize),
    };
  },

  async getById(id: string): Promise<OrdenCompra> {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .select('*, proveedores(nombre), ordenes_compra_items(*, productos(nombre, unidad_medida, stock_actual))')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as OrdenCompra;
  },

  async create(empresaId: string, userId: string, payload: CreateOCPayload): Promise<OrdenCompra> {
    // Generar número correlativo
    const { data: numero, error: numError } = await supabase
      .rpc('obtener_proximo_numero', { p_empresa_id: empresaId, p_tipo_documento: 'orden_compra' });
    if (numError) throw new Error(numError.message);

    const subtotal = payload.items.reduce(
      (s, i) => s + i.cantidad_pedida * i.costo_unitario,
      0
    );

    const { data: oc, error: ocError } = await supabase
      .from('ordenes_compra')
      .insert([{
        empresa_id: empresaId,
        user_id: userId,
        numero,
        proveedor_id: payload.proveedor_id ?? null,
        proveedor_nombre: payload.proveedor_nombre ?? null,
        fecha_entrega_esperada: payload.fecha_entrega_esperada ?? null,
        forma_pago: payload.forma_pago,
        notas: payload.notas ?? null,
        moneda: payload.moneda ?? 'ARS',
        tipo_cambio_tasa: payload.tipoCambioTasa ?? 1,
        subtotal,
        total: subtotal,
        estado: 'borrador' as OrdenCompraEstado,
        estado_pago: 'pendiente' as EstadoPago,
      }])
      .select()
      .single();
    if (ocError) throw new Error(ocError.message);

    const items = payload.items.map((item) => ({
      orden_id: (oc as OrdenCompra).id,
      empresa_id: empresaId,
      producto_id: item.producto_id ?? null,
      descripcion: item.descripcion,
      cantidad_pedida: item.cantidad_pedida,
      cantidad_recibida: 0,
      costo_unitario: item.costo_unitario,
      subtotal: item.cantidad_pedida * item.costo_unitario,
      unidad_medida: item.unidad_medida ?? null,
    }));

    const { error: itemsError } = await supabase.from('ordenes_compra_items').insert(items);
    if (itemsError) throw new Error(itemsError.message);

    return oc as OrdenCompra;
  },

  async updateEstado(id: string, estado: OrdenCompraEstado): Promise<OrdenCompra> {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .update({ estado })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as OrdenCompra;
  },

  /** Recepción parcial o total de ítems — el trigger DB actualiza stock automáticamente */
  async recibirItems(
    ordenId: string,
    recepciones: { itemId: string; cantidadRecibida: number }[]
  ): Promise<void> {
    for (const rec of recepciones) {
      const { error } = await supabase
        .from('ordenes_compra_items')
        .update({ cantidad_recibida: rec.cantidadRecibida })
        .eq('id', rec.itemId);
      if (error) throw new Error(error.message);
    }

    // Calcular nuevo estado global de la OC
    const { data: items, error: fetchError } = await supabase
      .from('ordenes_compra_items')
      .select('cantidad_pedida, cantidad_recibida')
      .eq('orden_id', ordenId);
    if (fetchError) throw new Error(fetchError.message);

    const allItems = (items ?? []) as Pick<OrdenCompraItem, 'cantidad_pedida' | 'cantidad_recibida'>[];
    const totalPedido = allItems.reduce((s, i) => s + Number(i.cantidad_pedida), 0);
    const totalRecibido = allItems.reduce((s, i) => s + Number(i.cantidad_recibida), 0);

    let nuevoEstado: OrdenCompraEstado;
    if (totalRecibido === 0) nuevoEstado = 'enviada';
    else if (totalRecibido >= totalPedido) nuevoEstado = 'recibida';
    else nuevoEstado = 'recibida_parcial';

    await supabase
      .from('ordenes_compra')
      .update({ estado: nuevoEstado })
      .eq('id', ordenId);
  },

  async cancelar(id: string): Promise<void> {
    const { error } = await supabase
      .from('ordenes_compra')
      .update({ estado: 'cancelada' as OrdenCompraEstado })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ── Facturas de proveedor (3-way match) ──────────────────────────────────

  async getFactura(ordenId: string): Promise<FacturaProveedor | null> {
    const { data, error } = await supabase
      .from('facturas_proveedor')
      .select('*')
      .eq('orden_compra_id', ordenId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  },

  async registrarFactura(payload: {
    empresa_id: string;
    orden_compra_id: string;
    proveedor_id?: string | null;
    numero_factura: string;
    fecha_factura: string;
    fecha_vencimiento?: string | null;
    monto_total: number;
    notas?: string | null;
  }): Promise<FacturaProveedor> {
    const { data, error } = await supabase
      .from('facturas_proveedor')
      .upsert([payload], { onConflict: 'orden_compra_id' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as FacturaProveedor;
  },

  async pagarFactura(facturaId: string): Promise<void> {
    const { error } = await supabase
      .from('facturas_proveedor')
      .update({ estado: 'pagada' })
      .eq('id', facturaId);
    if (error) throw new Error(error.message);
  },
};

export const OC_KEYS = {
  list: (empresaId: string, filters?: GetAllFilters) => ['ordenes_compra', empresaId, filters] as const,
  detail: (id: string) => ['orden_compra', id] as const,
  counts: (empresaId: string) => ['ordenes_compra_counts', empresaId] as const,
  factura: (ordenId: string) => ['factura_proveedor', ordenId] as const,
};
