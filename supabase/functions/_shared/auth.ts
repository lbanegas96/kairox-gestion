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

/** Headers CORS seguros */
export const corsHeaders = {
  'Access-Control-Allow-Origin':  Deno.env.get('SITE_URL') || 'http://localhost:3001',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

  const { data: { user }, error: userError } = await userClient.auth.getUser();
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

/** Respuesta de error genérica (no filtra detalles internos) */
export function errorResponse(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Respuesta exitosa */
export function okResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
