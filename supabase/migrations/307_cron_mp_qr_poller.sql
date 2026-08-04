-- mig.307 — Cron del mp-qr-poller (cada minuto)
--
-- Dispara `mp-qr-poller`, que hace dos cosas:
--   1. Consulta la API de MercadoPago por cada QR `pendiente` vigente y confirma
--      los que ya se pagaron (vía `confirmar_pago_qr`). Esto es lo que mantiene
--      vivo el cobro por QR mientras el webhook siga rechazando las
--      notificaciones de MP con 401 — ver el encabezado de la función.
--   2. Corre `expirar_qrs_vencidos()`, que devuelve el stock de los QRs que el
--      cliente abandonó. Sin esto, cada abandono deja stock descontado para
--      siempre (`crear_venta_pendiente_qr` lo descuenta al generar el QR).
--
-- CADENCIA: cada minuto, que es el mínimo de pg_cron. Implica que, con el
-- webhook caído, el cajero puede tardar hasta ~60s en ver "Pago acreditado" en
-- pantalla. Es aceptable como red de seguridad y desaparece en cuanto el webhook
-- funcione (ahí la confirmación vuelve a ser instantánea y el poller queda sólo
-- como respaldo). El modal del POS mientras tanto muestra el estado de espera
-- explícitamente, no se queda mudo.
--
-- SIN CLAVE EMBEBIDA — diferencia deliberada con los crons anteriores:
-- `mp-sync-worker`/`arca-worker` hardcodean la anon key en el `headers` del
-- `net.http_post` (la mig.109 dejó incluso un TODO al respecto). Acá no hace
-- falta: `mp-qr-poller` está desplegada con `verify_jwt=false`, así que el
-- gateway no pide `Authorization` — verificado con un `curl` sin ningún header,
-- que devolvió `HTTP 200`. Una clave menos en el repo.
--
-- La función no expone datos de ningún tenant (devuelve sólo contadores) y toda
-- la autorización real vive en los RPCs que llama, que son service_role-only.

DO $$
BEGIN
  PERFORM cron.unschedule('mp-qr-poller-every-1-min');
EXCEPTION WHEN OTHERS THEN
  -- el job no existía todavía — no-op
  NULL;
END $$;

SELECT cron.schedule(
  'mp-qr-poller-every-1-min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/mp-qr-poller',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Verificar:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'mp-qr-poller-every-1-min';
-- ROLLBACK:
--   SELECT cron.unschedule('mp-qr-poller-every-1-min');
