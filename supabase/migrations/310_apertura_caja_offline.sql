-- Modo Offline del POS — Fase 0, parte 2: apertura de caja idempotente.
--
-- Hoy CajaContext.openSession hace un INSERT directo contra caja_sesiones.
-- Si el cajero abre caja mientras está offline, ese INSERT tiene que quedar
-- en cola y reintentarse al reconectar — sin idempotencia, un reintento
-- crearía dos sesiones. Además, si dos dispositivos (uno offline, uno online)
-- abren la misma caja física casi al mismo tiempo, el índice único
-- uq_caja_sesion_abierta (mig.009) rechaza al segundo con un error crudo de
-- Postgres que hoy llega tal cual al frontend — acá se convierte en una
-- respuesta manejable ({conflict:true, ...la sesión que sí quedó abierta}).
--
-- p_client_uuid es opcional; sin él, el comportamiento es exactamente el
-- INSERT directo de siempre (para cuando se llama online, sin cola).

ALTER TABLE public.caja_sesiones ADD COLUMN IF NOT EXISTS client_uuid uuid;

CREATE UNIQUE INDEX IF NOT EXISTS uq_caja_sesiones_empresa_client_uuid
  ON public.caja_sesiones (empresa_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

CREATE FUNCTION public.abrir_caja_sesion(
  p_empresa_id uuid, p_caja_id uuid, p_user_id uuid, p_monto_inicial numeric,
  p_apertura_fecha timestamptz, p_client_uuid uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sesion_id uuid;
  v_existente RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF p_client_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_client_uuid::text, 1));
    SELECT id, caja_id, estado INTO v_existente
    FROM public.caja_sesiones
    WHERE empresa_id = p_empresa_id AND client_uuid = p_client_uuid;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'sesion_id', v_existente.id, 'caja_id', v_existente.caja_id,
        'estado', v_existente.estado, 'duplicate', true, 'conflict', false
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.caja_sesiones (
      caja_id, empresa_id, tenant_id, user_id, abierto_por, monto_inicial,
      estado, apertura_fecha, client_uuid
    ) VALUES (
      p_caja_id, p_empresa_id, p_empresa_id, p_user_id, p_user_id, p_monto_inicial,
      'abierta', p_apertura_fecha, p_client_uuid
    ) RETURNING id INTO v_sesion_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, caja_id, apertura_fecha, abierto_por INTO v_existente
    FROM public.caja_sesiones
    WHERE caja_id = p_caja_id AND estado = 'abierta';
    RETURN jsonb_build_object(
      'conflict', true, 'duplicate', false,
      'sesion_id', v_existente.id, 'caja_id', v_existente.caja_id,
      'apertura_fecha', v_existente.apertura_fecha, 'abierto_por', v_existente.abierto_por
    );
  END;

  RETURN jsonb_build_object('sesion_id', v_sesion_id, 'duplicate', false, 'conflict', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.abrir_caja_sesion(uuid, uuid, uuid, numeric, timestamptz, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abrir_caja_sesion(uuid, uuid, uuid, numeric, timestamptz, uuid) TO authenticated;
