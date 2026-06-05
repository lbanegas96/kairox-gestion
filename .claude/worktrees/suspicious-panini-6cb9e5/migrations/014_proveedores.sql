-- ==============================================================
-- Migration 014: Módulo Proveedores completo
-- La tabla proveedores ya existe (referenciada en 003 y 012)
-- pero solo tiene id. Agregamos ficha completa + cuenta corriente.
-- Ejecutar en Supabase SQL Editor
-- ==============================================================

-- 1. Completar tabla proveedores con ficha completa
ALTER TABLE public.proveedores
  ADD COLUMN IF NOT EXISTS empresa_id      uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS nombre          text,
  ADD COLUMN IF NOT EXISTS razon_social    text,
  ADD COLUMN IF NOT EXISTS cuit            text,
  ADD COLUMN IF NOT EXISTS condicion_iva   text NOT NULL DEFAULT 'RI'
                                             CHECK (condicion_iva IN ('RI','Monotributo','Exento','CF','No Categorizado')),
  ADD COLUMN IF NOT EXISTS telefono        text,
  ADD COLUMN IF NOT EXISTS email           text,
  ADD COLUMN IF NOT EXISTS direccion       text,
  ADD COLUMN IF NOT EXISTS localidad       text,
  ADD COLUMN IF NOT EXISTS provincia       text DEFAULT 'Buenos Aires',
  ADD COLUMN IF NOT EXISTS condicion_pago  text NOT NULL DEFAULT 'contado'
                                             CHECK (condicion_pago IN ('contado','30 días','60 días','90 días','personalizado')),
  ADD COLUMN IF NOT EXISTS plazo_pago_dias int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activo          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notas           text,
  ADD COLUMN IF NOT EXISTS created_at      timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now();

-- Índices
CREATE INDEX IF NOT EXISTS idx_prov_empresa ON public.proveedores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_prov_nombre  ON public.proveedores(nombre);
CREATE INDEX IF NOT EXISTS idx_prov_activo  ON public.proveedores(activo);

-- RLS
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prov_empresa" ON public.proveedores;
CREATE POLICY "prov_empresa" ON public.proveedores
  FOR ALL
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_proveedores_updated_at ON public.proveedores;
CREATE TRIGGER trg_proveedores_updated_at
  BEFORE UPDATE ON public.proveedores
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 2. Cuenta corriente con proveedores
CREATE TABLE IF NOT EXISTS public.cuenta_corriente_proveedores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  proveedor_id    uuid NOT NULL REFERENCES public.proveedores(id) ON DELETE RESTRICT,
  tipo            text NOT NULL
                    CHECK (tipo IN ('compra','pago','nota_credito','nota_debito','ajuste')),
  monto           numeric(18,2) NOT NULL CHECK (monto > 0),
  descripcion     text,
  referencia_id   uuid,
  referencia_tipo text,
  fecha           timestamptz NOT NULL DEFAULT now(),
  user_id         uuid,
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE public.cuenta_corriente_proveedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ccp_empresa" ON public.cuenta_corriente_proveedores
  FOR ALL
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_ccp_empresa    ON public.cuenta_corriente_proveedores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_ccp_proveedor  ON public.cuenta_corriente_proveedores(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_ccp_fecha      ON public.cuenta_corriente_proveedores(fecha DESC);

-- 3. Vista: saldo de cuenta corriente por proveedor
CREATE OR REPLACE VIEW public.v_saldo_proveedores AS
SELECT
  p.id             AS proveedor_id,
  p.empresa_id,
  p.nombre,
  p.cuit,
  COALESCE(SUM(CASE WHEN m.tipo IN ('compra','nota_debito')  THEN  m.monto
                    WHEN m.tipo IN ('pago','nota_credito')   THEN -m.monto
                    ELSE 0 END), 0) AS saldo_deuda
FROM public.proveedores p
LEFT JOIN public.cuenta_corriente_proveedores m
  ON m.proveedor_id = p.id AND m.empresa_id = p.empresa_id
WHERE p.activo = true
GROUP BY p.id, p.empresa_id, p.nombre, p.cuit;
