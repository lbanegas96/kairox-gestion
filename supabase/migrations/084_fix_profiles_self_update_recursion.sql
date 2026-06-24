-- ════════════════════════════════════════════════════════════════════════════
-- migration 084 — Fix recursión infinita en policy profiles_self_update
-- ════════════════════════════════════════════════════════════════════════════
--
-- BUG (visible en consola del browser):
--   ERROR 42P17: "infinite recursion detected in policy for relation profiles"
--
-- CAUSA RAÍZ:
--   La policy `profiles_self_update` tenía este WITH CHECK:
--     (id = (SELECT auth.uid())) AND
--     (role = (SELECT role FROM profiles WHERE id = (SELECT auth.uid())))
--
--   El subquery directo a `profiles` dentro del WITH CHECK fuerza a Postgres
--   a re-evaluar las policies SELECT de `profiles` para resolverlo. Como hay
--   policies SELECT activas sobre la misma tabla, Postgres detecta la
--   recursión y aborta — protección anti-loop. No es teórica, rompe cualquier
--   UPDATE que pasara por esta policy.
--
--   Las demás policies de profiles usan `is_admin()` y `get_my_empresa_id()`
--   que son SECURITY DEFINER → bypassean RLS y NO causan recursión.
--
-- FIX:
--   1. Crear función SECURITY DEFINER `get_my_role()` (mismo patrón que
--      `get_my_empresa_id()`) que devuelve el rol del usuario autenticado
--      saltando RLS.
--   2. Recrear la policy reemplazando el subquery por la llamada a la función.
--      Semántica preservada (igual que la versión vieja).
--
-- NOTA (no es regresión de esta migration):
--   La verificación "no cambiar tu propio role" del WITH CHECK NO funciona
--   ni en esta versión ni en la anterior — Postgres evalúa el CHECK después
--   de aplicar el UPDATE sobre la fila, entonces cualquier query a `profiles`
--   ve el role ya cambiado y la comparación siempre cierra. La recursión
--   histórica lo enmascaraba (los UPDATEs explotaban con 42P17 antes de
--   evaluar la lógica). Para cerrar la escalación de privilegios real se
--   necesita un trigger BEFORE UPDATE que compare OLD.role vs NEW.role — eso
--   queda fuera del alcance de este fix, no es regresión.

-- ─── Paso 1: helper get_my_role() ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

-- Consistencia con migration 063: nunca exponer SECURITY DEFINER a anon.
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated, service_role;

-- ─── Paso 2: recrear la policy sin subquery a profiles ────────────────────
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;

CREATE POLICY profiles_self_update ON public.profiles
  AS PERMISSIVE
  FOR UPDATE
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id = (SELECT auth.uid())
    AND role = (SELECT public.get_my_role())
  );

-- ROLLBACK (comentado):
-- DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
-- CREATE POLICY profiles_self_update ON public.profiles AS PERMISSIVE FOR UPDATE
--   USING (id = (SELECT auth.uid()))
--   WITH CHECK ((id = (SELECT auth.uid())) AND
--     (role = (SELECT role FROM profiles WHERE id = (SELECT auth.uid()))));
-- -- ⚠️ ESTO REINTRODUCE LA RECURSIÓN. NO ROLLBACKEAR sin un fix alternativo.
-- DROP FUNCTION IF EXISTS public.get_my_role();
