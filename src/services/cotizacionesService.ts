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
  moneda?: string;
  tipoCambioTasa?: number;
  descuentoGlobal?: number;
}

// Igual forma que CreateCotizacionPayload — updateEstado()/actualizar_cotizacion() comparten
// el mismo shape de items que ya arma FormNuevaCotizacion, así que create/update pueden usar
// el mismo objeto de payload sin transformarlo distinto en cada caller.
interface UpdateCotizacionPayload extends CreateCotizacionPayload {}

export interface HistorialEntry {
  id: number;
  tabla: 'cotizaciones' | 'cotizacion_items';
  operacion: 'INSERT' | 'UPDATE' | 'DELETE';
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  user_id: string | null;
  created_at: string;
}

export const cotizacionesService = {
  async getAll(
    empresaId: string,
    { estado, clienteId, page = 1, pageSize = 30 }: GetAllFilters = {}
  ): Promise<PaginatedResult<Cotizacion>> {
    let query = supabase
      .from('cotizaciones')
      .select('*, clientes(nombre), pedidos(id, numero)', { count: 'exact' })
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
      .select('*, clientes(*), cotizacion_items(*, productos(nombre, unidad_medida)), pedidos(id, numero)')
      .eq('id', id)
      .single();
    if (error) throw new Error(error.message);
    return data as Cotizacion;
  },

  async create(
    empresaId: string,
    userId: string,
    { cliente, items, notas, condicionesPago, fechaVencimiento, moneda = 'ARS', tipoCambioTasa = 1, descuentoGlobal = 0 }: CreateCotizacionPayload
  ): Promise<Cotizacion> {
    const { data: numData, error: numError } = await supabase
      .rpc('obtener_proximo_numero', { p_empresa_id: empresaId, p_tipo_documento: 'cotizacion' });
    if (numError) throw new Error(numError.message);

    const subtotal = items.reduce((s, i) => {
      const bruto = (Number(i.cantidad) || 0) * (Number(i.precio_unitario) || 0);
      const descPct = Number(i.descuento_item) || 0;
      return s + bruto * (1 - descPct / 100);
    }, 0);
    // El descuento global se aplica DESPUÉS de los descuentos por línea — mismo orden que
    // SAP: primero línea, después documento. Nunca al revés (duplicaría el descuento).
    const total = subtotal * (1 - (Number(descuentoGlobal) || 0) / 100);

    const { data: cot, error: cotError } = await supabase
      .from('cotizaciones')
      .insert([{
        empresa_id: empresaId,
        user_id: userId,
        numero: numData as string,
        cliente_id: cliente?.id ?? null,
        cliente_nombre: cliente?.nombre ?? null,
        subtotal,
        descuento: Number(descuentoGlobal) || 0,
        total,
        notas: notas ?? null,
        condiciones_pago: condicionesPago ?? null,
        fecha_vencimiento: fechaVencimiento ?? null,
        moneda,
        tipo_cambio_tasa: tipoCambioTasa,
        estado: 'borrador' as CotizacionEstado,
      }])
      .select()
      .single();
    if (cotError) throw new Error(cotError.message);

    const detalles = items.map((item) => {
      const cantidad = parseFloat(String(item.cantidad));
      const precioUnitario = parseFloat(String(item.precio_unitario));
      const descuentoItem = parseFloat(String(item.descuento_item ?? 0));
      return {
        cotizacion_id: (cot as Cotizacion).id,
        empresa_id: empresaId,
        producto_id: item.producto_id ?? null,
        descripcion: item.descripcion ?? '',
        cantidad,
        precio_unitario: precioUnitario,
        descuento_item: descuentoItem,
        subtotal: cantidad * precioUnitario * (1 - descuentoItem / 100),
        unidad_medida: item.unidad_medida ?? null,
        alicuota_iva: item.alicuota_iva ?? '21',
      };
    });

    const { error: detError } = await supabase.from('cotizacion_items').insert(detalles);
    if (detError) throw new Error(detError.message);

    return cot as Cotizacion;
  },

  // Solo editable mientras la cotización no esté "convertida" — la RPC lo revalida server-side
  // (no confiar solo en que el frontend oculte el botón). Manda el `id` de cada ítem existente
  // (mig.319) para que la RPC pueda diffear fila por fila en vez de borrar y recrear todo en
  // cada guardado — eso generaba un historial de auditoría ilegible (todos los ítems como
  // "quitado"+"agregado" en cada edición, aunque no hubieran cambiado).
  async update(
    cotizacionId: string,
    { cliente, items, notas, condicionesPago, fechaVencimiento, moneda = 'ARS', tipoCambioTasa = 1, descuentoGlobal = 0 }: UpdateCotizacionPayload
  ): Promise<Cotizacion> {
    const itemsPayload = items.map((item) => ({
      id: item.id ?? null,
      producto_id: item.producto_id ?? null,
      descripcion: item.descripcion ?? '',
      cantidad: parseFloat(String(item.cantidad)) || 0,
      precio_unitario: parseFloat(String(item.precio_unitario)) || 0,
      descuento_item: parseFloat(String(item.descuento_item ?? 0)) || 0,
      unidad_medida: item.unidad_medida ?? null,
      alicuota_iva: item.alicuota_iva ?? '21',
    }));

    const { data, error } = await supabase.rpc('actualizar_cotizacion', {
      p_cotizacion_id: cotizacionId,
      p_cliente_id: cliente?.id ?? null,
      p_cliente_nombre: cliente?.nombre ?? null,
      p_items: itemsPayload,
      p_notas: notas ?? null,
      p_condiciones_pago: condicionesPago ?? null,
      p_fecha_vencimiento: fechaVencimiento ?? null,
      p_moneda: moneda,
      p_tipo_cambio_tasa: tipoCambioTasa,
      p_descuento: Number(descuentoGlobal) || 0,
    });
    if (error) throw new Error(error.message);
    return data as Cotizacion;
  },

  // Historial de cambios — junta auditoría de cabecera (cotizaciones) e ítems
  // (cotizacion_items, filtrados por cotizacion_id dentro del JSONB porque su
  // propio registro_id es el id del ítem, no el de la cotización) y devuelve
  // todo ordenado por fecha, más reciente primero.
  async getHistorial(cotizacionId: string): Promise<HistorialEntry[]> {
    const [cabeceraRes, itemsRes] = await Promise.all([
      supabase
        .from('audit_log')
        .select('id, tabla, operacion, old_data, new_data, user_id, created_at')
        .eq('tabla', 'cotizaciones')
        .eq('registro_id', cotizacionId),
      supabase
        .from('audit_log')
        .select('id, tabla, operacion, old_data, new_data, user_id, created_at')
        .eq('tabla', 'cotizacion_items')
        .or(`old_data->>cotizacion_id.eq.${cotizacionId},new_data->>cotizacion_id.eq.${cotizacionId}`),
    ]);
    if (cabeceraRes.error) throw new Error(cabeceraRes.error.message);
    if (itemsRes.error) throw new Error(itemsRes.error.message);

    return [...(cabeceraRes.data ?? []), ...(itemsRes.data ?? [])]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) as HistorialEntry[];
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

  async convertir(cotizacionId: string, comprobanteId: string): Promise<void> {
    const { error } = await supabase
      .from('cotizaciones')
      .update({ estado: 'convertida' as CotizacionEstado, comprobante_id: comprobanteId })
      .eq('id', cotizacionId);
    if (error) throw new Error(error.message);
  },
};

export const COTIZACIONES_KEYS = {
  list: (empresaId: string, filters?: GetAllFilters) => ['cotizaciones', empresaId, filters] as const,
  detail: (id: string) => ['cotizacion', id] as const,
};
