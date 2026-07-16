-- Migration 194 — REVOKE EXECUTE FROM PUBLIC en las RPCs SECURITY DEFINER que
-- seguían siendo ejecutables por `anon` (hallazgo, sesión 60, 2026-07-11).
--
-- CORRECCIÓN de la mig.192: esa migración revocó `FROM anon`, pero el grant que
-- realmente deja entrar a anon es `PUBLIC=EXECUTE` (anon lo hereda de PUBLIC).
-- Revocar FROM anon fue un no-op para estas funciones — su ACL nunca tuvo un
-- grant directo a anon, sino a PUBLIC. Confirmado empíricamente con
-- has_function_privilege('anon', oid, 'EXECUTE') = true DESPUÉS de aplicar la 192.
--
-- El grant correcto a revocar es PUBLIC. `authenticated` conserva su grant
-- explícito (los usuarios logueados siguen pudiendo llamar estas RPCs); anon
-- deja de poder. Estado objetivo = mismo ACL que ya tiene get_my_empresa_id
-- (postgres/authenticated/service_role, sin PUBLIC → anon_puede=false).
--
-- Nota de seguridad: esto es defensa en profundidad. Los guards internos de las
-- 7 funciones YA bloquean a anon a nivel lógico (get_my_empresa_id()=NULL para
-- anon + IS DISTINCT FROM / IS NULL) — no había exploit activo. El único caso
-- que SÍ era explotable, reintentar_cae_comprobante con su guard `<>` NULL-unsafe,
-- se corrigió en mig.191. Esta migración cierra el hueco de ACL que la 192 no cerró.
--
-- email_exists_in_system NO se toca: tiene grant DIRECTO a anon (no vía PUBLIC),
-- lo necesita pre-login (validación de signup) — sigue siendo callable sin sesión.

REVOKE EXECUTE ON FUNCTION public.crear_venta(uuid, uuid, text, timestamptz, uuid, text, numeric, text, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cambiar_estado_cheque(uuid, uuid, text, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerar_asiento_cxc(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.regenerar_asiento_cxp(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reintentar_cae_comprobante(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_module_permission(text) FROM PUBLIC;

-- El comentario de arriba dice "authenticated conserva su grant explícito" — pero
-- ese grant nunca se escribió en ninguna migration, para NINGUNA de las 7 funciones
-- de esta lista salvo has_module_permission, que necesita uno explícito porque a
-- diferencia de crear_venta/cambiar_estado_cheque/etc. (RPCs "de entrada" que sí
-- reciben su GRANT EXECUTE TO authenticated en su propia migration de creación),
-- has_module_permission es un helper interno que hasta ahora solo se llamaba
-- indirectamente y confiaba en el EXECUTE implícito de PUBLIC. Al revocarlo acá,
-- production ya tenía el grant explícito puesto a mano (verificado con pg_proc.proacl);
-- el replay desde cero no. Sin esto, cualquier RPC que llame has_module_permission()
-- rompe con "permission denied for function has_module_permission".
GRANT EXECUTE ON FUNCTION public.has_module_permission(text) TO authenticated, service_role;

-- ROLLBACK (comentado): GRANT EXECUTE ON FUNCTION public.<fn>(...) TO PUBLIC;
-- (no debería hacer falta — authenticated conserva su grant explícito).
