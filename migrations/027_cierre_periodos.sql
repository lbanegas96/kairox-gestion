-- ── Tabla periodos_contables ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.periodos_contables (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre            TEXT        NOT NULL,
  fecha_inicio      DATE        NOT NULL,
  fecha_cierre      DATE        NOT NULL,
  estado            TEXT        NOT NULL DEFAULT 'abierto'
                                CHECK (estado IN ('abierto', 'cerrado')),
  cerrado_por       UUID        REFERENCES public.profiles(id),
  fecha_cierre_real TIMESTAMPTZ,
  observaciones     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT periodos_fechas_check CHECK (fecha_cierre >= fecha_inicio)
);

-- RLS
ALTER TABLE public.periodos_contables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "periodos_select" ON public.periodos_contables
  FOR SELECT USING (empresa_id = get_my_empresa_id());

CREATE POLICY "periodos_insert" ON public.periodos_contables
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id());

CREATE POLICY "periodos_update" ON public.periodos_contables
  FOR UPDATE USING (empresa_id = get_my_empresa_id());

-- Index para lookup eficiente por empresa + estado
CREATE INDEX IF NOT EXISTS idx_periodos_empresa_estado
  ON public.periodos_contables(empresa_id, estado);

-- ── Función fecha_en_periodo_cerrado ─────────────────────────────────────────
-- Recibe DATE (YYYY-MM-DD), no TIMESTAMPTZ

CREATE OR REPLACE FUNCTION public.fecha_en_periodo_cerrado(
  p_empresa_id UUID,
  p_fecha      DATE
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.periodos_contables
    WHERE empresa_id = p_empresa_id
      AND estado     = 'cerrado'
      AND p_fecha   BETWEEN fecha_inicio AND fecha_cierre
  );
$$;
