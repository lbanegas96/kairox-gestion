-- migrations/034_retenciones.sql
-- Submódulo Impuestos (Fase A.2): retenciones sufridas y practicadas + vista de acumulado.
--
-- NOTA de numeración: el spec la llamaba 031, pero 031 ya estaba aplicada
-- (compras_add_tipo_cambio_tasa). Renumerada a 034.
-- Pre-requisito: migration 032 (alicuotas_impuestos) ya aplicada.

CREATE TABLE IF NOT EXISTS public.retenciones (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  tipo               TEXT NOT NULL CHECK (tipo IN ('sufrida', 'practicada')),
  impuesto           TEXT NOT NULL CHECK (impuesto IN ('IIBB', 'Ganancias', 'SUSS', 'IVA', 'Otro')),
  jurisdiccion       TEXT NOT NULL DEFAULT 'Córdoba',
  monto              NUMERIC(12,2) NOT NULL,
  alicuota_aplicada  NUMERIC(6,4),       -- % usado para calcular (informativo)
  fecha              DATE NOT NULL,
  -- "sufrida": quién te retuvo · "practicada": a quién le retuviste
  contraparte_nombre TEXT NOT NULL,
  contraparte_cuit   TEXT,
  -- Trazabilidad
  comprobante_id     UUID REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  compra_id          UUID REFERENCES public.compras(id) ON DELETE SET NULL,
  numero_certificado TEXT,
  observaciones      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.retenciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "retenciones_all" ON public.retenciones;
CREATE POLICY "retenciones_all" ON public.retenciones
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_retenciones_empresa_tipo_fecha
  ON public.retenciones(empresa_id, tipo, fecha);

-- ── Acumulado mensual para DDJJ (vista, siempre actualizada) ────────────────
CREATE OR REPLACE VIEW public.retenciones_acumulado_mensual
WITH (security_invoker = true) AS
SELECT
  empresa_id,
  tipo,
  impuesto,
  jurisdiccion,
  DATE_TRUNC('month', fecha)::DATE AS periodo,
  SUM(monto) AS total_monto,
  COUNT(*)   AS cantidad
FROM public.retenciones
GROUP BY empresa_id, tipo, impuesto, jurisdiccion, DATE_TRUNC('month', fecha);
