-- ==============================================================
-- Migration 011: Módulo Cuentas Bancarias
-- Tabla cuentas_bancarias + movimientos_bancarios
-- Ejecutar en Supabase SQL Editor
-- ==============================================================

-- 1. Tabla cuentas_bancarias
CREATE TABLE IF NOT EXISTS public.cuentas_bancarias (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre          text NOT NULL,
  banco           text NOT NULL,
  cbu_alias       text,
  moneda          text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD', 'EUR')),
  plan_cuenta_id  uuid REFERENCES public.plan_cuentas(id) ON DELETE SET NULL,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.cuentas_bancarias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cb_all" ON public.cuentas_bancarias
  FOR ALL
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- 2. Tabla movimientos_bancarios
CREATE TABLE IF NOT EXISTS public.movimientos_bancarios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cuenta_bancaria_id  uuid NOT NULL REFERENCES public.cuentas_bancarias(id) ON DELETE CASCADE,
  fecha               timestamptz NOT NULL,
  descripcion         text NOT NULL DEFAULT '',
  monto               numeric NOT NULL CHECK (monto > 0),
  tipo                text NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  origen              text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'csv', 'email', 'webhook')),
  conciliado          boolean NOT NULL DEFAULT false,
  asiento_id          uuid REFERENCES public.asientos_contables(id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now()
);

ALTER TABLE public.movimientos_bancarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mb_all" ON public.movimientos_bancarios
  FOR ALL
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_mb_cuenta ON public.movimientos_bancarios(cuenta_bancaria_id);
CREATE INDEX IF NOT EXISTS idx_mb_fecha  ON public.movimientos_bancarios(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_mb_empresa ON public.movimientos_bancarios(empresa_id);
