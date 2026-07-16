-- Migration 205 — Encriptar el Access Token de MercadoPago en reposo (sesión 65
-- Luciano, ítem de hardening documentado por Nadia en la auditoría de seguridad
-- de MP: "el access token en integraciones_bancarias sigue en texto plano").
--
-- Antes: `integraciones_bancarias.access_token` guardaba el APP_USR-... en texto
-- plano, protegido solo por RLS + rol admin (nunca expuesto al frontend, pero
-- legible por cualquiera con acceso directo a la base o a un backup).
--
-- Después: el token vive cifrado en Supabase Vault, mismo mecanismo ya usado
-- para el certificado AFIP (vault_secret_upsert/vault_secret_read, ambas
-- service_role-only desde mig.025/113). Clave: 'mp_access_token_<empresa_id>'.
-- Los 3 edge functions de MP (mp-sync, mp-webhook, mp-save-config) ya se
-- actualizaron para leer/escribir por Vault en vez de la columna.
--
-- `refresh_token` se dropea sin backfill: 0 referencias en todo el código
-- (frontend ni edge functions la leen ni la escriben — era una columna legacy
-- de un diseño de OAuth Marketplace que nunca se implementó; el flujo real es
-- pegar el Access Token de producción a mano, sin refresh).

-- 1) Backfill: migrar cada token existente a Vault antes de borrar la columna.
-- En un replay desde cero (CI) la columna `access_token` no existe: el schema base
-- (000_schema_base.sql) se escribió DESPUÉS de que esta migration corriera en
-- producción y ya no la tiene. Sin este guard, el SELECT de abajo rompía con
-- "column access_token does not exist" — no hay nada que hacer backfill en una
-- base nueva, así que se salta directamente al DROP (que ya es IF EXISTS).
DO $$
DECLARE
  v_row RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'integraciones_bancarias'
       AND column_name = 'access_token'
  ) THEN
    RETURN;
  END IF;

  FOR v_row IN
    SELECT empresa_id, access_token
      FROM public.integraciones_bancarias
     WHERE proveedor = 'mercadopago'
       AND access_token IS NOT NULL
       AND access_token <> ''
  LOOP
    PERFORM public.vault_secret_upsert(
      'mp_access_token_' || v_row.empresa_id::text,
      v_row.access_token,
      'MercadoPago access token'
    );
  END LOOP;
END $$;

-- 2) Ya no queda ningún secreto en texto plano en la tabla.
ALTER TABLE public.integraciones_bancarias
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token;
