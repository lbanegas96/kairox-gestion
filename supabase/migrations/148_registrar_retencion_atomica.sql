-- ════════════════════════════════════════════════════════════════════════════
-- migration 148 — Limpieza hallazgo 🟢: numeración de certificado de Retención
-- no atómica (count() client-side)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo documentado en PLAN_AUDITORIA.md (sesión 44): generarNumeroCertificado
-- en TabRetenciones.jsx calculaba el próximo número con un count() en el
-- cliente y LUEGO insertaba — dos llamadas separadas, sin lock. Dos
-- retenciones "practicada" registradas casi al mismo tiempo podían recibir
-- el mismo numero_certificado.
--
-- Fix: RPC SECURITY DEFINER que usa un advisory lock transaccional
-- (empresa_id + año) para serializar el cálculo + insert en una sola
-- operación atómica. No se creó un nuevo tipo en series_numeracion porque
-- el formato "RET-{año}-####" reinicia por año, distinto al resto de los
-- documentos (continuos) — un advisory lock es más simple y suficiente para
-- el volumen de este módulo (registro manual, baja concurrencia esperada).

CREATE OR REPLACE FUNCTION public.registrar_retencion_practicada(
  p_empresa_id uuid, p_user_id uuid, p_impuesto text, p_jurisdiccion text,
  p_monto numeric, p_alicuota_aplicada numeric, p_fecha date,
  p_contraparte_nombre text, p_contraparte_cuit text,
  p_compra_id uuid DEFAULT NULL, p_observaciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_anio       int;
  v_count      int;
  v_numero     text;
  v_ret_id     uuid;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo configuración';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  v_anio := EXTRACT(YEAR FROM p_fecha)::int;

  -- Serializa el cálculo del número dentro de esta transacción: dos llamadas
  -- concurrentes para la misma empresa+año esperan su turno acá.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || v_anio::text, 0));

  SELECT count(*) INTO v_count
  FROM public.retenciones
  WHERE empresa_id = p_empresa_id AND tipo = 'practicada'
    AND fecha >= make_date(v_anio, 1, 1) AND fecha < make_date(v_anio + 1, 1, 1);

  v_numero := 'RET-' || v_anio || '-' || LPAD((v_count + 1)::text, 4, '0');

  INSERT INTO public.retenciones (
    empresa_id, user_id, tipo, impuesto, jurisdiccion, monto, alicuota_aplicada,
    fecha, contraparte_nombre, contraparte_cuit, compra_id, numero_certificado, observaciones
  ) VALUES (
    p_empresa_id, p_user_id, 'practicada', p_impuesto, p_jurisdiccion, p_monto, p_alicuota_aplicada,
    p_fecha, p_contraparte_nombre, p_contraparte_cuit, p_compra_id, v_numero, p_observaciones
  ) RETURNING id INTO v_ret_id;

  RETURN jsonb_build_object('id', v_ret_id, 'numero_certificado', v_numero);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_retencion_practicada(uuid,uuid,text,text,numeric,numeric,date,text,text,uuid,text) FROM PUBLIC, anon;
