-- migration 374 — corrige el "monto adeudado" del Open Item para comprobantes
-- con Cuenta Corriente PARCIAL.
--
-- Hallazgo real (29/08, Luciano): venta mixta Efectivo + Tarjeta Crédito +
-- Transferencia + Cuenta Corriente + Tarjeta Débito, total $117.200, de los
-- cuales solo $17.200 se cargaron realmente a Cuenta Corriente (DEBE
-- confirmado en cuenta_corriente_movimientos, gracias a mig.372). El ERP
-- mostraba la factura en estado "Parcial" — eso es CORRECTO (parte se cobró
-- ya, parte queda como Open Item genuino) — pero el "saldo pendiente" que el
-- sistema calculaba para esa factura era $117.200 (el TOTAL completo), no
-- los $17.200 realmente adeudados.
--
-- Causa raíz: hasta mig.372, el DEBE de cuenta_corriente_movimientos de una
-- factura con CC SIEMPRE era exactamente comprobantes.total (todo-o-nada),
-- así que usar comprobantes.total como "monto original del Open Item" daba
-- la cuenta correcta por pura coincidencia. mig.372 rompió esa coincidencia
-- al permitir que el DEBE sea PARCIAL — y 3 lugares seguían asumiendo la
-- vieja equivalencia:
--   1. Vista facturas_saldo_pendiente (saldo_pendiente = total - imputado)
--   2. registrar_cobro_cliente (tope al imputar un cobro manual)
--   3. crear_nota_credito (tope al imputar una NC contra la factura origen)
--
-- Fix: el "monto original del Open Item" de un comprobante ya NO es
-- comprobantes.total — es lo que realmente se cargó a cuenta corriente (SUM
-- de DEBE confirmado en cuenta_corriente_movimientos para ese
-- comprobante_id). Se centraliza en una función auxiliar para no triplicar
-- la lógica. Para Notas de Débito (que siempre cargan el 100% de su propio
-- total a CC, sin concepto de "parcial") esto no cambia nada — coincide
-- exactamente con el comportamiento anterior, cero regresión. Solo afecta al
-- caso nuevo de venta con CC parcial.
--
-- Verificado en vivo (BEGIN...ROLLBACK) contra la venta real de Luciano
-- (comprobante 11088bad-c209-44e3-8c75-d8d179e63dac, total $117.200, DEBE CC
-- real $17.200):
--   - Vista corregida: saldo_pendiente pasa de $117.200 a $17.200.
--   - registrar_cobro_cliente: imputar $20.000 ahora se rechaza ("supera el
--     saldo pendiente de la factura (17200.00)"); imputar $17.200 exactos
--     salda la factura (estado_pago -> 'pagada'). Antes del fix, imputar
--     hasta $117.200 se habría aceptado sin error.
--   - crear_nota_credito: una NC de $50.000 contra esa factura origen ahora
--     imputa solo $17.200 (el Open Item real), en vez de $50.000 — que
--     habría dejado un saldo fantasma de $67.200 sin respaldo en CC.

CREATE OR REPLACE FUNCTION public.monto_cc_original_comprobante(p_comprobante_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(monto), 0)
  FROM public.cuenta_corriente_movimientos
  WHERE comprobante_id = p_comprobante_id AND tipo = 'DEBE' AND estado = 'confirmado';
$function$;

-- 1) Vista facturas_saldo_pendiente
CREATE OR REPLACE VIEW public.facturas_saldo_pendiente AS
SELECT c.id AS comprobante_id, c.empresa_id, c.cliente_id, c.numero_venta, c.fecha, c.fecha_vencimiento, c.total,
    COALESCE(i.total_imputado, 0::numeric) AS total_imputado,
    public.monto_cc_original_comprobante(c.id) - COALESCE(i.total_imputado, 0::numeric) AS saldo_pendiente,
    c.cliente_nombre, c.moneda, c.tipo_cambio_tasa, c.monto_moneda_original
