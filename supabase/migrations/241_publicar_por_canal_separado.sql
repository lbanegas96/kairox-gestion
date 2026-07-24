-- Migration 241 — publicar por canal separado (Tiendanube vs MercadoLibre).
--
-- Hasta ahora había un único flag productos.publicar_ecommerce que exponía el
-- producto a TODOS los canales conectados. El usuario quiere control por canal:
-- poder publicar un producto en Tiendanube, en MercadoLibre, o en ambos, de forma
-- independiente. Se agrega productos.publicar_mercadolibre y publicar_ecommerce
-- pasa a significar "publicar en Tiendanube" (se mantiene el nombre de columna por
-- compatibilidad con el trigger/worker de Luciano; solo cambia el rótulo en la UI).
--
-- Los triggers de encolado pasan a mirar el flag de SU canal.
--
-- ROLLBACK:
--   -- restaurar fn_queue_publicar_canales y fn_queue_publicar_meli_config (mig.240)
--   ALTER TABLE public.productos DROP COLUMN publicar_mercadolibre;

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS publicar_mercadolibre boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.productos.publicar_ecommerce     IS 'Publicar en Tiendanube (canal ecommerce histórico).';
COMMENT ON COLUMN public.productos.publicar_mercadolibre  IS 'Publicar en MercadoLibre (requiere producto_mercadolibre_config con categoría).';

-- ── Trigger sobre productos: cada canal mira su propio flag ──────────────────
CREATE OR REPLACE FUNCTION public.fn_queue_publicar_canales()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- En UPDATE, ignorar si no cambió ningún flag de publicación ni un campo publicable.
  IF TG_OP = 'UPDATE'
     AND NEW.publicar_ecommerce    IS NOT DISTINCT FROM OLD.publicar_ecommerce
     AND NEW.publicar_mercadolibre IS NOT DISTINCT FROM OLD.publicar_mercadolibre
     AND NEW.nombre                IS NOT DISTINCT FROM OLD.nombre
     AND NEW.descripcion           IS NOT DISTINCT FROM OLD.descripcion
     AND NEW.precio_venta          IS NOT DISTINCT FROM OLD.precio_venta THEN
    RETURN NEW;
  END IF;

  -- Tiendanube: flag publicar_ecommerce + integración activa.
  IF NEW.publicar_ecommerce IS TRUE THEN
    INSERT INTO public.integraciones_producto_pendiente (empresa_id, producto_id, canal, estado, proximo_intento)
    SELECT NEW.empresa_id, NEW.id, 'tiendanube', 'pendiente', now()
    WHERE EXISTS (
      SELECT 1 FROM public.integraciones_canales ic
      WHERE ic.empresa_id = NEW.empresa_id AND ic.canal = 'tiendanube' AND ic.activo = true
    )
    ON CONFLICT (empresa_id, producto_id, canal) WHERE estado NOT IN ('publicado', 'error_definitivo')
    DO NOTHING;
  END IF;

  -- MercadoLibre: flag publicar_mercadolibre + integración activa + config con categoría.
  IF NEW.publicar_mercadolibre IS TRUE THEN
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
  END IF;

  RETURN NEW;
END;
$$;

-- ── Trigger sobre la config MELI: ahora mira publicar_mercadolibre ───────────
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
      WHERE p.id = NEW.producto_id AND p.publicar_mercadolibre IS TRUE
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
