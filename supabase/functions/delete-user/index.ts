import { verifyAdmin, adminClient, corsHeaders, errorResponse, okResponse } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // 1. Solo admin puede eliminar usuarios
  const auth = await verifyAdmin(req);
  if (!auth.ok) return errorResponse(auth.error!, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse('Body inválido');
  }

  const targetUserId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  if (!targetUserId) return errorResponse('user_id requerido');

  // 2. Verificar que el target pertenece a la misma empresa
  const { data: targetProfile, error: fetchError } = await adminClient
    .from('profiles')
    .select('id, empresa_id, role')
    .eq('id', targetUserId)
    .single();

  if (fetchError || !targetProfile) return errorResponse('Usuario no encontrado');
  if (targetProfile.empresa_id !== auth.empresaId) return errorResponse('No autorizado');

  // 3. Un admin no puede eliminarse a sí mismo
  if (targetUserId === auth.userId) return errorResponse('No podés eliminar tu propia cuenta');

  // 4. No se puede eliminar a otro admin
  if (targetProfile.role === 'admin') return errorResponse('No se puede eliminar al administrador');

  // 5. Eliminar perfil primero, luego auth.user
  const { error: profileDeleteError } = await adminClient
    .from('profiles')
    .delete()
    .eq('id', targetUserId);

  if (profileDeleteError) return errorResponse('Error al eliminar el perfil');

  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(targetUserId);
  if (authDeleteError) return errorResponse('Error al eliminar la cuenta');

  return okResponse({ deleted: true });
});
