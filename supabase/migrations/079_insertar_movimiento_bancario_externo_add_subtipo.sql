-- ════════════════════════════════════════════════════════════════════════════
-- migration 079 — Agregar p_subtipo a insertar_movimiento_bancario_externo
-- ════════════════════════════════════════════════════════════════════════════
--
-- Extiende la RPC con un parámetro opcional DEFAULT NULL para que
-- mp-webhook pueda pasar el tipo de cobro (transferencia, qr,
-- tarjeta_credito, tarjeta_debito) sin romper a los callers existentes:
--   · sync_uala_to_bancos (sesión 51): no pasa p_subtipo → NULL
--   · cualquier inserción manual futura: también queda NULL si no aplica
--
-- Compatible con migration 054 (guard multi-tenant) y migration 078
-- (columna subtipo en movimientos_bancarios).

CREATE OR REPLACE FUNCTION public.insertar_movimiento_bancario_externo(
  p_empresa_id         uuid,
  p_cuenta_bancaria_id uuid,
  p_fecha              timestamp with time zone,
  p_descripcion        text,
  p_monto              numeric,
  p_tipo               text,
  p_origen             text,
  p_subtipo            text DEFAULT NULL
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

  IF p_tipo NOT IN ('ingreso', 'egreso') THEN
    RAISE EXCEPTION 'tipo inválido: debe ser ingreso o egreso';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = p_empresa_id) THEN
    RAISE EXCEPTION 'empresa_id no encontrado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.cuentas_bancarias
    WHERE id = p_cuenta_bancaria_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'cuenta_bancaria_id no pertenece a la empresa';
  END IF;

  INSERT INTO public.movimientos_bancarios (
    empresa_id, cuenta_bancaria_id, fecha,
    descripcion, monto, tipo, origen, conciliado, subtipo
  ) VALUES (
    p_empresa_id, p_cuenta_bancaria_id, p_fecha,
    p_descripcion, p_monto, p_tipo, p_origen, false, p_subtipo
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'ok', true);
END;
$function$;

-- ROLLBACK (comentado): volver a la firma sin p_subtipo (migration 054)
-- CREATE OR REPLACE FUNCTION public.insertar_movimiento_bancario_externo(
--   p_empresa_id uuid, p_cuenta_bancaria_id uuid, p_fecha timestamptz,
--   p_descripcion text, p_monto numeric, p_tipo text, p_origen text
-- ) ... (body sin subtipo en INSERT)
