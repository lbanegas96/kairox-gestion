-- Migration 243 — envío gratis y garantía por producto (Fase 7 del adapter MELI).
--
-- A pedido explícito de Nadia: no se replica TODA la pantalla de edición de
-- MELI (cuotas, retiro en persona, información regulatoria, factura A —
-- no factura A, no aplica), solo lo que realmente varía por producto en su
-- operación: envío gratis y garantía.
--
-- ROLLBACK:
--   ALTER TABLE public.producto_mercadolibre_config DROP COLUMN envio_gratis;
--   ALTER TABLE public.producto_mercadolibre_config DROP COLUMN garantia;

ALTER TABLE public.producto_mercadolibre_config
  ADD COLUMN IF NOT EXISTS envio_gratis boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS garantia     text;

COMMENT ON COLUMN public.producto_mercadolibre_config.envio_gratis IS 'Envío gratis (shipping.free_shipping) — a pedido de Nadia, varía por producto.';
COMMENT ON COLUMN public.producto_mercadolibre_config.garantia IS 'Texto libre de garantía (warranty) del producto, ej. "6 meses de garantía de fábrica".';
