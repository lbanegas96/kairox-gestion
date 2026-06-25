-- Migration 091: GRANT EXECUTE on vault_secret_read to authenticated.
--
-- Síntoma: "permission denied for function vault_secret_read" (403) al
-- abrir Configuración → Facturación, intentando chequear si el cert AFIP
-- está cargado (ConfiguracionSection.jsx → reloadAFIP).
--
-- Causa: la función ya es SECURITY DEFINER con search_path=public,vault,
-- pero proacl mostraba solo {postgres, service_role} — falta authenticated.
-- Probable colateral de migrations 063/064 (REVOKE masivo de anon).
--
-- No se toca get_my_empresa_id (ya tiene authenticated=X).

REVOKE ALL ON FUNCTION public.vault_secret_read(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vault_secret_read(text) TO authenticated;
