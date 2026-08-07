/**
 * mp-qr-crear — genera un cobro con QR Dinámico de MercadoPago para el POS.
 *
 * Llamada por cualquier usuario autenticado con permiso de módulo ventas
 * (no sólo admin — es parte del checkout normal del cajero). Dos clientes
 * Supabase separados a propósito:
 *   - `userClient` (JWT del caller): para llamar `crear_venta_pendiente_qr`,
 *     así `auth.uid()`/`get_my_empresa_id()`/`has_module_permission('ventas')`
 *     se resuelven adentro del RPC exactamente igual que cualquier venta del
 *     frontend — la autorización real vive en el RPC, no acá.
 *   - `adminClient` (service_role): para leer el Access Token de Vault
 *     (`vault_secret_read` es service_role-only, mig.113) y llamar a la API
 *     de MercadoPago — el token nunca pasa por el navegador.
 *
 * Sin dependencia de _shared/auth.ts (helpers CORS/respuesta inline acá para
 * evitar el problema de resolución de rutas del bundler de deploy) — mismo
 * comportamiento, sin import cruzado.
 *
 * Flujo:
 *   1. crear_venta_pendiente_qr (RPC) → comprobante pendiente + external_reference
 *   2. Alta de tienda+caja en MP (una sola vez por empresa, se persiste en
 *      integraciones_bancarias.config junto a mp_user_id/webhook_secret)
 *   3. Crear la orden QR dinámica → qr_data (string EMVCo)
 *   4. Guardar qr_data/in_store_order_id en qr_pagos_mp
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MP_API_BASE          = 'https://api.mercadopago.com';

const ALLOWED_ORIGINS = new Set<string>([
  Deno.env.get('SITE_URL') || '',
  'https://kairox-gestion-chi.vercel.app',
  'https://kairox-gestion.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
].filter(Boolean));

// Vercel emite una URL nueva y única por cada `vercel deploy` (ej.
// kairox-gestion-4x0kytc7g-k-gestion.vercel.app), además de alias estables como
// kairox-gestion-chi.vercel.app. Sin este patrón, cualquiera que entre por la URL
// específica de un deploy se encuentra con CORS roto acá aunque la app cargue
// perfecto (bug real encontrado por Luciano, 07/08 — el QR no se pudo cobrar por
// esto exacto). Mismo patrón que _shared/auth.ts — este archivo tiene su propia
// copia porque no importa el helper compartido (ver comentario del bloque de arriba).
const VERCEL_DEPLOY_ORIGIN_RE = /^https:\/\/kairox-gestion(-[a-z0-9]+)?-k-gestion\.vercel\.app$/;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const isAllowed = ALLOWED_ORIGINS.has(origin) || VERCEL_DEPLOY_ORIGIN_RE.test(origin);
  const allowOrigin = isAllowed ? origin : (Deno.env.get('SITE_URL') || 'https://kairox-gestion.vercel.app');
  return {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
    'Access-Control-Allow-Origin': allowOrigin,
  };
}

function errorResponse(message: string, status: number, req: Request): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

function okResponse(data: unknown, req: Request): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

interface StoreAlta {
  mp_store_id: string;
  mp_external_pos_id: string;
}

/** Da de alta tienda+caja en MP si la empresa todavía no las tiene — se hace
 *  una única vez, el resultado se persiste en integraciones_bancarias.config. */
