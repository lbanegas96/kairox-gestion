-- Toggle "Centros de Costo" por empresa — mismo patrón que
-- empresas.usa_impuestos_avanzados (mig.173): opt-in configurable, oculta la UI
-- cuando está OFF y (para el único punto que pasa por una RPC, crear_venta)
-- también bloquea la ejecución si alguien fuerza un p_centro_costo_id por API
-- directa con el toggle apagado.
--
-- Backfill: TRUE solo para empresas que YA tienen al menos un centro de costo
-- cargado (a diferencia de mig.173, que hizo backfill universal porque IIBB ya
-- estaba en uso implícito) — Centro de Costo es opcional desde su origen
-- (Fase 1) y la mayoría de empresas nunca cargó ninguno, así que el default
-- correcto para ellas es quedar en false (oculto) hasta que lo activen.

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_centros_costo BOOLEAN NOT NULL DEFAULT false;

UPDATE public.empresas e
SET usa_centros_costo = true
WHERE EXISTS (SELECT 1 FROM public.centros_costo cc WHERE cc.empresa_id = e.id)
  AND usa_centros_costo = false;

-- Enforcement a nivel RPC (mismo criterio aplicado a IIBB en mig.178): crear_venta
-- es el único punto de escritura de centro_costo_id que pasa por una RPC (compras/
-- comprobantes lo insertan directo, ya protegidos por RLS+has_module_permission,
-- sin necesidad de este guard adicional). Solo se activa si p_centro_costo_id
-- viene con un valor real — sin selector visible (toggle OFF) el frontend nunca
-- manda uno, así que esto no afecta el uso normal.
CREATE OR REPLACE FUNCTION public.crear_venta(
  p_empresa_id uuid, p_user_id uuid, p_numero_venta text, p_fecha timestamp with time zone,
  p_cliente_id uuid, p_cliente_nombre text, p_total numeric, p_forma_pago text,
  p_estado_pago text, p_moneda text, p_tipo_cambio_tasa numeric, p_monto_paralelo numeric,
  p_tc_paralelo numeric, p_items jsonb, p_pagos jsonb, p_es_cc boolean, p_caja_sesion_id uuid,
  p_pedido_id uuid, p_monto_moneda_original numeric DEFAULT NULL::numeric,
  p_centro_costo_id uuid DEFAULT NULL::uuid
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
      precio_original, descuento_pct, descuento_monto, oferta_id, descuento_manual_pct
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unitario, v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item, v_oferta_id, v_descuento_manual_pct
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
      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, fecha, is_automatic, monto_paralelo, tc_paralelo
      ) VALUES (
        p_empresa_id, p_user_id, p_caja_sesion_id, 'ingreso', 'Venta', 'Venta #' || p_numero_venta,
        ROUND((v_pago->>'monto')::NUMERIC, 2), v_pago->>'metodo', p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC, NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC
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
