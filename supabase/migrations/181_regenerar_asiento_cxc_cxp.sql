-- Gap sistémico documentado en PLAN_AUDITORIA.md (Fase 5, área #1): registrar_cobro_cliente y
-- registrar_pago_proveedor generan el asiento contable de forma no bloqueante — si falla (período
-- cerrado, cuenta faltante, o cualquier otro error), el cobro/pago se registra igual y el usuario
-- ya ve un toast destructivo (sesión anterior), pero no había forma de regenerar el asiento después
-- sin re-hacer el cobro/pago completo.
--
-- Investigando el alcance real se confirmó en producción (Nalux) que 25/28 cobros y 2/6 pagos
-- reales no tienen asiento generado. La gran mayoría son anteriores a que la función generara
-- asientos (el primer asiento con origen='cobro_cliente' es del 2026-07-06), así que no es una
-- sorpresa — pero HAY 5 cobros reales posteriores a esa fecha que tampoco lo tienen, sin
-- imputación de por medio (se descartó diferencia de cambio como causa).
--
-- Se encontró además una causa raíz real y separada, que puede seguir generando estos casos hacia
-- adelante: next_numero_asiento() lee MAX(numero)+1 SIN lock, y asientos_contables tiene un
-- UNIQUE(empresa_id, numero) real — dos asientos concurrentes para la misma empresa (ej. una venta
-- y un cobro simultáneos) pueden calcular el mismo próximo número, y el segundo en commitear choca
-- contra el índice único. En crear_venta/crear_entrega/etc. ese error se propagaría visible; en
-- registrar_cobro_cliente/registrar_pago_proveedor queda atrapado por el EXCEPTION WHEN OTHERS y
-- se pierde en silencio. Fix: pg_advisory_xact_lock por empresa_id antes de leer el MAX, serializa
-- cualquier concurrencia real dentro de la misma transacción de Postgres (se libera solo al
-- terminar la transacción, sea commit o rollback).
--
-- Diseño de "regenerar asiento" (patrón SAP: documento vs. asiento como objetos separados,
-- ver sap-reference): se persiste dif_cambio_total (ya se calculaba, pero se perdía si el asiento
-- fallaba) y asiento_id (NULL mientras no haya asiento) en la fila del cobro/pago. La regeneración
-- no recalcula la diferencia de cambio con la cotización de HOY — usa el valor ya calculado en el
-- momento original del cobro/pago, para no introducir un desvío de tipo de cambio en un asiento
-- que se regenera días después.

-- 1) Fix de raíz: next_numero_asiento con lock por empresa
CREATE OR REPLACE FUNCTION public.next_numero_asiento(p_empresa_id uuid)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE v_next INT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('asientos_contables:' || p_empresa_id::text, 0));
  SELECT COALESCE(MAX(CAST(SUBSTRING(numero FROM 'AS-(\d+)') AS INT)), 0) + 1
  INTO v_next FROM asientos_contables WHERE empresa_id = p_empresa_id;
  RETURN 'AS-' || LPAD(v_next::TEXT, 6, '0');
END;
$function$;

-- 2) Columnas nuevas para poder regenerar el asiento después sin recalcular FX
ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS asiento_id uuid REFERENCES public.asientos_contables(id),
  ADD COLUMN IF NOT EXISTS dif_cambio_total numeric;

ALTER TABLE public.cuenta_corriente_proveedores
  ADD COLUMN IF NOT EXISTS asiento_id uuid REFERENCES public.asientos_contables(id),
  ADD COLUMN IF NOT EXISTS dif_cambio_total numeric;

-- 3) registrar_cobro_cliente: persistir asiento_id/dif_cambio_total (mismo body vigente + esto)
CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_monto numeric, p_metodo text, p_fecha timestamp with time zone, p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_monto_paralelo numeric DEFAULT NULL::numeric, p_tc_paralelo numeric DEFAULT NULL::numeric, p_imputaciones jsonb DEFAULT NULL::jsonb)
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
  v_monto    := ROUND(p_monto, 2);
  v_paralelo := CASE WHEN p_monto_paralelo IS NOT NULL THEN ROUND(p_monto_paralelo, 2) END;
  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, p_metodo, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_cc_id;
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || p_metodo,
     v_monto, p_metodo, true, v_paralelo, p_tc_paralelo)
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

