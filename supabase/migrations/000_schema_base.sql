-- Migration 000 — copia de schema.sql (raíz del repo), para CI únicamente.
--
-- schema.sql se aplicó a mano contra producción hace tiempo, nunca como
-- migration numerada — por eso `supabase test db` (que arma la DB desde cero
-- solo con supabase/migrations/*.sql) fallaba en la primera migration real
-- (001_audit_log.sql) con "function public.get_my_empresa_id() does not
-- exist": esa función vive en schema.sql, no en ninguna migration.
--
-- Este archivo es una copia idéntica de schema.sql, prefijada 000 para
-- correr primero. Es 100% idempotente (CREATE TABLE IF NOT EXISTS, DROP
-- POLICY IF EXISTS + CREATE POLICY, CREATE OR REPLACE FUNCTION) — si algún
-- día se corriera contra producción por error, sería un no-op total.
--
-- =============================================================================
-- KAIROX GESTIÓN — Schema completo para Supabase
-- =============================================================================
-- Versión: 2.0
-- Soluciona: error 42P17 (infinite recursion in RLS policy for "profiles")
-- Estrategia anti-recursión:
--   1. La policy de "profiles" usa auth.uid() directamente (sin sub-SELECT de profiles)
--   2. Todas las demás tablas usan la función get_my_empresa_id() que tiene
--      SECURITY DEFINER, lo que hace que bypass RLS al consultarla
-- =============================================================================

-- Habilitar extensión UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- TABLA: empresas
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.empresas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.empresas ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: profiles
-- (espeja auth.users — se crea en el trigger on_auth_user_created)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id  UUID REFERENCES public.empresas(id) ON DELETE SET NULL,
  tenant_id   UUID,                        -- alias histórico; apunta al mismo usuario o empresa
  first_name  TEXT,
  last_name   TEXT,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  permissions JSONB DEFAULT '{}'::jsonb,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- FUNCIÓN AUXILIAR — get_my_empresa_id()
-- SECURITY DEFINER: consulta profiles SIN activar RLS → rompe la recursión
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_my_empresa_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT empresa_id FROM public.profiles WHERE id = auth.uid()
$$;

-- =============================================================================
-- TABLA: categorias
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.categorias (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.categorias ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: proveedores
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.proveedores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  contacto    TEXT,
  telefono    TEXT,
  email       TEXT,
  direccion   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: productos
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.productos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  categoria_id    UUID REFERENCES public.categorias(id) ON DELETE SET NULL,
  proveedor_id    UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL,
  codigo_sku      TEXT,
  descripcion     TEXT,
  costo_compra    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  precio_venta    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stock_actual    INTEGER NOT NULL DEFAULT 0,
  stock_minimo    INTEGER NOT NULL DEFAULT 0,
  unidad_medida   TEXT NOT NULL DEFAULT 'Unidad',
  activo          BOOLEAN NOT NULL DEFAULT true,
  fecha_creacion  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, codigo_sku)
);

ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: clientes
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.clientes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL,
  documento       TEXT,
  telefono        TEXT,
  email           TEXT,
  direccion       TEXT,
  limite_credito  NUMERIC(12, 2) NOT NULL DEFAULT 0,
  saldo_actual    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: caja_sesiones
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.caja_sesiones (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id            UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
  tenant_id             UUID REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  abierto_por           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cerrado_por           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  monto_inicial         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  monto_final_real      NUMERIC(12, 2),
  monto_final_esperado  NUMERIC(12, 2),
  diferencia            NUMERIC(12, 2),
  estado                TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'cerrada')),
  apertura_fecha        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cierre_fecha          TIMESTAMPTZ,
  observaciones         TEXT
);

ALTER TABLE public.caja_sesiones ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: movimientos_caja
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.movimientos_caja (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id       UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  caja_sesion_id   UUID REFERENCES public.caja_sesiones(id) ON DELETE SET NULL,
  tipo             TEXT NOT NULL CHECK (tipo IN ('ingreso', 'egreso')),
  categoria        TEXT NOT NULL,
  concepto         TEXT NOT NULL,
  monto            NUMERIC(12, 2) NOT NULL,
  fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metodo_pago      TEXT NOT NULL DEFAULT 'Efectivo',
  is_automatic     BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.movimientos_caja ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: movimientos_inventario
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.movimientos_inventario (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id   UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tenant_id    UUID REFERENCES public.empresas(id) ON DELETE SET NULL,
  producto_id  UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida', 'ajuste')),
  cantidad     INTEGER NOT NULL,
  motivo       TEXT,
  fecha        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.movimientos_inventario ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: compras
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.compras (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id       UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  proveedor_id     UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
  numero_factura   TEXT,
  fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  forma_pago       TEXT NOT NULL DEFAULT 'Efectivo',
  estado_pago      TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado_pago IN ('pendiente', 'pagada', 'parcial')),
  total            NUMERIC(12, 2) NOT NULL DEFAULT 0,
  observaciones    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.compras ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: detalle_compras
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.detalle_compras (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id       UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  compra_id        UUID NOT NULL REFERENCES public.compras(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad         INTEGER NOT NULL,
  costo_unitario   NUMERIC(12, 2) NOT NULL,
  subtotal         NUMERIC(12, 2) NOT NULL
);

ALTER TABLE public.detalle_compras ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: comprobantes  (sistema nuevo de ventas)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.comprobantes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tenant_id       UUID REFERENCES public.empresas(id) ON DELETE SET NULL,
  cliente_id      UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  numero_venta    TEXT NOT NULL,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cliente_nombre  TEXT NOT NULL DEFAULT 'Consumidor Final',
  total           NUMERIC(12, 2) NOT NULL DEFAULT 0,
  forma_pago      TEXT NOT NULL DEFAULT 'Efectivo',
  UNIQUE (empresa_id, numero_venta)
);

ALTER TABLE public.comprobantes ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: comprobante_items
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.comprobante_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id       UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  comprobante_id   UUID NOT NULL REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad         INTEGER NOT NULL,
  precio_unitario  NUMERIC(12, 2) NOT NULL,
  subtotal         NUMERIC(12, 2) NOT NULL
);

ALTER TABLE public.comprobante_items ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: ventas  (sistema legacy — se mantiene por compatibilidad)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.ventas (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id   UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cliente_id   UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  fecha        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cliente      TEXT NOT NULL DEFAULT 'Consumidor Final',
  metodo_pago  TEXT NOT NULL DEFAULT 'Efectivo',
  subtotal     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  descuento    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total        NUMERIC(12, 2) NOT NULL DEFAULT 0
);

ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: detalle_ventas  (sistema legacy)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.detalle_ventas (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id       UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  venta_id         UUID NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
  producto_id      UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad         INTEGER NOT NULL,
  precio_unitario  NUMERIC(12, 2) NOT NULL,
  subtotal         NUMERIC(12, 2) NOT NULL
);

ALTER TABLE public.detalle_ventas ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- TABLA: cuenta_corriente_movimientos
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.cuenta_corriente_movimientos (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id   UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cliente_id   UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('DEBE', 'HABER')),
  monto        NUMERIC(12, 2) NOT NULL,
  descripcion  TEXT,
  fecha        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cuenta_corriente_movimientos ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- INDEXES
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_profiles_empresa       ON public.profiles(empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa       ON public.clientes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_productos_empresa      ON public.productos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_productos_categoria    ON public.productos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_categorias_empresa     ON public.categorias(empresa_id);
CREATE INDEX IF NOT EXISTS idx_proveedores_empresa    ON public.proveedores(empresa_id);
CREATE INDEX IF NOT EXISTS idx_compras_empresa        ON public.compras(empresa_id);
CREATE INDEX IF NOT EXISTS idx_compras_proveedor      ON public.compras(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_detalle_compras_compra ON public.detalle_compras(compra_id);
CREATE INDEX IF NOT EXISTS idx_comprobantes_empresa   ON public.comprobantes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_comprobante_items      ON public.comprobante_items(comprobante_id);
CREATE INDEX IF NOT EXISTS idx_ventas_empresa         ON public.ventas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_detalle_ventas_venta   ON public.detalle_ventas(venta_id);
CREATE INDEX IF NOT EXISTS idx_mov_caja_empresa       ON public.movimientos_caja(empresa_id);
CREATE INDEX IF NOT EXISTS idx_mov_caja_sesion        ON public.movimientos_caja(caja_sesion_id);
CREATE INDEX IF NOT EXISTS idx_mov_inv_empresa        ON public.movimientos_inventario(empresa_id);
CREATE INDEX IF NOT EXISTS idx_mov_inv_producto       ON public.movimientos_inventario(producto_id);
CREATE INDEX IF NOT EXISTS idx_caja_sesiones_empresa  ON public.caja_sesiones(empresa_id);
CREATE INDEX IF NOT EXISTS idx_cta_cte_cliente        ON public.cuenta_corriente_movimientos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cta_cte_empresa        ON public.cuenta_corriente_movimientos(empresa_id);

-- =============================================================================
-- RLS POLICIES
-- =============================================================================
-- Estrategia:
--   - profiles: usa id = auth.uid() directamente → SIN recursión
--   - empresas: usa id = get_my_empresa_id() (SECURITY DEFINER → sin recursión)
--   - Todas las demás tablas: empresa_id = get_my_empresa_id()

-- ---- profiles ---------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select"    ON public.profiles;
DROP POLICY IF EXISTS "profiles_update"    ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert"    ON public.profiles;

-- Cada usuario sólo ve/modifica su propio perfil
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

-- El trigger on_auth_user_created hace el INSERT con SECURITY DEFINER,
-- así que bloqueamos inserts directos por seguridad.
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

-- ---- empresas ---------------------------------------------------------------
DROP POLICY IF EXISTS "empresas_select" ON public.empresas;
DROP POLICY IF EXISTS "empresas_update" ON public.empresas;

CREATE POLICY "empresas_select" ON public.empresas
  FOR SELECT USING (id = public.get_my_empresa_id());

CREATE POLICY "empresas_update" ON public.empresas
  FOR UPDATE USING (id = public.get_my_empresa_id());

-- ---- categorias -------------------------------------------------------------
DROP POLICY IF EXISTS "categorias_all" ON public.categorias;

CREATE POLICY "categorias_all" ON public.categorias
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- proveedores ------------------------------------------------------------
DROP POLICY IF EXISTS "proveedores_all" ON public.proveedores;

CREATE POLICY "proveedores_all" ON public.proveedores
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- productos --------------------------------------------------------------
DROP POLICY IF EXISTS "productos_all" ON public.productos;

CREATE POLICY "productos_all" ON public.productos
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- clientes ---------------------------------------------------------------
DROP POLICY IF EXISTS "clientes_all" ON public.clientes;

CREATE POLICY "clientes_all" ON public.clientes
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- caja_sesiones ----------------------------------------------------------
DROP POLICY IF EXISTS "caja_sesiones_all" ON public.caja_sesiones;

CREATE POLICY "caja_sesiones_all" ON public.caja_sesiones
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- movimientos_caja -------------------------------------------------------
DROP POLICY IF EXISTS "movimientos_caja_all" ON public.movimientos_caja;

CREATE POLICY "movimientos_caja_all" ON public.movimientos_caja
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- movimientos_inventario -------------------------------------------------
DROP POLICY IF EXISTS "movimientos_inventario_all" ON public.movimientos_inventario;

CREATE POLICY "movimientos_inventario_all" ON public.movimientos_inventario
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- compras ----------------------------------------------------------------
DROP POLICY IF EXISTS "compras_all" ON public.compras;

CREATE POLICY "compras_all" ON public.compras
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- detalle_compras --------------------------------------------------------
DROP POLICY IF EXISTS "detalle_compras_all" ON public.detalle_compras;

CREATE POLICY "detalle_compras_all" ON public.detalle_compras
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- comprobantes -----------------------------------------------------------
DROP POLICY IF EXISTS "comprobantes_all" ON public.comprobantes;

CREATE POLICY "comprobantes_all" ON public.comprobantes
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- comprobante_items ------------------------------------------------------
DROP POLICY IF EXISTS "comprobante_items_all" ON public.comprobante_items;

CREATE POLICY "comprobante_items_all" ON public.comprobante_items
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- ventas -----------------------------------------------------------------
DROP POLICY IF EXISTS "ventas_all" ON public.ventas;

CREATE POLICY "ventas_all" ON public.ventas
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- detalle_ventas ---------------------------------------------------------
DROP POLICY IF EXISTS "detalle_ventas_all" ON public.detalle_ventas;

CREATE POLICY "detalle_ventas_all" ON public.detalle_ventas
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- ---- cuenta_corriente_movimientos -------------------------------------------
DROP POLICY IF EXISTS "cta_cte_all" ON public.cuenta_corriente_movimientos;

CREATE POLICY "cta_cte_all" ON public.cuenta_corriente_movimientos
  FOR ALL USING (empresa_id = public.get_my_empresa_id());

-- =============================================================================
-- TRIGGER: crear perfil automáticamente al registrar usuario
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- TABLA: configuracion
-- =============================================================================
-- No estaba en schema.sql original — se creó a mano contra producción en algún
-- momento (igual que get_my_empresa_id() en su día), sin quedar en ningún
-- archivo versionado. Definición tomada de information_schema/pg_constraint
-- del proyecto remoto (wuznppxeonmhfcvnqfbf) para que el replay de CI la
-- tenga disponible antes de 016_security_hardening.sql, que ya la referencia.
CREATE TABLE IF NOT EXISTS public.configuracion (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  clave       TEXT NOT NULL,
  valor       TEXT,
  UNIQUE (empresa_id, clave)
);

-- =============================================================================
-- TABLA: periodos_contables
-- =============================================================================
-- 008_oc_approval_periodos.sql creaba esta tabla con un diseño viejo
-- (empresa_id, anio, mes, cerrado) que quedó obsoleto al rediseñarla en
-- producción, sin migration, a esta forma (igual a la que ya recrea
-- 027_cierre_periodos.sql). Se adelanta acá porque 016_security_hardening.sql
-- (que corre antes que la 027) ya hace DROP POLICY/CREATE TRIGGER sobre ella.
CREATE TABLE IF NOT EXISTS public.periodos_contables (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        UUID        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre            TEXT        NOT NULL,
  fecha_inicio      DATE        NOT NULL,
  fecha_cierre      DATE        NOT NULL,
  estado            TEXT        NOT NULL DEFAULT 'abierto'
                                CHECK (estado IN ('abierto', 'cerrado')),
  cerrado_por       UUID        REFERENCES public.profiles(id),
  fecha_cierre_real TIMESTAMPTZ,
  observaciones     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT periodos_fechas_check CHECK (fecha_cierre >= fecha_inicio)
);

-- =============================================================================
-- 11 tablas más en el mismo caso: creadas a mano contra producción en algún
-- momento (nunca versionadas en ninguna migration), y referenciadas por
-- migrations tempranas (016, etc.) antes de que la migration que "debería"
-- haberlas creado (168_centros_costo.sql, 011_cuentas_bancarias.sql, etc.)
-- llegue a correr. Definiciones tomadas 1:1 de information_schema/
-- pg_constraint del proyecto remoto.
--
-- Simplificación deliberada: `asientos_contables.centro_costo_id` e
-- `integraciones_bancarias.cuenta_bancaria_id` NO llevan su FK inline acá
-- (a `centros_costo`/`cuentas_bancarias`, tablas que en el historial real
-- se crean más tarde, en 168/011) — se agrega solo la columna, sin
-- REFERENCES, para no tener que editar esas migrations ya aplicadas en
-- producción. No afecta ningún test pgTAP existente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.plan_cuentas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            UUID NOT NULL,
  codigo                VARCHAR(20) NOT NULL,
  nombre                VARCHAR(200) NOT NULL,
  tipo                  VARCHAR(20) NOT NULL CHECK (tipo IN ('activo','pasivo','patrimonio','ingreso','egreso')),
  nivel                 INTEGER NOT NULL DEFAULT 1,
  cuenta_padre_id       UUID REFERENCES public.plan_cuentas(id) ON DELETE RESTRICT,
  permite_movimientos   BOOLEAN DEFAULT true,
  saldo_actual          NUMERIC(15,2) DEFAULT 0,
  activa                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

CREATE TABLE IF NOT EXISTS public.asientos_contables (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       UUID NOT NULL,
  user_id          UUID NOT NULL,
  numero           VARCHAR(20) NOT NULL,
  fecha            DATE NOT NULL,
  descripcion      TEXT,
  estado           VARCHAR(20) DEFAULT 'borrador' CHECK (estado IN ('borrador','confirmado','anulado')),
  total_debe       NUMERIC(15,2) DEFAULT 0,
  total_haber      NUMERIC(15,2) DEFAULT 0,
  origen           VARCHAR(50),
  origen_id        UUID,
  created_at       TIMESTAMPTZ DEFAULT now(),
  centro_costo_id  UUID,  -- sin FK acá a propósito, ver nota arriba
  UNIQUE (empresa_id, numero)
);

CREATE TABLE IF NOT EXISTS public.asientos_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id    UUID NOT NULL REFERENCES public.asientos_contables(id) ON DELETE CASCADE,
  empresa_id    UUID NOT NULL,
  cuenta_id     UUID NOT NULL REFERENCES public.plan_cuentas(id),
  descripcion   TEXT,
  debe          NUMERIC(15,2) DEFAULT 0,
  haber         NUMERIC(15,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comprobante_pagos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comprobante_id  UUID NOT NULL REFERENCES public.comprobantes(id) ON DELETE CASCADE,
  empresa_id      UUID NOT NULL,
  metodo          TEXT NOT NULL CHECK (metodo IN ('Efectivo','Transferencia','Tarjeta','Cuenta Corriente','Cheque')),
  monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.listas_precio (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    UUID NOT NULL,
  user_id       UUID NOT NULL,
  nombre        TEXT NOT NULL,
  descripcion   TEXT,
  activo        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.lista_precio_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lista_precio_id   UUID NOT NULL REFERENCES public.listas_precio(id) ON DELETE CASCADE,
  empresa_id        UUID NOT NULL,
  producto_id       UUID NOT NULL,
  precio            NUMERIC(12,2) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lista_precio_id, producto_id)
);

CREATE TABLE IF NOT EXISTS public.integraciones_bancarias (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cuenta_bancaria_id   UUID,  -- sin FK acá a propósito, ver nota arriba
  proveedor            TEXT NOT NULL CHECK (proveedor IN ('mercadopago','naranja_x','modo','uala','otro')),
  activo               BOOLEAN NOT NULL DEFAULT true,
  token_expiry         TIMESTAMPTZ,
  config               JSONB DEFAULT '{}'::jsonb,
  ultimo_sync          TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, proveedor)
);

CREATE TABLE IF NOT EXISTS public.movimientos_uala (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha         TIMESTAMP NOT NULL,
  monto         NUMERIC(12,2) NOT NULL,
  destinatario  TEXT,
  created_at    TIMESTAMP DEFAULT now(),
  user_id       UUID,
  empresa_id    UUID
);

CREATE TABLE IF NOT EXISTS public.ofertas (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nombre                 VARCHAR(100) NOT NULL,
  descripcion            TEXT,
  tipo_descuento         VARCHAR(20) NOT NULL DEFAULT 'porcentaje' CHECK (tipo_descuento IN ('porcentaje','monto_fijo')),
  valor_descuento        NUMERIC(10,2) NOT NULL CHECK (valor_descuento >= 0),
  producto_id            UUID REFERENCES public.productos(id) ON DELETE CASCADE,
  categoria_nombre       VARCHAR(100),
  medio_pago             VARCHAR(50),
  dia_semana             SMALLINT[],
  monto_minimo_carrito   NUMERIC(12,2),
  cantidad_minima        NUMERIC(10,3),
  fecha_desde            DATE,
  fecha_hasta            DATE,
  activo                 BOOLEAN NOT NULL DEFAULT true,
  prioridad              SMALLINT NOT NULL DEFAULT 0,
  acumulable             BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ DEFAULT now(),
  updated_at             TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_porcentaje_maximo CHECK (
    (tipo_descuento = 'porcentaje' AND valor_descuento <= 100) OR (tipo_descuento = 'monto_fijo')
  )
);

CREATE TABLE IF NOT EXISTS public.pedidos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  numero          TEXT NOT NULL,
  cliente_id      UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  cliente_nombre  TEXT,
  fecha           TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_entrega   DATE,
  estado          TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','confirmado','en_preparacion','facturado','cancelado')),
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  notas           TEXT,
  comprobante_id  UUID REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);

CREATE TABLE IF NOT EXISTS public.pedido_items (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id             UUID NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  empresa_id            UUID NOT NULL,
  producto_id           UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  descripcion           TEXT NOT NULL,
  cantidad              NUMERIC(10,3) NOT NULL DEFAULT 1,
  precio_unitario       NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal              NUMERIC(12,2) NOT NULL DEFAULT 0,
  unidad_medida         TEXT,
  cantidad_entregada    NUMERIC(12,3) NOT NULL DEFAULT 0,
  cantidad_facturada    NUMERIC(12,3) NOT NULL DEFAULT 0
);

-- =============================================================================
-- Adelanto de las migrations "retroactivas" 040/041/042 — mismo problema que
-- las 11 tablas de arriba, pero con funciones/columnas: 023_indices_faltantes.sql
-- (y otras tempranas) ya asumen que `comprobantes.estado_pago` existe y que
-- `fn_audit_trigger` está definida, pero esas migrations retroactivas corren
-- recién en 040-042. Se adelanta acá solo lo que no depende de tablas creadas
-- después de 000 (`v_saldo_proveedores`, que sí depende de
-- `cuenta_corriente_proveedores` creada en 014, se deja para que 042 la cree
-- en su posición normal — no hace falta adelantarla, nada temprano la usa).
-- =============================================================================

-- fn_audit_trigger (definición final de 042 — row_to_json ya migrado a to_jsonb)
CREATE OR REPLACE FUNCTION public.fn_audit_trigger()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_empresa_id  UUID;
  v_registro_id UUID;
  v_old         JSONB;
  v_new         JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old         := to_jsonb(OLD);
    v_new         := NULL;
    v_empresa_id  := (to_jsonb(OLD) ->> 'empresa_id')::UUID;
    v_registro_id := (to_jsonb(OLD) ->> 'id')::UUID;
  ELSIF TG_OP = 'INSERT' THEN
    v_old         := NULL;
    v_new         := to_jsonb(NEW);
    v_empresa_id  := (to_jsonb(NEW) ->> 'empresa_id')::UUID;
    v_registro_id := (to_jsonb(NEW) ->> 'id')::UUID;
  ELSE
    v_old         := to_jsonb(OLD);
    v_new         := to_jsonb(NEW);
    v_empresa_id  := (to_jsonb(NEW) ->> 'empresa_id')::UUID;
    v_registro_id := (to_jsonb(NEW) ->> 'id')::UUID;
  END IF;

  INSERT INTO public.audit_log(tabla, operacion, registro_id, empresa_id, user_id, old_data, new_data)
  VALUES (TG_TABLE_NAME, TG_OP, v_registro_id, v_empresa_id, auth.uid(), v_old, v_new);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- fn_update_cliente_saldo + trigger (de 042) — cuenta_corriente_movimientos ya existe arriba
CREATE OR REPLACE FUNCTION public.fn_update_cliente_saldo()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.clientes
      SET saldo_actual = saldo_actual + CASE WHEN NEW.tipo = 'DEBE' THEN NEW.monto ELSE -NEW.monto END
    WHERE id = NEW.cliente_id;

  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.clientes
      SET saldo_actual = saldo_actual + CASE WHEN OLD.tipo = 'DEBE' THEN -OLD.monto ELSE OLD.monto END
    WHERE id = OLD.cliente_id;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.clientes
      SET saldo_actual = saldo_actual + CASE WHEN OLD.tipo = 'DEBE' THEN -OLD.monto ELSE OLD.monto END
    WHERE id = OLD.cliente_id;
    UPDATE public.clientes
      SET saldo_actual = saldo_actual + CASE WHEN NEW.tipo = 'DEBE' THEN NEW.monto ELSE -NEW.monto END
    WHERE id = NEW.cliente_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_cliente_saldo ON public.cuenta_corriente_movimientos;
CREATE TRIGGER trg_update_cliente_saldo
  AFTER INSERT OR UPDATE OR DELETE ON public.cuenta_corriente_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.fn_update_cliente_saldo();

-- tipos_cambio (de 040)
CREATE TABLE IF NOT EXISTS public.tipos_cambio (
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  empresa_id uuid        NOT NULL,
  moneda     text        NOT NULL DEFAULT 'USD',
  tasa       numeric     NOT NULL,
  fecha      date        NOT NULL,
  created_at timestamptz          DEFAULT now(),
  CONSTRAINT tipos_cambio_pkey PRIMARY KEY (id),
  CONSTRAINT tipos_cambio_empresa_id_moneda_fecha_key UNIQUE (empresa_id, moneda, fecha),
  CONSTRAINT tipos_cambio_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tc_empresa_moneda_fecha
  ON public.tipos_cambio (empresa_id, moneda, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_tipos_cambio_empresa_fecha
  ON public.tipos_cambio (empresa_id, moneda, fecha DESC);

ALTER TABLE public.tipos_cambio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tc_all" ON public.tipos_cambio;
CREATE POLICY "tc_all" ON public.tipos_cambio
  AS PERMISSIVE FOR ALL
  USING      (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

DROP POLICY IF EXISTS "tipos_cambio_empresa_all" ON public.tipos_cambio;
CREATE POLICY "tipos_cambio_empresa_all" ON public.tipos_cambio
  AS PERMISSIVE FOR ALL
  USING      (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

DROP TRIGGER IF EXISTS trg_audit_tipos_cambio ON public.tipos_cambio;
CREATE TRIGGER trg_audit_tipos_cambio
  AFTER INSERT OR UPDATE OR DELETE ON public.tipos_cambio
  FOR EACH ROW EXECUTE FUNCTION public.fn_audit_trigger();

-- Columnas de moneda paralela / open-item (de 041)
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_tc_paralelo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS moneda_paralela text    NOT NULL DEFAULT 'USD';

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS estado_pago           text    NOT NULL DEFAULT 'pagada',
  ADD COLUMN IF NOT EXISTS monto_paralelo        numeric,
  ADD COLUMN IF NOT EXISTS tc_paralelo           numeric,
  ADD COLUMN IF NOT EXISTS comprobante_origen_id uuid;

ALTER TABLE public.movimientos_caja
  ADD COLUMN IF NOT EXISTS monto_paralelo numeric,
  ADD COLUMN IF NOT EXISTS tc_paralelo    numeric;

ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS comprobante_id uuid,
  ADD COLUMN IF NOT EXISTS metodo_cobro   text,
  ADD COLUMN IF NOT EXISTS monto_paralelo numeric,
  ADD COLUMN IF NOT EXISTS tc_paralelo    numeric;

ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS monto_paralelo numeric,
  ADD COLUMN IF NOT EXISTS tc_paralelo    numeric;

-- =============================================================================
-- DATOS INICIALES (opcional — ejecutar después del primer registro de usuario)
-- =============================================================================
-- Para crear la primera empresa y vincularla al primer usuario:
--
-- INSERT INTO public.empresas (nombre) VALUES ('Mi Empresa') RETURNING id;
-- UPDATE public.profiles
--   SET empresa_id = '<UUID_RETORNADO>',
--       tenant_id  = id,
--       role       = 'admin'
--   WHERE id = '<UUID_DEL_USUARIO>';
-- =============================================================================
