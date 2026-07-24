-- Migration 240 — publicar catálogo KAIROX → MercadoLibre (Fase 5 del adapter).
--
-- Espejo del "publicar catálogo" de Tiendanube (mig.235, Luciano), con la
-- diferencia clave de MELI: para CREAR una publicación hace falta categoría +
-- atributos obligatorios (marca/modelo/etc.), que Tiendanube no pide. Esos datos
-- viven en una tabla de config por producto (producto_mercadolibre_config), que
-- llena el usuario desde un formulario en la app.
--
-- Además se generaliza la cola de publicación integraciones_producto_pendiente a
-- multi-canal (agrega columna `canal`, mismo criterio que la cola de stock en la
-- mig.239), para que un producto pueda publicarse a Tiendanube Y MercadoLibre.
--
-- ROLLBACK:
--   SELECT cron.unschedule('mercadolibre-catalogo-worker-every-5-min');
--   DROP TRIGGER IF EXISTS trg_queue_publicar_meli_config ON public.producto_mercadolibre_config;
--   DROP FUNCTION IF EXISTS public.fn_queue_publicar_meli_config();
--   DROP TRIGGER IF EXISTS trg_queue_publicar_canales ON public.productos;
--   DROP FUNCTION IF EXISTS public.fn_queue_publicar_canales();
--   -- restaurar fn_queue_publicar_tiendanube/trigger (mig.235)
--   DROP INDEX IF EXISTS uq_producto_pendiente_activo_canal;
--   CREATE UNIQUE INDEX uq_producto_pendiente_activo ON public.integraciones_producto_pendiente
--     (empresa_id, producto_id) WHERE estado NOT IN ('publicado','error_definitivo');
--   ALTER TABLE public.integraciones_producto_pendiente DROP COLUMN canal;
--   DROP TABLE IF EXISTS public.producto_mercadolibre_config;

-- ── 1. Config MELI por producto (categoría + atributos obligatorios) ─────────
CREATE TABLE IF NOT EXISTS public.producto_mercadolibre_config (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id     UUID        NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  category_id     TEXT,                 -- ej 'MLA412351' (hoja del árbol de MELI)
  category_name   TEXT,                 -- para mostrar en la UI sin re-consultar
  condicion       TEXT        NOT NULL DEFAULT 'new' CHECK (condicion IN ('new','used')),
  listing_type_id TEXT        NOT NULL DEFAULT 'bronze',  -- 'bronze' = publicación gratuita
  -- Atributos obligatorios/opcionales cargados por el usuario: [{id, value_name}]
  atributos       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (producto_id)
);

ALTER TABLE public.producto_mercadolibre_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "producto_mercadolibre_config_tenant" ON public.producto_mercadolibre_config
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

DROP TRIGGER IF EXISTS trg_meli_config_updated_at ON public.producto_mercadolibre_config;
CREATE TRIGGER trg_meli_config_updated_at
  BEFORE UPDATE ON public.producto_mercadolibre_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

REVOKE ALL ON public.producto_mercadolibre_config FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.producto_mercadolibre_config TO authenticated;

-- ── 2. Cola de publicación → multi-canal ────────────────────────────────────
ALTER TABLE public.integraciones_producto_pendiente
  ADD COLUMN IF NOT EXISTS canal TEXT;

UPDATE public.integraciones_producto_pendiente SET canal = 'tiendanube' WHERE canal IS NULL;

ALTER TABLE public.integraciones_producto_pendiente
  ALTER COLUMN canal SET NOT NULL;

DROP INDEX IF EXISTS uq_producto_pendiente_activo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_pendiente_activo_canal
  ON public.integraciones_producto_pendiente (empresa_id, producto_id, canal)
  WHERE estado NOT IN ('publicado', 'error_definitivo');

