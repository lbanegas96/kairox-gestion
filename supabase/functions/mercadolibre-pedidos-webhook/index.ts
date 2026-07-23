import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient } from '../_shared/auth.ts';
import { obtenerTokenValido } from '../_shared/integraciones.ts';

/**
 * Webhook de órdenes de MercadoLibre — recibe las notificaciones del tópico
 * `orders_v2` (configurado a nivel APP en el panel de MercadoLibre Developers,
 * apuntando a esta función). Mismo criterio de negocio que Tiendanube: la orden
 * entra como `pedido` para que el operador la revise y recién ahí la convierta en
 * venta/factura. NADA fiscal se genera solo.
 *
 * Diferencias con Tiendanube:
 *  - MELI NO firma las notificaciones (no hay HMAC). La seguridad viene de que el
 *    payload solo trae {resource, user_id, topic, application_id} — el dato real
 *    se re-consulta con NUESTRO token (GET /orders/{id}), así que una notificación
 *    falsa no puede inyectar datos, a lo sumo dispara un fetch. Igual validamos
 *    application_id === MELI_APP_ID como defensa extra.
 *  - La notificación es mínima: hay que pedir el detalle con GET /orders/{id}.
 *  - external_store_id = user_id del vendedor en MELI (no un store_id de tienda).
 *
 * Mapeo de estados MELI (order.status) → pedidos.estado:
 *   paid                                          → 'confirmado'
 *   cancelled                                     → 'cancelado'
 *   confirmed / payment_required /
 *   payment_in_process / partially_paid / *       → 'borrador'
 *
 * Idempotencia: índice único uq_pedidos_canal_externo (migración 232) — la orden
 * externa no se duplica; notificaciones repetidas (MELI reintenta) la actualizan.
 */
const ML_API_BASE = 'https://api.mercadolibre.com';

// Estados desde los que NO se retrocede si llega una notificación fuera de orden
// (ej. una 'paid' vieja reintentada después de que el operador ya facturó).
const ESTADOS_FINALES = new Set(['facturado', 'cancelado']);

type EstadoPedido = 'borrador' | 'confirmado' | 'cancelado';

// Traduce el status de la orden de MELI al estado del pedido en KAIROX.
function mapearEstado(statusMeli: unknown): EstadoPedido {
  if (statusMeli === 'paid') return 'confirmado';
  if (statusMeli === 'cancelled') return 'cancelado';
  return 'borrador';
}

function nombreCliente(buyer: Record<string, unknown> | undefined): string {
  const b = buyer ?? {};
  return (
    [b.first_name, b.last_name].filter(Boolean).join(' ').trim() ||
    (b.nickname as string) ||
    'Cliente MercadoLibre'
  );
}

// external_id con el que se guardó el mapeo: id de la variación si la publicación
// tiene variaciones, si no el id del ítem (mismo criterio que mercadolibre-catalogo).
function externalIdDeItem(item: Record<string, unknown>): string {
  const varId = item?.variation_id;
  if (varId != null && varId !== 0 && varId !== '') return String(varId);
  return String(item?.id ?? '');
}

