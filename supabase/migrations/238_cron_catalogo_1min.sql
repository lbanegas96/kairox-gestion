-- migration 238 — bajar el cron de publicación de catálogo de 5 a 1 minuto.
--
-- Pedido de Luciano: ahora que el guardado dispara el worker inmediatamente
-- (dispararPublicacionCatalogo, fire-and-forget desde el frontend), el cron pasa
-- a ser la RED DE SEGURIDAD para lo que el disparo inmediato no haya cubierto
-- (falla de red del navegador, reintentos con backoff, error transitorio de TN).
-- Con la cola vacía el worker sale rápido (una sola query), así que 1 min no es
-- un problema de costo — el rate limit de Tiendanube solo se toca cuando hay
-- algo real para publicar. El CAS agregado en el worker (mig. de código, no de
-- schema) evita que el disparo inmediato y este cron dupliquen una publicación
-- si coinciden.

DO $$
BEGIN
  PERFORM cron.unschedule('tiendanube-catalogo-worker-every-5-min');
EXCEPTION WHEN OTHERS THEN
  -- job no existía con ese nombre, no-op
END $$;

SELECT cron.schedule(
  'tiendanube-catalogo-worker-every-1-min',
  '* * * * *',
  $cron$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/tiendanube-catalogo-publicar',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $cron$
);
