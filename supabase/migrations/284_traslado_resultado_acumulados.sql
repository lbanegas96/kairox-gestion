-- migration 284 — Segundo paso del cierre estilo SAP: trasladar 3.3 Resultado
-- del Ejercicio a 3.2 Resultados Acumulados
--
-- mig.283 dejó el asiento de cierre de ejercicio (zapatea Ingreso/Egreso contra
-- 3.3). Falta el paso siguiente que SAP también hace al cambiar de ejercicio:
-- mover el saldo que quedó en 3.3 hacia 3.2 "Resultados Acumulados", dejando
-- 3.3 en cero para que el próximo ejercicio arranque limpio.
--
-- Se guarda el resultado neto calculado en mig.283 en una columna propia
-- (periodos_contables.resultado_neto) en vez de releer el saldo actual de 3.3 —
-- así, si se cierran varios ejercicios seguidos antes de trasladar alguno, cada
-- traslado mueve exactamente lo que le corresponde a SU período, sin mezclarse
-- con el resultado neto de otros períodos que también hayan tocado 3.3.

ALTER TABLE public.periodos_contables
  ADD COLUMN IF NOT EXISTS resultado_neto numeric,
  ADD COLUMN IF NOT EXISTS asiento_traslado_id uuid REFERENCES public.asientos_contables(id);

-- cerrar_ejercicio_contable: además de todo lo que ya hacía, ahora guarda el
-- resultado neto calculado en periodos_contables.resultado_neto
CREATE OR REPLACE FUNCTION public.cerrar_ejercicio_contable(p_periodo_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id       uuid;
  v_nombre           text;
  v_fecha_inicio     date;
  v_fecha_cierre     date;
  v_estado           text;
  v_asiento_cierre_id uuid;
  v_cta_resultado    uuid;
  v_asiento_id       uuid;
  v_desc             text;
  v_resultado_neto   numeric := 0;
  v_total_debe       numeric := 0;
  v_total_haber      numeric := 0;
  v_lineas_generadas int := 0;
  r RECORD;
BEGIN
  SELECT empresa_id, nombre, fecha_inicio, fecha_cierre, estado, asiento_cierre_id
    INTO v_empresa_id, v_nombre, v_fecha_inicio, v_fecha_cierre, v_estado, v_asiento_cierre_id
  FROM public.periodos_contables WHERE id = p_periodo_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Período no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el período no pertenece a tu empresa';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: el cierre de ejercicio requiere rol admin';
  END IF;
  IF v_estado <> 'cerrado' THEN
    RAISE EXCEPTION 'El período debe estar cerrado (fechas bloqueadas) antes de generar el asiento de cierre de ejercicio';
  END IF;
  IF v_asiento_cierre_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este período ya tiene un asiento de cierre de ejercicio generado';
  END IF;

  SELECT id INTO v_cta_resultado FROM public.plan_cuentas
  WHERE empresa_id = v_empresa_id AND codigo = '3.3' AND activa LIMIT 1;
  IF v_cta_resultado IS NULL THEN
    RAISE EXCEPTION 'Falta la cuenta 3.3 (Resultado del Ejercicio) en el plan de cuentas';
  END IF;

  v_desc := 'Cierre de Ejercicio — ' || v_nombre;
  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha_cierre, v_desc,
          'confirmado', 0, 0, 'cierre_ejercicio', p_periodo_id)
  RETURNING id INTO v_asiento_id;

  FOR r IN
    SELECT pc.id AS cuenta_id, pc.tipo, SUM(ai.debe) AS suma_debe, SUM(ai.haber) AS suma_haber
    FROM public.asientos_items ai
    JOIN public.asientos_contables ac ON ac.id = ai.asiento_id
    JOIN public.plan_cuentas pc ON pc.id = ai.cuenta_id
    WHERE ac.empresa_id = v_empresa_id
      AND ac.estado = 'confirmado'
      AND ac.fecha BETWEEN v_fecha_inicio AND v_fecha_cierre
      AND pc.tipo IN ('ingreso', 'egreso')
    GROUP BY pc.id, pc.tipo
    HAVING SUM(ai.debe) <> SUM(ai.haber)
  LOOP
    IF r.suma_haber > r.suma_debe THEN
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      VALUES (v_asiento_id, v_empresa_id, r.cuenta_id, v_desc, r.suma_haber - r.suma_debe, 0);
      v_total_debe := v_total_debe + (r.suma_haber - r.suma_debe);
      v_resultado_neto := v_resultado_neto + (r.suma_haber - r.suma_debe);
    ELSE
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      VALUES (v_asiento_id, v_empresa_id, r.cuenta_id, v_desc, 0, r.suma_debe - r.suma_haber);
      v_total_haber := v_total_haber + (r.suma_debe - r.suma_haber);
      v_resultado_neto := v_resultado_neto - (r.suma_debe - r.suma_haber);
    END IF;
    v_lineas_generadas := v_lineas_generadas + 1;
  END LOOP;

  IF v_lineas_generadas = 0 THEN
    DELETE FROM public.asientos_contables WHERE id = v_asiento_id;
    RETURN jsonb_build_object('ok', true, 'asiento_id', NULL, 'resultado_neto', 0, 'mensaje', 'Sin movimientos de resultado en el rango — no se generó asiento');
  END IF;

  IF v_resultado_neto > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
    VALUES (v_asiento_id, v_empresa_id, v_cta_resultado, v_desc, 0, v_resultado_neto);
    v_total_haber := v_total_haber + v_resultado_neto;
  ELSIF v_resultado_neto < 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
    VALUES (v_asiento_id, v_empresa_id, v_cta_resultado, v_desc, -v_resultado_neto, 0);
    v_total_debe := v_total_debe + (-v_resultado_neto);
  END IF;

  UPDATE public.asientos_contables
  SET total_debe = v_total_debe, total_haber = v_total_haber
  WHERE id = v_asiento_id;

  UPDATE public.periodos_contables
  SET asiento_cierre_id = v_asiento_id, resultado_neto = v_resultado_neto
  WHERE id = p_periodo_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'resultado_neto', v_resultado_neto);
