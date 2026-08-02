-- QR MercadoPago: expiración de 10 → 15 minutos (mig.297 usaba 10, el usuario
-- pidió más margen tras un QR real que expiró antes de poder escanearlo).
CREATE OR REPLACE FUNCTION public.crear_venta_pendiente_qr(p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_items jsonb, p_punto_venta_id uuid DEFAULT NULL::uuid, p_tipo_comprobante_afip text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_centro_costo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comprobante_id UUID; v_item JSONB; v_numero_venta TEXT;
  v_producto_id UUID; v_cantidad INTEGER; v_stock_actual INTEGER;
  v_precio_unitario NUMERIC; v_subtotal NUMERIC; v_alicuota TEXT; v_factor NUMERIC;
  v_neto_total NUMERIC := 0; v_iva_total NUMERIC := 0; v_bruto_total NUMERIC := 0;
  v_costo_unitario NUMERIC; v_costo_total NUMERIC := 0;
  v_entrega_id UUID; v_numero_entrega TEXT;
  v_usa_cc BOOLEAN; v_external_reference TEXT;
  v_fecha TIMESTAMPTZ := now();
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
      RAISE EXCEPTION 'Centros de Costo no está activado para esta empresa.';
    END IF;
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe tener al menos un ítem';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_subtotal := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_bruto_total := v_bruto_total + v_subtotal;
  END LOOP;
  IF v_bruto_total <= 0 THEN
    RAISE EXCEPTION 'El total de la venta debe ser mayor a cero';
  END IF;

  v_numero_venta := public.obtener_proximo_numero(p_empresa_id, 'venta', p_punto_venta_id);

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total,
    forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo,
    punto_venta_id, tipo_comprobante_afip, centro_costo_id
  ) VALUES (
    p_empresa_id, p_empresa_id, v_numero_venta, v_fecha, p_cliente_id,
    COALESCE(p_cliente_nombre, 'Consumidor Final'), ROUND(v_bruto_total, 2),
    'QR MercadoPago', 'pendiente', 'ARS', 1, 'venta',
    p_punto_venta_id, p_tipo_comprobante_afip, p_centro_costo_id
  )
  RETURNING id INTO v_comprobante_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id     := (v_item->>'producto_id')::UUID;
    v_cantidad        := (v_item->>'cantidad')::INTEGER;
    v_subtotal        := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_alicuota        := COALESCE(v_item->>'alicuota_iva', '21');
    v_precio_unitario := ROUND((v_item->>'precio_unitario')::NUMERIC, 2);

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

    v_factor := CASE v_alicuota WHEN '21' THEN 1.21 WHEN '10.5' THEN 1.105 ELSE 1 END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));

    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal,
      alicuota_iva, costo_unitario, cantidad_entregada
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unitario, v_subtotal,
      v_alicuota, v_costo_unitario, v_cantidad
    );

    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'salida', v_cantidad, 'Venta #' || v_numero_venta, v_fecha);
  END LOOP;

  UPDATE public.comprobantes SET
    neto_gravado = ROUND(v_neto_total, 2),
    iva_discriminado = ROUND(v_iva_total, 2),
    costo_mercaderia_vendida = ROUND(v_costo_total, 2)
  WHERE id = v_comprobante_id;

  v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
  INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, comprobante_id, cliente_id, origen, estado, fecha)
  VALUES (p_empresa_id, p_user_id, v_numero_entrega, v_comprobante_id, p_cliente_id, 'implicita', 'entregado', CURRENT_DATE)
  RETURNING id INTO v_entrega_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
    VALUES (v_entrega_id, p_empresa_id, (v_item->>'producto_id')::UUID, (v_item->>'cantidad')::INTEGER);
  END LOOP;

  v_external_reference := 'KAIROX-' || p_empresa_id::text || '-QR-' || gen_random_uuid()::text;
  INSERT INTO public.qr_pagos_mp (
    empresa_id, comprobante_id, user_id, caja_sesion_id, external_reference, monto, expiracion
  ) VALUES (
    p_empresa_id, v_comprobante_id, p_user_id, p_caja_sesion_id, v_external_reference,
    ROUND(v_bruto_total, 2), now() + interval '15 minutes'
  );

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta', v_numero_venta,
    'total', ROUND(v_bruto_total, 2),
    'external_reference', v_external_reference
  );
END;
$function$;
