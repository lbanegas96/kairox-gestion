-- Fusiona las policies de profiles que se evaluaban por separado (admin_* + self_*)
-- en una única policy por accion con OR, eliminando el warning de performance
-- "multiple_permissive_policies" sin cambiar ninguna logica de autorizacion.
SET lock_timeout = '3s';

DROP POLICY IF EXISTS profiles_admin_select ON public.profiles;
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT
  USING ( (id = (select auth.uid())) OR (is_admin() AND empresa_id = (select get_my_empresa_id())) );

DROP POLICY IF EXISTS profiles_admin_insert ON public.profiles;
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT
  WITH CHECK ( (id = (select auth.uid())) OR (empresa_id = get_my_empresa_id() AND is_admin()) );

DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
DROP POLICY IF EXISTS profiles_self_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE
  USING ( (id = (select auth.uid())) OR (is_admin() AND empresa_id = get_my_empresa_id()) )
  WITH CHECK (
    (id = (select auth.uid()) AND role = (select get_my_role()))
    OR (is_admin() AND empresa_id = get_my_empresa_id())
  );
