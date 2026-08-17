-- ════════════════════════════════════════════════════════════════════════════
-- Migration 330 — Grants faltantes en RPCs de ARCA (encontrado al verificar la
-- migración de cuenta de Supabase, 16/08)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: se creó una Factura C real de prueba (FAC-20260816-003) contra el
-- proyecto nuevo (isvkelrdxwvkfmrfqxxk) para confirmar que AFIP/ARCA sigue
-- funcionando tras la mudanza de cuenta. ARCA emitió el CAE real, pero
-- arca-worker no pudo persistirlo:
--   "ARCA emitió el CAE pero no se pudo persistir:
--    permission denied for function fn_persistir_cae_emitido"
--
-- CAUSA RAÍZ: la migración 315 crea `fn_persistir_cae_emitido` (worker-only,
-- guardada con `auth.role() = 'service_role'`) y hace
-- `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` — pero nunca vuelve a
-- otorgar EXECUTE a `service_role` explícitamente. En Postgres, revocar de
-- PUBLIC le saca el acceso a cualquier rol que solo lo tuviera por herencia de
-- PUBLIC (service_role incluido) si no tiene su propio GRANT. En el proyecto
-- viejo esto funcionaba porque en algún momento se otorgó el GRANT a mano en
-- producción, sin migración — mismo patrón de drift ya encontrado y corregido
-- durante la migración de cuenta (triggers de `pedidos`, políticas RLS de
-- `periodos_contables`, índices de performance, ver PLAN_MIGRACION_SUPABASE.md
-- y CONTEXT.md), ahora en la categoría de GRANTs.
--
-- Mismo patrón preventivo para `reintentar_caes_lote` (migración 202, revocada
-- de PUBLIC en la 204): la usa el botón "Reintentar" de
-- `MonitorFacturacionAFIP.jsx`, corre con `has_module_permission('ventas')`
-- como guard interno — está pensada para `authenticated`, y tampoco tiene
-- ningún GRANT explícito en el repo. No se confirmó un error real todavía
-- (nadie usó ese botón post-migración), pero es la misma clase de bug, así
-- que se corrige preventivamente acá.

GRANT EXECUTE ON FUNCTION public.fn_persistir_cae_emitido(uuid, uuid, uuid, uuid, integer, text, date, text, integer)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.reintentar_caes_lote(uuid[])
  TO authenticated;

-- ROLLBACK (comentado):
--   REVOKE EXECUTE ON FUNCTION public.fn_persistir_cae_emitido(uuid, uuid, uuid, uuid, integer, text, date, text, integer) FROM service_role;
--   REVOKE EXECUTE ON FUNCTION public.reintentar_caes_lote(uuid[]) FROM authenticated;
