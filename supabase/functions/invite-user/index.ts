import { verifyAdmin, adminClient, buildCorsHeaders, errorResponse, okResponse } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(req) });

  // 1. Solo admin puede invitar usuarios
  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error!, 401, req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Body inválido', 400, req);
  }

  const email     = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim().slice(0, 100) : '';
  const lastName  = typeof body.last_name  === 'string' ? body.last_name.trim().slice(0, 100)  : '';
  const role      = body.role === 'admin' ? 'admin' : 'staff';
  const empresaId = auth.empresaId!;

  if (!email || !/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return errorResponse('Email inválido', 400, req);
  }
  if (!firstName || firstName.length < 2) return errorResponse('Nombre inválido', 400, req);
  if (!lastName  || lastName.length  < 2) return errorResponse('Apellido inválido', 400, req);

  // redirectTo: usamos el Origin del request si está disponible, sino el SITE_URL configurado
  const origin = req.headers.get('Origin') || Deno.env.get('SITE_URL') || 'https://kairox-gestion.vercel.app';

  // Invitar vía Supabase (envía email con magic link)
  const { data: invited, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { first_name: firstName, last_name: lastName },
    redirectTo: `${origin}/auth/callback`,
  });

  if (inviteError) {
    if (inviteError.message?.toLowerCase().includes('already registered')) {
      return errorResponse('El email ya está registrado', 400, req);
    }
    return errorResponse('No se pudo enviar la invitación', 400, req);
  }

  // Crear perfil pre-configurado con empresa del admin
  await adminClient.from('profiles').upsert({
    id:         invited.user.id,
    email,
    first_name: firstName,
    last_name:  lastName,
    role,
    empresa_id: empresaId,
    active:     true,
    permissions: {},
  }, { onConflict: 'id' });

  return okResponse({ invited: true, email }, req);
});
