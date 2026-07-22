-- Migration 235 — cola de publicación de catálogo KAIROX → Tiendanube
-- (FASE 2 del build "Publicar catálogo", diseño en
-- docs/DISENO_publicar_catalogo_tiendanube.md).
--
-- Espejo exacto del patrón de la cola de stock (mig.233) y de facturas_arca
-- (mig.087): un trigger encola cuando un producto marcado `publicar_ecommerce`
-- se crea o cambia un campo publicable, y un worker por pg_cron procesa con
-- reintentos/backoff. NO se hace el HTTP a Tiendanube dentro de la transacción
-- del alta/edición del producto — mismo criterio de "no bloquear la operación"
-- ya usado para CAE y stock.
--
-- Dirección ÚNICA KAIROX → Tiendanube: KAIROX es la fuente de verdad del
-- catálogo (decisión de Luciano). El worker decide crear vs actualizar según si
-- el producto ya tiene mapeo con external_product_id.
--
-- ROLLBACK:
--   SELECT cron.unschedule('tiendanube-catalogo-worker-every-5-min');
--   DROP TRIGGER IF EXISTS trg_queue_publicar_tiendanube ON public.productos;
--   DROP FUNCTION IF EXISTS public.fn_queue_publicar_tiendanube();
--   DROP TABLE IF EXISTS public.integraciones_producto_pendiente;

-- ── 1. Cola de publicación ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.integraciones_producto_pendiente (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id     UUID        NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  estado          TEXT        NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','procesando','publicado','error_definitivo')),
  intentos        INTEGER     NOT NULL DEFAULT 0,
  max_intentos    INTEGER     NOT NULL DEFAULT 5,
  proximo_intento TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_mensaje   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un producto no se apila 2 veces mientras tenga una entrada activa — el worker
-- lee el producto MÁS RECIENTE al procesar, así que no hace falta una fila por
-- cada edición intermedia.
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_pendiente_activo
  ON public.integraciones_producto_pendiente (empresa_id, producto_id)
  WHERE estado NOT IN ('publicado', 'error_definitivo');

CREATE INDEX IF NOT EXISTS idx_producto_pendiente_worker
  ON public.integraciones_producto_pendiente (estado, proximo_intento);

ALTER TABLE public.integraciones_producto_pendiente ENABLE ROW LEVEL SECURITY;

-- RLS tenant (mismo criterio que la cola de stock). El worker corre con
-- service_role y bypassea RLS; esto es para lectura del estado desde la UI.
CREATE POLICY "integraciones_producto_pendiente_tenant" ON public.integraciones_producto_pendiente
  USING (empresa_id = get_my_empresa_id());

DROP TRIGGER IF EXISTS trg_producto_pendiente_updated_at ON public.integraciones_producto_pendiente;
CREATE TRIGGER trg_producto_pendiente_updated_at
  BEFORE UPDATE ON public.integraciones_producto_pendiente
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

REVOKE ALL ON public.integraciones_producto_pendiente FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integraciones_producto_pendiente TO authenticated;

-- ── 2. Trigger: encolar publicación ─────────────────────────────────────────
-- Encola si el producto está marcado `publicar_ecommerce` y la empresa tiene una
-- integración de Tiendanube activa. En UPDATE, solo si cambió un campo publicable
-- (nombre/descripción/precio) o se acaba de activar la publicación — el stock lo
-- maneja su propia cola (fn_queue_stock_tiendanube), no esta.
CREATE OR REPLACE FUNCTION public.fn_queue_publicar_tiendanube()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.publicar_ecommerce IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- En UPDATE, evitar encolar por cambios irrelevantes (ej. solo stock).
  IF TG_OP = 'UPDATE'
     AND NEW.publicar_ecommerce IS NOT DISTINCT FROM OLD.publicar_ecommerce
     AND NEW.nombre           IS NOT DISTINCT FROM OLD.nombre
     AND NEW.descripcion      IS NOT DISTINCT FROM OLD.descripcion
     AND NEW.precio_venta     IS NOT DISTINCT FROM OLD.precio_venta THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.integraciones_canales ic
    WHERE ic.empresa_id = NEW.empresa_id
      AND ic.canal = 'tiendanube'
      AND ic.activo = true
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.integraciones_producto_pendiente (empresa_id, producto_id, estado, proximo_intento)
  VALUES (NEW.empresa_id, NEW.id, 'pendiente', now())
  ON CONFLICT (empresa_id, producto_id) WHERE estado NOT IN ('publicado', 'error_definitivo')
  DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_publicar_tiendanube() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_queue_publicar_tiendanube ON public.productos;
CREATE TRIGGER trg_queue_publicar_tiendanube
  AFTER INSERT OR UPDATE ON public.productos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_queue_publicar_tiendanube();

-- ── 3. pg_cron: correr tiendanube-catalogo-publicar cada 5 minutos ──────────
-- Mismo esquema que la cola de stock (mig.233): anon key pública embebida, el
-- worker es verify_jwt=false y usa service_role internamente vía adminClient.
DO $$
BEGIN
  PERFORM cron.unschedule('tiendanube-catalogo-worker-every-5-min');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'tiendanube-catalogo-worker-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/tiendanube-catalogo-publicar',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
