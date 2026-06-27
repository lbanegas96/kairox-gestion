-- migration 107 — pg_cron: mp-sync cada 30 minutos
-- Captura pagos aprobados en MP (incluyendo transferencias CVU) que no llegaron
-- por webhook. Complementa a mp-webhook para cobertura total.

DO $$
BEGIN
  PERFORM cron.unschedule('mp-sync-every-30-min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'mp-sync-every-30-min',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/mp-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ROLLBACK: SELECT cron.unschedule('mp-sync-every-30-min');
