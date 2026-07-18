-- Migration 215 — registrar_cobro_cliente / registrar_pago_proveedor / puente Caja→Bancos
-- pasan a resolver por forma_pago_id (maestro formas_pago de la 214), no solo por texto.
--
-- Diseño: se agrega forma_pago_id como parámetro NUEVO al final de cada RPC (DEFAULT NULL),
-- 100% retrocompatible — cualquier caller que no lo mande sigue funcionando exactamente
-- igual que antes (p_metodo como texto libre). Cuando SÍ se manda, el RPC valida que la
-- forma de pago pertenezca a la empresa (mismo criterio que el hardening de tenant de las
-- migrations 187/211) y deriva el texto de metodo_cobro/metodo_pago desde formas_pago.nombre
-- —nunca confía en que p_metodo coincida con lo que el frontend mandó separado—, así el
-- texto histórico y el ID nuevo no pueden quedar desincronizados.
--
-- IMPORTANTE (mismo patrón de la 208/212, para no repetir el bug de overload ambiguo):
-- se hace DROP FUNCTION explícito de la firma vieja ANTES del CREATE OR REPLACE con la
-- firma nueva, porque agregar un parámetro cambia el tipo de firma para Postgres.

ALTER TABLE public.movimientos_caja
  ADD COLUMN forma_pago_id UUID REFERENCES public.formas_pago(id) ON DELETE SET NULL;

ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN forma_pago_id UUID REFERENCES public.formas_pago(id) ON DELETE SET NULL;

-- ── registrar_cobro_cliente ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.registrar_cobro_cliente(
  uuid, uuid, uuid, text, numeric, text, timestamp with time zone, text, uuid, numeric, numeric, jsonb
);

CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(
  p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_monto numeric,
  p_metodo text, p_fecha timestamp with time zone, p_descripcion text DEFAULT NULL::text,
  p_caja_sesion_id uuid DEFAULT NULL::uuid, p_monto_paralelo numeric DEFAULT NULL::numeric,
  p_tc_paralelo numeric DEFAULT NULL::numeric, p_imputaciones jsonb DEFAULT NULL::jsonb,
  p_forma_pago_id uuid DEFAULT NULL::uuid
)
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

  -- mig.215: si viene forma_pago_id, es la fuente de verdad del texto (no p_metodo suelto).
  v_metodo := p_metodo;
  IF p_forma_pago_id IS NOT NULL THEN
    SELECT nombre INTO v_metodo FROM public.formas_pago
     WHERE id = p_forma_pago_id AND empresa_id = p_empresa_id;
    IF v_metodo IS NULL THEN
      RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
    END IF;
  END IF;

  v_monto    := ROUND(p_monto, 2);
  v_paralelo := CASE WHEN p_monto_paralelo IS NOT NULL THEN ROUND(p_monto_paralelo, 2) END;
  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo, forma_pago_id)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, v_metodo, v_paralelo, p_tc_paralelo, p_forma_pago_id)
  RETURNING id INTO v_cc_id;
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || v_metodo,
     v_monto, v_metodo, true, v_paralelo, p_tc_paralelo, p_forma_pago_id)
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
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
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
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Cobro recibido', v_monto, 0),
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
  RETURN jsonb_build_object('ok', true, 'cc_id', v_cc_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado, 'diferencia_cambio', v_dif_cambio_total);
END;
$function$;

-- ── registrar_pago_proveedor ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.registrar_pago_proveedor(
  uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb, timestamp with time zone
);

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_proveedor_nombre text, p_monto numeric,
  p_metodo text, p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid,
  p_imputaciones jsonb DEFAULT NULL::jsonb, p_fecha timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_forma_pago_id uuid DEFAULT NULL::uuid
)
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
  v_metodo text;
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

  -- mig.215: si viene forma_pago_id, es la fuente de verdad del texto (no p_metodo suelto).
  v_metodo := p_metodo;
  IF p_forma_pago_id IS NOT NULL THEN
    SELECT nombre INTO v_metodo FROM public.formas_pago
     WHERE id = p_forma_pago_id AND empresa_id = p_empresa_id;
    IF v_metodo IS NULL THEN
      RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
    END IF;
  END IF;

  v_monto := ROUND(p_monto, 2);
  INSERT INTO public.cuenta_corriente_proveedores
    (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha)
  VALUES
    (p_empresa_id, p_proveedor_id, 'pago', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago a proveedor'), p_user_id, v_fecha_ts)
  RETURNING id INTO v_ccp_id;
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, forma_pago_id)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, v_fecha_ts, 'egreso', 'Pago Proveedor',
     'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor') || ' - ' || v_metodo,
     v_monto, v_metodo, true, p_forma_pago_id)
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
      UPDATE public.compras
         SET estado_pago = CASE
                              WHEN (v_ya_imputado + v_monto_imp) >= v_total_factura THEN 'pagada'
                              WHEN (v_ya_imputado + v_monto_imp) > 0 THEN 'parcial'
                              ELSE 'pendiente'
                            END
       WHERE id = v_factura_id;
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

