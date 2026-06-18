-- ── Listas de precio por cliente ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS listas_precio (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  UUID NOT NULL,
  user_id     UUID NOT NULL,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lista_precio_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lista_precio_id  UUID NOT NULL REFERENCES listas_precio(id) ON DELETE CASCADE,
  empresa_id       UUID NOT NULL,
  producto_id      UUID NOT NULL,
  precio           NUMERIC(12,2) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lista_precio_id, producto_id)
);

-- Asignar lista a cliente
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS lista_precio_id UUID REFERENCES listas_precio(id) ON DELETE SET NULL;

-- Document Flow: link comprobante a cotización y pedido de origen
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS cotizacion_id UUID;
ALTER TABLE comprobantes ADD COLUMN IF NOT EXISTS pedido_id UUID;

-- ── Índices ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_listas_precio_empresa   ON listas_precio(empresa_id);
CREATE INDEX IF NOT EXISTS idx_lista_items_lista        ON lista_precio_items(lista_precio_id);
CREATE INDEX IF NOT EXISTS idx_lista_items_producto     ON lista_precio_items(producto_id, empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_lista_precio    ON clientes(lista_precio_id) WHERE lista_precio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comprobantes_cotizacion  ON comprobantes(cotizacion_id) WHERE cotizacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comprobantes_pedido      ON comprobantes(pedido_id) WHERE pedido_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE listas_precio     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lista_precio_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa_listas_precio"      ON listas_precio;
DROP POLICY IF EXISTS "empresa_lista_precio_items" ON lista_precio_items;

CREATE POLICY "empresa_listas_precio" ON listas_precio
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE POLICY "empresa_lista_precio_items" ON lista_precio_items
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- ── Audit triggers ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audit_listas_precio      ON listas_precio;
DROP TRIGGER IF EXISTS audit_lista_precio_items ON lista_precio_items;

CREATE TRIGGER audit_listas_precio
  AFTER INSERT OR UPDATE OR DELETE ON listas_precio
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER audit_lista_precio_items
  AFTER INSERT OR UPDATE OR DELETE ON lista_precio_items
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
