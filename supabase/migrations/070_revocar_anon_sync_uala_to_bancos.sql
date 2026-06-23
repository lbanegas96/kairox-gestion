-- Higiene (sesión 51 continuación 2): sync_uala_to_bancos() es función nueva
-- (CREATE OR REPLACE tras un DROP, no un REPLACE puro) — al ser nueva, nació
-- con los grants default (PUBLIC/anon/authenticated), perdiendo el REVOKE que
-- la vieja sync_uala_to_caja() tenía desde la migration 063. Mismo patrón:
-- revocar de PUBLIC y anon (deja authenticated igual que el resto de las
-- funciones trigger ya existentes, ej. fn_oc_update_stock, handle_new_user —
-- consistencia con lo ya aceptado, no un hallazgo nuevo).
--
-- Detectado por get_advisors (security) al hacer el regression pass del
-- Día 3 del PLAN_SEMANA.md — no es parte del hallazgo original de Ualá,
-- es un descuido propio al recrear la función.

REVOKE EXECUTE ON FUNCTION public.sync_uala_to_bancos() FROM PUBLIC, anon;

-- Rollback (comentado):
-- GRANT EXECUTE ON FUNCTION public.sync_uala_to_bancos() TO PUBLIC;
