import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyAdmin, buildCorsHeaders, errorResponse, okResponse } from '../_shared/auth.ts';
import { generarState, guardarStatePendiente, type Canal } from '../_shared/integraciones.ts';

// Mapa de adapters implementados. Agregar un canal nuevo (Shopify, MercadoLibre)
// implica sumar su entrada acá + su rama de intercambio en integraciones-oauth-callback
// — el resto de la capa (state, Vault, tabla) ya queda armado y no se toca.
const AUTHORIZE_URL_BUILDERS: Record<string, (state: string) => string | null> = {
  tiendanube: (state) => {
    const appId = Deno.env.get('TIENDANUBE_APP_ID');
    if (!appId) return null;
    return `https://www.tiendanube.com/apps/${appId}/authorize?state=${state}`;
  },
};

serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405, req);

  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error!, 401, req);

  let canal: string;
  try {
    ({ canal } = await req.json());
  } catch {
    return errorResponse('Body inválido', 400, req);
  }

  const buildUrl = AUTHORIZE_URL_BUILDERS[canal];
  if (!buildUrl) {
    return errorResponse(`Canal no soportado: ${canal}`, 400, req);
  }

  const state = generarState();
  try {
    await guardarStatePendiente(auth.empresaId!, canal as Canal, state);
  } catch (e) {
    console.error('[integraciones-oauth-iniciar] Error guardando state:', e);
    return errorResponse('No se pudo iniciar la conexión', 500, req);
  }

  const authorizeUrl = buildUrl(state);
  if (!authorizeUrl) {
    console.error(`[integraciones-oauth-iniciar] Falta configuración de credenciales para canal: ${canal}`);
    return errorResponse('Integración no configurada del lado de KAIROX — contactar soporte', 500, req);
  }

  return okResponse({ authorize_url: authorizeUrl }, req);
});