FROM comprobantes c
LEFT JOIN (
    SELECT cci.factura_comprobante_id, sum(cci.monto) AS total_imputado
    FROM cuenta_corriente_imputaciones cci
    JOIN cuenta_corriente_movimientos ccm ON ccm.id = cci.cobro_movimiento_id
    WHERE ccm.estado = 'confirmado'::text
    GROUP BY cci.factura_comprobante_id
) i ON i.factura_comprobante_id = c.id
WHERE (c.tipo = ANY (ARRAY['venta'::text, 'nota_debito'::text])) AND c.cliente_id IS NOT NULL AND c.estado_pago <> 'pagada'::text;

-- 2) registrar_cobro_cliente — v_total_factura ahora sale de
--    monto_cc_original_comprobante(id) en vez de comprobantes.total.
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
     estado_liquidacion, monto_comision, monto_neto, fecha_acreditacion_estimada, cc_movimiento_id)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || v_metodo,
     v_monto, v_metodo, true, v_paralelo, p_tc_paralelo, p_forma_pago_id,
     v_estado_liq, v_monto_comision, v_monto_neto, v_fecha_acred_est, v_cc_id)
  RETURNING id INTO v_caja_id;

  IF p_imputaciones IS NOT NULL AND jsonb_array_length(p_imputaciones) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
    LOOP
      v_factura_id := (v_item->>'comprobante_id')::uuid;
      SELECT public.monto_cc_original_comprobante(id), moneda, tipo_cambio_tasa
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
      -- Solo cuenta lo imputado por cobros TODAVÍA confirmados — un cobro
      -- cancelado ya no debe seguir bloqueando saldo de la factura (mig.367).
      SELECT COALESCE(SUM(cci.monto), 0) INTO v_ya_imputado
      FROM public.cuenta_corriente_imputaciones cci
      JOIN public.cuenta_corriente_movimientos ccm ON ccm.id = cci.cobro_movimiento_id
      WHERE cci.factura_comprobante_id = v_factura_id AND ccm.estado = 'confirmado';
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

