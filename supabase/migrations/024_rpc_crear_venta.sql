-- migrations/024_rpc_crear_venta.sql
-- RPC transaccional para crear una venta completa con rollback automático.
-- Encapsula en una sola transacción: comprobante + items + stock + movimientos_inventario
-- + movimientos_caja (pagos no-CC) + cuenta_corriente_movimientos (si es CC).
--
-- NOTA de schema (verificado contra DB real, proyecto wuznppxeonmhfcvnqfbf):
--   • comprobante_items usa columnas en ESPAÑOL: producto_id, cantidad
--     (NO portugués produto_id/quantidade — el schema fue migrado).
--   • movimientos_inventario NO tiene user_id; sí tiene tenant_id (legacy, nullable).
--   • comprobantes.tipo (NOT NULL, CHECK venta|nota_credito) → 'venta'.
--   • cuenta_corriente_movimientos.comprobante_id existe (Open Item Management).
--   • tenant_id se setea = empresa_id (en este sistema user.tenant_id === user.empresa_id).
--
-- El asiento contable NO va en la transacción: es fire-and-forget desde el frontend.

CREATE OR REPLACE FUNCTION public.crear_venta(
  -- Identificación
  p_empresa_id         UUID,
  p_user_id            UUID,
  -- Comprobante
  p_numero_venta       TEXT,
  p_fecha              TIMESTAMPTZ,
  p_cliente_id         UUID,
  p_cliente_nombre     TEXT,
  p_total              NUMERIC,
  p_forma_pago         TEXT,
  p_estado_pago        TEXT,        -- 'pendiente' | 'pagada'
  p_moneda             TEXT,        -- 'ARS' | 'USD' | 'EUR' | 'BRL'
  p_tipo_cambio_tasa   NUMERIC,
  p_monto_paralelo     NUMERIC,     -- nullable
  p_tc_paralelo        NUMERIC,     -- nullable
  -- Items del carrito: JSONB array
  -- Cada item: { producto_id, cantidad, precio_unitario, subtotal }
  p_items              JSONB,
  -- Pagos: JSONB array
  -- Cada pago: { metodo, monto, monto_paralelo, tc_paralelo }
  -- Solo los pagos NO-CC van a movimientos_caja
  p_pagos              JSONB,
  -- CC: si es venta en cuenta corriente
  p_es_cc              BOOLEAN,
  -- Caja sesión actual (nullable si no hay sesión abierta)
  p_caja_sesion_id     UUID
)
RETURNS JSONB  -- { comprobante_id, numero_venta }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_comprobante_id  UUID;
  v_item            JSONB;
  v_pago            JSONB;
  v_stock_actual    INTEGER;
  v_cantidad        INTEGER;
  v_producto_id     UUID;
BEGIN
  -- ── Validación de seguridad multi-tenant ────────────────────────────────────
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  -- ── 1. Insertar comprobante ─────────────────────────────────────────────────
  -- OJO: comprobantes NO tiene columna user_id (verificado contra DB real).
  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha,
    cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa,
    monto_paralelo, tc_paralelo, tipo
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha,
    p_cliente_id, p_cliente_nombre, p_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa,
    p_monto_paralelo, p_tc_paralelo, 'venta'
  )
  RETURNING id INTO v_comprobante_id;

  -- ── 2. Items + descuento de stock atómico ───────────────────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;

    -- Lock de fila para evitar race condition entre ventas simultáneas
    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_producto_id AND empresa_id = p_empresa_id
    FOR UPDATE;

    IF v_stock_actual IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;

    IF v_stock_actual < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para producto %. Disponible: %, Solicitado: %',
        v_producto_id, v_stock_actual, v_cantidad;
    END IF;

    -- Item del comprobante (columnas en ESPAÑOL: producto_id, cantidad)
    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id,
      producto_id, cantidad,
      precio_unitario, subtotal
    ) VALUES (
      v_comprobante_id, p_empresa_id,
      v_producto_id, v_cantidad,
      (v_item->>'precio_unitario')::NUMERIC,
      (v_item->>'subtotal')::NUMERIC
    );

    -- Descontar stock atómicamente
    UPDATE public.productos
    SET stock_actual = stock_actual - v_cantidad
    WHERE id = v_producto_id AND empresa_id = p_empresa_id;

    -- Movimiento de inventario (sin user_id — no existe en esta tabla)
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

  -- ── 3. Movimientos de caja (pagos NO-CC) ────────────────────────────────────
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

  -- ── 4. Movimiento de Cuenta Corriente (solo si es CC) ───────────────────────
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

  -- ── Resultado ───────────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta',   p_numero_venta
  );
-- Sin bloque EXCEPTION: cualquier error propaga y PostgreSQL hace ROLLBACK
-- automático de toda la transacción de la función.
END;
$$;
