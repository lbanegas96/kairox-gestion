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
    return redirectAResultado('ok', canal);
  } catch (e) {
    console.error('[integraciones-oauth-callback] Error en intercambio:', e);
    return redirectAResultado('error', canal, 'exchange_fallo');
  }
});
