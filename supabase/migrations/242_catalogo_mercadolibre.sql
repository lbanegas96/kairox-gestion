-- Migration 242 — enganche al catálogo oficial de MercadoLibre (Fase 6).
--
-- Hallazgo real de la sesión anterior (ver CONTEXT.md): MELI rechaza el POST
-- /items con "body.required_fields [family_name]" en la inmensa mayoría de las
-- categorías reales (probado contra ropa, mates, electrodomésticos) — todas
-- están atadas a un catalog_domain. En cuanto se manda family_name, MELI exige
-- que el ítem se enganche a su catálogo oficial (rechaza el title propio).
--
-- Fix real: agregar catalog_product_id a la config del producto. Si el usuario
-- eligió un match del catálogo de MELI (buscado por marca/modelo desde
-- mercadolibre-categorias, acción catalog_search), el worker de publicación
-- arma un body mínimo enganchado a esa ficha (MELI trae título/fotos de ahí,
-- KAIROX solo pone precio/stock/condición). Si no hay catalog_product_id, el
-- worker sigue el camino viejo (title propio) — que solo funciona en las pocas
-- categorías sin catalog_domain.
--
-- ROLLBACK:
--   ALTER TABLE public.producto_mercadolibre_config DROP COLUMN catalog_product_id;
--   ALTER TABLE public.producto_mercadolibre_config DROP COLUMN catalog_product_name;

ALTER TABLE public.producto_mercadolibre_config
  ADD COLUMN IF NOT EXISTS catalog_product_id   TEXT,
  ADD COLUMN IF NOT EXISTS catalog_product_name  TEXT;

COMMENT ON COLUMN public.producto_mercadolibre_config.catalog_product_id IS
  'Ficha del catálogo oficial de MELI a la que se engancha la publicación (GET /products/search). NULL = publicación libre (solo funciona en categorías sin catalog_domain).';
