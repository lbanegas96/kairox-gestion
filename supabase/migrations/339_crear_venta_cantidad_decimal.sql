-- Migration 339 — crear_venta: cantidad pasa a numeric(12,3) (venta por peso/volumen).
-- Bloque 3 de 4 (Nadia, 20/08). Complementa la migración 338 (Bloque 1, columnas)
-- y el frontend del Bloque 2.
--
-- CAMBIO QUIRÚRGICO, 4 puntos exactos, nada más se toca en esta función tan
-- grande (fidelización, factura de reserva, dedup por client_uuid, costo de
-- mercadería vendida, etc. quedan idénticos):
--
--   1. v_cantidad INTEGER      → v_cantidad NUMERIC(12,3)
--   2. v_stock_actual INTEGER  → v_stock_actual NUMERIC(12,3)
--      (bug real encontrado ANTES de aplicar nada, releyendo la función: sin
--      este segundo cambio, `SELECT stock_actual INTO v_stock_actual` habría
--      asignado el numeric(12,3) real -- ya en numeric desde la mig.338 -- a
--      una variable PL/pgSQL todavía INTEGER, y PL/pgSQL REDONDEA en el
--      assignment cast numeric→integer sin avisar. 2,350 kg de stock real se
--      habría leído silenciosamente como 2 en la variable de trabajo,
--      aunque la columna en la tabla ya soportaba el decimal.)
--   3. (v_item->>'cantidad')::INTEGER → ::NUMERIC(12,3)  (al parsear el ítem)
--   4. (v_item->>'cantidad')::INTEGER → ::NUMERIC(12,3)  (al insertar en
--      entrega_items -- esa columna YA estaba en numeric(12,3) desde antes
--      de este proyecto, mig.083/044, pero el INSERT de acá la truncaba con
--      un cast a INTEGER que quedó suelto; entrega_items.cantidad_entregada
--      en comprobante_items ya casteaba a NUMERIC correctamente, sin tocar).
--
-- Definición base tomada del pg_get_functiondef VIVO en producción (no de
-- ningún archivo de migración vieja — crear_venta se redefinió muchas veces
-- desde la 190, la última en la mig.328), mismo criterio que usa la propia
-- mig.190 en su comentario.
--
-- No se toca compras (detalle_compras.cantidad, ya en numeric(12,3) desde la
-- mig.338, pero las RPCs de compras siguen sin tocar -- fuera de alcance de
-- este bloque, que es específicamente ventas).
--
-- ROLLBACK: recrear la función con este mismo body pero volviendo los 4
-- puntos de arriba a INTEGER — el rollback fallaría si para entonces ya hay
-- cantidades fraccionarias reales vendidas (mismo criterio que la mig.338).

