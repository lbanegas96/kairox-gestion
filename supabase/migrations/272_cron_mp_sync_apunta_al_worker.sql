-- ════════════════════════════════════════════════════════════════════════════
-- migration 272 — pg_cron: el job de MercadoPago pasa a apuntar a mp-sync-worker
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️ REQUIERE que la Edge Function `mp-sync-worker` esté DESPLEGADA ANTES de
-- aplicar esta migración (con `verify_jwt=false`, mismo criterio que
-- arca-worker). Si se aplica primero, el cron pega contra una función que no
-- existe y sigue fallando — distinto error, mismo resultado.
--
-- ── El incidente que arregla ────────────────────────────────────────────────
-- El job `mp-sync-every-2-min` (registrado por la mig.109) apuntaba a la Edge
-- Function `mp-sync`, que el 2026-07-14 (commit 7bccea5, "fix(seguridad): 3
-- hallazgos en integración MercadoPago") pasó a exigir `verifyAdmin(req)`.
--
-- Ese chequeo cerró un agujero real —cualquier usuario autenticado de
-- cualquier tenant podía forzar el sync de TODAS las empresas— y NO se toca.
-- El problema es que el cron invoca con la anon key, que no es un JWT de
-- usuario: `verifyAdmin` la rechaza siempre. Resultado: **401 en el 100% de
-- las corridas desde el 2026-07-14, sin ningún síntoma visible.** El último
-- movimiento con `origen='mercadopago'` entró el 2026-07-13 21:46 AR.
-- Diagnosticado el 2026-07-29 (Nadia) mirando `net._http_response`.
--
-- ── La solución ─────────────────────────────────────────────────────────────
-- Separar los dos puntos de entrada, que tienen posturas de auth distintas a
-- propósito (mismo patrón que arca-worker y tc-diario-sync, los dos crons que
-- sí funcionan):
--   - `mp-sync`        → queda igual: admin logueado, acotado a SU empresa.
--                        Es el botón "Actualizar MP" del frontend.
--   - `mp-sync-worker` → nueva: sin usuario, service_role, TODAS las empresas
--                        con integración activa. Es a la que apunta el cron.
-- La lógica de sync vive en `_shared/mpSync.ts` y la comparten las dos; la
-- consulta a `integraciones_bancarias` queda en cada una porque es ahí donde
-- se decide el alcance.
--
-- Se mantiene el nombre del job (`mp-sync-every-2-min`) y el schedule (*/2)
-- para no cambiar nada más que el destino. La anon key es segura de embeber:
-- es la publishable key, ya visible en el browser (misma nota que la mig.261).

-- ── 1. Extensiones (no-op si ya están, las habilitó la migración 102) ─────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 2. Re-registrar el job apuntando al worker (idempotente) ──────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('mp-sync-every-2-min');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'mp-sync-every-2-min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/mp-sync-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ── 3. Verificación post-aplicación ──────────────────────────────────────────
-- Que el job apunte al worker:
--   SELECT jobid, jobname, schedule, active, command FROM cron.job
--    WHERE jobname = 'mp-sync-every-2-min';
-- Que deje de dar 401 (esperar ~2 min y mirar la respuesta real, no solo que
-- el cron "succeeded" — cron.job_run_details dice si se encoló el POST, no qué
-- contestó la función):
--   SELECT status_code, left(content,120), created AT TIME ZONE 'America/Argentina/Buenos_Aires'
--     FROM net._http_response ORDER BY created DESC LIMIT 10;
--
-- OJO con el primer sync después de aplicar: `integraciones_bancarias.ultimo_sync`
-- de Nalux quedó en el 13/07, y `mp-sync` arranca desde ahí — el primer POST va a
-- pedirle a MercadoPago ~15 días de pagos de una sola vez, con `limit=100` en la
-- query. Si hubo más de 100 pagos aprobados en ese período, entran los 100 más
-- viejos y `ultimo_sync` avanza hasta `hasta` (ahora), **salteándose el resto**.
-- Conviene mirar cuántos entraron y, si se sospecha que faltan, retroceder
-- `ultimo_sync` a mano y volver a correr. No se automatiza acá porque paginar el
-- backfill es un cambio de comportamiento aparte, no parte de este arreglo.

-- ROLLBACK (vuelve a apuntar a mp-sync, o sea vuelve a fallar con 401 —
-- solo tiene sentido si se decide revertir el worker entero):
--   SELECT cron.unschedule('mp-sync-every-2-min');
--   SELECT cron.schedule('mp-sync-every-2-min', '*/2 * * * *', $$ ... url .../mp-sync ... $$);
