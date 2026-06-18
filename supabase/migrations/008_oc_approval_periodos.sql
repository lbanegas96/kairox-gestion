-- =============================================================================
-- MIGRACIÓN 008: Workflow aprobación OC + Cierre de períodos contables
-- =============================================================================

-- ── 1. Agregar estado pendiente_aprobacion a ordenes_compra ───────────────────
-- Primero eliminamos la constraint existente y la recreamos con el nuevo valor.
ALTER TABLE public.ordenes_compra
  DROP CONSTRAINT IF EXISTS ordenes_compra_estado_check;

ALTER TABLE public.ordenes_compra
  ADD CONSTRAINT ordenes_compra_estado_check
  CHECK (estado IN ('borrador','pendiente_aprobacion','enviada','recibida_parcial','recibida','cancelada'));

-- ── 2. Tabla de períodos contables ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.periodos_contables (
  empresa_id    UUID    NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  anio          INTEGER NOT NULL,
  mes           INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  cerrado       BOOLEAN NOT NULL DEFAULT false,
  fecha_cierre  TIMESTAMPTZ,
  cerrado_por   UUID    REFERENCES auth.users(id),
  PRIMARY KEY (empresa_id, anio, mes)
);

ALTER TABLE public.periodos_contables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "periodos_empresa" ON public.periodos_contables
  FOR ALL USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK         (empresa_id = public.get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_periodos_empresa ON public.periodos_contables(empresa_id, anio DESC, mes DESC);
