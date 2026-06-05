-- ==============================================================
-- Migration 013: Multi-moneda
-- Tabla tipos_cambio + columnas tipo_cambio_tasa en tablas operativas
-- Ejecutar en Supabase SQL Editor
-- ==============================================================

-- 1. Tabla de tipos de cambio históricos
CREATE TABLE IF NOT EXISTS public.tipos_cambio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  moneda      text NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD', 'EUR', 'BRL')),
  tasa        numeric(18,4) NOT NULL CHECK (tasa > 0),
  fecha       date NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (empresa_id, moneda, fecha)
);

ALTER TABLE public.tipos_cambio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tc_all" ON public.tipos_cambio;
CREATE POLICY "tc_all" ON public.tipos_cambio
  FOR ALL
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_tc_empresa_moneda_fecha
  ON public.tipos_cambio(empresa_id, moneda, fecha DESC);

-- 2. Función: obtener tasa vigente para una moneda y fecha
--    Busca la tasa más reciente <= fecha dada
CREATE OR REPLACE FUNCTION public.get_tasa_cambio(
  p_empresa_id uuid,
  p_moneda     text,
  p_fecha      date DEFAULT CURRENT_DATE
)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tasa
  FROM public.tipos_cambio
  WHERE empresa_id = p_empresa_id
    AND moneda = p_moneda
    AND fecha <= p_fecha
  ORDER BY fecha DESC
  LIMIT 1;
$$;

-- 3. Agregar tipo_cambio_tasa a cotizaciones
--    (moneda ya existe desde migration 002)
ALTER TABLE public.cotizaciones
  ADD COLUMN IF NOT EXISTS tipo_cambio_tasa numeric(18,4) NOT NULL DEFAULT 1;

-- 4. Agregar tipo_cambio_tasa a ordenes_compra
--    (moneda ya existe desde migration 003)
ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS tipo_cambio_tasa numeric(18,4) NOT NULL DEFAULT 1;

-- 5. Agregar moneda + tipo_cambio_tasa a comprobantes (ventas)
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS moneda           text NOT NULL DEFAULT 'ARS',
  ADD COLUMN IF NOT EXISTS tipo_cambio_tasa numeric(18,4) NOT NULL DEFAULT 1;
