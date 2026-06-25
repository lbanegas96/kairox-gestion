-- ════════════════════════════════════════════════════════════════════════════
-- Migration 090 — pie_documento + stock_minimo_global en empresas
-- ════════════════════════════════════════════════════════════════════════════
--
-- pie_documento:       texto libre al pie de facturas, remitos y cotizaciones.
-- stock_minimo_global: umbral global para alertas de stock bajo;
--                      se aplica cuando el producto no tiene stock_minimo propio.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS pie_documento TEXT,
  ADD COLUMN IF NOT EXISTS stock_minimo_global INTEGER DEFAULT 5;

-- ROLLBACK:
-- ALTER TABLE public.empresas
--   DROP COLUMN IF EXISTS pie_documento,
--   DROP COLUMN IF EXISTS stock_minimo_global;
