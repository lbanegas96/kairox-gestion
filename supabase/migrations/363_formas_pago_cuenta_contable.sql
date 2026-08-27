-- migration 363 — Determinación de Cuentas: cablear medios de pago (Fase 4)
--
-- PLAN_MAPA_Y_DETERMINACION_CUENTAS_2026-08-27.md, Fase 4 — el pedido original: que cada forma
-- de pago tenga su propia cuenta contable configurable, en vez de que registrar_cobro_cliente y
-- crearAsientoVenta hardcodeen '1.1.1 Caja' para todo cobro al contado.
--
-- Diseño (más directo que el motor genérico de mig.361, porque acá ya existe un maestro
-- dedicado — formas_pago, mig.214 — no hace falta pasar por codigo_cable):
--   1. cuenta_contable_id (nueva, nullable) en formas_pago — override explícito.
--   2. Si no hay override: los medios con cuenta_bancaria_id ya resuelven su cuenta a través de
--      cuentas_bancarias.plan_cuenta_id (esa cadena ya existe, mig.214/011) — no hace falta
--      duplicar el dato.
--   3. Si ninguna de las dos: cae al código hardcodeado de siempre (p_codigo_fallback) —
--      retrocompatible, ninguna empresa cambia de comportamiento hasta que configure algo.
--
-- Backfill: Efectivo no tiene cuenta_bancaria_id (no aplica) — se le asigna cuenta_contable_id
-- = 1.1.1 explícitamente para cada empresa existente, así el cable queda igual de "ya
-- configurado" que el resto (estilo SAP: el customizing no queda a medio llenar).
--
-- ROLLBACK (comentado): DROP FUNCTION public.obtener_cuenta_forma_pago(uuid, uuid, text);
--           ALTER TABLE public.formas_pago DROP COLUMN cuenta_contable_id;
--           (registrar_cobro_cliente vuelve a la versión anterior a esta migración)

ALTER TABLE public.formas_pago
  ADD COLUMN cuenta_contable_id uuid REFERENCES public.plan_cuentas(id) ON DELETE SET NULL;

-- Backfill: Efectivo → 1.1.1, por empresa (verificado contra Nalux real antes de aplicar).
UPDATE public.formas_pago fp
   SET cuenta_contable_id = pc.id
  FROM public.plan_cuentas pc
 WHERE pc.empresa_id = fp.empresa_id
   AND pc.codigo = '1.1.1' AND pc.activa
   AND fp.tipo_instrumento = 'efectivo'
   AND fp.cuenta_contable_id IS NULL;

