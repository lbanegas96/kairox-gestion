-- migration 114 — hardening: REVOKE EXECUTE en funciones-trigger (lista explícita)
--
-- PROBLEMA: estas funciones que devuelven `trigger` tenían EXECUTE para
-- authenticated/PUBLIC. Una función-trigger nunca debe ser invocable como RPC:
-- aunque la mayoría falla sin contexto de trigger, expone superficie de ataque
-- innecesaria (REST /rpc/<fn>). Política CLAUDE.md: revocar lo no usado.
--
-- SEGURO: la ejecución de un trigger NO chequea el privilegio EXECUTE de la función
-- (Postgres lo omite para triggers). Revocar EXECUTE no rompe ningún trigger.
--
-- ROLLBACK: no necesario — las funciones-trigger no requieren EXECUTE para operar.

REVOKE EXECUTE ON FUNCTION public.create_caja_principal()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_audit_trigger()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_oc_recalcular_estado()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_oc_update_stock()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_protect_profile_role()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_queue_factura_arca()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_seed_tipos_comprobante_afip() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_set_updated_at()            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_conciliado()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_update_cliente_saldo()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_uala_to_bancos()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_asiento_item_saldo()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_seed_maestros_empresa() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_fn_seed_series_numeracion() FROM PUBLIC, anon, authenticated;
