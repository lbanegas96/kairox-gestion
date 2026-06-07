import { supabase } from '@/lib/customSupabaseClient';

type PedidoEstado = 'borrador' | 'confirmado' | 'en_preparacion' | 'facturado' | 'cancelado';

interface CreatePedidoPayload {
  clienteId?: string | null;
  clienteNombre?: string | null;
  items: {
    producto_id?: string | null;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    unidad_medida?: string | null;
  }[];
  notas?: string | null;
  fechaEntrega?: string | null;
}

export const pedidosService = {
  async getAll(
    empresaId: string,
    { estado, page = 1, pageSize = 30 }: { estado?: string; page?: number; pageSize?: number } = {}
  ) {
    let query = supabase
      .from('pedidos')
      .select('*, clientes(nombre)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });

    if (estado) query = query.eq('estado', estado);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: data ?? [], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, clientes(*), pedido_items(*, productos(id, nombre, unidad_medida, precio_venta, stock_actual, codigo_sku))')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async create(
    empresaId: string,
    userId: string,
    { clienteId, clienteNombre, items, notas, fechaEntrega }: CreatePedidoPayload
  ) {
    const { data: numData, error: numError } = await supabase
      .rpc('next_pedido_number', { p_empresa_id: empresaId });
    if (numError) throw new Error(numError.message);

    const subtotal = items.reduce(
      (s, i) => s + Number(i.cantidad) * Number(i.precio_unitario),
      0
    );

    const { data: pedido, error: pedError } = await supabase
      .from('pedidos')
      .insert([{
        empresa_id: empresaId,
        user_id: userId,
        numero: numData as string,
        cliente_id: clienteId ?? null,
        cliente_nombre: clienteNombre ?? null,
        subtotal,
        total: subtotal,
        notas: notas ?? null,
        fecha_entrega: fechaEntrega ?? null,
        estado: 'borrador' as PedidoEstado,
      }])
      .select()
      .single();
    if (pedError) throw new Error(pedError.message);

    const detalles = items.map(item => ({
      pedido_id: (pedido as any).id,
      empresa_id: empresaId,
      producto_id: item.producto_id ?? null,
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario),
      subtotal: Number(item.cantidad) * Number(item.precio_unitario),
      unidad_medida: item.unidad_medida ?? null,
    }));

    const { error: detError } = await supabase.from('pedido_items').insert(detalles);
    if (detError) throw new Error(detError.message);

    return pedido;
  },

  async updateEstado(id: string, estado: PedidoEstado) {
    const { data, error } = await supabase
      .from('pedidos')
      .update({ estado })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async markAsFacturado(id: string, comprobanteId: string) {
    const { data, error } = await supabase
      .from('pedidos')
      .update({ estado: 'facturado' as PedidoEstado, comprobante_id: comprobanteId })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async delete(id: string) {
    const { error } = await supabase.from('pedidos').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export const PEDIDOS_KEYS = {
  list: (empresaId: string, filters?: object) => ['pedidos', empresaId, filters] as const,
  detail: (id: string | null) => ['pedido', id] as const,
};