-- ── 3. Trigger generalizado sobre productos (reemplaza fn_queue_publicar_tiendanube) ─
-- Encola una fila por canal aplicable cuando el producto está marcado
-- publicar_ecommerce y cambió un campo publicable (o recién se activó).
--   - tiendanube: alcanza con integración activa.
--   - mercadolibre: además requiere config con categoría cargada (sin eso el
--     POST /items fallaría siempre — mejor no encolar hasta que esté completa).
CREATE OR REPLACE FUNCTION public.fn_queue_publicar_canales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.publicar_ecommerce IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.publicar_ecommerce IS NOT DISTINCT FROM OLD.publicar_ecommerce
     AND NEW.nombre           IS NOT DISTINCT FROM OLD.nombre
     AND NEW.descripcion      IS NOT DISTINCT FROM OLD.descripcion
     AND NEW.precio_venta     IS NOT DISTINCT FROM OLD.precio_venta THEN
    RETURN NEW;
  END IF;

  -- Tiendanube
  INSERT INTO public.integraciones_producto_pendiente (empresa_id, producto_id, canal, estado, proximo_intento)
  SELECT NEW.empresa_id, NEW.id, 'tiendanube', 'pendiente', now()
  WHERE EXISTS (
    SELECT 1 FROM public.integraciones_canales ic
    WHERE ic.empresa_id = NEW.empresa_id AND ic.canal = 'tiendanube' AND ic.activo = true
  )
  ON CONFLICT (empresa_id, producto_id, canal) WHERE estado NOT IN ('publicado', 'error_definitivo')
  DO NOTHING;

  -- MercadoLibre (requiere config con categoría)
  INSERT INTO public.integraciones_producto_pendiente (empresa_id, producto_id, canal, estado, proximo_intento)
  SELECT NEW.empresa_id, NEW.id, 'mercadolibre', 'pendiente', now()
  WHERE EXISTS (
      SELECT 1 FROM public.integraciones_canales ic
      WHERE ic.empresa_id = NEW.empresa_id AND ic.canal = 'mercadolibre' AND ic.activo = true
    )
    AND EXISTS (
      SELECT 1 FROM public.producto_mercadolibre_config c
      WHERE c.producto_id = NEW.id AND c.category_id IS NOT NULL
    )
  ON CONFLICT (empresa_id, producto_id, canal) WHERE estado NOT IN ('publicado', 'error_definitivo')
  DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_publicar_canales() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_queue_publicar_tiendanube ON public.productos;
DROP TRIGGER IF EXISTS trg_queue_publicar_canales ON public.productos;
CREATE TRIGGER trg_queue_publicar_canales
  AFTER INSERT OR UPDATE ON public.productos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_queue_publicar_canales();

-- ── 4. Trigger sobre la config MELI: al guardar/cambiar la config (categoría o
--    atributos), re-encolar la publicación a MercadoLibre si el producto está
--    marcado publicar_ecommerce e integración activa. Así, completar el formulario
--    dispara la (re)publicación sin tener que re-guardar el producto. ──────────
CREATE OR REPLACE FUNCTION public.fn_queue_publicar_meli_config()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.integraciones_producto_pendiente (empresa_id, producto_id, canal, estado, proximo_intento)
  SELECT NEW.empresa_id, NEW.producto_id, 'mercadolibre', 'pendiente', now()
  WHERE EXISTS (
      SELECT 1 FROM public.productos p
      WHERE p.id = NEW.producto_id AND p.publicar_ecommerce IS TRUE
    )
    AND EXISTS (
      SELECT 1 FROM public.integraciones_canales ic
      WHERE ic.empresa_id = NEW.empresa_id AND ic.canal = 'mercadolibre' AND ic.activo = true
    )
  ON CONFLICT (empresa_id, producto_id, canal) WHERE estado NOT IN ('publicado', 'error_definitivo')
  DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_publicar_meli_config() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_queue_publicar_meli_config ON public.producto_mercadolibre_config;
CREATE TRIGGER trg_queue_publicar_meli_config
  AFTER INSERT OR UPDATE ON public.producto_mercadolibre_config
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_queue_publicar_meli_config();

-- ── 5. pg_cron: correr mercadolibre-catalogo-publicar cada 5 minutos ─────────
DO $$
BEGIN
  PERFORM cron.unschedule('mercadolibre-catalogo-worker-every-5-min');
EXCEPTION WHEN OTHERS THEN
  -- job no existía, no-op
END $$;

SELECT cron.schedule(
  'mercadolibre-catalogo-worker-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/mercadolibre-catalogo-publicar',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
    body    := '{}'::jsonb
  ) AS request_id;
  $$
);
