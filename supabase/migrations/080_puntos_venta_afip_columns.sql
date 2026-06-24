-- 080_puntos_venta_afip_columns.sql
-- Agrega columnas AFIP/ARCA a puntos_venta (tabla ya existente desde una migration anterior).
-- Las columnas nuevas son: tipo, es_default, cai_remito, cai_remito_vencimiento,
-- proximo_numero_remito y updated_at.
-- Se agrega trigger de updated_at usando fn_set_updated_at (ya existente en el proyecto).

ALTER TABLE public.puntos_venta
  ADD COLUMN IF NOT EXISTS tipo                   TEXT    NOT NULL DEFAULT 'web'
    CHECK (tipo IN ('web', 'manual')),
  ADD COLUMN IF NOT EXISTS es_default             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cai_remito             TEXT,
  ADD COLUMN IF NOT EXISTS cai_remito_vencimiento DATE,
  ADD COLUMN IF NOT EXISTS proximo_numero_remito  INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT now();

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_puntos_venta_updated_at ON public.puntos_venta;
CREATE TRIGGER trg_puntos_venta_updated_at
  BEFORE UPDATE ON public.puntos_venta
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
