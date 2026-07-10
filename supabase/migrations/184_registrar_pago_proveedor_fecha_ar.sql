-- Hallazgo 🟢 documentado en la Fase 5 (Multimoneda): registrar_pago_proveedor usaba la fecha
-- del SERVIDOR (now()::date, UTC) para todo — la propia fecha del movimiento en
-- cuenta_corriente_proveedores/movimientos_caja/asientos_contables, el chequeo de período
-- cerrado, Y la búsqueda de tipo de cambio para la diferencia de cambio — en vez de recibir la
-- fecha Argentina del caller como sí hace su hermana registrar_cobro_cliente (p_fecha).
--
-- Ventana de exposición real: un pago hecho después de las 21:00 ART (ya "mañana" en UTC) con la
-- tasa de "mañana" ya cargada por adelantado tomaría esa tasa en vez de la de hoy — mismo tipo de
-- desvío que ya se había corregido en el frontend para tipoCambioService.js (getTodayAR()).
--
-- Fix: agrega p_fecha (mismo patrón que registrar_cobro_cliente) — nullable con fallback a now()
-- para no romper si algún caller viejo no lo manda; se usa consistentemente en las 4 columnas que
-- antes tenían now()/now()::date sueltos.

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_proveedor_nombre text, p_monto numeric, p_metodo text, p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_imputaciones jsonb DEFAULT NULL::jsonb, p_fecha timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_monto numeric; v_ccp_id uuid; v_caja_id uuid; v_fecha_ts timestamptz := COALESCE(p_fecha, now());
  v_fecha_dia date := COALESCE(p_fecha::date, now()::date);
  v_cerrado boolean; v_cta_caja uuid; v_cta_cxp uuid; v_asiento_id uuid;
  v_asiento_generado boolean := false; v_item jsonb; v_factura_id uuid; v_monto_imp numeric;
  v_total_factura numeric; v_ya_imputado numeric; v_saldo_pendiente numeric; v_suma_imputada numeric := 0;
  v_compra_moneda text; v_compra_tc_origen numeric; v_monto_moneda_ext numeric; v_tc_actual numeric;
  v_monto_imp_actual numeric; v_dif_cambio numeric; v_dif_cambio_total numeric := 0;
  v_cta_dif_gan uuid; v_cta_dif_perd uuid; v_monto_cxp_cancelado numeric; v_total_asiento numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('compras') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
    END IF;
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El proveedor no pertenece a la empresa';
  END IF;
  v_monto := ROUND(p_monto, 2);
  INSERT INTO public.cuenta_corriente_proveedores
    (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha)
  VALUES
    (p_empresa_id, p_proveedor_id, 'pago', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago a proveedor'), p_user_id, v_fecha_ts)
  RETURNING id INTO v_ccp_id;
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, v_fecha_ts, 'egreso', 'Pago Proveedor',
     'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor') || ' - ' || p_metodo,
     v_monto, p_metodo, true)
  RETURNING id INTO v_caja_id;
  IF p_imputaciones IS NOT NULL AND jsonb_array_length(p_imputaciones) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
    LOOP
      v_factura_id := (v_item->>'compra_id')::uuid;
      SELECT total, moneda, tipo_cambio_tasa
      INTO v_total_factura, v_compra_moneda, v_compra_tc_origen
      FROM public.compras
      WHERE id = v_factura_id AND empresa_id = p_empresa_id AND proveedor_id = p_proveedor_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La compra % no existe o no pertenece a este proveedor', v_factura_id;
      END IF;
      v_monto_moneda_ext := NULLIF(v_item->>'monto_moneda_extranjera', '')::numeric;
      IF v_compra_moneda IS DISTINCT FROM 'ARS' AND v_monto_moneda_ext IS NOT NULL AND v_monto_moneda_ext > 0 THEN
        v_tc_actual        := COALESCE(public.get_tasa_cambio(p_empresa_id, v_compra_moneda, v_fecha_dia), v_compra_tc_origen);
        v_monto_imp        := ROUND(v_monto_moneda_ext * v_compra_tc_origen, 2);
        v_monto_imp_actual := ROUND(v_monto_moneda_ext * v_tc_actual, 2);
        v_dif_cambio       := v_monto_imp_actual - v_monto_imp;
        v_dif_cambio_total := v_dif_cambio_total + v_dif_cambio;
      ELSE
        v_monto_imp        := ROUND((v_item->>'monto')::numeric, 2);
        v_monto_imp_actual := v_monto_imp;
        v_monto_moneda_ext := NULL;
      END IF;
      IF v_monto_imp IS NULL OR v_monto_imp <= 0 THEN
        RAISE EXCEPTION 'El monto imputado a la compra % debe ser mayor a cero', v_factura_id;
      END IF;
      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado FROM public.cuenta_corriente_proveedores_imputaciones WHERE factura_compra_id = v_factura_id;
      v_saldo_pendiente := v_total_factura - v_ya_imputado;
      IF v_monto_imp > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto imputado (%) supera el saldo pendiente de la compra (%)', v_monto_imp, v_saldo_pendiente;
      END IF;
      INSERT INTO public.cuenta_corriente_proveedores_imputaciones
        (empresa_id, pago_movimiento_id, factura_compra_id, monto, monto_moneda_extranjera)
      VALUES (p_empresa_id, v_ccp_id, v_factura_id, v_monto_imp, v_monto_moneda_ext);
      v_suma_imputada := v_suma_imputada + v_monto_imp_actual;
    END LOOP;
    IF v_suma_imputada > v_monto THEN
      RAISE EXCEPTION 'La suma imputada a compras (%) no puede superar el monto del pago (%)', v_suma_imputada, v_monto;
    END IF;
  END IF;
  BEGIN
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;
    IF NOT COALESCE(v_cerrado, false) THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      SELECT id INTO v_cta_cxp  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
      IF v_dif_cambio_total <> 0 THEN
        SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
        SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
        IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
          v_dif_cambio_total := 0;
        END IF;
      END IF;
      v_monto_cxp_cancelado := v_monto - v_dif_cambio_total;
      v_total_asiento       := v_monto + GREATEST(-v_dif_cambio_total, 0);
      IF v_cta_caja IS NOT NULL AND v_cta_cxp IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor'),
          'confirmado', v_total_asiento, v_total_asiento, 'pago_proveedor', v_ccp_id
        ) RETURNING id INTO v_asiento_id;
        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_cxp,  'Cancelación parcial/total de deuda', v_monto_cxp_cancelado, 0),
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Pago realizado', 0, v_monto);
        IF v_dif_cambio_total > 0 THEN
          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, p_empresa_id, v_cta_dif_perd, 'Diferencia de cambio perdida (clearing)', v_dif_cambio_total, 0);
        ELSIF v_dif_cambio_total < 0 THEN
          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, p_empresa_id, v_cta_dif_gan, 'Diferencia de cambio ganada (clearing)', 0, -v_dif_cambio_total);
        END IF;
        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
    v_asiento_id := NULL;
  END;
  UPDATE public.cuenta_corriente_proveedores
     SET asiento_id = v_asiento_id, dif_cambio_total = v_dif_cambio_total
   WHERE id = v_ccp_id;
  RETURN jsonb_build_object('ok', true, 'ccp_id', v_ccp_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado, 'diferencia_cambio', v_dif_cambio_total);
END;
$function$;
