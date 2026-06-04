import { verifyAdmin, adminClient, corsHeaders, errorResponse, okResponse } from '../_shared/auth.ts';

const MAX_USERS_PER_EMPRESA = 50; // Límite de seguridad

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // 1. Verificar autenticación y rol admin
  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error!, 401);

  // 2. Parsear y validar body
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Body inválido');
  }

  const email      = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const firstName  = typeof body.first_name === 'string' ? body.first_name.trim().slice(0, 100) : '';
  const lastName   = typeof body.last_name  === 'string' ? body.last_name.trim().slice(0, 100)  : '';
  const role       = body.role === 'admin' ? 'admin' : 'staff'; // Solo admin o staff
  const password   = typeof body.password === 'string' ? body.password : '';
  const empresaId  = auth.empresaId!;

  // Validaciones
  if (!email || !/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email)) {
    return errorResponse('Email inválido');
  }
  if (!firstName || firstName.length < 2) return errorResponse('Nombre inválido');
  if (!lastName  || lastName.length  < 2) return errorResponse('Apellido inválido');
  if (!password  || password.length  < 12) return errorResponse('La contraseña debe tener al menos 12 caracteres');

  // Un admin no puede crear otro admin si ya hay uno
  if (role === 'admin') {
    const { count } = await adminClient
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', empresaId)
      .eq('role', 'admin');
    if ((count ?? 0) >= 1) return errorResponse('Ya existe un admin en esta empresa');
  }

  // Límite de usuarios por empresa
  const { count: userCount } = await adminClient
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId);
  if ((userCount ?? 0) >= MAX_USERS_PER_EMPRESA) {
    return errorResponse('Se alcanzó el límite de usuarios para esta empresa');
  }

  // 3. Crear usuario en auth.users
  const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName },
  });

  if (createError) {
    // No exponer detalles del error de Supabase
    if (createError.message?.toLowerCase().includes('already registered')) {
      return errorResponse('El email ya está registrado en el sistema');
    }
    return errorResponse('No se pudo crear el usuario');
  }

  // 4. Insertar perfil vinculado a la empresa del admin
  const { error: profileError } = await adminClient.from('profiles').insert({
    id:         newUser.user.id,
    email,
    first_name: firstName,
    last_name:  lastName,
    role,
    empresa_id: empresaId,
    active:     true,
    permissions: {},
  });

  if (profileError) {
    // Rollback: eliminar el usuario recién creado
    await adminClient.auth.admin.deleteUser(newUser.user.id);
    return errorResponse('Error al crear el perfil del usuario');
  }

  return okResponse({ id: newUser.user.id, email, role });
});