-- 4) registrar_pago_proveedor: mismo tratamiento simétrico
CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_proveedor_nombre text, p_monto numeric, p_metodo text, p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_imputaciones jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_monto numeric; v_ccp_id uuid; v_caja_id uuid; v_fecha_dia date := now()::date;
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
     COALESCE(NULLIF(p_descripcion, ''), 'Pago a proveedor'), p_user_id, now())
  RETURNING id INTO v_ccp_id;
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, now(), 'egreso', 'Pago Proveedor',
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
        v_tc_actual        := COALESCE(public.get_tasa_cambio(p_empresa_id, v_compra_moneda, now()::date), v_compra_tc_origen);
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

-- 5) RPC de regeneración manual — cobro cliente
CREATE OR REPLACE FUNCTION public.regenerar_asiento_cxc(p_movimiento_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid; v_monto numeric; v_dif_cambio_total numeric; v_cliente_nombre text;
  v_fecha_dia date; v_asiento_id_existente uuid; v_cerrado boolean;
  v_cta_caja uuid; v_cta_cxc uuid; v_cta_dif_gan uuid; v_cta_dif_perd uuid;
  v_monto_cxc_cancelado numeric; v_total_asiento numeric; v_asiento_id uuid;
BEGIN
  SELECT ccm.empresa_id, ccm.monto, ccm.dif_cambio_total, ccm.fecha::date, ccm.asiento_id,
         COALESCE(c.nombre, 'cliente')
    INTO v_empresa_id, v_monto, v_dif_cambio_total, v_fecha_dia, v_asiento_id_existente, v_cliente_nombre
    FROM public.cuenta_corriente_movimientos ccm
    LEFT JOIN public.clientes c ON c.id = ccm.cliente_id
   WHERE ccm.id = p_movimiento_id AND ccm.tipo = 'HABER';

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Cobro no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el cobro no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF v_asiento_id_existente IS NOT NULL THEN
    RAISE EXCEPTION 'Este cobro ya tiene un asiento contable generado';
  END IF;

  SELECT fecha_en_periodo_cerrado(v_empresa_id, v_fecha_dia) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'El período de este cobro (%) está cerrado — reabrilo en Plan de Cuentas antes de regenerar el asiento', v_fecha_dia;
  END IF;

  v_dif_cambio_total := COALESCE(v_dif_cambio_total, 0);
  SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_cxc  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
  IF v_cta_caja IS NULL OR v_cta_cxc IS NULL THEN
    RAISE EXCEPTION 'Falta configurar las cuentas contables de Caja (1.1.1) o Cuentas a Cobrar (1.1.2) en Plan de Cuentas';
  END IF;
  IF v_dif_cambio_total <> 0 THEN
    SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
    SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
    IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
      RAISE EXCEPTION 'Falta configurar las cuentas de Diferencia de Cambio (4.4/5.9) en Plan de Cuentas';
    END IF;
  END IF;

  v_monto_cxc_cancelado := v_monto - v_dif_cambio_total;
  v_total_asiento       := v_monto + GREATEST(-v_dif_cambio_total, 0);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha_dia,
    'Cobro a ' || v_cliente_nombre || ' (regenerado)',
    'confirmado', v_total_asiento, v_total_asiento, 'cobro_cliente', p_movimiento_id
  ) RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
    (v_asiento_id, v_empresa_id, v_cta_caja, 'Cobro recibido', v_monto, 0),
    (v_asiento_id, v_empresa_id, v_cta_cxc,  'Cancelación parcial/total de deuda', 0, v_monto_cxc_cancelado);
  IF v_dif_cambio_total > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_dif_gan, 'Diferencia de cambio ganada (clearing, regenerado)', 0, v_dif_cambio_total);
  ELSIF v_dif_cambio_total < 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_dif_perd, 'Diferencia de cambio perdida (clearing, regenerado)', -v_dif_cambio_total, 0);
  END IF;

  UPDATE public.cuenta_corriente_movimientos SET asiento_id = v_asiento_id WHERE id = p_movimiento_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.regenerar_asiento_cxc(uuid, uuid) TO authenticated;

