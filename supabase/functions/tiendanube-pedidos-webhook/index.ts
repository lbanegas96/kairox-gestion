import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient } from '../_shared/auth.ts';
import { leerTokenCanal } from '../_shared/integraciones.ts';

/**
 * Webhook de pedidos de Tiendanube (evento order/paid — se registra desde
 * tiendanube-registrar-webhooks). Cuando un pedido se paga, cae acá y se crea
 * un PEDIDO en estado 'borrador' en KAIROX para que el operador lo revise y
 * recién ahí lo convierta en venta (decisión de negocio: NADA fiscal se genera
 * solo — el precio, el cliente y la factura AFIP los define el humano al confirmar).
 *
 * El payload de Tiendanube es mínimo — {store_id, event, id} — así que hay que
 * pedir el detalle con GET /orders/{id}. Firma: x-linkedstore-hmac-sha256 =
 * HMAC-SHA256(body crudo, TIENDANUBE_CLIENT_SECRET) en hex.
 *
 * Idempotencia: el índice único uq_pedidos_canal_externo (migración 232) +
 * el chequeo previo evitan que un webhook reenviado duplique el pedido.
 */
const TN_API_BASE = 'https://api.tiendanube.com/2025-03';
const USER_AGENT = 'KAIROX Gestion (soporte@kairox.app)';

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
  if (!storeId || !orderId) return new Response('Bad Request', { status: 400 });

  try {
    // Resolver la integración por store_id
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

    // Idempotencia: ¿ya existe el pedido para esta orden?
    const { data: existente } = await adminClient
      .from('pedidos')
      .select('id')
      .eq('empresa_id', integracion.empresa_id)
      .eq('canal_externo', 'tiendanube')
      .eq('external_order_id', orderId)
      .maybeSingle();

    if (existente) {
      console.log('[tiendanube-pedidos-webhook] Pedido ya existente (dedup):', orderId);
      return new Response(JSON.stringify({ ok: true, duplicate: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Traer el detalle de la orden
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

    // Mapa variante Tiendanube → producto KAIROX
    const { data: mapeos } = await adminClient
      .from('integraciones_producto_mapeo')
      .select('external_id, producto_id')
      .eq('integracion_id', integracion.id);
    const porVariante = new Map((mapeos ?? []).map(m => [String(m.external_id), m.producto_id]));

    // Usuario admin de la empresa para atribuir el pedido (user_id NOT NULL)
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
      return new Response('ok', { status: 200 });
    }

    // Numerar el pedido (service_role bypass, migración 232)
    const { data: numero, error: numError } = await adminClient.rpc('obtener_proximo_numero', {
      p_empresa_id: integracion.empresa_id,
      p_tipo_documento: 'pedido',
    });
    if (numError || !numero) {
      console.error('[tiendanube-pedidos-webhook] Error numerando:', numError);
      return new Response('Error', { status: 500 });
    }

    const productos = Array.isArray(orden.products) ? orden.products : [];
    let sinMapear = 0;
    const total = Number(orden.total) || 0;

    // Insertar el pedido cabecera
    const { data: pedido, error: pedError } = await adminClient
      .from('pedidos')
      .insert({
        empresa_id: integracion.empresa_id,
        user_id: adminProfile.id,
        numero,
        cliente_nombre: orden.customer?.name ?? 'Cliente Tiendanube',
        estado: 'borrador',
        subtotal: total,
        total,
        canal_externo: 'tiendanube',
        external_order_id: orderId,
        notas: `Pedido importado de Tiendanube (orden #${orden.number ?? orderId}). Revisar y confirmar para facturar.`,
      })
      .select('id')
      .single();

    if (pedError) {
      // Si otro webhook concurrente ganó la carrera, el índice único lo rechaza → tratamos como dedup
      if (pedError.code === '23505') {
        console.log('[tiendanube-pedidos-webhook] Carrera resuelta por índice único (dedup):', orderId);
        return new Response(JSON.stringify({ ok: true, duplicate: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        });
      }
      console.error('[tiendanube-pedidos-webhook] Error insertando pedido:', pedError);
      return new Response('Error', { status: 500 });
    }

    // Insertar los items
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
        // El pedido cabecera ya existe — no lo borramos, el operador lo verá aunque falten items.
      }
    }

    console.log(`[tiendanube-pedidos-webhook] ✓ Pedido ${numero} creado — orden ${orderId}, ${items.length} items, ${sinMapear} sin mapear`);
    return new Response(JSON.stringify({ ok: true, pedido_id: pedido.id, sin_mapear: sinMapear }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[tiendanube-pedidos-webhook] Error inesperado:', e);
    return new Response('Error', { status: 500 });
  }
});
