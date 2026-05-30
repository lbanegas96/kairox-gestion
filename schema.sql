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
  tenant_id             UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
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
  tenant_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
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
  tenant_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
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
