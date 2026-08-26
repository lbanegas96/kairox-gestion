-- migration 355 — seed_plan_cuentas nunca tuvo EXECUTE otorgado a authenticated
--
-- HALLAZGO (Fase 0 de PLAN_PRUEBA_INTEGRAL_FERRETERIA_2026-08-26.md, primera vez que se
-- crea una empresa completamente nueva en esta sesión): el botón "Inicializar Plan
-- Estándar" en Plan de Cuentas (TabPlanCuentas.jsx → planCuentasService.seedCuentas →
-- RPC seed_plan_cuentas) no hacía absolutamente nada al clickearlo — sin toast de error
-- visible, sin ninguna fila nueva. Confirmado que el click SÍ llegaba al botón (no era un
-- problema de la interfaz): llamando al RPC directo por SQL simulando el rol
-- `authenticated`, PostgreSQL devuelve "permission denied for function seed_plan_cuentas".
--
-- Su ACL real: `{postgres=X/postgres}` — ni PUBLIC ni authenticated tienen EXECUTE. A
-- diferencia de sus 3 funciones hermanas del mismo flujo de alta (create_tenant,
-- seed_maestros_default, seed_series_numeracion — las 3 SÍ tenían el grant), esta se
-- quedó sin el GRANT explícito a authenticated en algún momento (probablemente una de
-- las migraciones de "revoke PUBLIC en lote" de sesiones anteriores le tocó el turno de
-- revocar pero nunca el de re-otorgar). Impacto real: **ninguna empresa nueva podía
-- sembrar su Plan de Cuentas desde la interfaz** — Nalux ya lo tenía de antes (por eso
-- nadie lo había notado en esta sesión hasta crear una empresa de cero).
--
-- Verificado seguro otorgar EXECUTE sin más: la función es SECURITY INVOKER (no
-- DEFINER) y no valida `p_empresa_id` por su cuenta, pero el INSERT que hace queda
-- sujeto igual a la política RLS real de `plan_cuentas`
-- (`empresa_id = get_my_empresa_id() AND has_module_permission('configuracion')` en el
-- WITH CHECK) — nadie puede usar este RPC para sembrarle cuentas a una empresa ajena,
-- RLS lo corta solo.

GRANT EXECUTE ON FUNCTION public.seed_plan_cuentas(uuid) TO authenticated;

-- ROLLBACK (comentado): REVOKE EXECUTE ON FUNCTION public.seed_plan_cuentas(uuid) FROM authenticated;
