-- 416 — Permisos de registrar_factura_compra_oc (9 parámetros): espejo en el repo de lo que YA está en producción
--
-- La mig. 398 hizo CREATE OR REPLACE de registrar_factura_compra_oc agregando 3 parámetros con DEFAULT NULL. Postgres
-- identifica las funciones por la firma completa, así que eso NO reemplazó la de 6 parámetros: creó un overload nuevo de
-- 9 al lado. Y toda función nueva nace con EXECUTE para PUBLIC, así que el overload de 9 quedó ejecutable sin sesión
-- (`anon`). En producción se corrigió el 20/09 con la migración `fix_grant_registrar_factura_compra_oc_9params`
-- (versión 20260920152149), pero ese cambio nunca llegó a un archivo del repo: una base recreada desde el repo (la CI de
-- pgTAP, un staging) dejaba el overload de 9 parámetros abierto a `anon`. Hallazgo COD-3 de la auditoría del 24/09.
--
-- Esta migración es ese mismo cambio.
--   · EN PRODUCCIÓN YA ESTÁ APLICADO (verificado el 25/09: en las dos firmas anon=false, authenticated=true, public=false),
--     así que aplicarla de nuevo no cambia nada. Existe para que el repo y la base coincidan.
--   · Se revoca también de `anon` de forma explícita, por si en algún entorno (un Postgres local, un staging) los
--     privilegios por defecto le dan EXECUTE a `anon` de forma directa y `FROM PUBLIC` solo no alcanzara.
--
-- Las otras dos "migraciones sin archivo" que listaba COD-3 (`revoke_execute_anon_defensa_profundidad_fix` y
-- `ajuste_inflacion_fase2_reportes_fix`) resultaron estar ya incorporadas a los archivos 353 y 380 (mismo contenido,
-- verificado por hash del texto normalizado), así que no necesitan archivo nuevo. La `349_stock_disponible_vista.sql` sí
-- existe y su vista es idéntica a la de producción (la limpieza de datos que trae se hizo a mano); solo falta su
-- registro en el historial de Supabase, que no afecta a nada.
--
-- Nota: el overload viejo de 6 parámetros sigue existiendo a propósito (mismo criterio que la migración de producción:
-- se elimina aparte, cuando se confirme que ningún navegador quedó con la versión vieja del frontend).

REVOKE EXECUTE ON FUNCTION public.registrar_factura_compra_oc(
  uuid, uuid, uuid, text, date, jsonb, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.registrar_factura_compra_oc(
  uuid, uuid, uuid, text, date, jsonb, text, text, text
) TO authenticated;