-- 3) crear_nota_credito — v_total_factura_origen ahora sale de
--    monto_cc_original_comprobante(id) en vez de comprobantes.total.
CREATE OR REPLACE FUNCTION public.crear_nota_credito(p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_motivo_nc text, p_items jsonb, p_comprobante_origen_id uuid DEFAULT NULL::uuid, p_devolucion_id uuid DEFAULT NULL::uuid, p_referencia_cliente text DEFAULT NULL::text, p_punto_venta_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_id UUID; v_numero TEXT; v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0;
  v_total NUMERIC; v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
  v_cc_mov_id UUID; v_total_factura_origen NUMERIC; v_ya_imputado_origen NUMERIC; v_saldo_pendiente_origen NUMERIC; v_monto_a_imputar NUMERIC;
  v_reingresa_stock BOOLEAN; v_costo_revertido NUMERIC := 0;
  v_pedido_id UUID; v_pedido_estado TEXT; v_totalmente_facturado BOOLEAN; v_pedido_reabrible BOOLEAN := false;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;
  IF p_comprobante_origen_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_origen_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'comprobante_origen_id no pertenece a la empresa';
  END IF;
  IF p_devolucion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.devoluciones WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'cliente' AND nota_credito_id IS NULL
  ) THEN
    RAISE EXCEPTION 'devolucion_id no pertenece a la empresa, no es de cliente, o ya tiene una NC generada';
  END IF;
  IF p_punto_venta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.puntos_venta WHERE id = p_punto_venta_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'punto_venta_id no pertenece a la empresa';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'La NC debe tener al menos un ítem'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la NC debe ser mayor a cero'; END IF;

  IF p_devolucion_id IS NOT NULL THEN
    SELECT reingresa_stock INTO v_reingresa_stock FROM public.devoluciones WHERE id = p_devolucion_id;
    IF COALESCE(v_reingresa_stock, false) THEN
      SELECT COALESCE(SUM(di.cantidad * ci.costo_unitario), 0) INTO v_costo_revertido
      FROM public.devolucion_items di
      JOIN public.comprobante_items ci ON ci.id = di.comprobante_item_id
      WHERE di.devolucion_id = p_devolucion_id AND ci.costo_unitario IS NOT NULL;
    END IF;
  END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito', p_punto_venta_id);
  INSERT INTO public.comprobantes (empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, neto_gravado, iva_discriminado, forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo, comprobante_origen_id, motivo_nc, referencia_cliente, costo_mercaderia_vendida, punto_venta_id)
  VALUES (p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id, COALESCE(p_cliente_nombre, 'Consumidor Final'), v_total, v_subtotal_neto, v_total_iva, 'Nota de Crédito', 'pagada', 'ARS', 1, 'nota_credito', p_comprobante_origen_id, p_motivo_nc, NULLIF(p_referencia_cliente, ''), ROUND(v_costo_revertido, 2), p_punto_venta_id)
  RETURNING id INTO v_comp_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.comprobante_items (comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva)
    VALUES (v_comp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21'));
  END LOOP;
  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha)
    VALUES (p_empresa_id, p_user_id, p_cliente_id, v_comp_id, 'HABER', v_total, 'NC ' || v_numero || ' — ' || p_motivo_nc, now())
    RETURNING id INTO v_cc_mov_id;

    IF p_comprobante_origen_id IS NOT NULL THEN
      SELECT public.monto_cc_original_comprobante(id) INTO v_total_factura_origen
        FROM public.comprobantes
       WHERE id = p_comprobante_origen_id
       FOR UPDATE;

      IF v_total_factura_origen IS NOT NULL THEN
        SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado_origen
          FROM public.cuenta_corriente_imputaciones
         WHERE factura_comprobante_id = p_comprobante_origen_id;
        v_saldo_pendiente_origen := v_total_factura_origen - v_ya_imputado_origen;
        v_monto_a_imputar := LEAST(v_total, GREATEST(v_saldo_pendiente_origen, 0));

        IF v_monto_a_imputar > 0 THEN
          INSERT INTO public.cuenta_corriente_imputaciones
            (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto)
          VALUES (p_empresa_id, v_cc_mov_id, p_comprobante_origen_id, v_monto_a_imputar);

          UPDATE public.comprobantes
             SET estado_pago = CASE
                                  WHEN (v_ya_imputado_origen + v_monto_a_imputar) >= v_total_factura_origen THEN 'pagada'
                                  WHEN (v_ya_imputado_origen + v_monto_a_imputar) > 0 THEN 'parcial'
                                  ELSE 'pendiente'
                                END
           WHERE id = p_comprobante_origen_id;
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_devolucion_id IS NOT NULL THEN
    UPDATE public.devoluciones
       SET nota_credito_id = v_comp_id, compensacion = 'nota_credito'
     WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'cliente';
  END IF;

  IF p_comprobante_origen_id IS NOT NULL THEN
    SELECT pedido_id INTO v_pedido_id FROM public.comprobantes WHERE id = p_comprobante_origen_id;

    IF v_pedido_id IS NOT NULL THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF NULLIF(v_item->>'producto_id', '') IS NOT NULL THEN
          UPDATE public.pedido_items
             SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - (v_item->>'cantidad')::NUMERIC)
           WHERE pedido_id = v_pedido_id
             AND producto_id = (v_item->>'producto_id')::UUID
             AND empresa_id = p_empresa_id;
        END IF;
      END LOOP;

      SELECT estado INTO v_pedido_estado FROM public.pedidos WHERE id = v_pedido_id;
      SELECT bool_and(cantidad_facturada >= cantidad) INTO v_totalmente_facturado
        FROM public.pedido_items WHERE pedido_id = v_pedido_id;
      v_pedido_reabrible := (v_pedido_estado = 'facturado') AND NOT COALESCE(v_totalmente_facturado, true);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total,
    'costo_mercaderia_vendida', ROUND(v_costo_revertido, 2),
    'pedido_id', v_pedido_id, 'pedido_reabrible', v_pedido_reabrible
  );
END;
$function$;
