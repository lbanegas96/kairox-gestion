-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 035 — Document Flow: Modelo de datos (Prompt 1/6)
-- Ventas: Cotización → Pedido → Entrega → Factura → Devolución → NC/ND
-- Compras: OC → Recepción → Factura Compra → Devolución a Proveedor
--
-- PURAMENTE ADITIVO — no modifica ninguna RPC existente (crear_venta, etc.)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Parte 1: Contadores de cantidad en items existentes ───────────────────
-- Verificaciones previas aplicadas:
--   comprobante_items : no tenía columnas tracking → se agregan
--   pedido_items      : no tenía columnas tracking → se agregan
--   detalle_compras   : no tenía columnas tracking → se agregan
--   ordenes_compra_items : ya tiene cantidad_recibida (3-way match) → se omite;
--                          NO tiene cantidad_facturada ni cantidad_devuelta → se agregan

ALTER TABLE public.comprobante_items
  ADD COLUMN IF NOT EXISTS cantidad_entregada NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_devuelta  NUMERIC(12,3) NOT NULL DEFAULT 0;

ALTER TABLE public.pedido_items
  ADD COLUMN IF NOT EXISTS cantidad_entregada NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_facturada NUMERIC(12,3) NOT NULL DEFAULT 0;

ALTER TABLE public.detalle_compras
  ADD COLUMN IF NOT EXISTS cantidad_recibida NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_devuelta NUMERIC(12,3) NOT NULL DEFAULT 0;

-- ordenes_compra_items: cantidad_recibida YA EXISTE — solo agregar las que faltan
ALTER TABLE public.ordenes_compra_items
  ADD COLUMN IF NOT EXISTS cantidad_facturada NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cantidad_devuelta  NUMERIC(12,3) NOT NULL DEFAULT 0;


