import { supabase } from '@/lib/customSupabaseClient';
import { getNowAR } from '@/lib/dateUtils';

export interface ItemNC {
  produto_id: string;       // Portuguese — comprobante_items schema
  nombre: string;
  cantidadOriginal: number;
  cantidadDevolver: number;
  precio_unitario: number;
  subtotal: number;
}

export interface CrearNCPayload {
  empresaId: string;
  userId: string;
  tenantId: string;
  comprobanteOrigenId: string;
  comprobanteOrigenNumero: string;
  clienteId: string | null;
  clienteNombre: string;
  formaPago: string;        // método original (para saber si revertir CC o caja)
  items: ItemNC[];
  motivoNC: string;
  totalNC: number;
}

/**
 * Crea una Nota de Crédito con reversión completa:
 * - Inserta comprobante tipo='nota_credito'
 * - Inserta comprobante_items de la NC
 * - Revierte stock (incrementa los produtos devueltos)
 * - Si formaPago='Cuenta Corriente': crea HABER en cuenta_corriente_movimientos
 * - Si efectivo: crea egreso en movimientos_caja (cash refund)
 * - Marca el comprobante original como 'cancelada' (si devolución total)
 */
export async function crearNotaCredito(payload: CrearNCPayload, cajaSessionId?: string): Promise<string> {
  const {
    empresaId, userId, tenantId, comprobanteOrigenId, comprobanteOrigenNumero,
    clienteId, clienteNombre, formaPago, items, motivoNC, totalNC
  } = payload;

  // 1. Generar número de NC
  const numeroNC = await generarNumeroNC(empresaId);

  // 2. Insertar comprobante NC
  const { data: nc, error: ncError } = await supabase
    .from('comprobantes')
    .insert([{
      empresa_id: empresaId,
      tenant_id: tenantId,
      cliente_id: clienteId,
      cliente_nombre: clienteNombre,
      numero_venta: numeroNC,
      fecha: getNowAR().toISOString(),
      total: totalNC,
      forma_pago: formaPago,
      tipo: 'nota_credito',
      estado_pago: 'pagada',
      comprobante_origen_id: comprobanteOrigenId,
      motivo_nc: motivoNC || `NC sobre comprobante ${comprobanteOrigenNumero}`,
    }])
    .select('id')
    .single();

  if (ncError) throw ncError;
  const ncId = nc.id;

  // 3. Insertar items de NC (usando columnas portuguesas del schema)
  const itemsNC = items
    .filter(i => i.cantidadDevolver > 0)
    .map(i => ({
      empresa_id: empresaId,
      comprobante_id: ncId,
      produto_id: i.produto_id,
      quantidade: i.cantidadDevolver,
      precio_unitario: i.precio_unitario,
      subtotal: i.cantidadDevolver * i.precio_unitario,
    }));

  if (itemsNC.length > 0) {
    const { error: itemsError } = await supabase
      .from('comprobante_items')
      .insert(itemsNC);
    if (itemsError) throw itemsError;
  }

  // 4. Revertir stock — incrementar por cada item devuelto
  for (const item of items.filter(i => i.cantidadDevolver > 0)) {
    // Movimiento de inventario (entrada por devolución)
    await supabase.from('movimientos_inventario').insert([{
      empresa_id: empresaId,
      user_id: tenantId,
      produto_id: item.produto_id,
      tipo: 'entrada',
      quantidade: item.cantidadDevolver,
      motivo: `Devolución NC ${numeroNC} — ${motivoNC || 'Nota de crédito'}`,
    }]);

    // Incrementar stock en products table
    await supabase.rpc('increment_stock', {
      p_produto_id: item.produto_id,
      p_quantidade: item.cantidadDevolver,
    }).catch(() => {
      // Fallback manual si RPC no existe
      supabase.from('produtos')
        .select('stock_atual')
        .eq('id', item.produto_id)
        .single()
        .then(({ data }) => {
          if (data) {
            supabase.from('produtos')
              .update({ stock_atual: (data.stock_atual || 0) + item.cantidadDevolver })
              .eq('id', item.produto_id);
          }
        });
    });
  }

  // 5. Reversión financiera según método de pago original
  if (formaPago === 'Cuenta Corriente' && clienteId) {
    // HABER en CC — reduce la deuda del cliente
    await supabase.from('cuenta_corriente_movimientos').insert([{
      empresa_id: empresaId,
      cliente_id: clienteId,
      tipo: 'HABER',
      monto: totalNC,
      descripcion: `Nota de Crédito ${numeroNC} — ${motivoNC || 'Devolución'}`,
      comprobante_id: ncId,
      metodo_cobro: 'Nota de Crédito',
    }]);
  } else if (cajaSessionId && ['Efectivo', 'Transferencia', 'Tarjeta'].includes(formaPago)) {
    // Egreso de caja — devolvemos dinero al cliente
    await supabase.from('movimientos_caja').insert([{
      user_id: empresaId,
      empresa_id: empresaId,
      caja_sesion_id: cajaSessionId,
      tipo: 'egreso',
      monto: totalNC,
      categoria: 'Nota de Crédito',
      descripcion: `Devolución NC ${numeroNC} — ${clienteNombre}`,
      metodo_pago: formaPago,
    }]);
  }

  // 6. Marcar comprobante original como cancelado
  // (solo si es devolución total — lo verifica el caller)
  // Se actualiza en SaleDetailModal después de crear la NC

  return ncId;
}

async function generarNumeroNC(empresaId: string): Promise<string> {
  // Contar NCs existentes para esta empresa
  const { count } = await supabase
    .from('comprobantes')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId)
    .eq('tipo', 'nota_credito');

  const num = ((count ?? 0) + 1).toString().padStart(5, '0');
  return `NC-${num}`;
}

/**
 * Obtiene los items de un comprobante para pre-cargar en el modal NC
 */
export async function getItemsComprobante(comprobanteId: string) {
  const { data, error } = await supabase
    .from('comprobante_items')
    .select('produto_id, quantidade, precio_unitario, subtotal, produtos(nome)')
    .eq('comprobante_id', comprobanteId);

  if (error) throw error;

  return (data || []).map((item: any) => ({
    produto_id: item.produto_id,
    nombre: item.produtos?.nome || 'Producto',
    cantidadOriginal: Number(item.quantidade || 0),
    cantidadDevolver: Number(item.quantidade || 0), // default: devolver todo
    precio_unitario: Number(item.precio_unitario || 0),
    subtotal: Number(item.subtotal || 0),
  }));
}

/**
 * Marca el comprobante original como cancelado (devolución total)
 */
export async function cancelarComprobante(comprobanteId: string): Promise<void> {
  const { error } = await supabase
    .from('comprobantes')
    .update({ estado_pago: 'cancelada' })
    .eq('id', comprobanteId);
  if (error) throw error;
}
