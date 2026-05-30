-- ============================================================
-- KAIROX Gestión — Plan de Cuentas y Contabilidad
-- Migración 004
-- ============================================================

-- Tabla principal: Plan de Cuentas
CREATE TABLE IF NOT EXISTS plan_cuentas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      UUID NOT NULL,
  codigo          VARCHAR(20) NOT NULL,
  nombre          VARCHAR(200) NOT NULL,
  tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('activo','pasivo','patrimonio','ingreso','egreso')),
  nivel           INTEGER NOT NULL DEFAULT 1,
  cuenta_padre_id UUID REFERENCES plan_cuentas(id) ON DELETE RESTRICT,
  permite_movimientos BOOLEAN DEFAULT true,
  saldo_actual    DECIMAL(15,2) DEFAULT 0,
  activa          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

-- Tabla: Asientos contables (libro diario)
CREATE TABLE IF NOT EXISTS asientos_contables (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL,
  user_id      UUID NOT NULL,
  numero       VARCHAR(20) NOT NULL,
  fecha        DATE NOT NULL,
  descripcion  TEXT,
  estado       VARCHAR(20) DEFAULT 'borrador' CHECK (estado IN ('borrador','confirmado','anulado')),
  total_debe   DECIMAL(15,2) DEFAULT 0,
  total_haber  DECIMAL(15,2) DEFAULT 0,
  origen       VARCHAR(50),   -- 'venta' | 'compra' | 'caja' | 'manual'
  origen_id    UUID,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, numero)
);

-- Tabla: Líneas de cada asiento
CREATE TABLE IF NOT EXISTS asientos_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id  UUID NOT NULL REFERENCES asientos_contables(id) ON DELETE CASCADE,
  empresa_id  UUID NOT NULL,
  cuenta_id   UUID NOT NULL REFERENCES plan_cuentas(id),
  descripcion TEXT,
  debe        DECIMAL(15,2) DEFAULT 0,
  haber       DECIMAL(15,2) DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RLS — Row Level Security
-- ============================================================
ALTER TABLE plan_cuentas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE asientos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE asientos_items     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_plan_cuentas" ON plan_cuentas
  USING (empresa_id = get_my_empresa_id());

CREATE POLICY "tenant_isolation_asientos" ON asientos_contables
  USING (empresa_id = get_my_empresa_id());

CREATE POLICY "tenant_isolation_asientos_items" ON asientos_items
  USING (empresa_id = get_my_empresa_id());

