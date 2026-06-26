/**
 * Shared auth utilities for edge functions.
 * Verifies JWT and checks admin role before any privileged operation.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!;

/** Client con privilegios de servicio (bypassea RLS) */
export const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

/** Lista de orígenes permitidos: producción + dev local en cualquier puerto Vite común */
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

/** Headers CORS base (sin Allow-Origin, que se setea por request en buildCorsHeaders) */
const BASE_CORS_HEADERS = {
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

/**
 * Devuelve headers CORS reflejando el origin del request si está permitido.
 * Esto permite que tanto producción como dev local (cualquier puerto Vite común)
 * puedan llamar a las edge functions sin tener que hardcodear un solo origen.
 */
export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : (Deno.env.get('SITE_URL') || 'https://kairox-gestion.vercel.app');
  return { ...BASE_CORS_HEADERS, 'Access-Control-Allow-Origin': allowOrigin };
}

/** Headers CORS estáticos (backward compat). Para nuevos handlers, preferí buildCorsHeaders(req). */
export const corsHeaders = {
  ...BASE_CORS_HEADERS,
  'Access-Control-Allow-Origin': Deno.env.get('SITE_URL') || 'https://kairox-gestion.vercel.app',
};

export interface AuthResult {
  ok: boolean;
  userId?: string;
  empresaId?: string;
  role?: string;
  error?: string;
}

/**
 * Verifica el JWT del header Authorization y devuelve el perfil del caller.
 * Retorna error si el token es inválido, el usuario está inactivo, o no es admin.
 */
export async function verifyAdmin(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, error: 'No autorizado' };
  }

  const token = authHeader.replace('Bearer ', '');

  // Verificar JWT con el anon client para obtener el user
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error: userError } = await userClient.auth.getUser();
  const user = data?.user;
  if (userError || !user) {
    return { ok: false, error: 'Token inválido' };
  }

  // Verificar perfil y rol usando service role (bypassea RLS)
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('id, role, empresa_id, active')
    .eq('id', user.id)
    .single();

  if (profileError || !profile) {
    return { ok: false, error: 'Perfil no encontrado' };
  }

  if (!profile.active) {
    return { ok: false, error: 'Cuenta inactiva' };
  }

  if (profile.role !== 'admin') {
    return { ok: false, error: 'Se requiere rol administrador' };
  }

  return { ok: true, userId: user.id, empresaId: profile.empresa_id, role: profile.role };
}

/** Respuesta de error genérica (no filtra detalles internos)
 *  Pasale `req` como tercer argumento para que el header CORS refleje el origen correcto. */
export function errorResponse(message: string, status = 400, req?: Request): Response {
  const headers = req ? buildCorsHeaders(req) : corsHeaders;
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

/** Respuesta exitosa */
export function okResponse(data: unknown, req?: Request): Response {
  const headers = req ? buildCorsHeaders(req) : corsHeaders;
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
