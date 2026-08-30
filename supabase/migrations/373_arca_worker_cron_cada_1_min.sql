-- migration 373 — arca-worker pasa de cada 5 minutos a cada 1 minuto
-- (hallazgo Luciano 29/08, imprimiendo un ticket a Consumidor Final: "el
-- envío a ARCA debe ser más rápido" para que el CAE real llegue a tiempo en
-- vez de que el comprobante quede en "CAE pendiente").
--
-- Se combina con un disparo inmediato (dispararArcaWorker, src/lib/afipQueue.js)
-- justo después de encolar cada factura en los 3 puntos del frontend que lo
-- hacen (useFinalizarVentaPosterior — POS, NuevaVentaModal — venta ERP,
-- NuevaFacturaModal — Facturar Pedido) — el cron sigue siendo la red de
-- seguridad real (reintentos, ventas offline que se sincronizan después,
-- cualquier disparo que no llegue), este cambio solo la hace más frecuente
-- por si ese disparo inmediato falla o no llega a tiempo.
--
-- arca-worker ya tenía su propio lock de corrida única (arca_worker_run) y
-- procesa hasta 10 registros por corrida sin exceder el timeout — correr
-- cada 1 min en vez de cada 5 no cambia nada de esa lógica, solo la cadencia.
--
-- cron.schedule() con el mismo jobname reemplaza el job existente en vez de
-- duplicarlo (mismo criterio que mig.329) — se mantiene el nombre
-- "arca-worker-every-5-min" tal cual para no tener que tocar ningún otro
-- lugar que lo referencie por nombre; solo cambia el schedule real.

SELECT cron.schedule(
  'arca-worker-every-5-min',
  '* * * * *',
  $cron$SELECT net.http_post(
    url     := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/arca-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;$cron$
);

-- ROLLBACK (comentado): volver a cada 5 minutos.
-- SELECT cron.schedule('arca-worker-every-5-min', '*/5 * * * *', $cron$SELECT net.http_post(
--   url := 'https://isvkelrdxwvkfmrfqxxk.supabase.co/functions/v1/arca-worker',
--   headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzdmtlbHJkeHd2a2ZtcmZxeHhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4NDAxMDEsImV4cCI6MjEwMjQxNjEwMX0.LAQLAk-n_ArNo_CczH5XOoAAJhfCo0-T5NaOGJZjll8"}'::jsonb,
--   body := '{}'::jsonb
-- ) AS request_id;$cron$);
