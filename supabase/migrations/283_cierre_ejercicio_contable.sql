-- migration 283 — Cierre de Ejercicio contable (estilo SAP: pase de Resultados a Patrimonio)
--
-- HALLAZGO (auditoría Bancos/Cheques, sesión 2026-07-31): el "cierre de período"
-- existente (TabPeriodos.jsx, mig.027) solo BLOQUEA fechas — ningún asiento nuevo
-- puede postearse en el rango cerrado. Pero nunca existió el asiento real de
-- cierre de ejercicio que SAP sí hace: zapatear las cuentas de Resultados
-- (ingreso/egreso) contra Patrimonio, dejándolas en cero para el ejercicio
-- siguiente. Hoy el "Resultado del Ejercicio" del Balance General
-- (TabBalanceGeneral.jsx) es un cálculo en pantalla, nunca un movimiento
-- contable persistido — las cuentas de resultado acumulan desde el origen sin
-- corte real.
--
-- Fix: operación explícita y separada del cierre de período (nunca automática).
-- Requiere que el período YA esté cerrado (fechas bloqueadas) antes de poder
-- generar el asiento — mismo criterio que "primero cerrás las fechas, después
-- contabilizás el cierre", como en SAP.

-- 1) Vínculo período → asiento de cierre (uno solo por período, no se puede repetir)
ALTER TABLE public.periodos_contables
  ADD COLUMN IF NOT EXISTS asiento_cierre_id uuid REFERENCES public.asientos_contables(id);

-- 2) RPC cerrar_ejercicio_contable: por cada cuenta de tipo ingreso/egreso con
-- movimientos dentro del rango del período, inserta una línea que la deja en
-- cero, contra una única línea de contrapartida en 3.3 "Resultado del Ejercicio".
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

  -- Por cada cuenta de resultado (ingreso/egreso) con movimientos confirmados
  -- dentro del rango, la línea que la deja en cero (contrario a su saldo neto)
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
      -- saldo acreedor (típico de ingreso): se debita para dejarla en cero
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      VALUES (v_asiento_id, v_empresa_id, r.cuenta_id, v_desc, r.suma_haber - r.suma_debe, 0);
      v_total_debe := v_total_debe + (r.suma_haber - r.suma_debe);
      v_resultado_neto := v_resultado_neto + (r.suma_haber - r.suma_debe);
    ELSE
      -- saldo deudor (típico de egreso): se acredita para dejarla en cero
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      VALUES (v_asiento_id, v_empresa_id, r.cuenta_id, v_desc, 0, r.suma_debe - r.suma_haber);
      v_total_haber := v_total_haber + (r.suma_debe - r.suma_haber);
      v_resultado_neto := v_resultado_neto - (r.suma_debe - r.suma_haber);
    END IF;
    v_lineas_generadas := v_lineas_generadas + 1;
  END LOOP;

  IF v_lineas_generadas = 0 THEN
    -- Nada que cerrar (sin movimientos de resultado en el rango): descartar el asiento vacío
    DELETE FROM public.asientos_contables WHERE id = v_asiento_id;
    RETURN jsonb_build_object('ok', true, 'asiento_id', NULL, 'resultado_neto', 0, 'mensaje', 'Sin movimientos de resultado en el rango — no se generó asiento');
  END IF;

  -- Contrapartida única contra 3.3 Resultado del Ejercicio
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
  SET asiento_cierre_id = v_asiento_id
  WHERE id = p_periodo_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'resultado_neto', v_resultado_neto);
END;
$function$;

REVOKE ALL ON FUNCTION public.cerrar_ejercicio_contable(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_ejercicio_contable(uuid, uuid) TO authenticated;

-- ROLLBACK (comentado): DROP FUNCTION cerrar_ejercicio_contable;
-- ALTER TABLE periodos_contables DROP COLUMN asiento_cierre_id;
