-- migration 109 — pg_cron: mp-sync cada 2 minutos (antes 30 min, migration 107)
-- Reduce la latencia de captura de pagos MP que no llegan por webhook.

-- Desagenda el job anterior (y el nuevo, por idempotencia si se re-corre)
DO $$
BEGIN
  PERFORM cron.unschedule('mp-sync-every-30-min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.unschedule('mp-sync-every-2-min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- TODO: mover a vault o variable de entorno si es posible, para
-- revisarlo en la auditoría de seguridad que vamos a hacer después.
-- (el Authorization Bearer es el anon key — público por diseño, no service_role)
SELECT cron.schedule(
  'mp-sync-every-2-min',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/mp-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ROLLBACK:
--   SELECT cron.unschedule('mp-sync-every-2-min');
--   y volver a crear 'mp-sync-every-30-min' con '*/30 * * * *' (ver migration 107)
