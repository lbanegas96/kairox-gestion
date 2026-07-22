-- Migration 231 — vault_secret_delete: falta el borrado en el wrapper de Vault
-- (migración 025 solo definió upsert/read).
--
-- Lo necesita el webhook de compliance de Tiendanube (store/redact — LGPD/Ley
-- 25.326): cuando un comercio pide eliminar los datos de su tienda, hay que
-- borrar de verdad el access token guardado en Vault, no solo desactivar la fila
-- de integraciones_canales.
--
-- Mismo patrón exacto que vault_secret_upsert/vault_secret_read: SECURITY
-- DEFINER, solo service_role puede ejecutarla.
--
-- ROLLBACK: DROP FUNCTION public.vault_secret_delete(TEXT);

CREATE OR REPLACE FUNCTION public.vault_secret_delete(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
BEGIN
  DELETE FROM vault.secrets WHERE name = p_name;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.vault_secret_delete(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_secret_delete(TEXT) TO service_role;
