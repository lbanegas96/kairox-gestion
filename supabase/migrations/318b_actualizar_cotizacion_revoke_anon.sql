-- migration 318b — actualizar_cotizacion: anon podía ejecutarla pese al REVOKE ALL FROM PUBLIC
--
-- Verificado con get_advisors() justo después de aplicar la mig.318: `anon` seguía con EXECUTE
-- (has_function_privilege confirmó true) — Supabase otorga privilegios por defecto a `anon` en
-- funciones nuevas del schema public, que un REVOKE ALL FROM PUBLIC no cubre (PUBLIC y el grant
-- directo a `anon` son cosas distintas). Mismo estándar que el resto del proyecto: `anon` en 0
-- funciones ejecutables.

REVOKE EXECUTE ON FUNCTION public.actualizar_cotizacion(uuid, uuid, text, jsonb, text, text, date, text, numeric, numeric) FROM anon;
REVOKE EXECUTE ON FUNCTION public.actualizar_cotizacion(uuid, uuid, text, jsonb, text, text, date, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.actualizar_cotizacion(uuid, uuid, text, jsonb, text, text, date, text, numeric, numeric) TO authenticated;
