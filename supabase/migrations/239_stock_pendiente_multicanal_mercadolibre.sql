-- Migration 239 — generaliza la cola de sync de stock a multi-canal y agrega
-- MercadoLibre (Fase 4 del adapter, ROADMAP.md).
--
-- Contexto: la cola integraciones_stock_pendiente (migración 233) se diseñó para
-- un solo canal (Tiendanube) — keyed por (empresa_id, producto_id). Pero un mismo
-- producto puede estar mapeado a Tiendanube Y MercadoLibre a la vez, y un cambio
-- de stock tiene que llegar a AMBOS. Se agrega la columna `canal` a la cola (en
-- vez de duplicar la tabla por canal) y se generaliza el trigger para encolar una
-- fila por cada canal activo con sincronizar_stock=true.
--
-- Dirección ÚNICA por canal: KAIROX → canal (KAIROX es la fuente de verdad del
-- stock). Igual criterio que Tiendanube.
--
-- ROLLBACK:
--   SELECT cron.unschedule('mercadolibre-stock-worker-every-5-min');
--   DROP TRIGGER IF EXISTS trg_queue_stock_canales ON public.productos;
--   DROP FUNCTION IF EXISTS public.fn_queue_stock_canales();
--   -- restaurar trigger/func fn_queue_stock_tiendanube (migración 233)
--   DROP INDEX IF EXISTS uq_stock_pendiente_activo_canal;
--   CREATE UNIQUE INDEX uq_stock_pendiente_activo ON public.integraciones_stock_pendiente
--     (empresa_id, producto_id) WHERE estado NOT IN ('sincronizado','error_definitivo');
--   ALTER TABLE public.integraciones_stock_pendiente DROP COLUMN canal;

-- ── 1. Columna canal en la cola ─────────────────────────────────────────────
ALTER TABLE public.integraciones_stock_pendiente
  ADD COLUMN IF NOT EXISTS canal TEXT;

-- Las filas existentes son todas de Tiendanube (único canal hasta ahora).
UPDATE public.integraciones_stock_pendiente SET canal = 'tiendanube' WHERE canal IS NULL;

ALTER TABLE public.integraciones_stock_pendiente
  ALTER COLUMN canal SET NOT NULL;

-- ── 2. Índice único ahora por canal: un producto puede tener una entrada activa
--    por CADA canal (Tiendanube y MercadoLibre a la vez), no una sola global. ──
DROP INDEX IF EXISTS uq_stock_pendiente_activo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_pendiente_activo_canal
  ON public.integraciones_stock_pendiente (empresa_id, producto_id, canal)
  WHERE estado NOT IN ('sincronizado', 'error_definitivo');

-- ── 3. Trigger generalizado: encola una fila por cada canal activo con
--    sincronizar_stock=true (reemplaza al fn_queue_stock_tiendanube de la 233). ─
CREATE OR REPLACE FUNCTION public.fn_queue_stock_canales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_actual IS NOT DISTINCT FROM OLD.stock_actual THEN
    RETURN NEW;
  END IF;

  -- Una fila por cada canal activo donde el producto esté mapeado con sync de
  -- stock. IN (...) explícito: solo canales con worker desplegado — no encolar
  -- para un canal sin quién lo procese (se acumularía 'pendiente' para siempre).
  INSERT INTO public.integraciones_stock_pendiente (empresa_id, producto_id, canal, estado, proximo_intento)
  SELECT DISTINCT NEW.empresa_id, NEW.id, ic.canal, 'pendiente', now()
  FROM public.integraciones_producto_mapeo ipm
  JOIN public.integraciones_canales ic ON ic.id = ipm.integracion_id
  WHERE ipm.producto_id = NEW.id
    AND ipm.sincronizar_stock = true
    AND ic.activo = true
    AND ic.canal IN ('tiendanube', 'mercadolibre')
  ON CONFLICT (empresa_id, producto_id, canal) WHERE estado NOT IN ('sincronizado', 'error_definitivo')
  DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_stock_canales() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_queue_stock_tiendanube ON public.productos;
DROP TRIGGER IF EXISTS trg_queue_stock_canales ON public.productos;
CREATE TRIGGER trg_queue_stock_canales
  AFTER UPDATE OF stock_actual ON public.productos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_queue_stock_canales();

-- El trigger/func viejo de la 233 queda huérfano (sin trigger que lo use); se
-- deja la función por si algún rollback la referencia, no molesta.

-- ── 4. pg_cron: correr mercadolibre-stock-worker cada 5 minutos ──────────────
-- Misma anon key pública ya usada en el resto de crons (worker verify_jwt=false).
DO $$
BEGIN
  PERFORM cron.unschedule('mercadolibre-stock-worker-every-5-min');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'mercadolibre-stock-worker-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/mercadolibre-stock-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
