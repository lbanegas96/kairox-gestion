-- Auditoría Fase 5: 2 hallazgos en generar_liquidacion_iibb.
--
-- 1) No tenía ningún guard contra generar 2 liquidaciones para el mismo período
--    (o períodos solapados) — un doble clic o un reintento tras un timeout de red
--    podía crear 2 filas 'borrador', y si ambas se confirman, el IIBB devengado
--    queda contabilizado 2 veces en Plan de Cuentas. Sin índice único (no hay uno
--    hoy en iibb_liquidaciones) porque "solapado" no es una condición de igualdad
--    exacta — se valida con un EXISTS dentro de la función, mismo patrón usado en
--    otros guards de esta auditoría (ej. sobre-imputación).
--
-- 2) La base imponible sumaba el neto_gravado de TODAS las ventas del período,
--    pero ignoraba las Notas de Crédito emitidas en ese mismo período (filtraba
--    tipo='venta' únicamente) — sobrestimando la base (y el impuesto) cada vez
--    que hubo una NC. Fix: se neteán las NC del mismo período (mismo criterio que
--    Ingresos Brutos real — la NC reduce la base en el período en que se emite,
--    no retroactivamente en el período de la venta original).

CREATE OR REPLACE FUNCTION public.generar_liquidacion_iibb(p_empresa_id uuid, p_user_id uuid, p_periodo_desde date, p_periodo_hasta date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_modalidad          TEXT;
  v_jurisdiccion_unica TEXT;
  v_base_total         NUMERIC := 0;
  v_detalle            JSONB := '[]'::jsonb;
  v_monto_total        NUMERIC := 0;
  v_alicuota           NUMERIC;
  v_coef               RECORD;
  v_suma_coeficientes  NUMERIC := 0;
  v_base_jurisdiccion  NUMERIC;
  v_monto_jurisdiccion NUMERIC;
  v_liquidacion_id     UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso para liquidar impuestos';
  END IF;
  IF p_periodo_hasta < p_periodo_desde THEN
    RAISE EXCEPTION 'El período hasta no puede ser anterior al período desde';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.iibb_liquidaciones
    WHERE empresa_id = p_empresa_id
      AND periodo_desde <= p_periodo_hasta
      AND periodo_hasta >= p_periodo_desde
  ) THEN
    RAISE EXCEPTION 'Ya existe una liquidación (borrador o confirmada) que se solapa con este período. Revisá el historial antes de generar una nueva.';
  END IF;

  SELECT modalidad_iibb, jurisdiccion_iibb INTO v_modalidad, v_jurisdiccion_unica
  FROM public.empresas WHERE id = p_empresa_id;

  SELECT
    COALESCE(SUM(CASE WHEN tipo = 'venta' THEN COALESCE(neto_gravado, total / 1.21) ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN tipo = 'nota_credito' THEN COALESCE(neto_gravado, total / 1.21) ELSE 0 END), 0)
  INTO v_base_total
  FROM public.comprobantes
  WHERE empresa_id = p_empresa_id
    AND tipo IN ('venta', 'nota_credito')
    AND fecha >= p_periodo_desde::timestamptz
    AND fecha <  (p_periodo_hasta + 1)::timestamptz;

  IF v_modalidad = 'convenio_multilateral' THEN
    FOR v_coef IN
      SELECT jurisdiccion, coeficiente FROM public.iibb_coeficientes
      WHERE empresa_id = p_empresa_id AND activo = true
        AND vigencia_desde <= p_periodo_hasta
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_periodo_hasta)
    LOOP
      v_suma_coeficientes := v_suma_coeficientes + v_coef.coeficiente;
    END LOOP;

    IF v_suma_coeficientes = 0 THEN
      RAISE EXCEPTION 'No hay coeficientes de Convenio Multilateral vigentes para este período. Cargalos en Impuestos > IIBB.';
    END IF;
    IF ABS(v_suma_coeficientes - 100) > 0.01 THEN
      RAISE EXCEPTION 'Los coeficientes vigentes suman % (deberían sumar 100) — revisá la carga antes de liquidar', v_suma_coeficientes;
    END IF;

    FOR v_coef IN
      SELECT jurisdiccion, coeficiente FROM public.iibb_coeficientes
      WHERE empresa_id = p_empresa_id AND activo = true
        AND vigencia_desde <= p_periodo_hasta
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_periodo_hasta)
      ORDER BY jurisdiccion
    LOOP
      SELECT alicuota INTO v_alicuota
      FROM public.alicuotas_impuestos
      WHERE empresa_id = p_empresa_id AND impuesto = 'IIBB' AND jurisdiccion = v_coef.jurisdiccion
        AND activo = true
        AND vigencia_desde <= p_periodo_hasta
        AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_periodo_hasta)
      ORDER BY vigencia_desde DESC LIMIT 1;

      IF v_alicuota IS NULL THEN
        RAISE EXCEPTION 'Falta la alícuota de IIBB para % — cargala en Impuestos > Alícuotas', v_coef.jurisdiccion;
      END IF;

      v_base_jurisdiccion  := ROUND(v_base_total * v_coef.coeficiente / 100, 2);
      v_monto_jurisdiccion := ROUND(v_base_jurisdiccion * v_alicuota / 100, 2);
      v_monto_total        := v_monto_total + v_monto_jurisdiccion;

      v_detalle := v_detalle || jsonb_build_object(
        'jurisdiccion', v_coef.jurisdiccion,
        'coeficiente', v_coef.coeficiente,
        'base_imponible', v_base_jurisdiccion,
        'alicuota', v_alicuota,
        'monto', v_monto_jurisdiccion
      );
    END LOOP;
  ELSE
    IF v_jurisdiccion_unica IS NULL OR v_jurisdiccion_unica = '' THEN
      RAISE EXCEPTION 'No hay jurisdicción de IIBB configurada para esta empresa. Configurala en Impuestos > IIBB.';
    END IF;

    SELECT alicuota INTO v_alicuota
    FROM public.alicuotas_impuestos
    WHERE empresa_id = p_empresa_id AND impuesto = 'IIBB' AND jurisdiccion = v_jurisdiccion_unica
      AND activo = true
      AND vigencia_desde <= p_periodo_hasta
      AND (vigencia_hasta IS NULL OR vigencia_hasta >= p_periodo_hasta)
    ORDER BY vigencia_desde DESC LIMIT 1;

    IF v_alicuota IS NULL THEN
      RAISE EXCEPTION 'Falta la alícuota de IIBB para % — cargala en Impuestos > Alícuotas', v_jurisdiccion_unica;
    END IF;

    v_monto_total := ROUND(v_base_total * v_alicuota / 100, 2);

    v_detalle := jsonb_build_array(jsonb_build_object(
      'jurisdiccion', v_jurisdiccion_unica,
      'coeficiente', 100,
      'base_imponible', v_base_total,
      'alicuota', v_alicuota,
      'monto', v_monto_total
    ));
  END IF;

  INSERT INTO public.iibb_liquidaciones
    (empresa_id, user_id, periodo_desde, periodo_hasta, modalidad, base_imponible_total, detalle, monto_total)
  VALUES
    (p_empresa_id, p_user_id, p_periodo_desde, p_periodo_hasta, v_modalidad, v_base_total, v_detalle, v_monto_total)
  RETURNING id INTO v_liquidacion_id;

  RETURN jsonb_build_object(
    'id', v_liquidacion_id,
    'modalidad', v_modalidad,
    'base_imponible_total', v_base_total,
    'detalle', v_detalle,
    'monto_total', v_monto_total
  );
END;
$function$;
