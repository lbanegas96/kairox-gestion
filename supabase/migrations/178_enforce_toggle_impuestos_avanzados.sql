-- Auditoría Fase 5 (Impuestos Avanzados): el toggle empresas.usa_impuestos_avanzados
-- (mig.173) solo ocultaba las tabs IIBB/Retenciones/Alícuotas en el frontend
-- (ImpuestosSection.jsx) — la decisión de diseño original elegida por el usuario fue
-- "Ocultar del menú + no ejecutar acciones", pero la segunda mitad nunca se implementó
-- a nivel RPC: un admin (o cualquiera con permiso 'configuracion') podía seguir
-- llamando generar_liquidacion_iibb/confirmar_liquidacion_iibb/
-- registrar_retencion_practicada por API directa con el toggle en OFF.

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
  v_avanzados          BOOLEAN;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso para liquidar impuestos';
  END IF;

  SELECT usa_impuestos_avanzados INTO v_avanzados FROM public.empresas WHERE id = p_empresa_id;
  IF NOT COALESCE(v_avanzados, false) THEN
    RAISE EXCEPTION 'Impuestos Avanzados no está activado para esta empresa. Activalo en Configuración > Finanzas.';
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

CREATE OR REPLACE FUNCTION public.confirmar_liquidacion_iibb(p_empresa_id uuid, p_user_id uuid, p_liquidacion_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_liq              RECORD;
  v_cta_impuestos    UUID;
  v_cta_a_pagar      UUID;
  v_asiento_id       UUID;
  v_asiento_generado BOOLEAN := false;
  v_avanzados        BOOLEAN;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso para liquidar impuestos';
  END IF;

  SELECT usa_impuestos_avanzados INTO v_avanzados FROM public.empresas WHERE id = p_empresa_id;
  IF NOT COALESCE(v_avanzados, false) THEN
    RAISE EXCEPTION 'Impuestos Avanzados no está activado para esta empresa. Activalo en Configuración > Finanzas.';
  END IF;

  SELECT * INTO v_liq FROM public.iibb_liquidaciones
  WHERE id = p_liquidacion_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La liquidación no existe o no pertenece a esta empresa';
  END IF;
  IF v_liq.estado = 'confirmada' THEN
    RAISE EXCEPTION 'Esta liquidación ya fue confirmada';
  END IF;

  BEGIN
    SELECT id INTO v_cta_impuestos FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.6' AND activa LIMIT 1;
    SELECT id INTO v_cta_a_pagar   FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.4' AND activa LIMIT 1;

    IF v_cta_impuestos IS NOT NULL AND v_cta_a_pagar IS NOT NULL AND v_liq.monto_total > 0 THEN
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (
        p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), CURRENT_DATE,
        'Liquidación IIBB ' || to_char(v_liq.periodo_desde, 'MM/YYYY'),
        'confirmado', v_liq.monto_total, v_liq.monto_total, 'iibb_liquidacion', v_liq.id
      ) RETURNING id INTO v_asiento_id;

      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, p_empresa_id, v_cta_impuestos, 'IIBB devengado del período', v_liq.monto_total, 0),
        (v_asiento_id, p_empresa_id, v_cta_a_pagar,   'IIBB a pagar', 0, v_liq.monto_total);

      v_asiento_generado := true;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  UPDATE public.iibb_liquidaciones
  SET estado = 'confirmada', asiento_id = v_asiento_id, fecha_confirmacion = NOW()
  WHERE id = p_liquidacion_id;

  RETURN jsonb_build_object('ok', true, 'asiento_generado', v_asiento_generado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_retencion_practicada(p_empresa_id uuid, p_user_id uuid, p_impuesto text, p_jurisdiccion text, p_monto numeric, p_alicuota_aplicada numeric, p_fecha date, p_contraparte_nombre text, p_contraparte_cuit text, p_compra_id uuid DEFAULT NULL::uuid, p_observaciones text DEFAULT NULL::text)
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
  v_avanzados  boolean;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('configuracion') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo configuración';
  END IF;

  SELECT usa_impuestos_avanzados INTO v_avanzados FROM public.empresas WHERE id = p_empresa_id;
  IF NOT COALESCE(v_avanzados, false) THEN
    RAISE EXCEPTION 'Impuestos Avanzados no está activado para esta empresa. Activalo en Configuración > Finanzas.';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;

  v_anio := EXTRACT(YEAR FROM p_fecha)::int;

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
