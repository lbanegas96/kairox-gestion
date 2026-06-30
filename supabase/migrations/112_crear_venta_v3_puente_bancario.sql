-- migration 112 — crear_venta v3: puente Caja ↔ Bancos
-- Para cada pago distinto de Efectivo y Cuenta Corriente, busca en
-- metodo_pago_cuenta_bancaria (migration 111). Si hay mapeo activo,
-- inserta un movimiento_bancario automático con origen='caja'.
-- Si no hay mapeo configurado, el comportamiento es idéntico a v2 (sin impacto).
-- ROLLBACK: recrear v2 sin el bloque de puente (ver migration 108 para el body).

CREATE OR REPLACE FUNCTION public.crear_venta(
  p_empresa_id       UUID,
  p_user_id          UUID,
  p_numero_venta     TEXT,
  p_fecha            TIMESTAMPTZ,
  p_cliente_id       UUID,
  p_cliente_nombre   TEXT,
  p_total            NUMERIC,
  p_forma_pago       TEXT,
  p_estado_pago      TEXT,
  p_moneda           TEXT,
  p_tipo_cambio_tasa NUMERIC,
  p_monto_paralelo   NUMERIC,
  p_tc_paralelo      NUMERIC,
  p_items            JSONB,
  p_pagos            JSONB,
  p_es_cc            BOOLEAN,
  p_caja_sesion_id   UUID,
  p_pedido_id        UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comprobante_id         UUID;
  v_item                   JSONB;
  v_pago                   JSONB;
  v_stock_actual           INTEGER;
  v_cantidad               INTEGER;
  v_producto_id            UUID;
  v_alicuota               TEXT;
  v_factor                 NUMERIC;
  v_subtotal               NUMERIC;
  v_neto_total             NUMERIC := 0;
  v_iva_total              NUMERIC := 0;
  v_entrega_id             UUID;
  v_numero_entrega         TEXT;
  v_entrega_manual_id      UUID := NULL;
  v_dias_credito           INTEGER;
  v_fecha_vencimiento      DATE;
  v_precio_original        NUMERIC;
  v_descuento_pct          NUMERIC;
  v_descuento_monto_item   NUMERIC;
  v_oferta_id              UUID;
  v_descuento_manual_pct   NUMERIC;
  v_descuento_global_monto NUMERIC := 0;
  v_descuento_global_pct   NUMERIC := 0;
  v_bruto_total            NUMERIC := 0;
  v_cuenta_bancaria_id     UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito INTO v_dias_credito
    FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
  END IF;
  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha,
    cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa,
    monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha,
    p_cliente_id, p_cliente_nombre, p_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa,
    p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento
  )
  RETURNING id INTO v_comprobante_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := (v_item->>'subtotal')::NUMERIC;
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');

    v_precio_original      := COALESCE((v_item->>'precio_original')::NUMERIC,
                                        (v_item->>'precio_unitario')::NUMERIC);
    v_descuento_pct        := COALESCE((v_item->>'descuento_pct')::NUMERIC, 0);
    v_descuento_monto_item := COALESCE((v_item->>'descuento_monto')::NUMERIC, 0);
    v_oferta_id            := NULLIF(v_item->>'oferta_id', '')::UUID;
    v_descuento_manual_pct := COALESCE((v_item->>'descuento_manual_pct')::NUMERIC, 0);

    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_producto_id AND empresa_id = p_empresa_id
    FOR UPDATE;

    IF v_stock_actual IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;
    IF v_stock_actual < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)',
        v_producto_id, v_stock_actual, v_cantidad;
    END IF;

    UPDATE public.productos
    SET stock_actual = stock_actual - v_cantidad
    WHERE id = v_producto_id;

    v_factor := CASE v_alicuota
      WHEN '21'   THEN 1.21
      WHEN '10.5' THEN 1.105
      ELSE 1
    END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));

    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id,
      cantidad, precio_unitario, subtotal, alicuota_iva,
      precio_original, descuento_pct, descuento_monto,
      oferta_id, descuento_manual_pct
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id,
      v_cantidad, (v_item->>'precio_unitario')::NUMERIC,
      v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item,
      v_oferta_id, v_descuento_manual_pct
    );

    v_descuento_global_monto := v_descuento_global_monto
                                + (v_descuento_monto_item * v_cantidad);
    v_bruto_total := v_bruto_total + (v_precio_original * v_cantidad);

    INSERT INTO public.movimientos_inventario (
      empresa_id, tenant_id, producto_id,
      tipo, cantidad, motivo, fecha
    ) VALUES (
      p_empresa_id, p_empresa_id, v_producto_id,
      'salida', v_cantidad,
      'Venta #' || p_numero_venta,
      p_fecha
    );
  END LOOP;

  v_descuento_global_pct := CASE
    WHEN v_bruto_total > 0
    THEN ROUND(v_descuento_global_monto / v_bruto_total * 100, 2)
    ELSE 0
  END;

  UPDATE public.comprobantes
  SET neto_gravado     = ROUND(v_neto_total, 2),
      iva_discriminado = ROUND(v_iva_total, 2),
      descuento_global_monto = v_descuento_global_monto,
      descuento_global_pct = v_descuento_global_pct
  WHERE id = v_comprobante_id;

  IF p_pedido_id IS NOT NULL THEN
    SELECT id INTO v_entrega_manual_id
    FROM public.entregas
    WHERE empresa_id = p_empresa_id
      AND pedido_id  = p_pedido_id
      AND origen     = 'manual'
      AND estado     = 'entregado'
    ORDER BY fecha DESC
    LIMIT 1;
  END IF;

  IF v_entrega_manual_id IS NOT NULL THEN
    UPDATE public.entregas
    SET comprobante_id = v_comprobante_id
    WHERE id = v_entrega_manual_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      UPDATE public.comprobante_items
      SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id
        AND producto_id   = (v_item->>'producto_id')::UUID;
    END LOOP;
  ELSE
    v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
    INSERT INTO public.entregas (
      empresa_id, user_id, numero_entrega, comprobante_id, cliente_id,
      origen, estado, fecha, pedido_id
    ) VALUES (
      p_empresa_id, p_user_id, v_numero_entrega, v_comprobante_id, p_cliente_id,
      'implicita', 'entregado', CURRENT_DATE, p_pedido_id
    ) RETURNING id INTO v_entrega_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
      VALUES (
        v_entrega_id, p_empresa_id,
        (v_item->>'producto_id')::UUID,
        (v_item->>'cantidad')::INTEGER
      );
      UPDATE public.comprobante_items
      SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id
        AND producto_id   = (v_item->>'producto_id')::UUID;
    END LOOP;
  END IF;

  -- Movimientos de Caja
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    IF (v_pago->>'metodo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id,
        tipo, categoria, concepto,
        monto, metodo_pago, fecha, is_automatic,
        monto_paralelo, tc_paralelo
      ) VALUES (
        p_empresa_id, p_user_id, p_caja_sesion_id,
        'ingreso', 'Venta',
        'Venta #' || p_numero_venta,
        (v_pago->>'monto')::NUMERIC,
        v_pago->>'metodo',
        p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC,
        NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC
      );
    END IF;
  END LOOP;

  -- Puente Caja ↔ Bancos: si hay mapeo configurado, crear movimiento bancario
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    IF (v_pago->>'metodo') IS DISTINCT FROM 'Efectivo'
       AND (v_pago->>'metodo') IS DISTINCT FROM 'Cuenta Corriente' THEN

      SELECT mpb.cuenta_bancaria_id INTO v_cuenta_bancaria_id
      FROM public.metodo_pago_cuenta_bancaria mpb
      WHERE mpb.empresa_id  = p_empresa_id
        AND mpb.metodo_pago = (v_pago->>'metodo')
        AND mpb.activo      = true;

      IF v_cuenta_bancaria_id IS NOT NULL THEN
        INSERT INTO public.movimientos_bancarios (
          empresa_id, cuenta_bancaria_id, fecha, descripcion,
          monto, tipo, origen, conciliado
        ) VALUES (
          p_empresa_id, v_cuenta_bancaria_id, p_fecha,
          'Venta #' || p_numero_venta,
          (v_pago->>'monto')::NUMERIC, 'ingreso', 'caja', false
        );
      END IF;

      v_cuenta_bancaria_id := NULL;
    END IF;
  END LOOP;

  IF p_es_cc AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id,
      tipo, monto, descripcion, fecha,
      comprobante_id,
      monto_paralelo, tc_paralelo
    ) VALUES (
      p_empresa_id, p_user_id, p_cliente_id,
      'DEBE', p_total,
      'Venta #' || p_numero_venta,
      p_fecha,
      v_comprobante_id,
      p_monto_paralelo, p_tc_paralelo
    );
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta',   p_numero_venta
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_venta(
  UUID, UUID, TEXT, TIMESTAMPTZ, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, JSONB, JSONB, BOOLEAN, UUID, UUID
) FROM public, anon;
