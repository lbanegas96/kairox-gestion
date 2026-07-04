-- migration 152 — Auditoría (área nueva: `empresas` raíz del tenant + `series_numeracion`)
--
-- Hallazgo 1 — `empresas`: la policy `empresas_update` (mig.006/016) solo exigía
-- `id = get_my_empresa_id()`, sin gate de admin. Probado con BEGIN...ROLLBACK sobre datos
-- reales: un staff no-admin ejecutó `UPDATE empresas SET nombre=..., cuit=..., afip_cuit=...,
-- usa_factura_electronica=false` sin ningún error — esta es la tabla raíz del tenant, con la
-- identidad legal/fiscal de la empresa (CUIT, razón social) y el interruptor de facturación
-- electrónica. Confirmado por grep que el único escritor no-ConfiguracionSection es
-- `OnboardingWizard.jsx`, y que el creador del tenant siempre es 'admin' (mig.006) — el
-- onboarding lo completa esa misma persona antes de invitar staff, así que exigir is_admin()
-- no rompe ese flujo.
--
-- Hallazgo 2 — `series_numeracion`: mismo patrón débil ("FOR ALL, solo empresa_id"). Probado:
-- un staff no-admin alteró `proximo_numero` de una serie real sin error — podría saltar o
-- reutilizar numeración de comprobantes. Confirmado por grep que el único call-site de
-- escritura es `ConfiguracionSection.jsx` (ya admin-only en la UI); `obtener_proximo_numero()`
-- (usada por el flujo normal de venta) es SECURITY DEFINER y sigue funcionando sin cambios.

DROP POLICY IF EXISTS "empresas_update" ON public.empresas;
CREATE POLICY "empresas_update" ON public.empresas FOR UPDATE
  USING (id = get_my_empresa_id() AND is_admin())
  WITH CHECK (id = get_my_empresa_id() AND is_admin());

DROP POLICY IF EXISTS "series_numeracion_all" ON public.series_numeracion;
CREATE POLICY "series_numeracion_select" ON public.series_numeracion FOR SELECT
  USING (empresa_id = get_my_empresa_id());
CREATE POLICY "series_numeracion_admin_write" ON public.series_numeracion FOR ALL
  USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());
