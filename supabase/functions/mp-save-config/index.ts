import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { verifyAdmin, adminClient, buildCorsHeaders } from '../_shared/auth.ts';

const MP_API_BASE = 'https://api.mercadopago.com';

// Guarda la configuración de Mercado Pago. El Access Token NUNCA se escribe en una
// columna de tabla en texto plano — se cifra en Supabase Vault (mismo mecanismo que
// el certificado AFIP) y solo queda en integraciones_bancarias una referencia
// implícita (empresa_id + proveedor), nunca el secreto en sí.
serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const auth = await verifyAdmin(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { access_token, cuenta_bancaria_id, webhook_secret } = await req.json();

    if (!cuenta_bancaria_id) {
      return new Response(JSON.stringify({ error: 'cuenta_bancaria_id requerido' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let mpUserId: number | null = null;

    if (access_token) {
      if (!access_token.startsWith('APP_USR-')) {
        return new Response(JSON.stringify({ error: 'El token debe empezar con APP_USR-' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }

      const mpRes = await fetch(`${MP_API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (!mpRes.ok) {
        return new Response(JSON.stringify({ error: 'Access Token inválido o expirado' }), {
          status: 400,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      const mpData = await mpRes.json();
      mpUserId = mpData.id ?? null;

      // Cifrado en Vault — mismo mecanismo que el certificado AFIP (vault_secret_upsert,
      // service_role-only). Nunca se guarda en una columna de tabla en texto plano.
      const { error: vaultError } = await adminClient.rpc('vault_secret_upsert', {
        p_name: `mp_access_token_${auth.empresaId}`,
        p_secret: access_token,
        p_description: 'MercadoPago access token',
      });
      if (vaultError) {
        console.error('[mp-save-config] Error guardando en Vault:', vaultError);
        return new Response(JSON.stringify({ error: 'No se pudo guardar el token de forma segura' }), {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
    }

    // Conservar config existente (webhook_secret / mp_user_id) si no vino un valor nuevo.
    const { data: existente } = await adminClient
      .from('integraciones_bancarias')
      .select('config')
      .eq('empresa_id', auth.empresaId)
      .eq('proveedor', 'mercadopago')
      .maybeSingle();

    const config = { ...(existente?.config ?? {}) };
    if (webhook_secret) config.webhook_secret = webhook_secret;
    if (mpUserId != null) config.mp_user_id = mpUserId;

    const { error: upsertError } = await adminClient
      .from('integraciones_bancarias')
      .upsert(
        {
          empresa_id: auth.empresaId,
          proveedor: 'mercadopago',
          cuenta_bancaria_id,
          activo: true,
          config,
        },
        { onConflict: 'empresa_id,proveedor' },
      );

    if (upsertError) throw upsertError;

    return new Response(JSON.stringify({ ok: true, mp_user_id: mpUserId }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[mp-save-config] Error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
