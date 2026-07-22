-- Migration 233 — cola de sync de stock KAIROX → Tiendanube (paso 3 del adapter,
-- ROADMAP.md). Mismo patrón ya probado en el código para AFIP (facturas_pendientes_arca
-- + arca-worker + pg_cron): trigger encola, un worker por cron procesa con reintentos.
-- Se elige este patrón (async, desacoplado) en vez de un HTTP call directo dentro
-- de la transacción de venta — igual criterio que "no bloquear la venta" ya
-- documentado en useConfirmarVenta.js para el encolado de CAE.
--
-- Dirección ÚNICA: KAIROX → Tiendanube (KAIROX es la fuente de verdad del stock).
-- El sync inverso (Tiendanube → KAIROX) queda fuera de alcance — es la pieza
-- difícil que el ROADMAP reserva para el adapter de MercadoLibre.
--
-- ROLLBACK:
--   SELECT cron.unschedule('tiendanube-stock-worker-every-5-min');
--   DROP TRIGGER IF EXISTS trg_queue_stock_tiendanube ON public.productos;
--   DROP FUNCTION IF EXISTS public.fn_queue_stock_tiendanube();
--   DROP TABLE IF EXISTS public.integraciones_stock_pendiente;
--   ALTER TABLE public.integraciones_producto_mapeo DROP COLUMN external_product_id;

-- ── 1. external_product_id: la API de Tiendanube para actualizar stock exige
--    el product_id padre en la URL (POST /products/{product_id}/variants/stock),
--    no alcanza con el id de la variante que ya guardábamos. ──────────────────
ALTER TABLE public.integraciones_producto_mapeo
  ADD COLUMN IF NOT EXISTS external_product_id TEXT;

-- ── 2. Cola de sync (mismo estilo que facturas_pendientes_arca) ──────────────
CREATE TABLE IF NOT EXISTS public.integraciones_stock_pendiente (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id     UUID        NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  estado          TEXT        NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','procesando','sincronizado','error_definitivo')),
  intentos        INTEGER     NOT NULL DEFAULT 0,
  max_intentos    INTEGER     NOT NULL DEFAULT 5,
  proximo_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_mensaje   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un producto no se encola 2 veces mientras ya tenga una entrada activa —
-- el worker siempre lee el stock_actual MÁS RECIENTE al procesar (no un
-- snapshot guardado en la cola), así que no hace falta apilar una fila por
-- cada cambio de stock intermedio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_pendiente_activo
  ON public.integraciones_stock_pendiente (empresa_id, producto_id)
  WHERE estado NOT IN ('sincronizado', 'error_definitivo');

CREATE INDEX IF NOT EXISTS idx_stock_pendiente_worker
  ON public.integraciones_stock_pendiente (estado, proximo_intento);

ALTER TABLE public.integraciones_stock_pendiente ENABLE ROW LEVEL SECURITY;

CREATE POLICY "integraciones_stock_pendiente_tenant" ON public.integraciones_stock_pendiente
  USING (empresa_id = get_my_empresa_id());

DROP TRIGGER IF EXISTS trg_stock_pendiente_updated_at ON public.integraciones_stock_pendiente;
CREATE TRIGGER trg_stock_pendiente_updated_at
  BEFORE UPDATE ON public.integraciones_stock_pendiente
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

REVOKE ALL ON public.integraciones_stock_pendiente FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integraciones_stock_pendiente TO authenticated;

-- ── 3. Trigger: encolar cuando cambia stock_actual, SOLO si el producto tiene
--    un mapeo activo con sincronizar_stock=true (evita encolar cambios de stock
--    de productos que nunca se conectaron a ningún canal — sería 100% ruido). ──
CREATE OR REPLACE FUNCTION public.fn_queue_stock_tiendanube()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stock_actual IS NOT DISTINCT FROM OLD.stock_actual THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.integraciones_producto_mapeo ipm
    JOIN public.integraciones_canales ic ON ic.id = ipm.integracion_id
    WHERE ipm.producto_id = NEW.id
      AND ipm.sincronizar_stock = true
      AND ic.activo = true
      AND ic.canal = 'tiendanube'
  ) THEN
    RETURN NEW;
  END IF;

  -- ON CONFLICT (columnas) WHERE ... — no "ON CONFLICT ON CONSTRAINT": un índice
  -- único PARCIAL (CREATE UNIQUE INDEX ... WHERE) no es una constraint real de
  -- Postgres, así que solo se puede referenciar por columnas + predicado exacto,
  -- no por nombre.
  INSERT INTO public.integraciones_stock_pendiente (empresa_id, producto_id, estado, proximo_intento)
  VALUES (NEW.empresa_id, NEW.id, 'pendiente', now())
  ON CONFLICT (empresa_id, producto_id) WHERE estado NOT IN ('sincronizado', 'error_definitivo')
  DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_stock_tiendanube() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_queue_stock_tiendanube ON public.productos;
CREATE TRIGGER trg_queue_stock_tiendanube
  AFTER UPDATE OF stock_actual ON public.productos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_queue_stock_tiendanube();

-- ── 4. pg_cron: correr tiendanube-stock-worker cada 5 minutos ────────────────
-- pg_cron/pg_net ya están habilitados desde la migración 102 (arca-worker).
-- Misma anon key ya embebida en esa migración (es la publishable key, pública
-- por diseño — el worker es verify_jwt=false, no necesita service_role).
DO $$
BEGIN
  PERFORM cron.unschedule('tiendanube-stock-worker-every-5-min');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'tiendanube-stock-worker-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/tiendanube-stock-worker',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
