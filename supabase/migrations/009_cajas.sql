-- ==============================================================
-- Migration 009: Tabla cajas (terminales POS) + caja_id en caja_sesiones
-- Ejecutar en Supabase SQL Editor
-- ==============================================================

-- 1. Tabla cajas
CREATE TABLE IF NOT EXISTS public.cajas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre     text NOT NULL DEFAULT 'Caja Principal',
  activo     boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- 2. RLS
ALTER TABLE public.cajas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cajas_all" ON public.cajas
  FOR ALL
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- 3. Columna caja_id en caja_sesiones
ALTER TABLE public.caja_sesiones
  ADD COLUMN IF NOT EXISTS caja_id uuid REFERENCES public.cajas(id);

-- 4. Unique index: solo 1 sesión abierta por caja
CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_sesion_abierta
  ON public.caja_sesiones(caja_id)
  WHERE estado = 'abierta';

-- 5. Backfill: crear "Caja Principal" para cada empresa existente que no tenga caja
INSERT INTO public.cajas (empresa_id, nombre)
SELECT e.id, 'Caja Principal'
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.cajas c WHERE c.empresa_id = e.id
);

-- 6. Backfill: asignar caja_id a sesiones existentes
UPDATE public.caja_sesiones cs
SET caja_id = c.id
FROM public.cajas c
WHERE c.empresa_id = cs.empresa_id
  AND cs.caja_id IS NULL;

-- 7. Trigger: auto-crear "Caja Principal" al registrar nueva empresa
CREATE OR REPLACE FUNCTION public.create_caja_principal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.cajas (empresa_id, nombre)
  VALUES (NEW.id, 'Caja Principal');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_empresa_caja_principal ON public.empresas;
CREATE TRIGGER trg_empresa_caja_principal
  AFTER INSERT ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.create_caja_principal();
