-- migration 286 — crear_venta (POS): liquidación de tarjetas, mismo patrón que mig.216
--
-- HALLAZGO (auditoría de Bancos, sesión 2026-07-31, Luciano): mig.216 resolvió la
-- liquidación de tarjetas para registrar_cobro_cliente (Cuenta Corriente) pero
-- dejó crear_venta (POS) explícitamente fuera de alcance: "extenderlo
-- correctamente es un cambio separado, no shoehornearlo acá a medias". Este es
-- ese cambio separado.
--
-- Antes: una venta de POS pagada con tarjeta (forma_pago con dias_acreditacion>0)
-- insertaba su movimientos_caja con estado_liquidacion='acreditado' (el default),
-- y el asiento contable (crearAsientoVenta, planCuentasService.ts) debitaba
-- directo 1.1.1 Caja y Bancos por el total. Resultado: el sistema asumía que la
-- plata ya estaba en el banco el mismo día de la venta, cuando en realidad tarda
-- 8-10 días hábiles y llega por el neto (Comunicación BCRA A 7153) — la misma
-- distorsión de liquidez que mig.216 ya había cerrado para Cuenta Corriente.
--
-- Fix: exactamente el mismo patrón de mig.216, aplicado dentro del loop de pagos
-- de crear_venta (una venta de POS puede tener VARIOS pagos — split entre
-- efectivo y tarjeta en la misma venta — así que la liquidación se resuelve por
-- CADA pago, no una vez por venta). Se devuelve el total pendiente de
-- liquidación en el jsonb de retorno para que el asiento contable (que se arma
-- aparte, en el cliente) sepa cuánto mandar a la cuenta puente 1.1.8 en vez de
-- 1.1.1 — ver la migración de código en planCuentasService.ts que acompaña esto.

CREATE OR REPLACE FUNCTION public.crear_venta(
  p_empresa_id uuid, p_user_id uuid, p_numero_venta text, p_fecha timestamp with time zone,
  p_cliente_id uuid, p_cliente_nombre text, p_total numeric, p_forma_pago text, p_estado_pago text,
  p_moneda text, p_tipo_cambio_tasa numeric, p_monto_paralelo numeric, p_tc_paralelo numeric,
  p_items jsonb, p_pagos jsonb, p_es_cc boolean, p_caja_sesion_id uuid, p_pedido_id uuid,
  p_monto_moneda_original numeric DEFAULT NULL::numeric, p_centro_costo_id uuid DEFAULT NULL::uuid
)
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
  -- mig.286: liquidación de tarjeta por pago (mismo patrón que mig.216)
  v_dias_acreditacion integer; v_comision_pct numeric; v_monto_pago numeric;
  v_estado_liq_pago text; v_monto_comision_pago numeric; v_monto_neto_pago numeric;
  v_fecha_acred_est_pago date; v_monto_pendiente_liq numeric := 0;
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
    VALUES (p_empresa_id, auth.uid(), v_numero_entrega, v_comprobante_id, p_cliente_id, 'implicita', 'entregado', CURRENT_DATE, p_pedido_id)
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
      v_forma_pago_id := NULLIF(v_pago->>'forma_pago_id', '')::uuid;
      v_metodo_pago := v_pago->>'metodo';
      v_dias_acreditacion := 0;
      v_comision_pct := 0;
      IF v_forma_pago_id IS NOT NULL THEN
        SELECT nombre, dias_acreditacion, comision_porcentaje
          INTO v_metodo_pago, v_dias_acreditacion, v_comision_pct
        FROM public.formas_pago
         WHERE id = v_forma_pago_id AND empresa_id = p_empresa_id;
        IF v_metodo_pago IS NULL THEN
          RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
        END IF;
      END IF;

      v_monto_pago := ROUND((v_pago->>'monto')::NUMERIC, 2);

      -- mig.286: mismo patrón que registrar_cobro_cliente (mig.216) — si la
      -- forma de pago tarda en acreditarse, este pago queda pendiente de
      -- liquidación. Se resuelve POR PAGO (una venta puede tener varios,
      -- ej. parte efectivo + parte tarjeta).
      IF COALESCE(v_dias_acreditacion, 0) > 0 THEN
        v_estado_liq_pago      := 'pendiente';
        v_monto_comision_pago  := ROUND(v_monto_pago * COALESCE(v_comision_pct, 0) / 100, 2);
        v_monto_neto_pago      := v_monto_pago - v_monto_comision_pago;
        v_fecha_acred_est_pago := p_fecha::date + v_dias_acreditacion;
        v_monto_pendiente_liq  := v_monto_pendiente_liq + v_monto_pago;
      ELSE
        v_estado_liq_pago      := 'acreditado';
        v_monto_comision_pago  := 0;
        v_monto_neto_pago      := NULL;
        v_fecha_acred_est_pago := NULL;
      END IF;

      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, fecha, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id, comprobante_id,
        estado_liquidacion, monto_comision, monto_neto, fecha_acreditacion_estimada
      ) VALUES (
        p_empresa_id, auth.uid(), p_caja_sesion_id, 'ingreso', 'Venta', 'Venta #' || p_numero_venta,
        v_monto_pago, v_metodo_pago, p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC, NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC, v_forma_pago_id, v_comprobante_id,
        v_estado_liq_pago, v_monto_comision_pago, v_monto_neto_pago, v_fecha_acred_est_pago
      );
    END IF;
  END LOOP;
  IF p_es_cc AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, tipo, monto, descripcion, fecha, comprobante_id, monto_paralelo, tc_paralelo
    ) VALUES (
      p_empresa_id, auth.uid(), p_cliente_id, 'DEBE', v_total, 'Venta #' || p_numero_venta, p_fecha,
      v_comprobante_id, p_monto_paralelo, p_tc_paralelo
    );
  END IF;
  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta', p_numero_venta,
    'neto_gravado', ROUND(v_neto_total, 2),
    'iva_discriminado', ROUND(v_iva_total, 2),
    'monto_pendiente_liquidacion', v_monto_pendiente_liq
  );
END;
$function$;

-- ROLLBACK (comentado): CREATE OR REPLACE crear_venta con el body previo a esta
-- migración (sin resolver dias_acreditacion/comision_porcentaje por pago, sin
-- las 4 columnas de liquidación en el INSERT a movimientos_caja, sin
-- 'monto_pendiente_liquidacion' en el jsonb de retorno).
