-- ════════════════════════════════════════════════════════════════════════════
-- migration 147 — Limpieza hallazgo 🟢: cheques_historial atómico
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo documentado en PLAN_AUDITORIA.md (sesión 44): el historial de
-- cheques se insertaba en una 2da llamada separada desde el frontend
-- (ChequesSection.registrarHistorial), no atómica con el insert/update del
-- cheque. Si esa 2da llamada fallaba, el cheque cambiaba de estado sin dejar
-- rastro en el historial.
--
-- Fix: 3 RPCs SECURITY DEFINER que hacen cheque + historial en una sola
-- transacción. Replican el guard has_module_permission('cheques') que ya
-- exige la policy RLS de `cheques` (mig.132) — necesario porque una RPC
-- SECURITY DEFINER bypasea RLS por table ownership, así que si no se
-- replica el chequeo acá se perdería el gate de permiso ya arreglado.

CREATE OR REPLACE FUNCTION public.crear_cheque_tercero(
  p_empresa_id uuid, p_user_id uuid, p_numero text, p_banco text, p_monto numeric,
  p_fecha_emision date, p_fecha_vencimiento date,
  p_cliente_id uuid DEFAULT NULL, p_comprobante_id uuid DEFAULT NULL,
  p_observaciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cheque_id uuid;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  INSERT INTO public.cheques (
    empresa_id, user_id, tipo, numero, banco, monto, fecha_emision, fecha_vencimiento,
    cliente_id, comprobante_id, observaciones, estado
  ) VALUES (
    p_empresa_id, p_user_id, 'tercero', p_numero, p_banco, p_monto, p_fecha_emision, p_fecha_vencimiento,
    p_cliente_id, p_comprobante_id, p_observaciones, 'en_cartera'
  ) RETURNING id INTO v_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (v_cheque_id, p_empresa_id, p_user_id, NULL, 'en_cartera', 'Registro inicial');

  RETURN jsonb_build_object('id', v_cheque_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_cheque_propio(
  p_empresa_id uuid, p_user_id uuid, p_numero text, p_banco text, p_monto numeric,
  p_fecha_emision date, p_fecha_vencimiento date,
  p_cuenta_bancaria_id uuid DEFAULT NULL, p_proveedor_id uuid DEFAULT NULL,
  p_compra_id uuid DEFAULT NULL, p_observaciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cheque_id uuid;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  INSERT INTO public.cheques (
    empresa_id, user_id, tipo, numero, banco, cuenta_bancaria_id, monto,
    fecha_emision, fecha_vencimiento, proveedor_id, compra_id, observaciones, estado
  ) VALUES (
    p_empresa_id, p_user_id, 'propio', p_numero, p_banco, p_cuenta_bancaria_id, p_monto,
    p_fecha_emision, p_fecha_vencimiento, p_proveedor_id, p_compra_id, p_observaciones, 'pendiente'
  ) RETURNING id INTO v_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (v_cheque_id, p_empresa_id, p_user_id, NULL, 'pendiente', 'Registro inicial');

  RETURN jsonb_build_object('id', v_cheque_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cambiar_estado_cheque(
  p_cheque_id uuid, p_user_id uuid, p_estado_nuevo text, p_observacion text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_estado_anterior text;
BEGIN
  SELECT empresa_id, estado INTO v_empresa_id, v_estado_anterior
  FROM public.cheques WHERE id = p_cheque_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Cheque no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el cheque no pertenece a tu empresa';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;

  UPDATE public.cheques SET estado = p_estado_nuevo, updated_at = now() WHERE id = p_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (p_cheque_id, v_empresa_id, p_user_id, v_estado_anterior, p_estado_nuevo, p_observacion);

  RETURN jsonb_build_object('ok', true, 'estado_anterior', v_estado_anterior, 'estado_nuevo', p_estado_nuevo);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_cheque_tercero(uuid,uuid,text,text,numeric,date,date,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_cheque_propio(uuid,uuid,text,text,numeric,date,date,uuid,uuid,uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cambiar_estado_cheque(uuid,uuid,text,text) FROM PUBLIC, anon;
