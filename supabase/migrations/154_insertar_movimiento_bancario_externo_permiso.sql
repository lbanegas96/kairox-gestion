-- migration 154 — Auditoría: RPC insertar_movimiento_bancario_externo sin gate de permiso
--
-- Hallazgo: la función (ambas sobrecargas, con/sin p_subtipo) valida tenant
-- (empresa_id = get_my_empresa_id(), exceptuando service_role para los webhooks de
-- MP) pero NO valida has_module_permission('bancos') — al ser SECURITY DEFINER,
-- bypasea la policy RLS de movimientos_bancarios que sí lo exige (mig.132).
--
-- Probado con BEGIN...ROLLBACK: un staff con permissions.bancos=false llamó la RPC
-- directamente (vía supabase.rpc(), sin pasar por ninguna pantalla) e insertó un
-- movimiento bancario falso de $999.999 con éxito. Ningún frontend real llama esta
-- función como 'authenticated' (solo los Edge Functions mp-sync/mp-webhook, que
-- corren como service_role) — pero el GRANT EXECUTE a 'authenticated' sigue activo
-- por defecto y es invocable desde el cliente por cualquier usuario con sesión.
--
-- Fix: agregar el mismo check has_module_permission('bancos') que ya exige la RLS,
-- solo para el camino no-service_role (mismo patrón que el guard de tenant existente).

CREATE OR REPLACE FUNCTION public.insertar_movimiento_bancario_externo(
  p_empresa_id uuid, p_cuenta_bancaria_id uuid, p_fecha timestamp with time zone,
  p_descripcion text, p_monto numeric, p_tipo text, p_origen text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('bancos') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo bancos';
    END IF;
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
    descripcion, monto, tipo, origen, conciliado
  ) VALUES (
    p_empresa_id, p_cuenta_bancaria_id, p_fecha,
    p_descripcion, p_monto, p_tipo, p_origen, false
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.insertar_movimiento_bancario_externo(
  p_empresa_id uuid, p_cuenta_bancaria_id uuid, p_fecha timestamp with time zone,
  p_descripcion text, p_monto numeric, p_tipo text, p_origen text, p_subtipo text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('bancos') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo bancos';
    END IF;
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