async function asegurarTiendaYCaja(
  adminClient: ReturnType<typeof createClient>,
  empresaId: string,
  mpUserId: string,
  accessToken: string,
  config: Record<string, unknown>,
  direccionEmpresa: string | null,
): Promise<StoreAlta> {
  if (config.mp_store_id && config.mp_external_pos_id) {
    return {
      mp_store_id: String(config.mp_store_id),
      mp_external_pos_id: String(config.mp_external_pos_id),
    };
  }

  // external_id de MP debe ser alfanumérico (sin guiones, confirmado en vivo:
  // 400 invalid_external_id con guiones en /pos) y corto (400
  // external_id_too_long con el UUID completo de 32 chars + prefijo) —
  // primeros 12 caracteres del UUID sin guiones alcanzan para unicidad
  // práctica por empresa.
  const empresaIdCorto = empresaId.replace(/-/g, '').slice(0, 12);

  let storeId = config.mp_store_id ? String(config.mp_store_id) : null;

  if (!storeId) {
    // MP exige location estructurada para dar de alta la tienda. KAIROX hoy
    // sólo guarda empresas.direccion como texto libre (sin street_number/
    // street_name/city_name separados) — se usa como mejor esfuerzo. Pendiente
    // real: una UI de Configuración que pida la dirección estructurada.
    const storeRes = await fetch(`${MP_API_BASE}/users/${mpUserId}/stores`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        name: 'KAIROX POS',
        external_id: `KAIROXSTORE${empresaIdCorto}`,
        location: {
          street_number: 'S/N',
          street_name: direccionEmpresa || 'Sin dirección',
          city_name: direccionEmpresa || 'Sin ciudad',
          state_name: direccionEmpresa || 'Sin provincia',
          // Sin "country": tanto 'AR' como 'ARG' devolvieron unknown_country —
          // se omite y se deja que MP lo infiera del site de la cuenta conectada.
          // latitude/longitude sí son obligatorios (confirmado en vivo: 400
          // "must be defined" sin esto, aunque no aparecen documentados como
          // requeridos). Sin geocoding real disponible hoy — placeholder Córdoba
          // Capital. Pendiente real: pedir la ubicación real en Configuración.
          latitude: -31.4201,
          longitude: -64.1888,
        },
      }),
    });
    if (!storeRes.ok) {
      throw new Error(`Error creando tienda MP: ${storeRes.status} ${await storeRes.text()}`);
    }
    const store = await storeRes.json();
    storeId = String(store.id);

    // Persistir el store_id apenas se crea — si la caja (POS) falla después,
    // el próximo intento reusa esta tienda en vez de crear una duplicada.
    config = { ...config, mp_store_id: storeId };
    await adminClient
      .from('integraciones_bancarias')
      .update({ config })
      .eq('empresa_id', empresaId)
      .eq('proveedor', 'mercadopago');
  }

  const externalPosId = `KAIROXPOS${empresaIdCorto}`;
  const posRes = await fetch(`${MP_API_BASE}/pos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      name: 'Caja POS',
      fixed_amount: false,
      store_id: storeId,
      external_id: externalPosId,
    }),
  });
  if (!posRes.ok) {
    throw new Error(`Error creando caja (POS) MP: ${posRes.status} ${await posRes.text()}`);
  }

  const alta: StoreAlta = { mp_store_id: storeId, mp_external_pos_id: externalPosId };
  await adminClient
    .from('integraciones_bancarias')
    .update({ config: { ...config, ...alta } })
    .eq('empresa_id', empresaId)
    .eq('proveedor', 'mercadopago');

  return alta;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, req);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('No autorizado', 401, req);
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return errorResponse('Token inválido', 401, req);
    }
    const userId = userData.user.id;

    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('empresa_id, active')
      .eq('id', userId)
      .single();
    if (profileErr || !profile?.active) {
      return errorResponse('Perfil no encontrado o inactivo', 401, req);
    }
    const empresaId = profile.empresa_id;

    const body = await req.json();
    const {
      items, cliente_id = null, cliente_nombre = null,
      punto_venta_id = null, tipo_comprobante_afip = null,
      caja_sesion_id = null, centro_costo_id = null,
    } = body ?? {};

    if (!Array.isArray(items) || items.length === 0) {
      return errorResponse('Faltan ítems para la venta', 400, req);
    }

    // 1. Crear la venta pendiente — RLS/autorización real vive en el RPC,
    //    llamado con el JWT del propio usuario.
    const { data: ventaResult, error: ventaErr } = await userClient.rpc('crear_venta_pendiente_qr', {
      p_empresa_id: empresaId,
      p_user_id: userId,
      p_cliente_id: cliente_id,
      p_cliente_nombre: cliente_nombre,
      p_items: items,
      p_punto_venta_id: punto_venta_id,
      p_tipo_comprobante_afip: tipo_comprobante_afip,
      p_caja_sesion_id: caja_sesion_id,
      p_centro_costo_id: centro_costo_id,
    });
    if (ventaErr) {
      console.error('[mp-qr-crear] Error crear_venta_pendiente_qr:', ventaErr);
      return errorResponse(ventaErr.message, 400, req);
    }

    const { comprobante_id, numero_venta, total, external_reference } = ventaResult;

    // 2. Integración MP de la empresa + Access Token (Vault, service_role-only).
    const { data: integracion, error: errInt } = await adminClient
      .from('integraciones_bancarias')
      .select('config')
      .eq('empresa_id', empresaId)
      .eq('proveedor', 'mercadopago')
      .eq('activo', true)
      .single();
    if (errInt || !integracion) {
      return errorResponse('No hay una cuenta de MercadoPago conectada. Configurala en Bancos.', 400, req);
    }
    const mpUserId = integracion.config?.mp_user_id;
    if (!mpUserId) {
      return errorResponse('La integración de MercadoPago no tiene mp_user_id — re-verificá el Access Token en Configuración.', 400, req);
    }

    const { data: accessToken, error: vaultErr } = await adminClient.rpc('vault_secret_read', {
      p_name: `mp_access_token_${empresaId}`,
    });
    if (vaultErr || !accessToken) {
      return errorResponse('No se pudo leer el Access Token de MercadoPago.', 500, req);
    }

    const { data: empresaData } = await adminClient
      .from('empresas')
      .select('direccion')
      .eq('id', empresaId)
      .single();

    // 3. Alta de tienda+caja (una vez) + orden QR dinámica.
    const { mp_external_pos_id } = await asegurarTiendaYCaja(
      adminClient, empresaId, mpUserId, accessToken, integracion.config ?? {}, empresaData?.direccion ?? null,
    );

    const expirationDate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const qrRes = await fetch(
      `${MP_API_BASE}/instore/orders/qr/seller/collectors/${mpUserId}/pos/${mp_external_pos_id}/qrs`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          external_reference,
          title: `Venta ${numero_venta}`,
          description: `KAIROX POS — Venta ${numero_venta}`,
          notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook?empresa_id=${empresaId}`,
          total_amount: total,
          expiration_date: expirationDate,
          items: items.map((it: { producto_id?: string; nombre?: string; cantidad: number; precio_unitario: number }) => ({
            sku_number: it.producto_id ?? '',
            category: 'general',
            title: it.nombre ?? 'Producto',
            quantity: it.cantidad,
            unit_price: it.precio_unitario,
            unit_measure: 'unit',
            total_amount: Math.round(it.cantidad * it.precio_unitario * 100) / 100,
          })),
        }),
      },
    );
    if (!qrRes.ok) {
      console.error('[mp-qr-crear] Error creando orden QR:', qrRes.status, await qrRes.text());
      return errorResponse('No se pudo generar el QR de MercadoPago', 502, req);
    }
    const qrOrder = await qrRes.json();

    await adminClient
      .from('qr_pagos_mp')
      .update({ qr_data: qrOrder.qr_data, in_store_order_id: qrOrder.in_store_order_id, updated_at: new Date().toISOString() })
      .eq('external_reference', external_reference);

    return okResponse({
      comprobante_id,
      numero_venta,
      total,
      external_reference,
      qr_data: qrOrder.qr_data,
      expiracion: expirationDate,
    }, req);
  } catch (err) {
    console.error('[mp-qr-crear] Error inesperado:', err);
    return errorResponse((err as Error).message ?? 'Error inesperado', 500, req);
  }
});
