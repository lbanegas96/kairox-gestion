-- migration 124 — integraciones_bancarias: SOLO admin puede leer/escribir
--
-- PROBLEMA: integraciones_bancarias tiene una única política "integraciones_bancarias_all"
-- (FOR ALL) que solo exige empresa_id = get_my_empresa_id(). Esta tabla guarda
-- access_token/refresh_token de Mercado Pago y Ualá (credenciales de cobro reales).
-- Cualquier usuario autenticado de la empresa (cajero, vendedor, etc.) podía, vía la
-- REST API de Supabase directamente (sin pasar por la UI), leer esos tokens en texto
-- plano o modificar cuenta_bancaria_id/access_token, redirigiendo a dónde se acreditan
-- los cobros.
--
-- PRECEDENTE: migración 119 ya aplicó exactamente este mismo criterio a `configuracion`
-- ("la escritura de configuración debe ser SOLO admin"). integraciones_bancarias es más
-- sensible que configuracion (contiene secretos de pago, no solo parámetros), así que
-- acá también restringimos el SELECT a admin — el único lugar del frontend que lee esta
-- tabla es ConfiguracionSection.jsx, que ya está gateado a admin-only en el render
-- (línea 1227), y ningún módulo operativo depende de leerla.
--
-- Las edge functions (mp-webhook, mp-sync) usan SUPABASE_SERVICE_ROLE_KEY, que bypassa
-- RLS por completo — no se ven afectadas por este cambio.
--
-- ROLLBACK: recrear "integraciones_bancarias_all" FOR ALL USING/WITH CHECK
--           (empresa_id = get_my_empresa_id()).

DROP POLICY IF EXISTS integraciones_bancarias_all ON public.integraciones_bancarias;

CREATE POLICY integraciones_bancarias_select ON public.integraciones_bancarias
  FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY integraciones_bancarias_insert ON public.integraciones_bancarias
  FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY integraciones_bancarias_update ON public.integraciones_bancarias
  FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY integraciones_bancarias_delete ON public.integraciones_bancarias
  FOR DELETE
  USING (empresa_id = get_my_empresa_id() AND is_admin());
