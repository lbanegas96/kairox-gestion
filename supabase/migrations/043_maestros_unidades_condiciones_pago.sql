-- Migration 043: Maestros reales — Unidades de Medida + Condiciones de Pago
-- Reemplaza placeholders de ConfiguracionSection Tab 4 (Inventario) y Tab 2 (Finanzas).
-- Aplicada via MCP Supabase el 2026-06-16.

-- ── Unidades de Medida ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unidades_medida (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo      TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(empresa_id, codigo)
);
ALTER TABLE public.unidades_medida ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "unidades_medida_all" ON public.unidades_medida;
CREATE POLICY "unidades_medida_all" ON public.unidades_medida
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- ── Condiciones de Pago ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.condiciones_pago (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  dias_credito   INTEGER NOT NULL DEFAULT 0,
  descuento_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(empresa_id, nombre)
);
ALTER TABLE public.condiciones_pago ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "condiciones_pago_all" ON public.condiciones_pago;
CREATE POLICY "condiciones_pago_all" ON public.condiciones_pago
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- FK opcional en clientes — aditivo. NOTA: clientes ya tiene DOS columnas de texto
-- preexistentes y distintas: `condiciones_pago` (plural, Textarea de notas libres,
-- en uso activo en ClientesSection.jsx) y `condicion_pago` (singular, TEXT, sin
-- ninguna referencia en código — columna huérfana). Esta migration NO toca ninguna
-- de las dos; solo agrega la FK nueva.
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS condicion_pago_id UUID REFERENCES public.condiciones_pago(id) ON DELETE SET NULL;

-- ── Función de seed — mismo patrón que seed_plan_cuentas ────────────────
CREATE OR REPLACE FUNCTION public.seed_maestros_default(p_empresa_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.unidades_medida (empresa_id, codigo, descripcion) VALUES
    (p_empresa_id, 'UN',  'Unidad'),
    (p_empresa_id, 'KG',  'Kilogramo'),
    (p_empresa_id, 'GR',  'Gramo'),
    (p_empresa_id, 'LT',  'Litro'),
    (p_empresa_id, 'ML',  'Mililitro'),
    (p_empresa_id, 'MT',  'Metro'),
    (p_empresa_id, 'CM',  'Centímetro'),
    (p_empresa_id, 'CJ',  'Caja'),
    (p_empresa_id, 'PQ',  'Paquete'),
    (p_empresa_id, 'DOC', 'Docena'),
    (p_empresa_id, 'PAR', 'Par')
  ON CONFLICT (empresa_id, codigo) DO NOTHING;

  INSERT INTO public.condiciones_pago (empresa_id, nombre, dias_credito, descuento_pct) VALUES
    (p_empresa_id, 'Contado', 0, 0),
    (p_empresa_id, '15 días', 15, 0),
    (p_empresa_id, '30 días', 30, 0),
    (p_empresa_id, '60 días', 60, 0),
    (p_empresa_id, '90 días', 90, 0)
  ON CONFLICT (empresa_id, nombre) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_maestros_default(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_maestros_default(UUID) TO authenticated;

-- ── Auto-seed para empresas nuevas ───────────────────────────────────────
-- IMPORTANTE: no existe ningún trigger/función que llame seed_plan_cuentas
-- automáticamente al crear una empresa — esa siembra es 100% manual (botón
-- "Inicializar" en PlanCuentasSection -> planCuentasService.seedCuentas()).
-- El único trigger real AFTER INSERT en `empresas` es trg_empresa_caja_principal
-- (migration 009), que crea "Caja Principal". Para que estos maestros nuevos SÍ
-- sean automáticos, se agrega un trigger independiente — no se toca
-- create_caja_principal() para no arriesgar una función que ya funciona en prod.
CREATE OR REPLACE FUNCTION public.trg_fn_seed_maestros_empresa()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.seed_maestros_default(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_empresa_seed_maestros ON public.empresas;
CREATE TRIGGER trg_empresa_seed_maestros
  AFTER INSERT ON public.empresas
  FOR EACH ROW EXECUTE FUNCTION public.trg_fn_seed_maestros_empresa();

-- ── Seed retroactivo para empresas existentes ────────────────────────────
DO $$
DECLARE
  v_empresa RECORD;
BEGIN
  FOR v_empresa IN SELECT id FROM public.empresas LOOP
    PERFORM public.seed_maestros_default(v_empresa.id);
  END LOOP;
END $$;
