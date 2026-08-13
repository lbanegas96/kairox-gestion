import { supabase } from '@/lib/customSupabaseClient';
import type { OrdenCompra, OrdenCompraEstado, PaginatedResult, EstadoPago, FacturaProveedor } from '@/types';

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
  descuentoGlobalPct?: number;
  items: {
    id?: string;
    producto_id?: string | null;
    descripcion: string;
    cantidad_pedida: number;
    costo_unitario: number;
    descuento_item?: number;
    alicuota_iva?: string;
    unidad_medida?: string | null;
  }[];
}

// Igual forma que CreateOCPayload — actualizar_orden_compra() usa el mismo shape de
// ítems que ya arma FormNuevaOC.jsx (create/update comparten objeto sin transformarlo distinto).
interface UpdateOCPayload extends CreateOCPayload {}

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

    // Subtotal neto de descuentos por línea, antes del descuento global — mismo orden
    // que Cotizaciones/Pedidos (línea primero, documento después).
    const subtotalConDescLinea = payload.items.reduce(
      (s, i) => s + i.cantidad_pedida * i.costo_unitario * (1 - (Number(i.descuento_item) || 0) / 100),
      0
    );
    const descuentoGlobalPct = Number(payload.descuentoGlobalPct) || 0;
    const total = subtotalConDescLinea * (1 - descuentoGlobalPct / 100);

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
        descuento_global_pct: descuentoGlobalPct,
        subtotal: subtotalConDescLinea,
        total,
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
      subtotal: item.cantidad_pedida * item.costo_unitario * (1 - (Number(item.descuento_item) || 0) / 100),
      unidad_medida: item.unidad_medida ?? null,
      alicuota_iva: item.alicuota_iva ?? '21',
      descuento_item: Number(item.descuento_item) || 0,
    }));

    const { error: itemsError } = await supabase.from('ordenes_compra_items').insert(items);
    if (itemsError) throw new Error(itemsError.message);

    return oc as OrdenCompra;
  },

  // Solo editable mientras estado IN ('borrador', 'enviada') — la RPC lo revalida server-side.
  // Manda el `id` de cada ítem existente para que actualizar_orden_compra pueda diffear fila
  // por fila (mig.322) — mismo patrón que cotizacionesService.update()/pedidosService (mig.319/320).
  async update(ordenId: string, payload: UpdateOCPayload): Promise<OrdenCompra> {
    const itemsPayload = payload.items.map((item) => ({
      id: item.id ?? null,
      producto_id: item.producto_id ?? null,
      descripcion: item.descripcion,
      cantidad_pedida: item.cantidad_pedida,
      costo_unitario: item.costo_unitario,
      descuento_item: Number(item.descuento_item) || 0,
      alicuota_iva: item.alicuota_iva ?? '21',
      unidad_medida: item.unidad_medida ?? null,
    }));

    const { data, error } = await supabase.rpc('actualizar_orden_compra', {
      p_orden_id: ordenId,
      p_proveedor_id: payload.proveedor_id ?? null,
      p_proveedor_nombre: payload.proveedor_nombre ?? null,
      p_items: itemsPayload,
      p_notas: payload.notas ?? null,
      p_fecha_entrega_esperada: payload.fecha_entrega_esperada ?? null,
      p_forma_pago: payload.forma_pago,
      p_moneda: payload.moneda ?? 'ARS',
      p_tipo_cambio_tasa: payload.tipoCambioTasa ?? 1,
      p_descuento_global_pct: Number(payload.descuentoGlobalPct) || 0,
    });
    if (error) throw new Error(error.message);
    return data as OrdenCompra;
  },

  // Historial de cambios — junta auditoría de cabecera (ordenes_compra) e ítems
  // (ordenes_compra_items, filtrados por orden_id dentro del JSONB porque su propio
  // registro_id es el id del ítem, no el de la orden). Mismo patrón que
  // cotizacionesService.getHistorial().
  async getHistorial(ordenId: string) {
    const [cabeceraRes, itemsRes] = await Promise.all([
      supabase
        .from('audit_log')
        .select('id, tabla, operacion, old_data, new_data, user_id, created_at')
        .eq('tabla', 'ordenes_compra')
        .eq('registro_id', ordenId),
      supabase
        .from('audit_log')
        .select('id, tabla, operacion, old_data, new_data, user_id, created_at')
        .eq('tabla', 'ordenes_compra_items')
        .or(`old_data->>orden_id.eq.${ordenId},new_data->>orden_id.eq.${ordenId}`),
    ]);
    if (cabeceraRes.error) throw new Error(cabeceraRes.error.message);
    if (itemsRes.error) throw new Error(itemsRes.error.message);

    return [...(cabeceraRes.data ?? []), ...(itemsRes.data ?? [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
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

  async cancelar(id: string): Promise<void> {
    const { error } = await supabase
      .from('ordenes_compra')
      .update({ estado: 'cancelada' as OrdenCompraEstado })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  // ── Factura de proveedor (3-way match) — mig.279 ─────────────────────────
  // Reemplaza `facturas_proveedor` (mig.012), que nunca se conectó a Cuenta
  // Corriente/Libro IVA/asiento. Ahora la factura de una OC vive en
  // `compras`/`detalle_compras` (vía RPC atómica `registrar_factura_compra_oc`),
  // el mismo lugar que ya usan Compra Rápida y NC/ND de Proveedor.

  async getFactura(ordenId: string): Promise<FacturaProveedor | null> {
    const { data, error } = await supabase
      .from('compras')
      .select('*, detalle_compras(*)')
      .eq('orden_compra_id', ordenId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id,
      numero_factura: data.numero_factura,
      fecha_factura: data.fecha,
      monto_total: data.total,
      estado: data.estado_pago === 'pagada' ? 'pagada' : 'pendiente',
      detalle_compras: data.detalle_compras,
    } as unknown as FacturaProveedor;
  },

  async registrarFactura(payload: {
    empresa_id: string;
    user_id: string;
    orden_compra_id: string;
    numero_factura: string;
    fecha_factura: string;
    items: {
      producto_id?: string | null;
      cantidad: number;
      costo_unitario_neto: number;
      alicuota_iva: number;
    }[];
  }): Promise<{ compra_id: string; total: number }> {
    const { data, error } = await supabase.rpc('registrar_factura_compra_oc', {
      p_empresa_id: payload.empresa_id,
      p_user_id: payload.user_id,
      p_orden_compra_id: payload.orden_compra_id,
      p_numero_factura: payload.numero_factura,
      p_fecha_factura: payload.fecha_factura,
      p_items: payload.items,
    });
    if (error) throw new Error(error.message);
    return data as { compra_id: string; total: number };
  },
};

export const OC_KEYS = {
  list: (empresaId: string, filters?: GetAllFilters) => ['ordenes_compra', empresaId, filters] as const,
  detail: (id: string) => ['orden_compra', id] as const,
  counts: (empresaId: string) => ['ordenes_compra_counts', empresaId] as const,
  factura: (ordenId: string) => ['factura_proveedor', ordenId] as const,
};
