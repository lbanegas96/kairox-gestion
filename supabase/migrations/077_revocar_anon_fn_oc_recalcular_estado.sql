-- Auditoría sesión 54 — hallazgo detectado en get_advisors:
-- fn_oc_recalcular_estado() es una función SECURITY DEFINER que hace DML
-- sobre ordenes_compra (UPDATE estado). El rol anon puede llamarla
-- directamente vía /rest/v1/rpc/fn_oc_recalcular_estado.
-- Cuando se la llama sin trigger context, NEW es NULL y la función retorna
-- temprano (exitosamente) sin hacer nada — pero el grant sigue siendo
-- incorrecto: anon nunca debería poder invocar una función SECURITY DEFINER
-- con capacidad de DML, sin importar que el early return lo proteja hoy.
-- Fix: mismo patrón que migration 063 y 070 (trigger functions).

REVOKE EXECUTE ON FUNCTION public.fn_oc_recalcular_estado() FROM PUBLIC, anon;

-- Rollback (comentado):
-- GRANT EXECUTE ON FUNCTION public.fn_oc_recalcular_estado() TO PUBLIC;