END;
$function$;

-- RPC trasladar_resultado_acumulados: mueve periodos_contables.resultado_neto
-- de 3.3 a 3.2, dejando 3.3 en cero para el ejercicio siguiente.
CREATE OR REPLACE FUNCTION public.trasladar_resultado_acumulados(p_periodo_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id         uuid;
  v_nombre             text;
  v_fecha_cierre       date;
  v_asiento_cierre_id  uuid;
  v_asiento_traslado_id uuid;
  v_resultado_neto     numeric;
  v_cta_resultado      uuid;
  v_cta_acumulados     uuid;
  v_asiento_id         uuid;
  v_desc               text;
BEGIN
  SELECT empresa_id, nombre, fecha_cierre, asiento_cierre_id, asiento_traslado_id, resultado_neto
    INTO v_empresa_id, v_nombre, v_fecha_cierre, v_asiento_cierre_id, v_asiento_traslado_id, v_resultado_neto
  FROM public.periodos_contables WHERE id = p_periodo_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Período no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el período no pertenece a tu empresa';
  END IF;
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'No autorizado: el traslado a Resultados Acumulados requiere rol admin';
  END IF;
  IF v_asiento_cierre_id IS NULL THEN
    RAISE EXCEPTION 'Este período todavía no tiene el asiento de cierre de ejercicio generado';
  END IF;
  IF v_asiento_traslado_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este período ya trasladó su resultado a Resultados Acumulados';
  END IF;
  IF v_resultado_neto IS NULL OR v_resultado_neto = 0 THEN
    RAISE EXCEPTION 'Este período no tiene resultado neto para trasladar';
  END IF;

  SELECT id INTO v_cta_resultado FROM public.plan_cuentas
  WHERE empresa_id = v_empresa_id AND codigo = '3.3' AND activa LIMIT 1;
  IF v_cta_resultado IS NULL THEN
    RAISE EXCEPTION 'Falta la cuenta 3.3 (Resultado del Ejercicio) en el plan de cuentas';
  END IF;
  SELECT id INTO v_cta_acumulados FROM public.plan_cuentas
  WHERE empresa_id = v_empresa_id AND codigo = '3.2' AND activa LIMIT 1;
  IF v_cta_acumulados IS NULL THEN
    RAISE EXCEPTION 'Falta la cuenta 3.2 (Resultados Acumulados) en el plan de cuentas';
  END IF;

  v_desc := 'Traslado a Resultados Acumulados — ' || v_nombre;
  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha_cierre, v_desc,
          'confirmado', abs(v_resultado_neto), abs(v_resultado_neto), 'traslado_resultado', p_periodo_id)
  RETURNING id INTO v_asiento_id;

  IF v_resultado_neto > 0 THEN
    -- 3.3 tenía saldo acreedor (ganancia): se debita para dejarla en cero, se acredita 3.2
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_resultado,  v_desc, v_resultado_neto, 0),
      (v_asiento_id, v_empresa_id, v_cta_acumulados, v_desc, 0, v_resultado_neto);
  ELSE
    -- 3.3 tenía saldo deudor (pérdida): se acredita para dejarla en cero, se debita 3.2
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_acumulados, v_desc, -v_resultado_neto, 0),
      (v_asiento_id, v_empresa_id, v_cta_resultado,  v_desc, 0, -v_resultado_neto);
  END IF;

  UPDATE public.periodos_contables
  SET asiento_traslado_id = v_asiento_id
  WHERE id = p_periodo_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'resultado_neto', v_resultado_neto);
END;
$function$;

REVOKE ALL ON FUNCTION public.trasladar_resultado_acumulados(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trasladar_resultado_acumulados(uuid, uuid) TO authenticated;

-- ROLLBACK (comentado): DROP FUNCTION trasladar_resultado_acumulados;
-- recrear cerrar_ejercicio_contable con el body previo a esta migration (sin
-- setear periodos_contables.resultado_neto);
-- ALTER TABLE periodos_contables DROP COLUMN resultado_neto, DROP COLUMN asiento_traslado_id.
