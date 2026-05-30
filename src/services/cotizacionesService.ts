import { supabase } from '@/lib/customSupabaseClient';
import type { Cotizacion, CotizacionEstado, CotizacionItem, PaginatedResult } from '@/types';

interface GetAllFilters {
  estado?: CotizacionEstado;
  clienteId?: string | null;
  page?: number;
  pageSize?: number;
}

interface CreateCotizacionPayload {
  cliente?: { id?: string; nombre?: string } | null;
  items: Partial<CotizacionItem>[];
  notas?: string;
  condicionesPago?: string;
  fechaVencimiento?: string | null;
}

export const cotizacionesService = {
  async getAll(
    empresaId: string,
    { estado, clienteId, page = 1, pageSize = 30 }: GetAllFilters = {}
  ): Promise<PaginatedResult<Cotizacion>> {
    let query = supabase
      .from('cotizaciones')
      .select('*, clientes(nombre)', { count: 'exact' })
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });

    if (estado) query = query.eq('estado', estado);
    if (clienteId) query = query.eq('cliente_id', clienteId);

    const from = (page - 1) * pageSize;
    query = query.range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw new Error(error.message);
    return { data: (data ?? []) as Cotizacion[], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id: string): Promise<Cotizacion> {
    const { data, error } = await supabase
      .from('cotizaciones')
      .select('*, clientes(*), cotizacion_items(*, productos(nombre, unidad_medida))')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as Cotizacion;
  },

  async create(
    empresaId: string,
    userId: string,
    { cliente, items, notas, condicionesPago, fechaVencimiento }: CreateCotizacionPayload
  ): Promise<Cotizacion> {
    const { data: numData, error: numError } = await supabase
      .rpc('next_cotizacion_number', { p_empresa_id: empresaId });
    if (numError) throw new Error(numError.message);

    const subtotal = items.reduce(
      (s, i) => s + (Number(i.cantidad) || 0) * (Number(i.precio_unitario) || 0),
      0
    );

    const { data: cot, error: cotError } = await supabase
      .from('cotizaciones')
      .insert([{
        empresa_id: empresaId,
        user_id: userId,
        numero: numData as string,
        cliente_id: cliente?.id ?? null,
        cliente_nombre: cliente?.nombre ?? null,
        subtotal,
        total: subtotal,
        notas: notas ?? null,
        condiciones_pago: condicionesPago ?? null,
        fecha_vencimiento: fechaVencimiento ?? null,
        estado: 'borrador' as CotizacionEstado,
      }])
      .select()
      .single();
    if (cotError) throw new Error(cotError.message);

    const detalles = items.map((item) => ({
      cotizacion_id: (cot as Cotizacion).id,
      empresa_id: empresaId,
      producto_id: item.producto_id ?? null,
      descripcion: item.descripcion ?? '',
      cantidad: parseFloat(String(item.cantidad)),
      precio_unitario: parseFloat(String(item.precio_unitario)),
      descuento_item: parseFloat(String(item.descuento_item ?? 0)),
      subtotal: parseFloat(String(item.cantidad)) * parseFloat(String(item.precio_unitario)),
      unidad_medida: item.unidad_medida ?? null,
    }));

    const { error: detError } = await supabase.from('cotizacion_items').insert(detalles);
    if (detError) throw new Error(detError.message);

    return cot as Cotizacion;
  },

  async updateEstado(id: string, estado: CotizacionEstado): Promise<Cotizacion> {
    const { data, error } = await supabase
      .from('cotizaciones')
      .update({ estado })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data as Cotizacion;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('cotizaciones').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },
};

export const COTIZACIONES_KEYS = {
  list: (empresaId: string, filters?: GetAllFilters) => ['cotizaciones', empresaId, filters] as const,
  detail: (id: string) => ['cotizacion', id] as const,
};
