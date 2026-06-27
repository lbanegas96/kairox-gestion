-- ════════════════════════════════════════════════════════════════════════════
-- migration 102 — pg_cron: registrar job arca-worker cada 5 minutos
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO (sesión 65): el cron de supabase/config.toml [functions.arca-worker.cron]
-- NO se aplica automáticamente al hacer deploy via MCP (deploy_edge_function).
-- Solo se aplicaría con `supabase functions deploy` via CLI + proyecto vinculado.
-- Resultado: el worker existe y funciona, pero NUNCA corría en forma autónoma.
-- Las 4 facturas pendientes (20260626-006 a 009) tienen intentos=0 porque ningún
-- cron las procesó desde que se crearon.
--
-- FIX: habilitar pg_cron + pg_net y registrar el job directamente en la DB.
-- La anon key es segura para embeber aquí: es la publishable key (ya visible en
-- el browser). El worker tiene verify_jwt=false → no necesita service_role.
-- Uso de pg_net (disponible en Supabase por defecto) para hacer el HTTP POST.
-- El worker es idempotente: si no hay facturas pendientes, devuelve vacío y termina.

-- ── 1. Habilitar extensiones ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 2. Registrar el cron (idempotente: eliminar si existe primero) ────────────
DO $$
BEGIN
  PERFORM cron.unschedule('arca-worker-every-5-min');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'arca-worker-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/arca-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ── 3. Verificar que quedó registrado ────────────────────────────────────────
-- SELECT jobid, jobname, schedule, active FROM cron.job;

-- ROLLBACK:
-- SELECT cron.unschedule('arca-worker-every-5-min');
