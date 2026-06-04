-- =============================================================================
-- MIGRACIÓN 002: Módulo de Cotizaciones / Presupuestos
-- Flujo: cotizacion (borrador→enviada→aprobada→rechazada) → venta
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.cotizaciones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  numero          TEXT NOT NULL,
  cliente_id      UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  cliente_nombre  TEXT,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_vencimiento TIMESTAMPTZ,
  estado          TEXT NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador', 'enviada', 'aprobada', 'rechazada', 'vencida', 'convertida')),
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  descuento       NUMERIC(5,2)  NOT NULL DEFAULT 0,    -- porcentaje
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda          TEXT NOT NULL DEFAULT 'ARS',
  notas           TEXT,
  condiciones_pago TEXT,
  comprobante_id  UUID REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cotizacion_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cotizacion_id   UUID NOT NULL REFERENCES public.cotizaciones(id) ON DELETE CASCADE,
  empresa_id      UUID NOT NULL,
  producto_id     UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  descripcion     TEXT NOT NULL,
  cantidad        NUMERIC(10,3) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(12,2) NOT NULL,
  descuento_item  NUMERIC(5,2)  NOT NULL DEFAULT 0,
  subtotal        NUMERIC(12,2) NOT NULL,
  unidad_medida   TEXT
);

-- Índices
CREATE INDEX idx_cotizaciones_empresa ON public.cotizaciones(empresa_id);
CREATE INDEX idx_cotizaciones_cliente ON public.cotizaciones(cliente_id);
CREATE INDEX idx_cotizaciones_estado  ON public.cotizaciones(estado);
CREATE INDEX idx_cotizaciones_fecha   ON public.cotizaciones(fecha DESC);
CREATE INDEX idx_cotizacion_items_cot ON public.cotizacion_items(cotizacion_id);

-- RLS
ALTER TABLE public.cotizaciones     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cotizacion_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cotizaciones_empresa" ON public.cotizaciones
  USING (empresa_id = public.get_my_empresa_id());
CREATE POLICY "cotizacion_items_empresa" ON public.cotizacion_items
  USING (empresa_id = public.get_my_empresa_id());

-- Función: generar número de cotización correlativo por empresa
CREATE OR REPLACE FUNCTION public.next_cotizacion_number(p_empresa_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(numero, '[^0-9]', '', 'g') AS INT)), 0) + 1
  INTO next_num
  FROM public.cotizaciones
  WHERE empresa_id = p_empresa_id;
  RETURN 'COT-' || LPAD(next_num::TEXT, 5, '0');
END;
$$;

-- Trigger: actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_cotizaciones_updated_at
  BEFORE UPDATE ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Trigger auditoría
CREATE TRIGGER trg_audit_cotizaciones
  AFTER INSERT OR UPDATE OR DELETE ON public.cotizaciones
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
