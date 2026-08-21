-- mig.341 — Primera tanda de la auditoría de seguridad del 20/08 (advisors WARN).
--
-- 3 funciones con grant de más a `anon` (o sin search_path fijo), mismo criterio
-- ya usado en mig.330/337: revocar de PUBLIC/anon lo que no corresponde, dejar
-- authenticated solo donde el código real lo necesita.
--
-- 1) productos_stock_bajo(uuid) — la RPC del Dashboard/POS para "Alertas de
--    Stock" (mig.333, aplicada ayer). Le faltaba SET search_path (WARN
--    function_search_path_mutable) y el REVOKE de PUBLIC/anon que sí se le
--    puso a todo lo demás. Riesgo real hoy: bajo (RLS de productos ya blinda
--    incluso si alguien pasa un empresa_id ajeno, porque esta función es
--    SECURITY INVOKER, no DEFINER), pero sin motivo para que anon la tenga.
--    Probado con BEGIN...ROLLBACK: sigue devolviendo los mismos 52 productos
--    de bajo stock de Nalux después del fix.
--
-- 2) marcar_cae_resuelto_manual(uuid, text, text, date) — la version ACTIVA
--    (hay otro overload de 1 solo argumento, sin ningún grant, huérfano, no
--    se toca acá). La usa MonitorFacturacionAFIP.jsx vía supabase.rpc(...) —
--    se mantiene el grant a `authenticated`, se saca el de `anon`. Ya se
--    protegía sola por sus propios checks de empresa_id/permiso de módulo,
--    pero sin motivo para que un anónimo pueda ni siquiera intentar llamarla.
--
-- 3) rls_auto_enable() — RETURNS event_trigger: no es una función invocable
--    normalmente, sólo la dispara el motor de event triggers de Postgres al
--    crear una tabla nueva (para prenderle RLS sola). El mecanismo de event
--    trigger no depende del GRANT de EXECUTE para dispararse — revocarlo de
--    PUBLIC/anon/authenticated no afecta su funcionamiento real, sólo cierra
--    la posibilidad de que alguien la llame a mano vía /rest/v1/rpc (nunca
--    tuvo sentido, confirmado con grep que nada en src/ la llama directo).

CREATE OR REPLACE FUNCTION public.productos_stock_bajo(p_empresa_id uuid)
 RETURNS TABLE(id uuid, nombre text, stock_actual integer, stock_minimo integer, unidad_medida text)
 LANGUAGE sql
 STABLE
 SET search_path = public
AS $function$
  SELECT id, nombre, stock_actual, stock_minimo, unidad_medida
  FROM public.productos
  WHERE empresa_id = p_empresa_id
    AND activo = true
    AND stock_actual <= stock_minimo
  ORDER BY nombre;
$function$;

REVOKE EXECUTE ON FUNCTION public.productos_stock_bajo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.productos_stock_bajo(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.marcar_cae_resuelto_manual(uuid, text, text, date) FROM PUBLIC, anon;

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
