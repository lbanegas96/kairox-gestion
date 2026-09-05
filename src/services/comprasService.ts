import { supabase } from '@/lib/customSupabaseClient';
import { getStartOfDayAR, getEndOfDayAR } from '@/lib/dateUtils';
import type { Compra, DetalleCompra, PaginatedResult, EstadoPago } from '@/types';

interface GetAllFilters {
  fechaDesde?: string;
  fechaHasta?: string;
  proveedorId?: string | null;
  estado?: EstadoPago;
  page?: number;
  pageSize?: number;
}

interface CreateCompraPayload {
  compra: Partial<Compra>;
  items: Partial<DetalleCompra>[];
  currentSessionId?: string | null;
}

export const comprasService = {
  async getAll(
    empresaId: string,
    { fechaDesde, fechaHasta, proveedorId, estado, page = 1, pageSize = 30 }: GetAllFilters = {}
  ): Promise<PaginatedResult<Compra>> {
    let query = supabase
      .from('compras')
      .select('*, proveedores(nombre)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('fecha', { ascending: false });

    if (fechaDesde) query = query.gte('fecha', getStartOfDayAR(new Date(fechaDesde)));
    if (fechaHasta) query = query.lte('fecha', getEndOfDayAR(new Date(fechaHasta)));
    if (proveedorId) query = query.eq('proveedor_id', proveedorId);
    if (estado) query = query.eq('estado_pago', estado);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: (data ?? []) as Compra[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id: string): Promise<Compra> {
    const { data, error } = await supabase
      .from('compras')
      .select('*, proveedores(nombre), detalle_compras(*, productos(nombre, unidad_medida))')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as Compra;
  },

  async create(empresaId: string, userId: string, { compra, items }: CreateCompraPayload): Promise<Compra> {
    const { data: newCompra, error: compraError } = await supabase
      .from('compras')
      .insert([{ ...compra, user_id: userId, empresa_id: empresaId }])
      .select()
      .single();
    if (compraError) throw new Error(compraError.message);

    const detalles = items.map((item) => ({
      compra_id: (newCompra as Compra).id,
      empresa_id: empresaId,
      producto_id: item.producto_id ?? null,
      cantidad: Number(item.cantidad),
      costo_unitario: Number(item.costo_unitario),
      subtotal: Number(item.cantidad) * Number(item.costo_unitario),
    }));

    const { error: detError } = await supabase.from('detalle_compras').insert(detalles);
    if (detError) throw new Error(detError.message);

    return newCompra as Compra;
  },

  async updateEstadoPago(id: string, estado: EstadoPago): Promise<Compra> {
    const { data, error } = await supabase
      .from('compras')
      .update({ estado_pago: estado })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Compra;
  },

  // Anulación real (mig.391, Fase 2 de PLAN_PARIDAD_COMPRAS.md) — simétrica a
  // cancelar_factura del lado ventas: reversa stock, cantidad_facturada de la
  // OC de origen (si vino de una), caja (si fue Efectivo) y Cuenta Corriente
  // del proveedor. El asiento se reversa aparte, en el caller (mismo patrón
  // que SaleDetailModal.jsx con crearAsientoReversaVenta).
  async cancelar(
    empresaId: string, userId: string, compraId: string, motivo?: string | null
  ): Promise<{ compra_id: string; numero_factura: string | null; total: number }> {
    const { data, error } = await supabase.rpc('cancelar_compra', {
      p_empresa_id: empresaId,
      p_user_id: userId,
      p_compra_id: compraId,
      p_motivo: motivo ?? null,
    });
    if (error) throw new Error(error.message);
    return data as { compra_id: string; numero_factura: string | null; total: number };
  },

  // Historial de cambios — junta auditoría de cabecera (compras) e ítems
  // (detalle_compras, filtrados por compra_id dentro del JSONB porque su
  // propio registro_id es el id del ítem, no el de la compra). Mismo patrón
  // que ordenesCompraService.getHistorial().
  async getHistorial(compraId: string) {
    const [cabeceraRes, itemsRes] = await Promise.all([
      supabase
        .from('audit_log')
        .select('id, tabla, operacion, old_data, new_data, user_id, created_at')
        .eq('tabla', 'compras')
        .eq('registro_id', compraId),
      supabase
        .from('audit_log')
        .select('id, tabla, operacion, old_data, new_data, user_id, created_at')
        .eq('tabla', 'detalle_compras')
        .or(`old_data->>compra_id.eq.${compraId},new_data->>compra_id.eq.${compraId}`),
    ]);
    if (cabeceraRes.error) throw new Error(cabeceraRes.error.message);
    if (itemsRes.error) throw new Error(itemsRes.error.message);

    return [...(cabeceraRes.data ?? []), ...(itemsRes.data ?? [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  },
};

export const COMPRAS_KEYS = {
  list: (empresaId: string, filters?: GetAllFilters) => ['compras', empresaId, filters] as const,
  detail: (id: string) => ['compra', id] as const,
};
