-- Sesión 47: cierra el hallazgo CRÍTICO de seguridad de la auditoría de
-- arquitectura — 28 funciones SECURITY DEFINER eran ejecutables por el rol
-- `anon` (sin autenticar) vía REST, protegidas hoy "por casualidad" porque
-- internamente chequean get_my_empresa_id() (NULL para anon), no por diseño
-- de permisos. Confirmado caller real de cada una antes de revocar:
-- - create_tenant: se llama desde OnboardingPage.jsx, que solo renderiza para
--   un usuario ya autenticado (useAuth().user) — nunca anon.
-- - email_exists_in_system: ÚNICA excepción, queda con acceso anon a
--   propósito (checkEmailExists() en validationUtils.js se llama durante el
--   formulario de signup, ANTES de que exista sesión).
-- - El resto: sin ningún caller legítimo pre-auth confirmado por grep.
--
-- También cierra el hallazgo de 9 funciones con search_path mutable
-- (incluye fn_calcular_costo_valoracion, el cálculo central de PPP).
--
-- REVOKE sobre un grant que no existe es un no-op en Postgres (no rompe nada
-- si una función no tenía grant a PUBLIC) — por eso se aplica el mismo patrón
-- a las 28 sin distinguir cuáles tenían grant a PUBLIC y cuáles no.

-- ───────────────────────────────────────────────────────────────────────────
-- Revocar anon (y PUBLIC, que anon hereda implícitamente) de 28 funciones.
-- ───────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.ajustar_stock_manual(uuid, text, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.aplicar_compra_producto(uuid, numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_entrega(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_recepcion(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_recepcion_implicita(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_caja_principal() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_tenant(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(uuid, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fecha_en_periodo_cerrado(uuid, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_audit_trigger() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_oc_update_stock() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_sync_conciliado() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_update_cliente_saldo() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_empresa_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.increment_stock(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.insertar_movimiento_bancario_externo(uuid, uuid, timestamp with time zone, text, numeric, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.obtener_proximo_numero(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_attempt(text, text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seed_maestros_default(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seed_plan_cuentas(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.seed_series_numeracion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.siguiente_numero_documento(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_uala_to_caja() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_fn_seed_maestros_empresa() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_fn_seed_series_numeracion() FROM PUBLIC, anon;

-- ───────────────────────────────────────────────────────────────────────────
-- search_path inmutable en las 9 funciones que no lo tenían.
-- ───────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.trg_fn_seed_series_numeracion() SET search_path TO 'public';
ALTER FUNCTION public.next_numero_asiento(uuid) SET search_path TO 'public';
ALTER FUNCTION public.trg_asiento_item_saldo() SET search_path TO 'public';
ALTER FUNCTION public.fn_set_updated_at() SET search_path TO 'public';
ALTER FUNCTION public.create_caja_principal() SET search_path TO 'public';
ALTER FUNCTION public.fn_calcular_costo_valoracion(text, numeric, numeric, numeric, numeric) SET search_path TO 'public';
ALTER FUNCTION public.recalcular_saldo_cuenta(uuid) SET search_path TO 'public';
ALTER FUNCTION public.email_exists_in_system(text) SET search_path TO 'public';
ALTER FUNCTION public.trg_fn_seed_maestros_empresa() SET search_path TO 'public';

-- Rollback (comentado): volver a otorgar a anon las 28 funciones de arriba
-- con GRANT EXECUTE ON FUNCTION ... TO anon; (no se documenta cada línea
-- porque NO debería revertirse — era el hallazgo crítico que esto cierra).
