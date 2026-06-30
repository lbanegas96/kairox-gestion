-- migration 119 — configuracion: lectura abierta a la empresa, escritura SOLO admin
--
-- PROBLEMA: configuracion tenía 9 políticas RLS solapadas. Las que exigían is_admin()
-- (config_delete/insert/update) estaban ANULADAS por `configuracion_all` (FOR ALL a
-- cualquier usuario) y por el set "Configuracion: X propia empresa" → en la práctica
-- CUALQUIER usuario de la empresa podía editar la configuración. Además generaba 20
-- warnings multiple_permissive_policies.
--
-- DECISIÓN (Luciano): la escritura de configuración debe ser SOLO admin.
--
-- SOLUCIÓN: dropear las 9 políticas y dejar 4 limpias y sin solape:
--   SELECT → cualquier usuario de la empresa (la app lee config para todos)
--   INSERT/UPDATE/DELETE → solo admin (is_admin())
--
-- Las escrituras a configuracion ocurren solo en ConfiguracionSection (updateConfig +
-- guardado de alertas). La primera config del onboarding la crea el owner (admin) o
-- corre vía SECURITY DEFINER (bypassa RLS), así que no se rompe el alta de empresas.
--
-- ROLLBACK: recrear las políticas previas (ver definiciones en pg_policies pre-119).

DROP POLICY IF EXISTS configuracion_all                       ON public.configuracion;
DROP POLICY IF EXISTS "Configuracion: select propia empresa"  ON public.configuracion;
DROP POLICY IF EXISTS config_select                           ON public.configuracion;
DROP POLICY IF EXISTS "Configuracion: insert propia empresa"  ON public.configuracion;
DROP POLICY IF EXISTS config_insert                           ON public.configuracion;
DROP POLICY IF EXISTS "Configuracion: update propia empresa"  ON public.configuracion;
DROP POLICY IF EXISTS config_update                           ON public.configuracion;
DROP POLICY IF EXISTS "Configuracion: delete propia empresa"  ON public.configuracion;
DROP POLICY IF EXISTS config_delete                           ON public.configuracion;

CREATE POLICY config_select ON public.configuracion
  FOR SELECT
  USING (empresa_id = get_my_empresa_id());

CREATE POLICY config_insert ON public.configuracion
  FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY config_update ON public.configuracion
  FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY config_delete ON public.configuracion
  FOR DELETE
  USING (empresa_id = get_my_empresa_id() AND is_admin());
