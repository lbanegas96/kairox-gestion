-- Fix de reproducibilidad, NO de seguridad en producción — hallado durante la
-- Fase 1 del plan de sometimiento a estrés (sesión 76-77) al levantar por primera
-- vez el stack local completo (`supabase start`, con Docker ya disponible en esta
-- máquina) para correr el nuevo test pgTAP de aislamiento multi-tenant.
--
-- La migration 194 (revoke_public_execute_rpcs, sesión 60) ya documentó este mismo
-- patrón para 7 funciones: revocó EXECUTE FROM PUBLIC, y su propio comentario
-- (líneas 32-40) dice textualmente que "el grant explícito a `authenticated` nunca
-- se escribió en ninguna migration" para 6 de esas 7 — producción lo tiene puesto
-- a mano, pero un replay desde cero (`supabase db reset`) no lo reproduce.
-- En ese momento solo se re-otorgó `has_module_permission` (por ser un helper
-- interno usado por casi todo, su ausencia rompe todo inmediatamente y de forma
-- obvia); las otras 6 quedaron pendientes de este mismo fix.
--
-- De esas 6, esta migración confirmó (con `has_function_privilege` contra el
-- stack local recién levantado) que solo `crear_venta` está realmente afectada
-- hoy — las otras 5 (cambiar_estado_cheque, regenerar_asiento_cxc/cxp,
-- registrar_pago_proveedor, reintentar_cae_comprobante) ya tienen el grant
-- correcto vía alguna migration posterior que sí lo incluyó.
--
-- Impacto en producción: NINGUNO — producción ya tiene este grant puesto a mano
-- (confirmado con `has_function_privilege('authenticated', ..., 'EXECUTE')` contra
-- el proyecto hosted, que dio `true` antes de aplicar esta migración). El único
-- efecto real es que a partir de ahora un `supabase db reset` local reproduce
-- fielmente el estado de producción para esta función — necesario para que la
-- Fase 2 (infra de carga) pueda confiar en el stack local como espejo real.

GRANT EXECUTE ON FUNCTION public.crear_venta(
  uuid, uuid, text, timestamp with time zone, uuid, text, numeric, text, text,
  text, numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric, uuid
) TO authenticated;

-- ROLLBACK (comentado): REVOKE EXECUTE ON FUNCTION public.crear_venta(...) FROM authenticated;
-- (no debería hacer falta — esto solo iguala el estado local al que producción ya tenía).
