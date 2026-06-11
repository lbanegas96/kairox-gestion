-- migrations/026_onboarding.sql
-- Columnas de onboarding y datos básicos de empresa.
-- Idempotente: todas las columnas usan IF NOT EXISTS.
-- Nota: empresas ya tiene afip_cuit (migration 025). Aquí se agrega cuit (campo genérico
--       de exhibición/onboarding) y los demás campos de perfil básico.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS rubro                  TEXT,
  ADD COLUMN IF NOT EXISTS cuit                   TEXT,
  ADD COLUMN IF NOT EXISTS direccion              TEXT,
  ADD COLUMN IF NOT EXISTS telefono               TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completado  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_paso        INTEGER NOT NULL DEFAULT 0;
  -- onboarding_paso: 0=no iniciado, 1=datos empresa guardados, 2=primer producto, 3=completado

-- Índice útil para analytics: empresas que aún no completaron onboarding
CREATE INDEX IF NOT EXISTS idx_empresas_onboarding
  ON public.empresas(onboarding_completado)
  WHERE onboarding_completado = false;
