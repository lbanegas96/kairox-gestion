-- ============================================================
-- Migration 017: Pedidos de clientes + Condiciones de venta
-- Aplicar en Supabase SQL Editor
-- ============================================================

-- ── Columnas en clientes ─────────────────────────────────────
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS condiciones_pago TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS dias_credito     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bloquear_en_limite BOOLEAN DEFAULT false;

-- ── Tabla pedidos ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedidos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL,
  numero        TEXT NOT NULL,
  cliente_id    UUID REFERENCES clientes(id),
  cliente_nombre TEXT NOT NULL DEFAULT 'Consumidor Final',
  estado        TEXT NOT NULL DEFAULT 'borrador'
                  CHECK (estado IN ('borrador','confirmado','en_preparacion','facturado','cancelado')),
  notas         TEXT DEFAULT '',
  total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  fecha         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_entrega DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedido_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id       UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  empresa_id      UUID NOT NULL,
  producto_id     UUID REFERENCES productos(id),
  descripcion     TEXT NOT NULL DEFAULT '',
  cantidad        NUMERIC(12,3) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(14,2) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0
);

-- ── RLS pedidos ───────────────────────────────────────────────
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedido_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pedidos_empresa" ON pedidos;
CREATE POLICY "pedidos_empresa" ON pedidos
  FOR ALL USING (empresa_id = get_my_empresa_id());

DROP POLICY IF EXISTS "pedido_items_empresa" ON pedido_items;
CREATE POLICY "pedido_items_empresa" ON pedido_items
  FOR ALL USING (empresa_id = get_my_empresa_id());

-- ── Audit triggers ────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_pedidos ON pedidos;
CREATE TRIGGER audit_pedidos
  AFTER INSERT OR UPDATE OR DELETE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- ── updated_at auto ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS set_pedidos_updated_at ON pedidos;
CREATE TRIGGER set_pedidos_updated_at
  BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── Índices ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa   ON pedidos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente   ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado    ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedido_items_ped  ON pedido_items(pedido_id);
