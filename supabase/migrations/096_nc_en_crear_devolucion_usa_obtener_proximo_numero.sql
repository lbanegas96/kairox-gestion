-- Migration 096: crear_devolucion — número de NC via obtener_proximo_numero (atómico)
-- Antes: siguiente_numero_documento (COUNT(*) sin lock → podía generar duplicados)
-- Ahora: obtener_proximo_numero(empresa_id, 'nota_credito') → FOR UPDATE en series_numeracion

CREATE OR REPLACE FUNCTION public.crear_devolucion(
  p_empresa_id          UUID,
  p_user_id             UUID,
  p_tipo                TEXT,
  p_items               JSONB,
  p_entrega_id          UUID    DEFAULT NULL,
  p_recepcion_id        UUID    DEFAULT NULL,
  p_comprobante_id      UUID    DEFAULT NULL,
  p_compra_id           UUID    DEFAULT NULL,
  p_cliente_id          UUID    DEFAULT NULL,
  p_proveedor_id        UUID    DEFAULT NULL,
  p_reingresa_stock     BOOLEAN DEFAULT FALSE,
  p_compensacion        TEXT    DEFAULT 'pendiente',
  p_reembolso_efectivo  BOOLEAN DEFAULT FALSE,
  p_motivo              TEXT    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_devolucion_id    UUID;
  v_numero_dev       TEXT;
  v_item             JSONB;
  v_producto_id      UUID;
  v_cantidad         NUMERIC;
  v_precio_unit      NUMERIC;
  v_subtotal         NUMERIC;
  v_total_dev        NUMERIC := 0;
  v_nc_id            UUID    := NULL;
  v_numero_nc        TEXT    := NULL;
  v_cliente_nombre   TEXT;
  v_caja_sesion_id   UUID;
  v_stock_actual_dev NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- FIX 086: obtener_proximo_numero usa FOR UPDATE en series_numeracion → atómico
  v_numero_dev := public.obtener_proximo_numero(p_empresa_id, 'devolucion');

  INSERT INTO public.devoluciones (
    empresa_id, user_id, numero_devolucion, tipo,
    entrega_id, recepcion_id, comprobante_id, compra_id,
    cliente_id, proveedor_id,
    reingresa_stock, compensacion, reembolso_efectivo, motivo
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_dev, p_tipo,
    p_entrega_id, p_recepcion_id, p_comprobante_id, p_compra_id,
    p_cliente_id, p_proveedor_id,
    p_reingresa_stock, p_compensacion, p_reembolso_efectivo, p_motivo
  ) RETURNING id INTO v_devolucion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC;
    v_precio_unit := (v_item->>'precio_unitario')::NUMERIC;
    v_subtotal    := v_cantidad * v_precio_unit;
    v_total_dev   := v_total_dev + v_subtotal;

    INSERT INTO public.devolucion_items (
      devolucion_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal,
      comprobante_item_id, detalle_compra_item_id
    ) VALUES (
      v_devolucion_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unit, v_subtotal,
      NULLIF(v_item->>'comprobante_item_id', '')::UUID,
      NULLIF(v_item->>'detalle_compra_item_id', '')::UUID
    );

    IF (v_item->>'comprobante_item_id') IS NOT NULL AND (v_item->>'comprobante_item_id') <> '' THEN
      UPDATE public.comprobante_items
      SET cantidad_devuelta = cantidad_devuelta + v_cantidad
      WHERE id = (v_item->>'comprobante_item_id')::UUID;
    END IF;

    IF (v_item->>'detalle_compra_item_id') IS NOT NULL AND (v_item->>'detalle_compra_item_id') <> '' THEN
      UPDATE public.detalle_compras
      SET cantidad_devuelta = cantidad_devuelta + v_cantidad
      WHERE id = (v_item->>'detalle_compra_item_id')::UUID;
    END IF;

    IF p_reingresa_stock THEN
      IF p_tipo = 'cliente' THEN
        UPDATE public.productos
        SET stock_actual = stock_actual + v_cantidad
        WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (
          empresa_id, producto_id, tipo, cantidad, motivo, user_id
        ) VALUES (
          p_empresa_id, v_producto_id, 'ingreso', v_cantidad::INTEGER,
          'Devolucion cliente ' || v_numero_dev, p_user_id
        );
      ELSE
        SELECT stock_actual INTO v_stock_actual_dev
        FROM public.productos
        WHERE id = v_producto_id AND empresa_id = p_empresa_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', v_producto_id;
        END IF;

        IF COALESCE(v_stock_actual_dev, 0) - v_cantidad < 0 THEN
          RAISE EXCEPTION 'Stock insuficiente para devolver al proveedor el producto: %', v_producto_id;
        END IF;

        UPDATE public.productos
        SET stock_actual = stock_actual - v_cantidad
        WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (
          empresa_id, producto_id, tipo, cantidad, motivo, user_id
        ) VALUES (
          p_empresa_id, v_producto_id, 'salida', v_cantidad::INTEGER,
          'Devolucion a proveedor ' || v_numero_dev, p_user_id
        );
      END IF;
    END IF;
  END LOOP;

  IF p_compensacion = 'nota_credito' THEN
    -- FIX 096: usar obtener_proximo_numero (FOR UPDATE) en lugar de siguiente_numero_documento (COUNT*)
    v_numero_nc := public.obtener_proximo_numero(p_empresa_id, 'nota_credito');

    SELECT nombre INTO v_cliente_nombre
    FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id;

    INSERT INTO public.comprobantes (
      empresa_id, numero_venta, tipo, cliente_id, cliente_nombre, total,
      comprobante_origen_id, motivo_nc, forma_pago, estado_pago
    ) VALUES (
      p_empresa_id, v_numero_nc, 'nota_credito',
      p_cliente_id, COALESCE(v_cliente_nombre, 'Consumidor Final'),
      v_total_dev, p_comprobante_id, p_motivo,
      'Efectivo',
      CASE WHEN p_reembolso_efectivo THEN 'pagada' ELSE 'pendiente' END
    ) RETURNING id INTO v_nc_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_producto_id := (v_item->>'producto_id')::UUID;
      v_cantidad    := (v_item->>'cantidad')::NUMERIC;
      v_precio_unit := (v_item->>'precio_unitario')::NUMERIC;
      INSERT INTO public.comprobante_items (
        empresa_id, comprobante_id, producto_id,
        cantidad, precio_unitario, subtotal
      ) VALUES (
        p_empresa_id, v_nc_id, v_producto_id,
        v_cantidad::INTEGER, v_precio_unit, v_cantidad * v_precio_unit
      );
    END LOOP;

    IF NOT p_reembolso_efectivo THEN
      INSERT INTO public.cuenta_corriente_movimientos (
        empresa_id, cliente_id, tipo, monto, descripcion, comprobante_id
      ) VALUES (
        p_empresa_id, p_cliente_id, 'HABER', v_total_dev,
        'NC ' || v_numero_nc || ' por devolucion ' || v_numero_dev,
        v_nc_id
      );
    ELSE
      SELECT id INTO v_caja_sesion_id
      FROM public.caja_sesiones
      WHERE empresa_id = p_empresa_id AND estado = 'abierta'
      ORDER BY apertura_fecha DESC LIMIT 1;

      IF v_caja_sesion_id IS NULL THEN
        RAISE EXCEPTION 'Caja cerrada: abri la caja para procesar reembolsos en efectivo';
      END IF;

      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo,
        categoria, concepto, monto, metodo_pago, is_automatic
      ) VALUES (
        p_empresa_id, p_user_id, v_caja_sesion_id,
        CASE WHEN p_tipo = 'cliente' THEN 'egreso' ELSE 'ingreso' END,
        'Devoluciones',
        'Reembolso devolucion ' || v_numero_dev,
        v_total_dev, 'Efectivo', TRUE
      );
    END IF;

    UPDATE public.devoluciones SET nota_credito_id = v_nc_id WHERE id = v_devolucion_id;
  END IF;

  RETURN jsonb_build_object(
    'devolucion_id',     v_devolucion_id,
    'numero_devolucion', v_numero_dev,
    'nota_credito_id',   v_nc_id,
    'numero_nc',         v_numero_nc,
    'total',             v_total_dev
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.crear_devolucion(
  uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text, boolean, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.crear_devolucion(
  uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text, boolean, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.crear_devolucion(
  uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text, boolean, text
) TO authenticated;
