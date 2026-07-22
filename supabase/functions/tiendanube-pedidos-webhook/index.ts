import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient } from '../_shared/auth.ts';
import { leerTokenCanal } from '../_shared/integraciones.ts';

/**
 * Webhook de pedidos de Tiendanube — escucha los 3 eventos del ciclo de vida
 * de un pedido (order/created, order/paid, order/cancelled), registrados desde
 * integraciones-oauth-callback. Mismo criterio que una Orden de Venta en un ERP
 * (SAP, etc.): el pedido existe como documento comercial en cuanto se crea —no
 * recién cuando se paga— y va avanzando de estado. NADA fiscal se genera solo:
 * el operador revisa y confirma la venta/factura a mano en KAIROX.
 *
 * Mapeo de estados (pedidos.estado):
 *   order/created (sin pagar todavía) → 'borrador'
 *   order/created con payment_status ya 'paid' (raro, orden de llegada) → 'confirmado'
 *   order/paid  → 'confirmado' (equivalente a "reservado/listo para facturar")
 *   order/cancelled → 'cancelado'
 *
 * El payload de Tiendanube es mínimo — {store_id, event, id} — hay que pedir
 * el detalle con GET /orders/{id}. Firma: x-linkedstore-hmac-sha256 =
 * HMAC-SHA256(body crudo, TIENDANUBE_CLIENT_SECRET) en hex.
 *
 * Idempotencia: índice único uq_pedidos_canal_externo (migración 232) — un
 * mismo pedido externo nunca se duplica, los eventos posteriores lo actualizan.
 */
const TN_API_BASE = 'https://api.tiendanube.com/2025-03';
const USER_AGENT = 'KAIROX Gestion (soporte@kairox.app)';

// Estados desde los que NO tiene sentido retroceder si llega un evento viejo
// fuera de orden (ej. order/paid reintentado después de que el operador ya facturó).
const ESTADOS_FINALES = new Set(['facturado', 'cancelado']);

async function verificarFirma(rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const secret = Deno.env.get('TIENDANUBE_CLIENT_SECRET');
  if (!secret) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const hash = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hash === header;
}

function nombreCliente(orden: Record<string, unknown>): string {
  const cliente = (orden.customer as Record<string, unknown>) ?? {};
  return (
    (cliente.name as string) ||
    [cliente.first_name, cliente.last_name].filter(Boolean).join(' ').trim() ||
    'Cliente Tiendanube'
  );
}