-- ── Parte 2: Tabla entregas ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entregas (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id     UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  numero_entrega TEXT        NOT NULL,
  -- Origen: desde un Pedido (flujo largo) o desde una Factura (POS, implícita)
  pedido_id      UUID        REFERENCES public.pedidos(id) ON DELETE SET NULL,
  comprobante_id UUID        REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  cliente_id     UUID        REFERENCES public.clientes(id) ON DELETE SET NULL,
  origen         TEXT        NOT NULL DEFAULT 'manual'
                 CHECK (origen IN ('implicita', 'manual')),
  estado         TEXT        NOT NULL DEFAULT 'entregado'
                 CHECK (estado IN ('pendiente', 'entregado', 'parcial', 'anulado')),
  fecha          DATE        NOT NULL DEFAULT CURRENT_DATE,
  observaciones  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.entregas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entregas_all" ON public.entregas;
CREATE POLICY "entregas_all" ON public.entregas
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_entregas_empresa     ON public.entregas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_entregas_pedido      ON public.entregas(pedido_id);
CREATE INDEX IF NOT EXISTS idx_entregas_comprobante ON public.entregas(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_entregas_cliente     ON public.entregas(cliente_id);

-- Items de Entrega
CREATE TABLE IF NOT EXISTS public.entrega_items (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  entrega_id     UUID        NOT NULL REFERENCES public.entregas(id) ON DELETE CASCADE,
  empresa_id     UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id    UUID        NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad       NUMERIC(12,3) NOT NULL,
  pedido_item_id UUID        REFERENCES public.pedido_items(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.entrega_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entrega_items_all" ON public.entrega_items;
CREATE POLICY "entrega_items_all" ON public.entrega_items
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_entrega_items_entrega ON public.entrega_items(entrega_id);


-- ── Parte 3: Tabla recepciones ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recepciones (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id       UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id          UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  numero_recepcion TEXT        NOT NULL,
  orden_compra_id  UUID        REFERENCES public.ordenes_compra(id) ON DELETE SET NULL,
  compra_id        UUID        REFERENCES public.compras(id) ON DELETE SET NULL,
  proveedor_id     UUID        REFERENCES public.proveedores(id) ON DELETE SET NULL,
  origen           TEXT        NOT NULL DEFAULT 'manual'
                   CHECK (origen IN ('implicita', 'manual')),
  estado           TEXT        NOT NULL DEFAULT 'recibido'
                   CHECK (estado IN ('pendiente', 'recibido', 'parcial', 'anulado')),
  fecha            DATE        NOT NULL DEFAULT CURRENT_DATE,
  observaciones    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recepciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recepciones_all" ON public.recepciones;
CREATE POLICY "recepciones_all" ON public.recepciones
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_recepciones_empresa   ON public.recepciones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_oc        ON public.recepciones(orden_compra_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_compra    ON public.recepciones(compra_id);
CREATE INDEX IF NOT EXISTS idx_recepciones_proveedor ON public.recepciones(proveedor_id);

-- Items de Recepción
-- Nota: la tabla real es ordenes_compra_items (con "es"), no orden_compra_items
CREATE TABLE IF NOT EXISTS public.recepcion_items (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  recepcion_id          UUID        NOT NULL REFERENCES public.recepciones(id) ON DELETE CASCADE,
  empresa_id            UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id           UUID        NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad              NUMERIC(12,3) NOT NULL,
  orden_compra_item_id  UUID        REFERENCES public.ordenes_compra_items(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.recepcion_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recepcion_items_all" ON public.recepcion_items;
CREATE POLICY "recepcion_items_all" ON public.recepcion_items
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_recepcion_items_recepcion ON public.recepcion_items(recepcion_id);


-- ── Parte 4: Tabla devoluciones ───────────────────────────────────────────
-- Nota: NCs en KAIROX están en comprobantes con tipo='nota_credito'
--       → nota_credito_id referencia comprobantes(id)
CREATE TABLE IF NOT EXISTS public.devoluciones (
  id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id             UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id                UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  numero_devolucion      TEXT        NOT NULL,
  tipo                   TEXT        NOT NULL CHECK (tipo IN ('cliente', 'proveedor')),
  -- Referencias de origen
  entrega_id             UUID        REFERENCES public.entregas(id) ON DELETE SET NULL,
  recepcion_id           UUID        REFERENCES public.recepciones(id) ON DELETE SET NULL,
  comprobante_id         UUID        REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  compra_id              UUID        REFERENCES public.compras(id) ON DELETE SET NULL,
  cliente_id             UUID        REFERENCES public.clientes(id) ON DELETE SET NULL,
  proveedor_id           UUID        REFERENCES public.proveedores(id) ON DELETE SET NULL,
  reingresa_stock        BOOLEAN     NOT NULL DEFAULT false,
  compensacion           TEXT        NOT NULL CHECK (compensacion IN ('nota_credito', 'reemplazo', 'pendiente')),
  reembolso_efectivo     BOOLEAN     NOT NULL DEFAULT false,
  motivo                 TEXT,
  fecha                  DATE        NOT NULL DEFAULT CURRENT_DATE,
  observaciones          TEXT,
  -- Documento generado como consecuencia (FK a comprobantes pues NCs están ahí)
  nota_credito_id        UUID        REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  entrega_reemplazo_id   UUID        REFERENCES public.entregas(id) ON DELETE SET NULL,
  recepcion_reemplazo_id UUID        REFERENCES public.recepciones(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.devoluciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "devoluciones_all" ON public.devoluciones;
CREATE POLICY "devoluciones_all" ON public.devoluciones
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_devoluciones_empresa   ON public.devoluciones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_tipo      ON public.devoluciones(empresa_id, tipo);
CREATE INDEX IF NOT EXISTS idx_devoluciones_cliente   ON public.devoluciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_devoluciones_proveedor ON public.devoluciones(proveedor_id);

-- Items de Devolución
CREATE TABLE IF NOT EXISTS public.devolucion_items (
  id                     UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  devolucion_id          UUID          NOT NULL REFERENCES public.devoluciones(id) ON DELETE CASCADE,
  empresa_id             UUID          NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  producto_id            UUID          NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad               NUMERIC(12,3) NOT NULL,
  precio_unitario        NUMERIC(12,2) NOT NULL,
  subtotal               NUMERIC(12,2) NOT NULL,
  comprobante_item_id    UUID          REFERENCES public.comprobante_items(id) ON DELETE SET NULL,
  detalle_compra_item_id UUID          REFERENCES public.detalle_compras(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.devolucion_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "devolucion_items_all" ON public.devolucion_items;
CREATE POLICY "devolucion_items_all" ON public.devolucion_items
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_devolucion_items_devolucion ON public.devolucion_items(devolucion_id);


-- ── Parte 5: Tabla notas_debito ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notas_debito (
  id               UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id       UUID          NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id          UUID          REFERENCES public.profiles(id) ON DELETE SET NULL,
  numero_nd        TEXT          NOT NULL,
  tipo             TEXT          NOT NULL CHECK (tipo IN ('emitida', 'recibida')),
  comprobante_id   UUID          REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  compra_id        UUID          REFERENCES public.compras(id) ON DELETE SET NULL,
  cliente_id       UUID          REFERENCES public.clientes(id) ON DELETE SET NULL,
  proveedor_id     UUID          REFERENCES public.proveedores(id) ON DELETE SET NULL,
  concepto         TEXT          NOT NULL,
  monto            NUMERIC(12,2) NOT NULL,
  moneda           TEXT          NOT NULL DEFAULT 'ARS',
  fecha            DATE          NOT NULL DEFAULT CURRENT_DATE,
  observaciones    TEXT,
  cc_movimiento_id UUID,         -- FK suave a cuenta_corriente_movimientos, se completa al procesar
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notas_debito ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_debito_all" ON public.notas_debito;
CREATE POLICY "notas_debito_all" ON public.notas_debito
  USING  (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

CREATE INDEX IF NOT EXISTS idx_notas_debito_empresa   ON public.notas_debito(empresa_id);
CREATE INDEX IF NOT EXISTS idx_notas_debito_tipo      ON public.notas_debito(empresa_id, tipo);
CREATE INDEX IF NOT EXISTS idx_notas_debito_cliente   ON public.notas_debito(cliente_id);
CREATE INDEX IF NOT EXISTS idx_notas_debito_proveedor ON public.notas_debito(proveedor_id);


-- ── Parte 6: Función correlativo genérico ────────────────────────────────
-- Genera número de documento tipo "ENT-2026-0001", "REC-2026-0001", etc.
-- COUNT dentro del año por empresa — no hay gaps, no es transactional-safe
-- (para transaccional-safe usar SEQUENCE; para SME el COUNT es suficiente)
CREATE OR REPLACE FUNCTION public.siguiente_numero_documento(
  p_empresa_id UUID,
  p_tabla      TEXT,
  p_columna    TEXT,
  p_prefijo    TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anio  TEXT    := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  v_count INTEGER;
  v_query TEXT;
BEGIN
  v_query := format(
    'SELECT COUNT(*) FROM public.%I WHERE empresa_id = $1 AND %I LIKE $2',
    p_tabla, p_columna
  );
  EXECUTE v_query INTO v_count
    USING p_empresa_id, p_prefijo || '-' || v_anio || '-%';
  RETURN p_prefijo || '-' || v_anio || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$$;

-- Revocar acceso público, permitir solo usuarios autenticados vía RLS
REVOKE ALL ON FUNCTION public.siguiente_numero_documento(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siguiente_numero_documento(UUID, TEXT, TEXT, TEXT) TO authenticated;