-- ============================================================
-- Índices
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_plan_cuentas_empresa  ON plan_cuentas (empresa_id, codigo);
CREATE INDEX IF NOT EXISTS idx_asientos_empresa_fecha ON asientos_contables (empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_asientos_items_asiento ON asientos_items (asiento_id);
CREATE INDEX IF NOT EXISTS idx_asientos_items_cuenta  ON asientos_items (cuenta_id);

-- ============================================================
-- Trigger: recalcular saldo_actual en plan_cuentas
-- Se ejecuta al confirmar/anular un asiento
-- ============================================================
CREATE OR REPLACE FUNCTION recalcular_saldo_cuenta(p_cuenta_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE plan_cuentas
  SET saldo_actual = (
    SELECT COALESCE(SUM(ai.debe - ai.haber), 0)
    FROM   asientos_items ai
    JOIN   asientos_contables a ON a.id = ai.asiento_id
    WHERE  ai.cuenta_id = p_cuenta_id
    AND    a.estado = 'confirmado'
  )
  WHERE id = p_cuenta_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_asiento_item_saldo()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalcular_saldo_cuenta(OLD.cuenta_id);
    RETURN OLD;
  ELSE
    PERFORM recalcular_saldo_cuenta(NEW.cuenta_id);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_asiento_item_saldo ON asientos_items;
CREATE TRIGGER trg_asiento_item_saldo
  AFTER INSERT OR UPDATE OR DELETE ON asientos_items
  FOR EACH ROW EXECUTE FUNCTION trg_asiento_item_saldo();

-- ============================================================
-- Secuencia de numeración de asientos por empresa
-- ============================================================
CREATE OR REPLACE FUNCTION next_numero_asiento(p_empresa_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_next INT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM 'AS-(\d+)') AS INT)), 0) + 1
  INTO   v_next
  FROM   asientos_contables
  WHERE  empresa_id = p_empresa_id;
  RETURN 'AS-' || LPAD(v_next::TEXT, 6, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Cuentas predeterminadas (se insertan solo si la empresa
-- aún no tiene plan de cuentas). Se usa una función para
-- ejecutarlas en contexto del usuario actual.
-- ============================================================
CREATE OR REPLACE FUNCTION seed_plan_cuentas(p_empresa_id UUID)
RETURNS void AS $$
BEGIN
  -- Solo si la empresa no tiene cuentas aún
  IF EXISTS (SELECT 1 FROM plan_cuentas WHERE empresa_id = p_empresa_id LIMIT 1) THEN
    RETURN;
  END IF;

  -- ── 1. ACTIVO ─────────────────────────────────────────────
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '1',     'ACTIVO',                    'activo', 1, false),
    (p_empresa_id, '1.1',   'Activo Corriente',          'activo', 2, false),
    (p_empresa_id, '1.1.1', 'Caja y Bancos',             'activo', 3, true),
    (p_empresa_id, '1.1.2', 'Cuentas a Cobrar',          'activo', 3, true),
    (p_empresa_id, '1.1.3', 'Mercaderías / Inventario',  'activo', 3, true),
    (p_empresa_id, '1.1.4', 'IVA Crédito Fiscal',        'activo', 3, true),
    (p_empresa_id, '1.1.5', 'Otros Activos Corrientes',  'activo', 3, true),
    (p_empresa_id, '1.2',   'Activo No Corriente',       'activo', 2, false),
    (p_empresa_id, '1.2.1', 'Bienes de Uso (neto)',      'activo', 3, true),
    (p_empresa_id, '1.2.2', 'Intangibles',               'activo', 3, true);

  -- ── 2. PASIVO ─────────────────────────────────────────────
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '2',     'PASIVO',                    'pasivo', 1, false),
    (p_empresa_id, '2.1',   'Pasivo Corriente',          'pasivo', 2, false),
    (p_empresa_id, '2.1.1', 'Cuentas a Pagar',           'pasivo', 3, true),
    (p_empresa_id, '2.1.2', 'Sueldos y Cargas Sociales', 'pasivo', 3, true),
    (p_empresa_id, '2.1.3', 'IVA Débito Fiscal',         'pasivo', 3, true),
    (p_empresa_id, '2.1.4', 'Impuestos a Pagar',         'pasivo', 3, true),
    (p_empresa_id, '2.1.5', 'Otros Pasivos Corrientes',  'pasivo', 3, true),
    (p_empresa_id, '2.2',   'Pasivo No Corriente',       'pasivo', 2, false),
    (p_empresa_id, '2.2.1', 'Deudas Financieras LP',     'pasivo', 3, true);

  -- ── 3. PATRIMONIO NETO ────────────────────────────────────
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '3',     'PATRIMONIO NETO',           'patrimonio', 1, false),
    (p_empresa_id, '3.1',   'Capital Social',            'patrimonio', 2, true),
    (p_empresa_id, '3.2',   'Resultados Acumulados',     'patrimonio', 2, true),
    (p_empresa_id, '3.3',   'Resultado del Ejercicio',   'patrimonio', 2, true);

  -- ── 4. INGRESOS ───────────────────────────────────────────
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '4',     'INGRESOS',                  'ingreso', 1, false),
    (p_empresa_id, '4.1',   'Ventas de Productos',       'ingreso', 2, true),
    (p_empresa_id, '4.2',   'Ventas de Servicios',       'ingreso', 2, true),
    (p_empresa_id, '4.3',   'Otros Ingresos',            'ingreso', 2, true);

  -- ── 5. EGRESOS / GASTOS ───────────────────────────────────
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '5',     'EGRESOS / GASTOS',          'egreso', 1, false),
    (p_empresa_id, '5.1',   'Costo de Mercaderías',      'egreso', 2, true),
    (p_empresa_id, '5.2',   'Gastos de Personal',        'egreso', 2, true),
    (p_empresa_id, '5.3',   'Gastos Comerciales',        'egreso', 2, true),
    (p_empresa_id, '5.4',   'Gastos de Administración',  'egreso', 2, true),
    (p_empresa_id, '5.5',   'Gastos Financieros',        'egreso', 2, true),
    (p_empresa_id, '5.6',   'Impuestos y Tasas',         'egreso', 2, true),
    (p_empresa_id, '5.7',   'Amortizaciones',            'egreso', 2, true),
    (p_empresa_id, '5.8',   'Otros Gastos',              'egreso', 2, true);

END;
$$ LANGUAGE plpgsql;
