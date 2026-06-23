-- Hallazgo (auditoría sesión 52): profiles_select solo permite id=auth.uid()
-- — no existe ninguna policy SELECT que permita ver a los COLEGAS de la
-- misma empresa. Resultado real (confirmado con BEGIN...ROLLBACK): un admin
-- que consulta `profiles WHERE empresa_id = su_empresa` solo recibe SU
-- PROPIA fila, nunca las de sus compañeros. UsuariosSection.jsx (pantalla de
-- gestión de usuarios, solo para admins) depende de esto y hoy muestra la
-- lista de usuarios vacía/incompleta en producción.
--
-- Fix: agregar policy SELECT para admins, mismo patrón que
-- profiles_admin_update/profiles_admin_insert/profiles_admin_delete
-- (is_admin() AND empresa_id = get_my_empresa_id()). No se amplía a todos
-- los usuarios autenticados (solo admin) porque es el único caso de uso real
-- encontrado (grep confirmó que ningún otro componente necesita ver perfiles
-- de otros usuarios).

CREATE POLICY "profiles_admin_select" ON public.profiles
  FOR SELECT
  USING (is_admin() AND (empresa_id = (select public.get_my_empresa_id())));

-- Rollback (comentado):
-- DROP POLICY IF EXISTS "profiles_admin_select" ON public.profiles;
