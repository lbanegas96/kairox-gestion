-- Migration 192 — REVOKE EXECUTE explícito de `anon` en las 13 RPCs que quedaron
-- ejecutables sin loguearse (hallazgo sistémico, auditoría sesión 59, 2026-07-11).
--
-- Causa raíz: `REVOKE ALL ... FROM PUBLIC` (patrón usado en TODAS las migraciones
-- de este proyecto, incluida mig.185) NO revoca el GRANT que Supabase otorga
-- directamente al rol `anon` (no vía el pseudo-rol PUBLIC) al crear cualquier
-- función nueva en `public`. Hay que revocarlo explícitamente de `anon`.
--
-- Verificado con BEGIN...ROLLBACK (rol anon, sin ningún JWT) antes de escribir
-- esta migración: todas estas funciones YA bloquean/devuelven vacío para anon
-- gracias a sus guards internos (`IS DISTINCT FROM get_my_empresa_id()`, o
-- devuelven 0 filas porque get_my_empresa_id() es NULL) — esto es defensa en
-- profundidad, no una corrección de un exploit activo (la única que SÍ era
-- explotable, reintentar_cae_comprobante, se corrige aparte en mig.191).
--
-- `email_exists_in_system` queda AFUERA de este REVOKE a propósito: confirmado
-- (grep) que la llama `checkEmailExists()` en src/lib/validationUtils.js, con
-- comentario propio "evitar filtrar datos por RLS" — es la validación de
-- "¿este email ya existe?" del formulario de signup, ANTES de loguearse, y por
-- diseño necesita ser callable sin sesión. Habilita enumeración de emails
-- (cualquiera puede chequear si un email está registrado) — tradeoff de UX
-- común y aceptado en signup, no un hallazgo nuevo a corregir.

REVOKE EXECUTE ON FUNCTION public.crear_venta(uuid, uuid, text, timestamptz, uuid, text, numeric, text, text, text, numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cambiar_estado_cheque(uuid, uuid, text, text, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.regenerar_asiento_cxc(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.regenerar_asiento_cxp(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.listar_cotizaciones_min() FROM anon;
REVOKE EXECUTE ON FUNCTION public.listar_plan_cuentas_min() FROM anon;
REVOKE EXECUTE ON FUNCTION public.listar_proveedores_min() FROM anon;
REVOKE EXECUTE ON FUNCTION public.contar_ordenes_compra_activas() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reintentar_cae_comprobante(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_empresa_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_module_permission(text) FROM anon;

-- ROLLBACK (comentado): volver a otorgar si algo rompiera (no debería, ninguna
-- pantalla anónima/pre-login llama a estas funciones):
-- GRANT EXECUTE ON FUNCTION public.crear_venta(...) TO anon; -- etc, una por una.
