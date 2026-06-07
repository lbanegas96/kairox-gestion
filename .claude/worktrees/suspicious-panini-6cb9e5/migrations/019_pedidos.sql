-- =============================================================================
-- MIGRACIÓN 019: Pedidos de Clientes
-- Flujo: borrador → confirmado → en_preparacion → facturado | cancelado
-- Idempotente: IF NOT EXISTS / DROP … IF EXISTS en políticas y triggers
-- =============================================================================

-- Tabla principal
CREATE TABLE IF NOT EXISTS public.pedidos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  numero          TEXT NOT NULL,
  cliente_id      UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  cliente_nombre  TEXT,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_entrega   DATE,
  estado          TEXT NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador', 'confirmado', 'en_preparacion', 'facturado', 'cancelado')),
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas           TEXT,
  comprobante_id  UUID REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ítems del pedido
CREATE TABLE IF NOT EXISTS public.pedido_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id       UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  empresa_id      UUID NOT NULL,
  producto_id     UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  descripcion     TEXT NOT NULL,
  cantidad        NUMERIC(10,3) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidad_medida   TEXT
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa  ON public.pedidos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente  ON public.pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado   ON public.pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha    ON public.pedidos(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_pedido_items_ped ON public.pedido_items(pedido_id);

-- RLS
ALTER TABLE public.pedidos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedidos_empresa"      ON public.pedidos;
DROP POLICY IF EXISTS "pedido_items_empresa" ON public.pedido_items;

CREATE POLICY "pedidos_empresa" ON public.pedidos
  USING (empresa_id = public.get_my_empresa_id());
CREATE POLICY "pedido_items_empresa" ON public.pedido_items
  USING (empresa_id = public.get_my_empresa_id());

-- Número correlativo por empresa (PED-00001, PED-00002, …)
CREATE OR REPLACE FUNCTION public.next_pedido_number(p_empresa_id UUID)
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
  FROM public.pedidos
  WHERE empresa_id = p_empresa_id;
  RETURN 'PED-' || LPAD(next_num::TEXT, 5, '0');
END;
$$;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_pedidos_updated_at ON public.pedidos;
CREATE TRIGGER trg_pedidos_updated_at
  BEFORE UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- Trigger auditoría
DROP TRIGGER IF EXISTS trg_audit_pedidos ON public.pedidos;
CREATE TRIGGER trg_audit_pedidos
  AFTER INSERT OR UPDATE OR DELETE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();
