import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { resolverState, guardarTokenCanal, type Canal } from '../_shared/integraciones.ts';

const SITE_URL = Deno.env.get('SITE_URL') || 'https://kairox-gestion.vercel.app';

interface ResultadoExchange {
  accessToken: string;
  refreshToken?: string;
  tokenExpiry?: string | null;
  externalStoreId?: string | null;
  extraConfig?: Record<string, unknown>;
}

// Cada canal implementa su propio intercambio code→token — endpoint, formato
// de body y forma de la respuesta son distintos por proveedor. Agregar Shopify
// o MercadoLibre acá no toca la resolución de state ni el guardado en Vault.
const TOKEN_EXCHANGERS: Record<string, (code: string) => Promise<ResultadoExchange>> = {
  // Tiendanube (Nuvemshop) — https://tiendanube.github.io/api-documentation/authentication
  // El access token NO expira (solo se invalida si se pide uno nuevo o se
  // desinstala la app) — no hay refresh_token en la respuesta.
  tiendanube: async (code) => {
    const clientId = Deno.env.get('TIENDANUBE_APP_ID');
    const clientSecret = Deno.env.get('TIENDANUBE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      throw new Error('Falta configurar TIENDANUBE_APP_ID / TIENDANUBE_CLIENT_SECRET');
    }

    const res = await fetch('https://www.tiendanube.com/apps/authorize/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Tiendanube token exchange falló (${res.status}): ${body}`);
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      externalStoreId: data.user_id != null ? String(data.user_id) : null,
      extraConfig: { scope: data.scope },
    };
  },
};

// Registra los webhooks de pedidos en Tiendanube apuntando a
// tiendanube-pedidos-webhook. Se registran los 3 eventos del ciclo de vida de
// un pedido (created/paid/cancelled) — no solo "paid" — para que KAIROX vea el
// pedido apenas existe (mismo criterio que una Orden de Venta en un ERP: existe
// como documento comercial antes de estar pagada), no recién cuando se cobra.
// Idempotente por evento: chequea los webhooks ya registrados antes de crear.
// No fatal: si falla, la conexión igual queda hecha (se puede reintentar
// reconectando), solo se loguea.
async function registrarWebhookPedidosTiendanube(storeId: string, token: string): Promise<void> {
  const TN_API_BASE = 'https://api.tiendanube.com/2025-03';
  const USER_AGENT = 'KAIROX Gestion (soporte@kairox.app)';
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    console.error('[integraciones-oauth-callback] Sin SUPABASE_URL para registrar webhook');
    return;
  }
  const webhookUrl = `${supabaseUrl}/functions/v1/tiendanube-pedidos-webhook`;
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json' };
  const EVENTOS = ['order/created', 'order/paid', 'order/cancelled'];

  try {
    const listRes = await fetch(`${TN_API_BASE}/${storeId}/webhooks`, { headers });
    const existentes = listRes.ok ? await listRes.json() : [];
    const registrados = new Set(
      Array.isArray(existentes)
        ? existentes.filter((w: Record<string, unknown>) => w.url === webhookUrl).map((w: Record<string, unknown>) => w.event)
        : [],
    );

    for (const evento of EVENTOS) {
      if (registrados.has(evento)) {
        console.log(`[integraciones-oauth-callback] Webhook ${evento} ya registrado`);
        continue;
      }
      const res = await fetch(`${TN_API_BASE}/${storeId}/webhooks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ event: evento, url: webhookUrl }),
      });
      if (!res.ok) {
        console.error(`[integraciones-oauth-callback] No se pudo registrar webhook ${evento}:`, res.status, await res.text());
      } else {
        console.log(`[integraciones-oauth-callback] ✓ Webhook ${evento} registrado`);
      }
    }
  } catch (e) {
    console.error('[integraciones-oauth-callback] Error registrando webhooks:', e);
  }
}

function redirectAResultado(status: 'ok' | 'error', canal: string, detalle?: string): Response {
  const url = new URL(SITE_URL);
  url.searchParams.set('integracion', canal);
  url.searchParams.set('status', status);
  if (detalle) url.searchParams.set('detalle', detalle);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    console.error('[integraciones-oauth-callback] Falta code o state en el callback');
    return redirectAResultado('error', 'desconocido', 'parametros_faltantes');
  }

  const resuelto = await resolverState(state);
  if (!resuelto) {
    console.error('[integraciones-oauth-callback] State inválido, expirado o ya usado:', state);
    return redirectAResultado('error', 'desconocido', 'state_invalido');
  }

  const { empresaId, canal } = resuelto;
  const exchange = TOKEN_EXCHANGERS[canal];
  if (!exchange) {
    console.error('[integraciones-oauth-callback] Canal sin exchanger implementado:', canal);
    return redirectAResultado('error', canal, 'canal_no_soportado');
  }

  try {
    const resultado = await exchange(code);
    await guardarTokenCanal(empresaId, canal as Canal, resultado);
    console.log(`[integraciones-oauth-callback] ✓ Conectado — empresa: ${empresaId} canal: ${canal}`);

    // Registrar el webhook de pedidos (no fatal si falla)
    if (canal === 'tiendanube' && resultado.externalStoreId) {
      await registrarWebhookPedidosTiendanube(resultado.externalStoreId, resultado.accessToken);
    }

    return redirectAResultado('ok', canal);
  } catch (e) {
    console.error('[integraciones-oauth-callback] Error en intercambio:', e);
    return redirectAResultado('error', canal, 'exchange_fallo');
  }
});
