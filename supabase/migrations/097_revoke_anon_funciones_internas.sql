-- Migration 097: REVOKE anon en 4 funciones internas + fix search_path en crear_devolucion
-- Funciones que escaparon de migration 063 o fueron creadas después sin REVOKE
--
-- fn_calcular_costo_valoracion : helper interno de PPP, no es RPC pública
-- next_numero_asiento          : helper de Plan de Cuentas, no es RPC pública
-- recalcular_saldo_cuenta      : helper de Plan de Cuentas, no es RPC pública
-- fn_seed_tipos_comprobante_afip: seed de tipos AFIP, tampoco es pública
-- crear_devolucion             : la migration 096 (CREATE OR REPLACE) perdió el SET search_path

-- ── 1. fn_calcular_costo_valoracion ──────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_calcular_costo_valoracion FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_calcular_costo_valoracion FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_calcular_costo_valoracion TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_calcular_costo_valoracion TO service_role;

-- ── 2. next_numero_asiento ────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.next_numero_asiento FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.next_numero_asiento FROM anon;
GRANT  EXECUTE ON FUNCTION public.next_numero_asiento TO authenticated;
GRANT  EXECUTE ON FUNCTION public.next_numero_asiento TO service_role;

-- ── 3. recalcular_saldo_cuenta ────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.recalcular_saldo_cuenta FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalcular_saldo_cuenta FROM anon;
GRANT  EXECUTE ON FUNCTION public.recalcular_saldo_cuenta TO authenticated;
GRANT  EXECUTE ON FUNCTION public.recalcular_saldo_cuenta TO service_role;

-- ── 4. fn_seed_tipos_comprobante_afip ─────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.fn_seed_tipos_comprobante_afip FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_seed_tipos_comprobante_afip FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_seed_tipos_comprobante_afip TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_seed_tipos_comprobante_afip TO service_role;

-- ── 5. crear_devolucion — restaurar search_path inmutable ──────────────────────
-- La migration 096 usó CREATE OR REPLACE sin SET search_path, borrando lo que
-- la migration 063 había fijado. Lo restauramos con ALTER FUNCTION (no toca la lógica).
ALTER FUNCTION public.crear_devolucion(
  uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text, boolean, text
) SET search_path TO 'public';
