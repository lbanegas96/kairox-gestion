-- ════════════════════════════════════════════════════════════════════════════
-- migration 261 — pg_cron: registrar job tc-diario-sync todos los días 08:00 AR
-- ════════════════════════════════════════════════════════════════════════════
--
-- Fase B de PLAN_TC_AUTOMATICO.md. Depende de la migración 260 (columnas
-- `empresas.tc_automatico` y `tipos_cambio.origen`) y de la Edge Function
-- `tc-diario-sync`, ya deployada.
--
-- Mismo patrón y misma justificación que la migración 102 (arca-worker): el cron
-- declarado en supabase/config.toml NO se aplica al deployar via MCP, hay que
-- registrarlo en la DB. La anon key es segura para embeber acá: es la publishable
-- key, ya visible en el browser.
--
-- HORARIO: '0 11 * * *' = 11:00 UTC = 08:00 AR (offset fijo UTC-3, Argentina no
-- tiene horario de verano desde 2009). Se eligió 08:00 para que el TC esté cargado
-- antes de que abra el primer local.
--
-- CORRE TODOS LOS DÍAS, fines de semana incluidos, a propósito: el gate de moneda
-- paralela busca un TC con `fecha = hoy`, así que si sábado y domingo no se
-- escribiera ninguna fila, toda operación de fin de semana quedaría bloqueada
-- (y KAIROX tiene clientes de retail que operan sábados). Con el mercado cerrado
-- dolarapi devuelve la última cotización — la del viernes — que además es el
-- tratamiento financiero correcto: valuar al cierre del último día hábil.
--
-- La función es idempotente y segura de re-ejecutar: si no hay ninguna empresa
-- con `tc_automatico=true` no escribe nada, y nunca pisa un TC cargado a mano.

-- ── 1. Extensiones (no-op si ya están, las habilitó la migración 102) ─────────
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── 2. Registrar el cron (idempotente: eliminar si existe primero) ────────────
DO $$
BEGIN
  PERFORM cron.unschedule('tc-diario-sync-8am-ar');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'tc-diario-sync-8am-ar',
  '0 11 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/tc-diario-sync',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);

-- ── 3. Verificar que quedó registrado ────────────────────────────────────────
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'tc-diario-sync-8am-ar';

-- ROLLBACK:
-- SELECT cron.unschedule('tc-diario-sync-8am-ar');
