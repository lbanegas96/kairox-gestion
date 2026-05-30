-- =============================================================================
-- MIGRACIÓN 003: Órdenes de Compra con workflow
-- Estados: borrador → enviada → recibida_parcial → recibida → cancelada
-- Al confirmar recepción → actualiza stock automáticamente
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ordenes_compra (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  numero          TEXT NOT NULL,
  proveedor_id    UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  proveedor_nombre TEXT,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_entrega_esperada TIMESTAMPTZ,
  estado          TEXT NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador', 'enviada', 'recibida_parcial', 'recibida', 'cancelada')),
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  moneda          TEXT NOT NULL DEFAULT 'ARS',
  forma_pago      TEXT NOT NULL DEFAULT 'Efectivo',
  estado_pago     TEXT NOT NULL DEFAULT 'pendiente'
                    CHECK (estado_pago IN ('pendiente', 'parcial', 'pagada')),
  notas           TEXT,
  compra_id       UUID REFERENCES public.compras(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ordenes_compra_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orden_id        UUID NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE CASCADE,
  empresa_id      UUID NOT NULL,
  producto_id     UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  descripcion     TEXT NOT NULL,
  cantidad_pedida NUMERIC(10,3) NOT NULL DEFAULT 1,
  cantidad_recibida NUMERIC(10,3) NOT NULL DEFAULT 0,
  costo_unitario  NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL,
  unidad_medida   TEXT
);

-- Índices
CREATE INDEX idx_oc_empresa   ON public.ordenes_compra(empresa_id);
CREATE INDEX idx_oc_proveedor ON public.ordenes_compra(proveedor_id);
CREATE INDEX idx_oc_estado    ON public.ordenes_compra(estado);
CREATE INDEX idx_oc_fecha     ON public.ordenes_compra(fecha DESC);
CREATE INDEX idx_oc_items     ON public.ordenes_compra_items(orden_id);

-- RLS
ALTER TABLE public.ordenes_compra       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordenes_compra_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "oc_empresa"       ON public.ordenes_compra       USING (empresa_id = public.get_my_empresa_id());
CREATE POLICY "oc_items_empresa" ON public.ordenes_compra_items USING (empresa_id = public.get_my_empresa_id());

-- Numeración correlativa
CREATE OR REPLACE FUNCTION public.next_oc_number(p_empresa_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE next_num INT;
BEGIN
  SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(numero, '[^0-9]', '', 'g') AS INT)), 0) + 1
  INTO next_num FROM public.ordenes_compra WHERE empresa_id = p_empresa_id;
  RETURN 'OC-' || LPAD(next_num::TEXT, 5, '0');
END;
$$;

-- Trigger: al actualizar cantidad_recibida, actualizar stock si corresponde
CREATE OR REPLACE FUNCTION public.fn_oc_update_stock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  delta NUMERIC;
BEGIN
  -- Solo actúa cuando aumenta la cantidad recibida
  delta := NEW.cantidad_recibida - OLD.cantidad_recibida;
  IF delta > 0 AND NEW.producto_id IS NOT NULL THEN
    UPDATE public.productos
    SET stock_actual = stock_actual + delta,
        costo_compra = NEW.costo_unitario
    WHERE id = NEW.producto_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_oc_stock
  AFTER UPDATE OF cantidad_recibida ON public.ordenes_compra_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_oc_update_stock();

-- updated_at
CREATE TRIGGER trg_oc_updated_at
  BEFORE UPDATE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Auditoría
CREATE TRIGGER trg_audit_ordenes_compra
  AFTER INSERT OR UPDATE OR DELETE ON public.ordenes_compra
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
