-- Migration 379 -- Fix de seguridad sobre mig.378 (Ajuste por Inflación).
--
-- Hallazgo real vía Supabase Advisors post-deploy: las 3 funciones nuevas
-- quedaron ejecutables por el rol `anon` (sin autenticación) -- Postgres
-- otorga EXECUTE a PUBLIC por default en CREATE FUNCTION, y mig.378 solo
-- agregó GRANT a `authenticated` sin revocar el grant público. El caso
-- grave: `_lineas_ajuste_por_inflacion` NO valida empresa/auth internamente
-- (es un helper interno, pensado para ser llamado solo desde las otras 2
-- funciones) -- cualquiera sin loguearse podía llamarla vía REST con
-- cualquier periodo_id y leer nombres de cuenta + montos de ajuste de
-- CUALQUIER empresa. Las otras 2 (`calcular_preview_...`,
-- `generar_ajuste_por_inflacion`) sí validan `get_my_empresa_id()`/
-- `is_admin()` internamente, así que no filtraban datos pese al grant de
-- más -- igual se les revoca `anon` por buena práctica (defensa en
-- profundidad, mismo criterio que pide el Advisor).
--
-- ROLLBACK: no aplica (solo restringe permisos, no hay nada que revertir
-- a un estado "peor" con sentido).

-- `_lineas_ajuste_por_inflacion` es un helper interno -- las llamadas desde
-- calcular_preview_ajuste_por_inflacion/generar_ajuste_por_inflacion (ambas
-- SECURITY DEFINER) funcionan igual sin este grant, porque una función
-- llamando a otra función no pasa por la capa de permisos de PostgREST.
REVOKE EXECUTE ON FUNCTION public._lineas_ajuste_por_inflacion(UUID) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.calcular_preview_ajuste_por_inflacion(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generar_ajuste_por_inflacion(UUID, UUID) FROM PUBLIC, anon;