CREATE OR REPLACE FUNCTION public.crear_venta(p_empresa_id uuid, p_user_id uuid, p_numero_venta text, p_fecha timestamp with time zone, p_cliente_id uuid, p_cliente_nombre text, p_total numeric, p_forma_pago text, p_estado_pago text, p_moneda text, p_tipo_cambio_tasa numeric, p_monto_paralelo numeric, p_tc_paralelo numeric, p_items jsonb, p_pagos jsonb, p_es_cc boolean, p_caja_sesion_id uuid, p_pedido_id uuid, p_monto_moneda_original numeric DEFAULT NULL::numeric, p_centro_costo_id uuid DEFAULT NULL::uuid, p_client_uuid uuid DEFAULT NULL::uuid, p_puntos_canjeados integer DEFAULT 0, p_tipo_comprobante_afip text DEFAULT NULL::text, p_punto_venta_id uuid DEFAULT NULL::uuid, p_referencia_cliente text DEFAULT NULL::text, p_factura_reserva boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comprobante_id UUID; v_item JSONB; v_pago JSONB; v_stock_actual NUMERIC(12,3);
  v_cantidad NUMERIC(12,3); v_producto_id UUID; v_alicuota TEXT; v_factor NUMERIC;
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
  v_costo_unitario NUMERIC; v_costo_total NUMERIC := 0;
  v_existente RECORD;
  v_usa_fidelizacion BOOLEAN; v_pesos_por_punto NUMERIC; v_saldo_puntos INTEGER;
  v_puntos_ganados INTEGER := 0;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF p_client_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_client_uuid::text, 0));
    SELECT id, numero_venta, neto_gravado, iva_discriminado, costo_mercaderia_vendida
      INTO v_existente
    FROM public.comprobantes
    WHERE empresa_id = p_empresa_id AND client_uuid = p_client_uuid;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'comprobante_id', v_existente.id,
        'numero_venta', v_existente.numero_venta,
        'neto_gravado', v_existente.neto_gravado,
        'iva_discriminado', v_existente.iva_discriminado,
        'costo_mercaderia_vendida', v_existente.costo_mercaderia_vendida,
        'puntos_ganados', 0,
        'duplicate', true
      );
    END IF;
  END IF;

  IF p_centro_costo_id IS NOT NULL THEN
    SELECT usa_centros_costo INTO v_usa_cc FROM public.empresas WHERE id = p_empresa_id;
    IF NOT COALESCE(v_usa_cc, false) THEN
      RAISE EXCEPTION 'Centros de Costo no está activado para esta empresa. Activalo en Configuración > Finanzas.';
    END IF;
  END IF;

  IF p_factura_reserva AND p_pedido_id IS NULL THEN
    RAISE EXCEPTION 'Factura de Reserva requiere un pedido asociado';
  END IF;

  v_total := ROUND(p_total, 2);
  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito, saldo_puntos INTO v_dias_credito, v_saldo_puntos
    FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id FOR UPDATE;

    SELECT usa_fidelizacion, puntos_pesos_por_punto
      INTO v_usa_fidelizacion, v_pesos_por_punto
    FROM public.empresas WHERE id = p_empresa_id;
  END IF;

  IF p_puntos_canjeados > 0 THEN
    IF p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'No se pueden canjear puntos sin un cliente asociado a la venta';
    END IF;
    IF NOT COALESCE(v_usa_fidelizacion, false) THEN
      RAISE EXCEPTION 'Fidelización por puntos no está activada para esta empresa';
    END IF;
    IF COALESCE(v_saldo_puntos, 0) < p_puntos_canjeados THEN
      RAISE EXCEPTION 'Saldo de puntos insuficiente (disponible: %, solicitado: %)', COALESCE(v_saldo_puntos, 0), p_puntos_canjeados;
    END IF;
  END IF;

  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);

  IF p_pedido_id IS NOT NULL THEN
    SELECT id INTO v_entrega_manual_id FROM public.entregas
    WHERE empresa_id = p_empresa_id AND pedido_id = p_pedido_id AND origen = 'manual' AND estado = 'entregado'
    ORDER BY fecha DESC LIMIT 1;
  END IF;

  IF p_factura_reserva AND v_entrega_manual_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este pedido ya tiene una Entrega registrada — no se puede facturar como Reserva';
  END IF;

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa, monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento, monto_moneda_original, centro_costo_id, client_uuid,
    tipo_comprobante_afip, punto_venta_id, referencia_cliente
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha, p_cliente_id, p_cliente_nombre, v_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa, p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento, ROUND(p_monto_moneda_original, 2), p_centro_costo_id, p_client_uuid,
    p_tipo_comprobante_afip, p_punto_venta_id, NULLIF(TRIM(p_referencia_cliente), '')
  )
  RETURNING id INTO v_comprobante_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC(12,3);
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
    v_costo_unitario := NULL;
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
    -- Factura de Reserva: nunca mueve stock, sin importar si el ítem está o
    -- no atado a un pedido_item (por el guard de arriba, acá v_entrega_manual_id
    -- siempre es NULL en este modo, así que sin este override quedaría en TRUE).
    IF p_factura_reserva THEN
      v_mueve_stock := FALSE;
    END IF;
    IF v_mueve_stock THEN
      SELECT stock_actual, costo_compra INTO v_stock_actual, v_costo_unitario
      FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
      IF v_stock_actual IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
      END IF;
      IF v_stock_actual < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)', v_producto_id, v_stock_actual, v_cantidad;
      END IF;
      UPDATE public.productos SET stock_actual = stock_actual - v_cantidad WHERE id = v_producto_id;
      v_costo_total := v_costo_total + (COALESCE(v_costo_unitario, 0) * v_cantidad);
    END IF;
    v_factor := CASE v_alicuota WHEN '21' THEN 1.21 WHEN '10.5' THEN 1.105 ELSE 1 END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));
    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva,
      precio_original, descuento_pct, descuento_monto, oferta_id, descuento_manual_pct,
      unidad_venta_id, cantidad_venta, precio_unidad_venta, costo_unitario
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unitario, v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item, v_oferta_id, v_descuento_manual_pct,
      v_unidad_venta_id, v_cantidad_venta, v_precio_unidad_venta, v_costo_unitario
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
    descuento_global_monto = ROUND(v_descuento_global_monto, 2), descuento_global_pct = v_descuento_global_pct,
    costo_mercaderia_vendida = ROUND(v_costo_total, 2)
  WHERE id = v_comprobante_id;
  IF v_entrega_manual_id IS NOT NULL THEN
    UPDATE public.entregas SET comprobante_id = v_comprobante_id WHERE id = v_entrega_manual_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      UPDATE public.comprobante_items SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id AND producto_id = (v_item->>'producto_id')::UUID;
    END LOOP;
  ELSIF p_factura_reserva THEN
    -- Factura de Reserva: no se genera ninguna Entrega todavía (ni implícita,
    -- tampoco se linkeó una manual — el guard de arriba garantiza que acá
    -- v_entrega_manual_id es NULL). Se genera después, aparte, con "Generar
    -- Entrega" (crear_entrega, sin cambios — nunca tuvo check de estado).
    NULL;
  ELSE
    v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
    INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, comprobante_id, cliente_id, origen, estado, fecha, pedido_id)
    VALUES (p_empresa_id, auth.uid(), v_numero_entrega, v_comprobante_id, p_cliente_id, 'implicita', 'entregado', CURRENT_DATE, p_pedido_id)
    RETURNING id INTO v_entrega_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
      VALUES (v_entrega_id, p_empresa_id, (v_item->>'producto_id')::UUID, (v_item->>'cantidad')::NUMERIC(12,3));
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
      IF v_forma_pago_id IS NOT NULL THEN
        SELECT nombre INTO v_metodo_pago FROM public.formas_pago
         WHERE id = v_forma_pago_id AND empresa_id = p_empresa_id;
        IF v_metodo_pago IS NULL THEN
          RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
        END IF;
      END IF;
      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, fecha, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id, comprobante_id
      ) VALUES (
        p_empresa_id, auth.uid(), p_caja_sesion_id, 'ingreso', 'Venta', 'Venta #' || p_numero_venta,
        ROUND((v_pago->>'monto')::NUMERIC, 2), v_metodo_pago, p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC, NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC, v_forma_pago_id, v_comprobante_id
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

  IF p_puntos_canjeados > 0 THEN
    UPDATE public.clientes SET saldo_puntos = saldo_puntos - p_puntos_canjeados
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id
    RETURNING saldo_puntos INTO v_saldo_puntos;
    INSERT INTO public.movimientos_puntos (empresa_id, cliente_id, comprobante_id, tipo, puntos, saldo_posterior, user_id)
    VALUES (p_empresa_id, p_cliente_id, v_comprobante_id, 'canjeado', p_puntos_canjeados, v_saldo_puntos, auth.uid());
  END IF;

  IF p_cliente_id IS NOT NULL AND COALESCE(v_usa_fidelizacion, false) AND COALESCE(v_pesos_por_punto, 0) > 0 THEN
    v_puntos_ganados := FLOOR(v_total / v_pesos_por_punto)::integer;
    IF v_puntos_ganados > 0 THEN
      UPDATE public.clientes SET saldo_puntos = saldo_puntos + v_puntos_ganados
      WHERE id = p_cliente_id AND empresa_id = p_empresa_id
      RETURNING saldo_puntos INTO v_saldo_puntos;
      INSERT INTO public.movimientos_puntos (empresa_id, cliente_id, comprobante_id, tipo, puntos, saldo_posterior, user_id)
      VALUES (p_empresa_id, p_cliente_id, v_comprobante_id, 'ganado', v_puntos_ganados, v_saldo_puntos, auth.uid());
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta', p_numero_venta,
    'neto_gravado', ROUND(v_neto_total, 2),
    'iva_discriminado', ROUND(v_iva_total, 2),
    'costo_mercaderia_vendida', ROUND(v_costo_total, 2),
    'puntos_ganados', v_puntos_ganados,
    'duplicate', false
  );
END;
$function$;
