import { supabase } from '@/lib/customSupabaseClient';

export const cotizacionesService = {
  async getAll(empresaId, { estado, clienteId, page = 1, pageSize = 30 } = {}) {
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
    if (error) throw error;
    return { data: data ?? [], count: count ?? 0, pages: Math.ceil((count ?? 0) / pageSize) };
  },

  async getById(id) {
    const { data, error } = await supabase
      .from('cotizaciones')
      .select('*, clientes(*), cotizacion_items(*, productos(nombre, unidad_medida))')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },

  async create(empresaId, userId, { cliente, items, notas, condicionesPago, fechaVencimiento }) {
    const { data: numData, error: numError } = await supabase
      .rpc('next_cotizacion_number', { p_empresa_id: empresaId });
    if (numError) throw numError;

    const subtotal = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0);
    const total = subtotal;

    const { data: cot, error: cotError } = await supabase
      .from('cotizaciones')
      .insert([{
        empresa_id: empresaId,
        user_id: userId,
        numero: numData,
        cliente_id: cliente?.id ?? null,
        cliente_nombre: cliente?.nombre ?? null,
        subtotal,
        total,
        notas,
        condiciones_pago: condicionesPago,
        fecha_vencimiento: fechaVencimiento ?? null,
        estado: 'borrador',
      }])
      .select()
      .single();
    if (cotError) throw cotError;

    const detalles = items.map(item => ({
      cotizacion_id: cot.id,
      empresa_id: empresaId,
      producto_id: item.producto_id ?? null,
      descripcion: item.descripcion,
      cantidad: parseFloat(item.cantidad),
      precio_unitario: parseFloat(item.precio_unitario),
      descuento_item: parseFloat(item.descuento_item ?? 0),
      subtotal: parseFloat(item.cantidad) * parseFloat(item.precio_unitario),
      unidad_medida: item.unidad_medida ?? null,
    }));

    const { error: detError } = await supabase.from('cotizacion_items').insert(detalles);
    if (detError) throw detError;

    return cot;
  },

  async updateEstado(id, estado) {
    const { data, error } = await supabase
      .from('cotizaciones')
      .update({ estado })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from('cotizaciones').delete().eq('id', id);
    if (error) throw error;
  },
};

export const COTIZACIONES_KEYS = {
  list: (empresaId, filters) => ['cotizaciones', empresaId, filters],
  cotizacion: (id) => ['cotizacion', id],
};
