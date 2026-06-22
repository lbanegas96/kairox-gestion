-- Sesión 47: cierra un hallazgo MÁS SEVERO de lo documentado inicialmente.
-- El advisor marcaba la policy "service role puede insertar" de
-- movimientos_uala como WITH CHECK siempre true, pero al revisar el TO de la
-- policy se confirmó que NO estaba scoped a service_role (estaba en PUBLIC,
-- a pesar del nombre) — y la tabla además tenía GRANT INSERT a nivel tabla
-- para anon Y authenticated. Resultado real: cualquiera, incluso sin login,
-- podía insertar filas arbitrarias en movimientos_uala (tabla de
-- conciliación bancaria con Ualá).

-- 1. Revocar el INSERT a nivel tabla de anon/authenticated — solo el
--    integration job (service_role) debe escribir acá.
REVOKE INSERT ON public.movimientos_uala FROM anon, authenticated;

-- 2. Re-crear la policy explícitamente scoped a service_role (antes estaba
--    en PUBLIC pese al nombre "service role puede insertar").
DROP POLICY IF EXISTS "service role puede insertar" ON public.movimientos_uala;
CREATE POLICY "service role puede insertar" ON public.movimientos_uala
  FOR INSERT TO service_role
  WITH CHECK (true);

-- Rollback (comentado):
-- GRANT INSERT ON public.movimientos_uala TO anon, authenticated;
-- DROP POLICY "service role puede insertar" ON public.movimientos_uala;
-- CREATE POLICY "service role puede insertar" ON public.movimientos_uala FOR INSERT WITH CHECK (true);
