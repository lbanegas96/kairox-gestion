-- =============================================================================
-- MIGRATION 054 — Guard multi-tenant en insertar_movimiento_bancario_externo
-- =============================================================================
-- Hallazgo CRÍTICO de la auditoría de estabilización (sesión 32): esta RPC es
-- SECURITY DEFINER (bypassea RLS), está granteada a anon + authenticated, y
-- valida que la cuenta bancaria pertenezca al p_empresa_id PASADO por el caller
-- — pero nunca comparaba contra get_my_empresa_id(). Un usuario autenticado de
-- Empresa A que conociera el UUID de una cuenta de Empresa B podía inyectar
-- movimientos bancarios en la conciliación de B.
--
-- CUIDADO — caller legítimo sin sesión de usuario:
--   supabase/functions/mp-webhook/index.ts llama esta RPC con la
--   SERVICE_ROLE_KEY (no hay JWT de usuario), pasando p_empresa_id desde el
--   query param del webhook de Mercado Pago. Bajo service_role,
--   get_my_empresa_id() devuelve NULL, así que un guard ingenuo
--   `p_empresa_id IS DISTINCT FROM get_my_empresa_id()` rompería TODOS los
--   cobros automáticos de MP en producción.
--
-- Por eso el guard exceptúa explícitamente a service_role (vía auth.role(), que
-- lee el claim del JWT y es independiente del cambio de rol que hace
-- SECURITY DEFINER). El webhook ya valida internamente la empresa y deriva la
-- cuenta bancaria desde su propia fila de integraciones_bancarias, así que el
-- camino service_role es seguro sin el chequeo de get_my_empresa_id().
--
-- NOTA (no se toca en esta tarea): el GRANT a `anon` no tiene ningún caller real
-- (el webhook usa service_role, no anon). Queda flageado para una limpieza de
-- grants más amplia. De todos modos, este guard ya neutraliza el riesgo de anon:
-- anon no tiene JWT → auth.role() = 'anon' → no es service_role → cae en el
-- chequeo de get_my_empresa_id() (NULL) → RAISE.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.insertar_movimiento_bancario_externo(
  p_empresa_id uuid,
  p_cuenta_bancaria_id uuid,
  p_fecha timestamp with time zone,
  p_descripcion text,
  p_monto numeric,
  p_tipo text,
  p_origen text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  -- Guard multi-tenant: usuarios autenticados solo pueden insertar en SU empresa.
  -- service_role (webhooks sin sesión, ej. mp-webhook) queda exceptuado.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  -- Validar tipo
  IF p_tipo NOT IN ('ingreso', 'egreso') THEN
    RAISE EXCEPTION 'tipo inválido: debe ser ingreso o egreso';
  END IF;

  -- Validar que empresa_id existe
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = p_empresa_id) THEN
    RAISE EXCEPTION 'empresa_id no encontrado';
  END IF;

  -- Validar que la cuenta bancaria pertenece a la empresa
  IF NOT EXISTS (
    SELECT 1 FROM public.cuentas_bancarias
    WHERE id = p_cuenta_bancaria_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'cuenta_bancaria_id no pertenece a la empresa';
  END IF;

  -- Insertar el movimiento
  INSERT INTO public.movimientos_bancarios (
    empresa_id, cuenta_bancaria_id, fecha,
    descripcion, monto, tipo, origen, conciliado
  ) VALUES (
    p_empresa_id, p_cuenta_bancaria_id, p_fecha,
    p_descripcion, p_monto, p_tipo, p_origen, false
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'ok', true);
END;
$function$;
