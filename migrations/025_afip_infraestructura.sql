-- migrations/025_afip_infraestructura.sql
-- Infraestructura base para integración AFIP/ARCA (Fase 1: tablas, columnas, RLS, Vault wrappers)
-- Idempotente. Verificado contra schema real (proyecto wuznppxeonmhfcvnqfbf).
--
-- Diferencias vs. spec original (resueltas aquí):
--   • clientes NO tiene cuit/condicion_iva → se usa `documento` (ya existe) y se agrega `condicion_iva`.
--   • Vault 0.3.1 expone vault.create_secret/update_secret + vista vault.decrypted_secrets,
--     NO existen vault_secret_upsert/vault_secret_read → se crean como wrappers SECURITY DEFINER.

-- ── 1. Columnas AFIP en tabla empresas ────────────────────────────────────────
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_factura_electronica  BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS condicion_iva            TEXT        CHECK (condicion_iva IN ('RI','Monotributo','Exento','CF')),
  ADD COLUMN IF NOT EXISTS afip_cuit                TEXT,
  ADD COLUMN IF NOT EXISTS afip_ticket_acceso       TEXT,        -- TA (Ticket de Acceso) cacheado, nullable
  ADD COLUMN IF NOT EXISTS afip_ticket_expira       TIMESTAMPTZ; -- vencimiento del TA

-- ── 2. Condición IVA del receptor en clientes ─────────────────────────────────
-- (clientes.documento ya existe y se usa como CUIT/DNI del receptor)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS condicion_iva TEXT
    CHECK (condicion_iva IN ('RI','Monotributo','Exento','CF'));

-- ── 3. Tabla puntos_venta ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.puntos_venta (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                  UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  numero                      INTEGER NOT NULL,  -- número AFIP (1, 2, 3...)
  nombre                      TEXT NOT NULL DEFAULT 'Punto de Venta Principal',
  tipo_comprobante_default    TEXT NOT NULL DEFAULT 'B' CHECK (tipo_comprobante_default IN ('A','B','C','E')),
  activo                      BOOLEAN NOT NULL DEFAULT true,
  ultimo_numero_a             INTEGER NOT NULL DEFAULT 0,
  ultimo_numero_b             INTEGER NOT NULL DEFAULT 0,
  ultimo_numero_c             INTEGER NOT NULL DEFAULT 0,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, numero)
);

ALTER TABLE public.puntos_venta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "puntos_venta_all" ON public.puntos_venta;
CREATE POLICY "puntos_venta_all" ON public.puntos_venta
  USING (empresa_id = get_my_empresa_id())
  WITH CHECK (empresa_id = get_my_empresa_id());

-- ── 4. Columnas AFIP en tabla comprobantes ────────────────────────────────────
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS cae                    TEXT,
  ADD COLUMN IF NOT EXISTS cae_vencimiento        DATE,
  ADD COLUMN IF NOT EXISTS cae_estado             TEXT NOT NULL DEFAULT 'no_aplica'
                                                  CHECK (cae_estado IN ('no_aplica','pendiente','emitido','error')),
  ADD COLUMN IF NOT EXISTS tipo_comprobante_afip  TEXT CHECK (tipo_comprobante_afip IN ('A','B','C','E')),
  ADD COLUMN IF NOT EXISTS numero_afip            TEXT,  -- "0001-00000123"
  ADD COLUMN IF NOT EXISTS punto_venta_id         UUID REFERENCES public.puntos_venta(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS error_afip             TEXT;  -- mensaje de error cuando cae_estado = 'error'

-- ── 5. Índices ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_comprobantes_cae_estado
  ON public.comprobantes(empresa_id, cae_estado)
  WHERE cae_estado = 'pendiente';
CREATE INDEX IF NOT EXISTS idx_puntos_venta_empresa
  ON public.puntos_venta(empresa_id);

-- ── 6. Wrappers de Supabase Vault ─────────────────────────────────────────────
-- Vault guarda los secretos cifrados (certificado .crt y clave privada AFIP).
-- Estas funciones SECURITY DEFINER son el único punto de acceso desde las Edge
-- Functions (service_role). NO se exponen a anon/authenticated.

-- Upsert: crea el secreto si no existe, o lo actualiza. Retorna el UUID del secreto.
CREATE OR REPLACE FUNCTION public.vault_secret_upsert(
  p_name        TEXT,
  p_secret      TEXT,
  p_description TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id UUID;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = p_name;
  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_secret, p_name, p_description);
  ELSE
    PERFORM vault.update_secret(v_id, p_secret, p_name, p_description);
  END IF;
  RETURN v_id;
END;
$$;

-- Read: devuelve el secreto descifrado por nombre (NULL si no existe).
CREATE OR REPLACE FUNCTION public.vault_secret_read(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
$$;

-- Bloquear acceso público; solo service_role (Edge Functions) puede ejecutarlas.
REVOKE ALL ON FUNCTION public.vault_secret_upsert(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_secret_read(TEXT)               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_secret_upsert(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_secret_read(TEXT)               TO service_role;