-- 6) RPC de regeneración manual — pago proveedor (simétrica)
CREATE OR REPLACE FUNCTION public.regenerar_asiento_cxp(p_movimiento_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid; v_monto numeric; v_dif_cambio_total numeric; v_proveedor_nombre text;
  v_fecha_dia date; v_asiento_id_existente uuid; v_cerrado boolean;
  v_cta_caja uuid; v_cta_cxp uuid; v_cta_dif_gan uuid; v_cta_dif_perd uuid;
  v_monto_cxp_cancelado numeric; v_total_asiento numeric; v_asiento_id uuid;
BEGIN
  SELECT ccp.empresa_id, ccp.monto, ccp.dif_cambio_total, ccp.fecha::date, ccp.asiento_id,
         COALESCE(p.nombre, 'proveedor')
    INTO v_empresa_id, v_monto, v_dif_cambio_total, v_fecha_dia, v_asiento_id_existente, v_proveedor_nombre
    FROM public.cuenta_corriente_proveedores ccp
    LEFT JOIN public.proveedores p ON p.id = ccp.proveedor_id
   WHERE ccp.id = p_movimiento_id AND ccp.tipo = 'pago';

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Pago no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el pago no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF v_asiento_id_existente IS NOT NULL THEN
    RAISE EXCEPTION 'Este pago ya tiene un asiento contable generado';
  END IF;

  SELECT fecha_en_periodo_cerrado(v_empresa_id, v_fecha_dia) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'El período de este pago (%) está cerrado — reabrilo en Plan de Cuentas antes de regenerar el asiento', v_fecha_dia;
  END IF;

  v_dif_cambio_total := COALESCE(v_dif_cambio_total, 0);
  SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_cxp  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
  IF v_cta_caja IS NULL OR v_cta_cxp IS NULL THEN
    RAISE EXCEPTION 'Falta configurar las cuentas contables de Caja (1.1.1) o Proveedores (2.1.1) en Plan de Cuentas';
  END IF;
  IF v_dif_cambio_total <> 0 THEN
    SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
    SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
    IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
      RAISE EXCEPTION 'Falta configurar las cuentas de Diferencia de Cambio (4.4/5.9) en Plan de Cuentas';
    END IF;
  END IF;

  v_monto_cxp_cancelado := v_monto - v_dif_cambio_total;
  v_total_asiento       := v_monto + GREATEST(-v_dif_cambio_total, 0);

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_empresa_id, p_user_id, next_numero_asiento(v_empresa_id), v_fecha_dia,
    'Pago a ' || v_proveedor_nombre || ' (regenerado)',
    'confirmado', v_total_asiento, v_total_asiento, 'pago_proveedor', p_movimiento_id
  ) RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
    (v_asiento_id, v_empresa_id, v_cta_cxp,  'Cancelación parcial/total de deuda', v_monto_cxp_cancelado, 0),
    (v_asiento_id, v_empresa_id, v_cta_caja, 'Pago realizado', 0, v_monto);
  IF v_dif_cambio_total > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_dif_perd, 'Diferencia de cambio perdida (clearing, regenerado)', v_dif_cambio_total, 0);
  ELSIF v_dif_cambio_total < 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_empresa_id, v_cta_dif_gan, 'Diferencia de cambio ganada (clearing, regenerado)', 0, -v_dif_cambio_total);
  END IF;

  UPDATE public.cuenta_corriente_proveedores SET asiento_id = v_asiento_id WHERE id = p_movimiento_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.regenerar_asiento_cxp(uuid, uuid) TO authenticated;
