-- migration 226 — Revocar anon EXECUTE en 3 RPCs de dinero que lo recuperaron
--
-- HALLAZGO (barrido general, sesión 80, vía get_advisors de Supabase): 3 funciones
-- que mueven plata volvieron a quedar ejecutables por el rol `anon` (público, sin
-- login):
--   - registrar_cobro_cliente   (recreada con p_forma_pago_id en mig.215)
--   - registrar_pago_proveedor  (recreada con p_forma_pago_id en mig.215)
--   - acreditar_movimiento_caja (nueva en mig.216 — liquidación de tarjetas)
--
-- Por qué reaparecieron: las migrations 192/194 revocaron `anon` de todas las RPCs
-- de ese momento. Pero cuando una función se recrea con una FIRMA NUEVA (agregar
-- un parámetro cambia la identidad de la función para Postgres), el REVOKE viejo
-- ya no aplica y Supabase vuelve a otorgar EXECUTE a anon/authenticated por
-- default. Así que estas 3 quedaron con el grant de anon otra vez.
--
-- ¿Es explotable? NO. Las 3 tienen el guard interno
-- `IF auth.role() IS DISTINCT FROM 'service_role' THEN IF <empresa> IS DISTINCT
-- FROM get_my_empresa_id() THEN RAISE 'No autorizado' ...`. Para anon,
-- get_my_empresa_id() es NULL, así que el p_empresa_id recibido nunca coincide y
-- la función aborta antes de tocar nada. Verificado. Esto es hardening / defensa
-- en profundidad y consistencia con la política de 192/194 — no un bug vivo.
--
-- Fix: revocar EXECUTE de PUBLIC y anon; re-otorgar explícito a authenticated +
-- service_role (que sí las necesitan: la app y el backend). Mismo patrón exacto
-- que la migration 194.

REVOKE EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid, uuid, uuid, text, numeric, text, timestamp with time zone, text, uuid, numeric, numeric, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid, uuid, uuid, text, numeric, text, timestamp with time zone, text, uuid, numeric, numeric, jsonb, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb, timestamp with time zone, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb, timestamp with time zone, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.acreditar_movimiento_caja(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acreditar_movimiento_caja(uuid) TO authenticated, service_role;

-- ROLLBACK (comentado): GRANT EXECUTE ON FUNCTION ... TO anon; para cada una — no
-- se recomienda, anon nunca debería poder invocar estas 3.
