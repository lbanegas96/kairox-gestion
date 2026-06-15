-- =============================================================================
-- 040_retroactive_tipos_cambio.sql
-- RETROACTIVA — Solo documentación. NO re-aplicar en Supabase (ya ejecutada).
-- Documenta la creación de la tabla tipos_cambio con RLS, índices y audit trigger.
-- =============================================================================

-- Tabla principal de tipos de cambio por empresa, moneda y fecha
CREATE TABLE IF NOT EXISTS public.tipos_cambio (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid        NOT NULL,
  moneda     text        NOT NULL DEFAULT 'USD',
  tasa       numeric     NOT NULL,
  fecha      date        NOT NULL,
  created_at timestamptz          DEFAULT now(),
  CONSTRAINT tipos_cambio_pkey PRIMARY KEY (id),
  CONSTRAINT tipos_cambio_empresa_id_moneda_fecha_key UNIQUE (empresa_id, moneda, fecha),
  CONSTRAINT tipos_cambio_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE
);

-- Índices de consulta rápida (empresa + moneda, ordenado por fecha DESC)
CREATE INDEX IF NOT EXISTS idx_tc_empresa_moneda_fecha
  ON public.tipos_cambio (empresa_id, moneda, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_tipos_cambio_empresa_fecha
  ON public.tipos_cambio (empresa_id, moneda, fecha DESC);

-- RLS — solo registros de la propia empresa
ALTER TABLE public.tipos_cambio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tc_all" ON public.tipos_cambio;
CREATE POLICY "tc_all" ON public.tipos_cambio
  AS PERMISSIVE FOR ALL
  USING      (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

DROP POLICY IF EXISTS "tipos_cambio_empresa_all" ON public.tipos_cambio;
CREATE POLICY "tipos_cambio_empresa_all" ON public.tipos_cambio
  AS PERMISSIVE FOR ALL
  USING      (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- Audit trigger (fn_audit_trigger documentada en 042)
DROP TRIGGER IF EXISTS trg_audit_tipos_cambio ON public.tipos_cambio;
CREATE TRIGGER trg_audit_tipos_cambio
  AFTER INSERT OR UPDATE OR DELETE ON public.tipos_cambio
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
