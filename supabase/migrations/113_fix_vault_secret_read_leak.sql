-- migration 113 — CRÍTICO: cerrar fuga cross-tenant en vault_secret_read
--
-- PROBLEMA: migration 091 otorgó EXECUTE de vault_secret_read(text) a 'authenticated'
-- para que el frontend pudiera mostrar el badge "certificado configurado". Pero la
-- función hace `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name`
-- SIN filtro de empresa. Cualquier usuario autenticado podía leer la clave privada AFIP
-- (afip_key_<otra_empresa>) o el certificado de CUALQUIER otra empresa vía REST RPC,
-- habilitando suplantación fiscal. Viola el invariante documentado (vault solo service_role).
--
-- SOLUCIÓN:
--   1. Nueva función afip_cert_status() — devuelve SOLO un booleano (existe/no existe),
--      scoped a la empresa del caller vía get_my_empresa_id(). No expone el secreto.
--   2. REVOKE de vault_secret_read a authenticated/public/anon — vuelve a ser service_role-only.
--
-- ROLLBACK:
--   GRANT EXECUTE ON FUNCTION public.vault_secret_read(text) TO authenticated;
--   DROP FUNCTION public.afip_cert_status();

CREATE OR REPLACE FUNCTION public.afip_cert_status()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'afip_cert_' || get_my_empresa_id()::text
      AND decrypted_secret IS NOT NULL
      AND decrypted_secret <> ''
  );
$$;

REVOKE ALL ON FUNCTION public.afip_cert_status() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.afip_cert_status() TO authenticated;

-- Cerrar la fuga: el lector directo de secretos vuelve a ser service_role-only
REVOKE EXECUTE ON FUNCTION public.vault_secret_read(text) FROM authenticated, public, anon;
