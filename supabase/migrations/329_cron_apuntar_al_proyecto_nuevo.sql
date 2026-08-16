-- migration 329 — reapuntar los cron jobs al proyecto nuevo de Supabase
--
-- PROBLEMA (encontrado el 16/08, despues del corte a la cuenta nueva):
-- las migraciones que crean los cron jobs (102, 107, 109, 233, 235, 238, 239,
-- 240, 261, 272, 307, 316) tienen la URL del proyecto y la anon key
-- HARDCODEADAS. Al replicar el schema en el proyecto nuevo, los 8 jobs que
-- llaman Edge Functions quedaron apuntando a las funciones del proyecto VIEJO
-- (ref wuznppxeonmhfcvnqfbf), que trabajan contra la base VIEJA. Con la app ya
-- cortada a la base nueva, eso significa que arca-worker (facturacion AFIP
-- automatica), mp-sync, mp-qr-poller y los workers de Tiendanube/MercadoLibre
-- estaban corriendo contra la base equivocada — y desde el 17/08, cuando el
-- proyecto viejo queda restringido, directamente iban a fallar.
--
-- No alcanzo a romper nada: al momento de detectarlo no habia ningun registro
-- en estado pendiente en las colas (facturas_pendientes_arca,
-- integraciones_stock_pendiente, qr_pagos_mp) — verificado antes de aplicar.
--
-- SOLUCION: reprogramar los 8 jobs con la URL y la anon key del proyecto nuevo.
-- cron.schedule() con el mismo jobname reemplaza el job existente, no duplica.
-- La anon key es publishable (ya viaja al browser), no es un secreto — mismo
-- criterio que ya documentaba la migration 102.
--
-- Los 2 jobs que son SQL puro (aplicar-precios-programados-diario,
-- caea-marcar-vencidos-diario) no tocan ninguna URL y quedan como estaban.
--
-- PENDIENTE (deuda tecnica, no se resuelve aca): que la URL y la key salgan de
-- un solo lugar en vez de estar hardcodeadas en 12 migraciones distintas, para
-- que una mudanza de proyecto no vuelva a dejar los crons apuntando al lugar
-- viejo en silencio.
--
-- ROLLBACK: volver a correr este mismo bloque cambiando isvkelrdxwvkfmrfqxxk
-- por el ref del proyecto que corresponda y su anon key.

SELECT cron.schedule(
  'arca-worker-every-5-min',
  '*/5 * * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/arca-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);

SELECT cron.schedule(
  'mercadolibre-catalogo-worker-every-5-min',
  '*/5 * * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/mercadolibre-catalogo-publicar',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);

SELECT cron.schedule(
  'mercadolibre-stock-worker-every-5-min',
  '*/5 * * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/mercadolibre-stock-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);

SELECT cron.schedule(
  'mp-qr-poller-every-1-min',
  '* * * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/mp-qr-poller',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);

SELECT cron.schedule(
  'mp-sync-every-2-min',
  '*/2 * * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/mp-sync-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);

SELECT cron.schedule(
  'tc-diario-sync-8am-ar',
  '0 11 * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/tc-diario-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);

SELECT cron.schedule(
  'tiendanube-catalogo-worker-every-1-min',
  '* * * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/tiendanube-catalogo-publicar',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);

SELECT cron.schedule(
  'tiendanube-stock-worker-every-5-min',
  '*/5 * * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/tiendanube-stock-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);