-- ── Puente Caja→Bancos: preferir forma_pago_id (ID estable) sobre el match por texto ─────
CREATE OR REPLACE FUNCTION public.trg_fn_puente_caja_bancos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta_bancaria_id uuid;
  v_tipo_instrumento text;
BEGIN
  IF NEW.metodo_pago IS DISTINCT FROM 'Efectivo'
     AND NEW.metodo_pago IS DISTINCT FROM 'Cuenta Corriente' THEN

    IF NEW.forma_pago_id IS NOT NULL THEN
      SELECT cuenta_bancaria_id, tipo_instrumento INTO v_cuenta_bancaria_id, v_tipo_instrumento
      FROM public.formas_pago
      WHERE id = NEW.forma_pago_id AND empresa_id = NEW.empresa_id;

      IF v_tipo_instrumento = 'efectivo' THEN
        v_cuenta_bancaria_id := NULL;
      END IF;
    ELSE
      SELECT mpb.cuenta_bancaria_id INTO v_cuenta_bancaria_id
      FROM public.metodo_pago_cuenta_bancaria mpb
      WHERE mpb.empresa_id  = NEW.empresa_id
        AND mpb.metodo_pago = NEW.metodo_pago
        AND mpb.activo      = true;
    END IF;

    IF v_cuenta_bancaria_id IS NOT NULL THEN
      INSERT INTO public.movimientos_bancarios (
        empresa_id, cuenta_bancaria_id, fecha, descripcion,
        monto, tipo, origen, conciliado
      ) VALUES (
        NEW.empresa_id, v_cuenta_bancaria_id, NEW.fecha,
        NEW.concepto, NEW.monto, NEW.tipo, 'caja', false
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── crear_venta (POS/Ventas) ─────────────────────────────────────────────
-- No necesita cambiar su firma (mismo riesgo de overload que arriba, evitado acá
-- directamente): cada pago ya viaja como objeto jsonb dentro de p_pagos
-- ({metodo, monto, ...}) — alcanza con leer una clave nueva opcional
-- forma_pago_id de ESE objeto, sin tocar los 20 parámetros de la función.
CREATE OR REPLACE FUNCTION public.crear_venta(p_empresa_id uuid, p_user_id uuid, p_numero_venta text, p_fecha timestamp with time zone, p_cliente_id uuid, p_cliente_nombre text, p_total numeric, p_forma_pago text, p_estado_pago text, p_moneda text, p_tipo_cambio_tasa numeric, p_monto_paralelo numeric, p_tc_paralelo numeric, p_items jsonb, p_pagos jsonb, p_es_cc boolean, p_caja_sesion_id uuid, p_pedido_id uuid, p_monto_moneda_original numeric DEFAULT NULL::numeric, p_centro_costo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comprobante_id UUID; v_item JSONB; v_pago JSONB; v_stock_actual INTEGER;
  v_cantidad INTEGER; v_producto_id UUID; v_alicuota TEXT; v_factor NUMERIC;
  v_subtotal NUMERIC; v_neto_total NUMERIC := 0; v_iva_total NUMERIC := 0;
  v_entrega_id UUID; v_numero_entrega TEXT; v_entrega_manual_id UUID := NULL;
  v_dias_credito INTEGER; v_fecha_vencimiento DATE; v_precio_unitario NUMERIC;
  v_precio_original NUMERIC; v_descuento_pct NUMERIC; v_descuento_monto_item NUMERIC;
  v_oferta_id UUID; v_descuento_manual_pct NUMERIC; v_descuento_global_monto NUMERIC := 0;
  v_descuento_global_pct NUMERIC := 0; v_bruto_total NUMERIC := 0; v_total NUMERIC;
  v_pedido_item_id UUID; v_ped_cantidad NUMERIC; v_ped_entregada NUMERIC;
  v_ped_facturada NUMERIC; v_max_facturable NUMERIC; v_mueve_stock BOOLEAN;
  v_usa_cc BOOLEAN;
  v_unidad_venta_id UUID; v_cantidad_venta NUMERIC; v_precio_unidad_venta NUMERIC;
  v_forma_pago_id UUID; v_metodo_pago TEXT;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF p_centro_costo_id IS NOT NULL THEN
    SELECT usa_centros_costo INTO v_usa_cc FROM public.empresas WHERE id = p_empresa_id;
    IF NOT COALESCE(v_usa_cc, false) THEN
      RAISE EXCEPTION 'Centros de Costo no está activado para esta empresa. Activalo en Configuración > Finanzas.';
    END IF;
  END IF;

  v_total := ROUND(p_total, 2);
  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito INTO v_dias_credito FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
  END IF;
  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);
  IF p_pedido_id IS NOT NULL THEN
    SELECT id INTO v_entrega_manual_id FROM public.entregas
    WHERE empresa_id = p_empresa_id AND pedido_id = p_pedido_id AND origen = 'manual' AND estado = 'entregado'
    ORDER BY fecha DESC LIMIT 1;
  END IF;
  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa, monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento, monto_moneda_original, centro_costo_id
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha, p_cliente_id, p_cliente_nombre, v_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa, p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento, ROUND(p_monto_moneda_original, 2), p_centro_costo_id
  )
  RETURNING id INTO v_comprobante_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');
    v_precio_unitario      := ROUND((v_item->>'precio_unitario')::NUMERIC, 2);
    v_precio_original      := ROUND(COALESCE((v_item->>'precio_original')::NUMERIC, (v_item->>'precio_unitario')::NUMERIC), 2);
    v_descuento_pct        := COALESCE((v_item->>'descuento_pct')::NUMERIC, 0);
    v_descuento_monto_item := ROUND(COALESCE((v_item->>'descuento_monto')::NUMERIC, 0), 2);
    v_oferta_id            := NULLIF(v_item->>'oferta_id', '')::UUID;
    v_descuento_manual_pct := COALESCE((v_item->>'descuento_manual_pct')::NUMERIC, 0);
    v_unidad_venta_id     := NULLIF(v_item->>'unidad_venta_id', '')::UUID;
    v_cantidad_venta      := NULLIF(v_item->>'cantidad_venta', '')::NUMERIC;
    v_precio_unidad_venta := NULLIF(v_item->>'precio_unidad_venta', '')::NUMERIC;
    v_mueve_stock    := TRUE;
    v_pedido_item_id := NULL;
    IF p_pedido_id IS NOT NULL THEN
      SELECT id, cantidad, cantidad_entregada, cantidad_facturada
        INTO v_pedido_item_id, v_ped_cantidad, v_ped_entregada, v_ped_facturada
      FROM public.pedido_items
      WHERE pedido_id = p_pedido_id AND producto_id = v_producto_id AND empresa_id = p_empresa_id
      FOR UPDATE;
      IF v_pedido_item_id IS NOT NULL THEN
        IF v_entrega_manual_id IS NOT NULL THEN
          v_max_facturable := COALESCE(v_ped_entregada, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := FALSE;
        ELSE
          v_max_facturable := COALESCE(v_ped_cantidad, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := TRUE;
        END IF;
        IF v_cantidad > v_max_facturable THEN
          RAISE EXCEPTION 'Cantidad a facturar (%) supera lo disponible para el producto % del pedido (máximo facturable: %)', v_cantidad, v_producto_id, v_max_facturable;
        END IF;
        UPDATE public.pedido_items SET cantidad_facturada = COALESCE(cantidad_facturada, 0) + v_cantidad WHERE id = v_pedido_item_id;
      END IF;
    END IF;
    IF v_mueve_stock THEN
      SELECT stock_actual INTO v_stock_actual FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
      IF v_stock_actual IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
      END IF;
      IF v_stock_actual < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)', v_producto_id, v_stock_actual, v_cantidad;
      END IF;
      UPDATE public.productos SET stock_actual = stock_actual - v_cantidad WHERE id = v_producto_id;
    END IF;
    v_factor := CASE v_alicuota WHEN '21' THEN 1.21 WHEN '10.5' THEN 1.105 ELSE 1 END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));
    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva,
      precio_original, descuento_pct, descuento_monto, oferta_id, descuento_manual_pct,
      unidad_venta_id, cantidad_venta, precio_unidad_venta
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unitario, v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item, v_oferta_id, v_descuento_manual_pct,
      v_unidad_venta_id, v_cantidad_venta, v_precio_unidad_venta
    );
    v_descuento_global_monto := v_descuento_global_monto + (v_descuento_monto_item * v_cantidad);
    v_bruto_total := v_bruto_total + (v_precio_original * v_cantidad);
    IF v_mueve_stock THEN
      INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
      VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'salida', v_cantidad, 'Venta #' || p_numero_venta, p_fecha);
    END IF;
  END LOOP;
  v_descuento_global_pct := CASE WHEN v_bruto_total > 0 THEN ROUND(v_descuento_global_monto / v_bruto_total * 100, 2) ELSE 0 END;
  UPDATE public.comprobantes SET neto_gravado = ROUND(v_neto_total, 2), iva_discriminado = ROUND(v_iva_total, 2),
    descuento_global_monto = ROUND(v_descuento_global_monto, 2), descuento_global_pct = v_descuento_global_pct
  WHERE id = v_comprobante_id;
  IF v_entrega_manual_id IS NOT NULL THEN
    UPDATE public.entregas SET comprobante_id = v_comprobante_id WHERE id = v_entrega_manual_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      UPDATE public.comprobante_items SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id AND producto_id = (v_item->>'producto_id')::UUID;
    END LOOP;
  ELSE
    v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
    INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, comprobante_id, cliente_id, origen, estado, fecha, pedido_id)
    VALUES (p_empresa_id, p_user_id, v_numero_entrega, v_comprobante_id, p_cliente_id, 'implicita', 'entregado', CURRENT_DATE, p_pedido_id)
    RETURNING id INTO v_entrega_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
      VALUES (v_entrega_id, p_empresa_id, (v_item->>'producto_id')::UUID, (v_item->>'cantidad')::INTEGER);
      UPDATE public.comprobante_items SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id AND producto_id = (v_item->>'producto_id')::UUID;
    END LOOP;
  END IF;
  IF p_pedido_id IS NOT NULL THEN
    UPDATE public.pedidos SET comprobante_id = v_comprobante_id WHERE id = p_pedido_id AND comprobante_id IS NULL;
  END IF;
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    IF (v_pago->>'metodo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      -- mig.215: si el pago trae forma_pago_id, resuelve el texto desde el maestro
      -- (mismo criterio que registrar_cobro_cliente/registrar_pago_proveedor).
      v_forma_pago_id := NULLIF(v_pago->>'forma_pago_id', '')::uuid;
      v_metodo_pago := v_pago->>'metodo';
      IF v_forma_pago_id IS NOT NULL THEN
        SELECT nombre INTO v_metodo_pago FROM public.formas_pago
         WHERE id = v_forma_pago_id AND empresa_id = p_empresa_id;
        IF v_metodo_pago IS NULL THEN
          RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
        END IF;
      END IF;
      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, fecha, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id
      ) VALUES (
        p_empresa_id, p_user_id, p_caja_sesion_id, 'ingreso', 'Venta', 'Venta #' || p_numero_venta,
        ROUND((v_pago->>'monto')::NUMERIC, 2), v_metodo_pago, p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC, NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC, v_forma_pago_id
      );
    END IF;
  END LOOP;
  IF p_es_cc AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, tipo, monto, descripcion, fecha, comprobante_id, monto_paralelo, tc_paralelo
    ) VALUES (
      p_empresa_id, p_user_id, p_cliente_id, 'DEBE', v_total, 'Venta #' || p_numero_venta, p_fecha,
      v_comprobante_id, p_monto_paralelo, p_tc_paralelo
    );
  END IF;
  RETURN jsonb_build_object('comprobante_id', v_comprobante_id, 'numero_venta', p_numero_venta);
END;
$function$;

-- ROLLBACK (comentado): DROP FUNCTION de las 2 firmas nuevas + CREATE OR REPLACE de las
-- firmas viejas (sin p_forma_pago_id), CREATE OR REPLACE crear_venta con el body previo
-- (sin leer forma_pago_id de cada pago), CREATE OR REPLACE trg_fn_puente_caja_bancos con el
-- body previo a esta migration, ALTER TABLE ... DROP COLUMN forma_pago_id en ambas tablas.
