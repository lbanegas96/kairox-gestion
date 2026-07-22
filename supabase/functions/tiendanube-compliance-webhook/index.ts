import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { adminClient } from '../_shared/auth.ts';

/**
 * Webhooks obligatorios de privacidad/LGPD que Tiendanube exige a CUALQUIER
 * app (pública o privada) que toque datos de clientes — ver
 * https://tiendanube.github.io/api-documentation/resources/webhook (sección LGPD).
 * Se registran 3 URLs distintas en el panel de Partners, todas apuntando acá
 * con ?tipo=<uno de los 3 de abajo>.
 *
 * Firma: header x-linkedstore-hmac-sha256 = HMAC-SHA256(body crudo, TIENDANUBE_CLIENT_SECRET)
 * en hex — mismo secreto que usa el intercambio OAuth (integraciones-oauth-callback).
 */
const TIPOS_VALIDOS = new Set(['store_redact', 'customers_redact', 'customers_data_request']);

async function verificarFirma(rawBody: string, header: string | null): Promise<boolean> {
  if (!header) return false;
  const secret = Deno.env.get('TIENDANUBE_CLIENT_SECRET');
  if (!secret) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const hash = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return hash === header;
}

async function manejarStoreRedact(payload: { store_id: number | string }) {
  const storeId = String(payload.store_id);

  const { data: integracion } = await adminClient
    .from('integraciones_canales')
    .select('id, empresa_id')
    .eq('canal', 'tiendanube')
    .eq('external_store_id', storeId)
    .maybeSingle();

  if (!integracion) {
    console.log('[tiendanube-compliance-webhook] store_redact — sin integración registrada para store_id:', storeId);
    return;
  }

  // Vault primero: si el borrado de la fila fallara después, preferimos un
  // registro sin token vigente antes que un token huérfano sin fila que lo referencie.
  await adminClient.rpc('vault_secret_delete', { p_name: `tiendanube_access_token_${integracion.empresa_id}` });
  await adminClient.rpc('vault_secret_delete', { p_name: `tiendanube_refresh_token_${integracion.empresa_id}` });

  // ON DELETE CASCADE (migración 230) limpia integraciones_producto_mapeo solo.
  await adminClient.from('integraciones_canales').delete().eq('id', integracion.id);

  console.log('[tiendanube-compliance-webhook] ✓ store_redact — conexión y token borrados, empresa:', integracion.empresa_id);
}

function manejarCustomersRedact(payload: unknown) {
  // Todavía no sincronizamos pedidos/clientes de Tiendanube (falta esa parte
  // del adapter) — hoy KAIROX no guarda ningún dato de clientes de Tiendanube,
  // así que no hay nada que borrar. CUANDO se implemente el sync de pedidos,
  // este handler tiene que borrar/anonimizar los datos del cliente indicado acá.
  console.log('[tiendanube-compliance-webhook] customers_redact recibido (no-op — sin datos de clientes almacenados todavía):', JSON.stringify(payload));
}

function manejarCustomersDataRequest(payload: unknown) {
  // Mismo caso que customers_redact: no hay datos de clientes de Tiendanube
  // almacenados todavía.
  console.log('[tiendanube-compliance-webhook] customers_data_request recibido (no-op — sin datos almacenados todavía):', JSON.stringify(payload));
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const tipo = new URL(req.url).searchParams.get('tipo');
  if (!tipo || !TIPOS_VALIDOS.has(tipo)) {
    console.error('[tiendanube-compliance-webhook] tipo inválido o faltante:', tipo);
    return new Response('Bad Request', { status: 400 });
  }

  const rawBody = await req.text();
  const firmaValida = await verificarFirma(rawBody, req.headers.get('x-linkedstore-hmac-sha256'));
  if (!firmaValida) {
    console.error('[tiendanube-compliance-webhook] Firma inválida —', tipo);
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  try {
    if (tipo === 'store_redact') {
      await manejarStoreRedact(payload);
    } else if (tipo === 'customers_redact') {
      manejarCustomersRedact(payload);
    } else {
      manejarCustomersDataRequest(payload);
    }
  } catch (e) {
    // Igual respondemos 2xx: Tiendanube reintenta con backoff si no lo hacemos, y
    // un error nuestro no debería dejar bloqueado indefinidamente el pedido del
    // comercio. El log queda para revisión manual.
    console.error(`[tiendanube-compliance-webhook] Error procesando ${tipo}:`, e);
  }

  return new Response('ok', { status: 200 });
});
