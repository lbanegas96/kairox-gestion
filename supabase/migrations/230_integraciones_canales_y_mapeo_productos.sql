-- Migration 230 — capa de integración con canales de venta externos (ROADMAP.md).
--
-- Primeras 2 tablas de la capa reutilizable descripta en ROADMAP.md ("Capa de
-- integración"): conexión por canal (Tiendanube primero, después Shopify/MELI) +
-- mapeo de productos KAIROX ↔ producto/variante externa. Sin lógica de sync
-- todavía — solo el esquema donde va a apoyarse.
--
-- Por qué NO reusar integraciones_bancarias: esa tabla tiene
-- CHECK proveedor IN ('mercadopago','naranja_x','modo','uala','otro') — está
-- modelada para cuentas de cobro (tiene cuenta_bancaria_id NOT NULL implícito
-- en su uso real), no para canales de catálogo/pedidos. Un canal de venta no
-- tiene "cuenta bancaria" asociada, tiene tienda + catálogo + pedidos.
--
-- Secretos (access_token / refresh_token de cada canal): NO se guardan en
-- estas tablas. Van a Vault vía vault_secret_upsert/vault_secret_read, mismo
-- mecanismo ya probado con el certificado AFIP y el token de MercadoPago
-- (mp-save-config, mp-webhook) — la key sugerida es
-- '{canal}_access_token_{empresa_id}' (y '_refresh_token_' si el canal lo usa).
--
-- RLS: admin-only, mismo criterio que integraciones_bancarias (migración 124)
-- — son credenciales/config de integración, no datos operativos de uso diario.
--
-- ROLLBACK: DROP TABLE public.integraciones_producto_mapeo;
--           DROP TABLE public.integraciones_canales;
--           (sin DROP FUNCTION: fn_set_updated_at ya existe y la usan otras tablas)

CREATE TABLE IF NOT EXISTS public.integraciones_canales (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  canal                   TEXT NOT NULL CHECK (canal IN ('tiendanube', 'shopify', 'mercadolibre')),
  external_store_id       TEXT,
  activo                  BOOLEAN NOT NULL DEFAULT true,
  token_expiry            TIMESTAMPTZ,
  config                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ultimo_sync_productos   TIMESTAMPTZ,
  ultimo_sync_pedidos     TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, canal)
);

CREATE TABLE IF NOT EXISTS public.integraciones_producto_mapeo (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integracion_id      UUID NOT NULL REFERENCES public.integraciones_canales(id) ON DELETE CASCADE,
  producto_id         UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  external_id         TEXT NOT NULL,  -- id de producto/variante en el canal externo
  external_sku        TEXT,
  sincronizar_stock   BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integracion_id, external_id),
  UNIQUE (integracion_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_integraciones_producto_mapeo_producto
  ON public.integraciones_producto_mapeo (producto_id);

CREATE TRIGGER trg_integraciones_canales_updated_at
  BEFORE UPDATE ON public.integraciones_canales
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

CREATE TRIGGER trg_integraciones_producto_mapeo_updated_at
  BEFORE UPDATE ON public.integraciones_producto_mapeo
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.integraciones_canales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integraciones_producto_mapeo ENABLE ROW LEVEL SECURITY;

CREATE POLICY integraciones_canales_select ON public.integraciones_canales
  FOR SELECT
  USING (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY integraciones_canales_insert ON public.integraciones_canales
  FOR INSERT
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY integraciones_canales_update ON public.integraciones_canales
  FOR UPDATE
  USING (empresa_id = get_my_empresa_id() AND is_admin())
  WITH CHECK (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY integraciones_canales_delete ON public.integraciones_canales
  FOR DELETE
  USING (empresa_id = get_my_empresa_id() AND is_admin());

CREATE POLICY integraciones_producto_mapeo_select ON public.integraciones_producto_mapeo
  FOR SELECT
  USING (
    is_admin() AND EXISTS (
      SELECT 1 FROM public.integraciones_canales ic
      WHERE ic.id = integraciones_producto_mapeo.integracion_id
        AND ic.empresa_id = get_my_empresa_id()
    )
  );

CREATE POLICY integraciones_producto_mapeo_insert ON public.integraciones_producto_mapeo
  FOR INSERT
  WITH CHECK (
    is_admin() AND EXISTS (
      SELECT 1 FROM public.integraciones_canales ic
      WHERE ic.id = integraciones_producto_mapeo.integracion_id
        AND ic.empresa_id = get_my_empresa_id()
    )
  );

CREATE POLICY integraciones_producto_mapeo_update ON public.integraciones_producto_mapeo
  FOR UPDATE
  USING (
    is_admin() AND EXISTS (
      SELECT 1 FROM public.integraciones_canales ic
      WHERE ic.id = integraciones_producto_mapeo.integracion_id
        AND ic.empresa_id = get_my_empresa_id()
    )
  )
  WITH CHECK (
    is_admin() AND EXISTS (
      SELECT 1 FROM public.integraciones_canales ic
      WHERE ic.id = integraciones_producto_mapeo.integracion_id
        AND ic.empresa_id = get_my_empresa_id()
    )
  );

CREATE POLICY integraciones_producto_mapeo_delete ON public.integraciones_producto_mapeo
  FOR DELETE
  USING (
    is_admin() AND EXISTS (
      SELECT 1 FROM public.integraciones_canales ic
      WHERE ic.id = integraciones_producto_mapeo.integracion_id
        AND ic.empresa_id = get_my_empresa_id()
    )
  );
