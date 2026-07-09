-- migration 168 — Centros de Costo (Fase 1 del plan de 4 frentes contables,
-- 2026-07-08). Dimensión analítica opcional para reportar por sucursal/línea
-- de negocio. 100% aditivo: columna nullable, nada existente cambia de
-- comportamiento si no se usa.

-- ── Maestro (mismo patrón que unidades_medida/condiciones_pago, mig.043) ────
CREATE TABLE IF NOT EXISTS public.centros_costo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(empresa_id, nombre)
);

ALTER TABLE public.centros_costo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "centros_costo_all" ON public.centros_costo;
CREATE POLICY "centros_costo_all" ON public.centros_costo
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

REVOKE ALL ON public.centros_costo FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.centros_costo TO authenticated;

-- ── FK opcional en los 3 puntos donde se genera un resultado ────────────────
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS centro_costo_id UUID REFERENCES public.centros_costo(id) ON DELETE SET NULL;

ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS centro_costo_id UUID REFERENCES public.centros_costo(id) ON DELETE SET NULL;

ALTER TABLE public.asientos_contables
  ADD COLUMN IF NOT EXISTS centro_costo_id UUID REFERENCES public.centros_costo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_comprobantes_centro_costo ON public.comprobantes(centro_costo_id) WHERE centro_costo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_compras_centro_costo      ON public.compras(centro_costo_id)      WHERE centro_costo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asientos_centro_costo     ON public.asientos_contables(centro_costo_id) WHERE centro_costo_id IS NOT NULL;

-- ROLLBACK (comentado):
-- ALTER TABLE public.asientos_contables DROP COLUMN IF EXISTS centro_costo_id;
-- ALTER TABLE public.compras            DROP COLUMN IF EXISTS centro_costo_id;
-- ALTER TABLE public.comprobantes       DROP COLUMN IF EXISTS centro_costo_id;
-- DROP TABLE IF EXISTS public.centros_costo;
