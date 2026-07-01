import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
  }

  try {
    const { access_token } = await req.json();

    if (!access_token || !access_token.startsWith('APP_USR-')) {
      return new Response(
        JSON.stringify({ valid: false, error: 'El token debe empezar con APP_USR-' }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }

    const mpRes = await fetch('https://api.mercadopago.com/users/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (mpRes.ok) {
      const data = await mpRes.json();
      return new Response(
        JSON.stringify({ valid: true, mp_user_id: data.id ?? null, nickname: data.nickname ?? null, email: data.email ?? null }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    } else {
      return new Response(
        JSON.stringify({ valid: false, error: 'Token inválido o expirado' }),
        { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      );
    }
  } catch (e) {
    return new Response(
      JSON.stringify({ valid: false, error: String(e) }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }
});
