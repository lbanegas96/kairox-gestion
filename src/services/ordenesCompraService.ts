import { supabase } from '@/lib/customSupabaseClient';
import type { OrdenCompra, OrdenCompraEstado, OrdenCompraItem, PaginatedResult, EstadoPago } from '@/types';
import { asientosAutoService } from './planCuentasService';

interface GetAllFilters {
  estado?: OrdenCompraEstado;
  proveedorId?: string | null;
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
}

interface CreateOCPayload {
  proveedor_id?: string | null;
  proveedor_nombre?: string | null;
  fecha_entrega_esperada?: string | null;
  forma_pago: string;
  notas?: string;
  estadoInicial?: OrdenCompraEstado;
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
    { estado, proveedorId, page = 1, pageSize = 30, dateFrom, dateTo }: GetAllFilters = {}
  ): Promise<PaginatedResult<OrdenCompra>> {
    let query = supabase
      .from('ordenes_compra')
      .select('*, proveedores(nombre)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });

    if (estado) query = query.eq('estado', estado);
    if (proveedorId) query = query.eq('proveedor_id', proveedorId);
    if (dateFrom) query = query.gte('fecha', `${dateFrom}T00:00:00`);
    if (dateTo) query = query.lte('fecha', `${dateTo}T23:59:59`);

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
      .rpc('next_oc_number', { p_empresa_id: empresaId });
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
        subtotal,
        total: subtotal,
        estado: (payload.estadoInicial ?? 'borrador') as OrdenCompraEstado,
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

  /** Recepción parcial o total de ítems — suma el delta al acumulado, actualiza stock y genera asiento contable */
  async recibirItems(
    ordenId: string,
    recepciones: { itemId: string; cantidadRecibida: number }[],
    empresaId?: string,
    userId?: string
  ): Promise<void> {
    let totalAsiento = 0;

    for (const rec of recepciones) {
      if (rec.cantidadRecibida <= 0) continue;

      // Leer estado actual + costo para hacer ADD y calcular monto del asiento
      const { data: current, error: fetchItemError } = await supabase
        .from('ordenes_compra_items')
        .select('cantidad_recibida, cantidad_pedida, costo_unitario')
        .eq('id', rec.itemId)
        .single();
      if (fetchItemError) throw new Error(fetchItemError.message);

      const nuevaCantidad = Math.min(
        Number(current.cantidad_recibida) + rec.cantidadRecibida,
        Number(current.cantidad_pedida)
      );
      const deltaQty = nuevaCantidad - Number(current.cantidad_recibida);
      totalAsiento += deltaQty * Number(current.costo_unitario);

      const { error } = await supabase
        .from('ordenes_compra_items')
        .update({ cantidad_recibida: nuevaCantidad })
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

    // Asiento contable automático: DEBE Mercaderías / HABER Ctas a Pagar
    if (empresaId && userId && totalAsiento > 0) {
      try {
        const fecha = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
        const { data: oc } = await supabase
          .from('ordenes_compra')
          .select('numero, proveedor_nombre')
          .eq('id', ordenId)
          .single();
        const provNombre = (oc as any)?.proveedor_nombre ?? 'Proveedor';
        await asientosAutoService.crearAsientoRecepcionOC(empresaId, userId, {
          ocId: ordenId,
          total: totalAsiento,
          fecha,
          descripcion: `Recepción mercadería OC ${(oc as any)?.numero ?? ordenId} — ${provNombre}`,
        });
      } catch {
        // silencioso si empresa no tiene plan de cuentas o período cerrado
      }
    }
  },

  async cancelar(id: string): Promise<void> {
    const { error } = await supabase
      .from('ordenes_compra')
      .update({ estado: 'cancelada' as OrdenCompraEstado })
      .eq('id', id);
    if (error) throw new Error(error.message);
  },

  async getEstadoCounts(empresaId: string): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from('ordenes_compra')
      .select('estado')
      .eq('empresa_id', empresaId);
    if (error) throw new Error(error.message);
    return (data ?? []).reduce((acc: Record<string, number>, row: { estado: string }) => {
      acc[row.estado] = (acc[row.estado] ?? 0) + 1;
      return acc;
    }, {});
  },
};

export const OC_KEYS = {
  list: (empresaId: string, filters?: GetAllFilters) => ['ordenes_compra', empresaId, filters] as const,
  detail: (id: string) => ['orden_compra', id] as const,
  counts: (empresaId: string) => ['ordenes_compra_counts', empresaId] as const,
};
