-- migration 150 — Auditoría (área nueva: Puntos de Venta / numeración fiscal AFIP)
--
-- Hallazgo: `puntos_venta` (mig.025) tenía policy "FOR ALL, solo empresa_id" — sin gate
-- de admin ni de permiso de módulo. Esta tabla controla `ultimo_numero_a/b/c`, el
-- contador que usa el flujo AFIP/ARCA (arca-worker) para numerar comprobantes con CAE.
--
-- Probado con BEGIN...ROLLBACK: un staff no-admin ejecutó UPDATE puntos_venta SET
-- ultimo_numero_b = 0 sin ningún error — resetear ese contador manualmente (por error
-- o mala intención) puede hacer que el sistema reintente numeración ya usada ante AFIP,
-- un problema fiscal real, no solo de datos internos. Mismo riesgo con DELETE (la FK
-- comprobantes.punto_venta_id es ON DELETE SET NULL — el comprobante sobrevive pero
-- pierde el vínculo con su punto de venta).
--
-- Fix: tratada al mismo nivel que periodos_contables/determinacion_cuentas_mayor
-- (fiscal/contable crítico) — CUD exige is_admin(), no solo has_module_permission().
-- SELECT sigue tenant-only (el POS necesita leer el punto de venta activo para operar).

DROP POLICY IF EXISTS "puntos_venta_all" ON public.puntos_venta;

CREATE POLICY "puntos_venta_select" ON public.puntos_venta FOR SELECT
  USING (empresa_id = get_my_empresa_id());

CREATE POLICY "puntos_venta_admin_write" ON public.puntos_venta FOR ALL
  USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());