CREATE OR REPLACE FUNCTION public.obtener_cuenta_forma_pago(
  p_empresa_id uuid, p_forma_pago_id uuid, p_codigo_fallback text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta_id uuid;
  v_cuenta_bancaria_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  IF p_forma_pago_id IS NOT NULL THEN
    SELECT cuenta_contable_id, cuenta_bancaria_id
      INTO v_cuenta_id, v_cuenta_bancaria_id
    FROM public.formas_pago
    WHERE id = p_forma_pago_id AND empresa_id = p_empresa_id;

    IF v_cuenta_id IS NULL AND v_cuenta_bancaria_id IS NOT NULL THEN
      SELECT plan_cuenta_id INTO v_cuenta_id
      FROM public.cuentas_bancarias
      WHERE id = v_cuenta_bancaria_id AND empresa_id = p_empresa_id;
    END IF;
  END IF;

  IF v_cuenta_id IS NULL AND p_codigo_fallback IS NOT NULL THEN
    SELECT id INTO v_cuenta_id
    FROM public.plan_cuentas
    WHERE empresa_id = p_empresa_id AND codigo = p_codigo_fallback AND activa;
  END IF;

  RETURN v_cuenta_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.obtener_cuenta_forma_pago(uuid, uuid, text) TO authenticated;

-- registrar_cobro_cliente (mig.216/357, firma sin cambios) — el cobro al contado ('acreditado',
-- no la rama 'pendiente' que ya usa la cuenta puente 1.1.8) deja de hardcodear '1.1.1' y consulta
-- la determinación por forma de pago.
CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_monto numeric, p_metodo text, p_fecha timestamp with time zone, p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_monto_paralelo numeric DEFAULT NULL::numeric, p_tc_paralelo numeric DEFAULT NULL::numeric, p_imputaciones jsonb DEFAULT NULL::jsonb, p_forma_pago_id uuid DEFAULT NULL::uuid, p_referencia_pago text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_monto numeric; v_paralelo numeric; v_cc_id uuid; v_caja_id uuid; v_fecha_dia date;
  v_cerrado boolean; v_cta_caja uuid; v_cta_cxc uuid; v_asiento_id uuid;
  v_asiento_generado boolean := false; v_item jsonb; v_factura_id uuid; v_monto_imp numeric;
  v_total_factura numeric; v_ya_imputado numeric; v_saldo_pendiente numeric; v_suma_imputada numeric := 0;
  v_factura_moneda text; v_factura_tc_origen numeric; v_monto_moneda_ext numeric; v_tc_actual numeric;
  v_monto_imp_actual numeric; v_dif_cambio numeric; v_dif_cambio_total numeric := 0;
  v_cta_dif_gan uuid; v_cta_dif_perd uuid; v_monto_cxc_cancelado numeric; v_total_asiento numeric;
  v_metodo text;
  -- mig.216: liquidación de tarjeta
  v_dias_acreditacion integer := 0; v_comision_pct numeric := 0;
  v_estado_liq text := 'acreditado'; v_monto_comision numeric := 0; v_monto_neto numeric;
  v_fecha_acred_est date; v_cta_puente uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('ventas') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
    END IF;
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del cobro debe ser mayor a cero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El cliente no pertenece a la empresa';
  END IF;

  v_metodo := p_metodo;
  IF p_forma_pago_id IS NOT NULL THEN
    SELECT nombre, dias_acreditacion, comision_porcentaje
      INTO v_metodo, v_dias_acreditacion, v_comision_pct
    FROM public.formas_pago
     WHERE id = p_forma_pago_id AND empresa_id = p_empresa_id;
    IF v_metodo IS NULL THEN
      RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
    END IF;
  END IF;

  v_monto    := ROUND(p_monto, 2);
  v_paralelo := CASE WHEN p_monto_paralelo IS NOT NULL THEN ROUND(p_monto_paralelo, 2) END;

  IF COALESCE(v_dias_acreditacion, 0) > 0 THEN
    v_estado_liq     := 'pendiente';
    v_monto_comision := ROUND(v_monto * COALESCE(v_comision_pct, 0) / 100, 2);
    v_monto_neto     := v_monto - v_monto_comision;
    v_fecha_acred_est := p_fecha::date + v_dias_acreditacion;
  END IF;

  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo, forma_pago_id, referencia_pago)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, v_metodo, v_paralelo, p_tc_paralelo, p_forma_pago_id, NULLIF(p_referencia_pago, ''))
  RETURNING id INTO v_cc_id;
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id,
     estado_liquidacion, monto_comision, monto_neto, fecha_acreditacion_estimada)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || v_metodo,
     v_monto, v_metodo, true, v_paralelo, p_tc_paralelo, p_forma_pago_id,
     v_estado_liq, v_monto_comision, v_monto_neto, v_fecha_acred_est)
  RETURNING id INTO v_caja_id;
  IF p_imputaciones IS NOT NULL AND jsonb_array_length(p_imputaciones) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
    LOOP
      v_factura_id := (v_item->>'comprobante_id')::uuid;
      SELECT total, moneda, tipo_cambio_tasa
      INTO v_total_factura, v_factura_moneda, v_factura_tc_origen
      FROM public.comprobantes
      WHERE id = v_factura_id AND empresa_id = p_empresa_id AND cliente_id = p_cliente_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La factura % no existe o no pertenece a este cliente', v_factura_id;
      END IF;
      v_monto_moneda_ext := NULLIF(v_item->>'monto_moneda_extranjera', '')::numeric;
      IF v_factura_moneda IS DISTINCT FROM 'ARS' AND v_monto_moneda_ext IS NOT NULL AND v_monto_moneda_ext > 0 THEN
        v_tc_actual        := COALESCE(public.get_tasa_cambio(p_empresa_id, v_factura_moneda, p_fecha::date), v_factura_tc_origen);
        v_monto_imp        := ROUND(v_monto_moneda_ext * v_factura_tc_origen, 2);
        v_monto_imp_actual := ROUND(v_monto_moneda_ext * v_tc_actual, 2);
        v_dif_cambio       := v_monto_imp_actual - v_monto_imp;
        v_dif_cambio_total := v_dif_cambio_total + v_dif_cambio;
      ELSE
        v_monto_imp        := ROUND((v_item->>'monto')::numeric, 2);
        v_monto_imp_actual := v_monto_imp;
        v_monto_moneda_ext := NULL;
      END IF;
      IF v_monto_imp IS NULL OR v_monto_imp <= 0 THEN
        RAISE EXCEPTION 'El monto imputado a la factura % debe ser mayor a cero', v_factura_id;
      END IF;
      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado FROM public.cuenta_corriente_imputaciones WHERE factura_comprobante_id = v_factura_id;
      v_saldo_pendiente := v_total_factura - v_ya_imputado;
      IF v_monto_imp > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto imputado (%) supera el saldo pendiente de la factura (%)', v_monto_imp, v_saldo_pendiente;
      END IF;
      INSERT INTO public.cuenta_corriente_imputaciones
        (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto, monto_moneda_extranjera)
      VALUES (p_empresa_id, v_cc_id, v_factura_id, v_monto_imp, v_monto_moneda_ext);
      UPDATE public.comprobantes
         SET estado_pago = CASE
                              WHEN (v_ya_imputado + v_monto_imp) >= v_total_factura THEN 'pagada'
                              WHEN (v_ya_imputado + v_monto_imp) > 0 THEN 'parcial'
                              ELSE 'pendiente'
                            END
       WHERE id = v_factura_id;
      v_suma_imputada := v_suma_imputada + v_monto_imp_actual;
    END LOOP;
    IF v_suma_imputada > v_monto THEN
      RAISE EXCEPTION 'La suma imputada a facturas (%) no puede superar el monto del cobro (%)', v_suma_imputada, v_monto;
    END IF;
  END IF;
  BEGIN
    v_fecha_dia := p_fecha::date;
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;
    IF NOT COALESCE(v_cerrado, false) THEN
      IF v_estado_liq = 'pendiente' THEN
        SELECT id INTO v_cta_puente FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.8' AND activa LIMIT 1;
        v_cta_caja := v_cta_puente;
      ELSE
        -- mig.363 — Determinación de Cuentas (Fase 4): antes hardcodeaba '1.1.1'
        -- para todo cobro al contado. Ahora resuelve por forma de pago (override
        -- explícito, o vía cuenta bancaria si la tiene vinculada) y sólo cae a
        -- '1.1.1' si nada de eso está configurado — mismo resultado de siempre
        -- para cualquier empresa que no lo haya tocado.
        v_cta_caja := public.obtener_cuenta_forma_pago(p_empresa_id, p_forma_pago_id, '1.1.1');
      END IF;
      SELECT id INTO v_cta_cxc  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
      IF v_dif_cambio_total <> 0 THEN
        SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
        SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
        IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
          v_dif_cambio_total := 0;
        END IF;
      END IF;
      v_monto_cxc_cancelado := v_monto - v_dif_cambio_total;
      v_total_asiento       := v_monto + GREATEST(-v_dif_cambio_total, 0);
      IF v_cta_caja IS NOT NULL AND v_cta_cxc IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente'),
          'confirmado', v_total_asiento, v_total_asiento, 'cobro_cliente', v_cc_id
        ) RETURNING id INTO v_asiento_id;
        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_caja, CASE WHEN v_estado_liq = 'pendiente' THEN 'Cobro recibido (pendiente de acreditar)' ELSE 'Cobro recibido' END, v_monto, 0),
          (v_asiento_id, p_empresa_id, v_cta_cxc,  'Cancelación parcial/total de deuda', 0, v_monto_cxc_cancelado);
        IF v_dif_cambio_total > 0 THEN
          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, p_empresa_id, v_cta_dif_gan, 'Diferencia de cambio ganada (clearing)', 0, v_dif_cambio_total);
        ELSIF v_dif_cambio_total < 0 THEN
          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, p_empresa_id, v_cta_dif_perd, 'Diferencia de cambio perdida (clearing)', -v_dif_cambio_total, 0);
        END IF;
        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
    v_asiento_id := NULL;
  END;
  UPDATE public.cuenta_corriente_movimientos
     SET asiento_id = v_asiento_id, dif_cambio_total = v_dif_cambio_total
   WHERE id = v_cc_id;
  RETURN jsonb_build_object('ok', true, 'cc_id', v_cc_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado, 'diferencia_cambio', v_dif_cambio_total, 'estado_liquidacion', v_estado_liq);
END;
$function$;
