-- Migration 007: Agregar empresa_id a cuenta_corriente_movimientos + corregir RLS
-- Problema: la tabla fue creada sin empresa_id; el INSERT falla con 403 RLS.

-- 1. Agregar columna empresa_id si no existe
ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES public.empresas(id) ON DELETE CASCADE;

-- 2. Agregar created_at si no existe (fix anterior de sesión)
ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Backfill: completar empresa_id desde la empresa del cliente
UPDATE public.cuenta_corriente_movimientos ccm
SET empresa_id = c.empresa_id
FROM public.clientes c
WHERE ccm.cliente_id = c.id
  AND ccm.empresa_id IS NULL;

-- 4. Reemplazar políticas RLS (eliminar las viejas, crear unified basada en empresa_id)
DROP POLICY IF EXISTS "cta_cte_all"               ON public.cuenta_corriente_movimientos;
DROP POLICY IF EXISTS "cta_cte_movimientos_all"   ON public.cuenta_corriente_movimientos;
DROP POLICY IF EXISTS "Enable all for tenant"      ON public.cuenta_corriente_movimientos;

CREATE POLICY "cta_cte_empresa" ON public.cuenta_corriente_movimientos
  FOR ALL
  USING      (empresa_id = public.get_my_empresa_id())
  WITH CHECK (empresa_id = public.get_my_empresa_id());