async function crearPedido(
  integracion: { id: string; empresa_id: string },
  orden: Record<string, unknown>,
  orderId: string,
  estadoInicial: EstadoPedido,
): Promise<{ pedidoId: string; sinMapear: number } | null> {
  const { data: mapeos } = await adminClient
    .from('integraciones_producto_mapeo')
    .select('external_id, producto_id')
    .eq('integracion_id', integracion.id);
  const porVariante = new Map((mapeos ?? []).map(m => [String(m.external_id), m.producto_id]));

  const { data: adminProfile } = await adminClient
    .from('profiles')
    .select('id')
    .eq('empresa_id', integracion.empresa_id)
    .eq('role', 'admin')
    .eq('active', true)
    .limit(1)
    .maybeSingle();
  if (!adminProfile) {
    console.error('[mercadolibre-pedidos-webhook] Sin admin para empresa:', integracion.empresa_id);
    return null;
  }

  const { data: numero, error: numError } = await adminClient.rpc('obtener_proximo_numero', {
    p_empresa_id: integracion.empresa_id,
    p_tipo_documento: 'pedido',
  });
  if (numError || !numero) {
    console.error('[mercadolibre-pedidos-webhook] Error numerando:', numError);
    return null;
  }

  const orderItems = Array.isArray(orden.order_items) ? orden.order_items : [];
  const total = Number(orden.total_amount) || 0;
  const notaEstado = estadoInicial === 'confirmado'
    ? 'Pago recibido en MercadoLibre — listo para revisar y facturar.'
    : 'Orden creada en MercadoLibre, todavía sin pago confirmado.';

  const { data: pedido, error: pedError } = await adminClient
    .from('pedidos')
    .insert({
      empresa_id: integracion.empresa_id,
      user_id: adminProfile.id,
      numero,
      cliente_nombre: nombreCliente(orden.buyer as Record<string, unknown>),
      estado: estadoInicial,
      subtotal: total,
      total,
      canal_externo: 'mercadolibre',
      external_order_id: orderId,
      notas: `Pedido importado de MercadoLibre (orden #${orderId}). ${notaEstado}`,
    })
    .select('id')
    .single();

  if (pedError) {
    if (pedError.code === '23505') {
      console.log('[mercadolibre-pedidos-webhook] Carrera resuelta por índice único (dedup):', orderId);
      return null;
    }
    console.error('[mercadolibre-pedidos-webhook] Error insertando pedido:', pedError);
    return null;
  }

  let sinMapear = 0;
  const items = orderItems.map((oi: Record<string, unknown>) => {
    const item = (oi.item as Record<string, unknown>) ?? {};
    const extId = externalIdDeItem(item);
    const productoId = porVariante.get(extId) ?? null;
    if (!productoId) sinMapear++;
    const cantidad = Number(oi.quantity) || 1;
    const precio = Number(oi.unit_price) || 0;
    return {
      pedido_id: pedido.id,
      empresa_id: integracion.empresa_id,
      producto_id: productoId,
      descripcion: String(item.title ?? 'Producto'),
      cantidad,
      precio_unitario: precio,
      subtotal: Math.round(precio * cantidad * 100) / 100,
    };
  });

  if (items.length > 0) {
    const { error: itemsError } = await adminClient.from('pedido_items').insert(items);
    if (itemsError) {
      console.error('[mercadolibre-pedidos-webhook] Error insertando items:', itemsError);
    }
  }

  return { pedidoId: pedido.id, sinMapear };
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let payload: {
    resource?: string;
    user_id?: number | string;
    topic?: string;
    application_id?: number | string;
  };
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // Defensa extra (MELI no firma): la notificación tiene que ser de NUESTRA app.
  const appId = Deno.env.get('MELI_APP_ID');
  if (appId && payload.application_id != null && String(payload.application_id) !== appId) {
    console.warn('[mercadolibre-pedidos-webhook] application_id ajeno, ignorado:', payload.application_id);
    return new Response('ok', { status: 200 });
  }

  // Solo nos interesan las notificaciones de órdenes.
  if (payload.topic && payload.topic !== 'orders_v2' && payload.topic !== 'orders') {
    return new Response('ok', { status: 200 });
  }

  const userId = payload.user_id != null ? String(payload.user_id) : null;
  const orderId = payload.resource ? payload.resource.split('/').filter(Boolean).pop() ?? null : null;
  if (!userId || !orderId) return new Response('Bad Request', { status: 400 });

  try {
    const { data: integracion } = await adminClient
      .from('integraciones_canales')
      .select('id, empresa_id')
      .eq('canal', 'mercadolibre')
      .eq('external_store_id', userId)
      .eq('activo', true)
      .maybeSingle();

    if (!integracion) {
      console.warn('[mercadolibre-pedidos-webhook] Sin integración activa para user_id:', userId);
      return new Response('ok', { status: 200 }); // no reintentar: no es error de MELI
    }

    const token = await obtenerTokenValido(integracion.empresa_id, 'mercadolibre');
    if (!token) {
      console.error('[mercadolibre-pedidos-webhook] Sin token para empresa:', integracion.empresa_id);
      return new Response('ok', { status: 200 });
    }

    const ordRes = await fetch(`${ML_API_BASE}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!ordRes.ok) {
      console.error('[mercadolibre-pedidos-webhook] Error GET order:', ordRes.status, await ordRes.text());
      return new Response('Error', { status: 500 }); // 5xx → MELI reintenta
    }
    const orden = await ordRes.json();
    const estado = mapearEstado(orden.status);

    const { data: existente } = await adminClient
      .from('pedidos')
      .select('id, estado')
      .eq('empresa_id', integracion.empresa_id)
      .eq('canal_externo', 'mercadolibre')
      .eq('external_order_id', orderId)
      .maybeSingle();

    // ── Ya existe: actualizar estado si corresponde ─────────────────────────
    if (existente) {
      if (ESTADOS_FINALES.has(existente.estado)) {
        console.log('[mercadolibre-pedidos-webhook] ignorado — pedido ya en estado final:', existente.estado);
        return new Response('ok', { status: 200 });
      }
      if (existente.estado === estado) {
        console.log('[mercadolibre-pedidos-webhook] sin cambio de estado (dedup):', orderId);
        return new Response(JSON.stringify({ ok: true, duplicate: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      const nota = estado === 'confirmado'
        ? `Pago confirmado en MercadoLibre (orden #${orderId}) — listo para revisar y facturar.`
        : estado === 'cancelado'
          ? `Orden cancelada en MercadoLibre (orden #${orderId}).`
          : `Orden actualizada en MercadoLibre (orden #${orderId}).`;
      const { error } = await adminClient
        .from('pedidos')
        .update({ estado, notas: nota })
        .eq('id', existente.id);
      if (error) console.error('[mercadolibre-pedidos-webhook] Error actualizando estado:', error);
      else console.log(`[mercadolibre-pedidos-webhook] ✓ Pedido → ${estado}:`, orderId);
      return new Response('ok', { status: 200 });
    }

    // ── No existe: si la orden ya nace cancelada, no creamos nada ────────────
    if (estado === 'cancelado') {
      console.log('[mercadolibre-pedidos-webhook] cancelled sin pedido previo (nada que hacer):', orderId);
      return new Response('ok', { status: 200 });
    }

    const resultado = await crearPedido(integracion, orden, orderId, estado);
    if (!resultado) return new Response('Error', { status: 500 });

    console.log(`[mercadolibre-pedidos-webhook] ✓ Pedido creado (${estado}) — orden ${orderId}, ${resultado.sinMapear} sin mapear`);
    return new Response(JSON.stringify({ ok: true, pedido_id: resultado.pedidoId, sin_mapear: resultado.sinMapear }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[mercadolibre-pedidos-webhook] Error inesperado:', e);
    return new Response('Error', { status: 500 });
  }
});
