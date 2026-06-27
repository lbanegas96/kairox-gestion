-- ════════════════════════════════════════════════════════════════════════════
-- migration 101 — GRANT EXECUTE get_my_empresa_id a anon (fix RLS en contexto anon)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO (sesión 64): el log de Postgres spameaba cientos de
--   "permission denied for function get_my_empresa_id".
-- Causa: un sweep viejo (migration 063) revocó EXECUTE de PUBLIC/anon sobre
-- get_my_empresa_id. Pero ~30 RLS policies (comprobantes, productos, clientes,
-- caja, configuracion, etc.) usan `empresa_id = get_my_empresa_id()` y aplican a
-- TODOS los roles (PUBLIC), incluido anon. Cuando una request llega en contexto
-- anon (realtime, sesión sin JWT, etc.), la policy intenta ejecutar la función y
-- tira "permission denied" → la query ERRORA en vez de devolver 0 filas.
--
-- get_my_empresa_id es un HELPER de RLS, no una RPC de negocio: hace
--   SELECT empresa_id FROM profiles WHERE id = auth.uid()
-- Para anon, auth.uid() es NULL → devuelve NULL → la policy evalúa
-- `empresa_id = NULL` = false → no devuelve filas. Es el comportamiento correcto
-- y seguro: anon NUNCA puede obtener el empresa_id de otro (sólo el suyo, que es
-- NULL). Por eso debe ser ejecutable por anon, igual que auth.uid().
--
-- FIX: re-otorgar EXECUTE a anon (y authenticated, por las dudas). No debilita el
-- aislamiento multi-tenant — sólo evita que las policies erroreen en contexto anon.

GRANT EXECUTE ON FUNCTION public.get_my_empresa_id() TO anon;
GRANT EXECUTE ON FUNCTION public.get_my_empresa_id() TO authenticated;

-- ROLLBACK (comentado):
-- REVOKE EXECUTE ON FUNCTION public.get_my_empresa_id() FROM anon;