async function crearPedido(
  integracion: { id: string; empresa_id: string },
  orden: Record<string, unknown>,
  orderId: string,
  estadoInicial: 'borrador' | 'confirmado',
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
    console.error('[tiendanube-pedidos-webhook] Sin admin para empresa:', integracion.empresa_id);
    return null;
  }

  const { data: numero, error: numError } = await adminClient.rpc('obtener_proximo_numero', {
    p_empresa_id: integracion.empresa_id,
    p_tipo_documento: 'pedido',
  });
  if (numError || !numero) {
    console.error('[tiendanube-pedidos-webhook] Error numerando:', numError);
    return null;
  }

  const productos = Array.isArray(orden.products) ? orden.products : [];
  const total = Number(orden.total) || 0;
  const notaEstado = estadoInicial === 'confirmado'
    ? 'Pago recibido en Tiendanube — listo para revisar y facturar.'
    : 'Pedido recién creado en Tiendanube, todavía sin pago confirmado.';

  const { data: pedido, error: pedError } = await adminClient
    .from('pedidos')
    .insert({
      empresa_id: integracion.empresa_id,
      user_id: adminProfile.id,
      numero,
      cliente_nombre: nombreCliente(orden),
      estado: estadoInicial,
      subtotal: total,
      total,
      canal_externo: 'tiendanube',
      external_order_id: orderId,
      notas: `Pedido importado de Tiendanube (orden #${orden.number ?? orderId}). ${notaEstado}`,
    })
    .select('id')
    .single();

  if (pedError) {
    if (pedError.code === '23505') {
      console.log('[tiendanube-pedidos-webhook] Carrera resuelta por índice único (dedup):', orderId);
      return null;
    }
    console.error('[tiendanube-pedidos-webhook] Error insertando pedido:', pedError);
    return null;
  }

  let sinMapear = 0;
  const items = productos.map((p: Record<string, unknown>) => {
    const varId = p.variant_id != null ? String(p.variant_id) : '';
    const productoId = porVariante.get(varId) ?? null;
    if (!productoId) sinMapear++;
    const cantidad = Number(p.quantity) || 1;
    const precio = Number(p.price) || 0;
    return {
      pedido_id: pedido.id,
      empresa_id: integracion.empresa_id,
      producto_id: productoId,
      descripcion: String(p.name ?? 'Producto'),
      cantidad,
      precio_unitario: precio,
      subtotal: Math.round(precio * cantidad * 100) / 100,
    };
  });

  if (items.length > 0) {
    const { error: itemsError } = await adminClient.from('pedido_items').insert(items);
    if (itemsError) {
      console.error('[tiendanube-pedidos-webhook] Error insertando items:', itemsError);
    }
  }

  return { pedidoId: pedido.id, sinMapear };
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const rawBody = await req.text();
  if (!await verificarFirma(rawBody, req.headers.get('x-linkedstore-hmac-sha256'))) {
    console.error('[tiendanube-pedidos-webhook] Firma inválida');
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: { store_id?: number | string; event?: string; id?: number | string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const storeId = payload.store_id != null ? String(payload.store_id) : null;
  const orderId = payload.id != null ? String(payload.id) : null;
  const evento = payload.event;
  if (!storeId || !orderId || !evento) return new Response('Bad Request', { status: 400 });

  try {
    const { data: integracion } = await adminClient
      .from('integraciones_canales')
      .select('id, empresa_id')
      .eq('canal', 'tiendanube')
      .eq('external_store_id', storeId)
      .eq('activo', true)
      .maybeSingle();

    if (!integracion) {
      console.warn('[tiendanube-pedidos-webhook] Sin integración activa para store_id:', storeId);
      return new Response('ok', { status: 200 }); // no reintentar: no es error de Tiendanube
    }

    const { data: existente } = await adminClient
      .from('pedidos')
      .select('id, estado')
      .eq('empresa_id', integracion.empresa_id)
      .eq('canal_externo', 'tiendanube')
      .eq('external_order_id', orderId)
      .maybeSingle();

    // ── order/cancelled ────────────────────────────────────────────────────
    if (evento === 'order/cancelled') {
      if (!existente) {
        console.log('[tiendanube-pedidos-webhook] cancelled sin pedido previo (nada que hacer):', orderId);
        return new Response('ok', { status: 200 });
      }
      if (ESTADOS_FINALES.has(existente.estado)) {
        console.log('[tiendanube-pedidos-webhook] cancelled ignorado — pedido ya en estado final:', existente.estado);
        return new Response('ok', { status: 200 });
      }
      const { error } = await adminClient.from('pedidos').update({ estado: 'cancelado' }).eq('id', existente.id);
      if (error) console.error('[tiendanube-pedidos-webhook] Error cancelando pedido:', error);
      else console.log('[tiendanube-pedidos-webhook] ✓ Pedido cancelado:', orderId);
      return new Response('ok', { status: 200 });
    }

    // ── order/created y order/paid: si ya existe, solo order/paid lo actualiza ──
    if (existente) {
      if (evento !== 'order/paid') {
        console.log(`[tiendanube-pedidos-webhook] ${evento} — pedido ya existente (dedup):`, orderId);
        return new Response(JSON.stringify({ ok: true, duplicate: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      if (ESTADOS_FINALES.has(existente.estado)) {
        console.log('[tiendanube-pedidos-webhook] paid ignorado — pedido ya en estado final:', existente.estado);
        return new Response('ok', { status: 200 });
      }
      const { error } = await adminClient
        .from('pedidos')
        .update({
          estado: 'confirmado',
          notas: `Pago confirmado en Tiendanube (orden #${orderId}) — listo para revisar y facturar.`,
        })
        .eq('id', existente.id);
      if (error) console.error('[tiendanube-pedidos-webhook] Error actualizando a confirmado:', error);
      else console.log('[tiendanube-pedidos-webhook] ✓ Pedido confirmado (pago recibido):', orderId);
      return new Response('ok', { status: 200 });
    }

    // ── No existe todavía: traer el detalle y crearlo ───────────────────────
    const token = await leerTokenCanal(integracion.empresa_id, 'tiendanube');
    if (!token) {
      console.error('[tiendanube-pedidos-webhook] Sin token para empresa:', integracion.empresa_id);
      return new Response('ok', { status: 200 });
    }

    const ordRes = await fetch(`${TN_API_BASE}/${storeId}/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT },
    });
    if (!ordRes.ok) {
      console.error('[tiendanube-pedidos-webhook] Error GET order:', ordRes.status);
      return new Response('Error', { status: 500 }); // 5xx → Tiendanube reintenta
    }
    const orden = await ordRes.json();

    // order/paid llegando sin created previo (registro tardío del webhook, etc.)
    // o order/created con el pedido ya pagado al momento de crearlo: mismo resultado.
    const estadoInicial = (evento === 'order/paid' || orden.payment_status === 'paid') ? 'confirmado' : 'borrador';

    const resultado = await crearPedido(integracion, orden, orderId, estadoInicial);
    if (!resultado) return new Response('Error', { status: 500 });

    console.log(`[tiendanube-pedidos-webhook] ✓ Pedido creado (${estadoInicial}) — orden ${orderId}, ${resultado.sinMapear} sin mapear`);
    return new Response(JSON.stringify({ ok: true, pedido_id: resultado.pedidoId, sin_mapear: resultado.sinMapear }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[tiendanube-pedidos-webhook] Error inesperado:', e);
    return new Response('Error', { status: 500 });
  }
});
