-- migrations/033_crear_venta_iva.sql
-- Actualiza la RPC crear_venta (migration 024 + fix_crear_venta_sin_user_id) para
-- calcular neto_gravado e iva_discriminado reales según la alicuota_iva de cada item,
-- en lugar de asumir 21% fijo. Guarda alicuota_iva en comprobante_items (snapshot).
--
-- IMPORTANTE: copia COMPLETA de la lógica existente (RPC crítica en producción).
-- Único cambio: cálculo de IVA por item + UPDATE de totales discriminados.
--
-- Convención de cálculo: el subtotal del item INCLUYE IVA (precio_venta es precio
-- final con IVA). Por eso neto = subtotal / (1 + factor); iva = subtotal - neto.
-- Para alícuotas 0/exento/no_gravado el factor es 0 → todo el subtotal es neto.
-- Fallback: items sin alicuota_iva → '21' (retrocompatibilidad).

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
  p_estado_pago        TEXT,
  p_moneda             TEXT,
  p_tipo_cambio_tasa   NUMERIC,
  p_monto_paralelo     NUMERIC,
  p_tc_paralelo        NUMERIC,
  p_items              JSONB,
  p_pagos              JSONB,
  p_es_cc              BOOLEAN,
  p_caja_sesion_id     UUID
)
RETURNS JSONB
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
  -- IVA
  v_alicuota        TEXT;
  v_factor          NUMERIC;
  v_subtotal        NUMERIC;
  v_neto_total      NUMERIC := 0;
  v_iva_total       NUMERIC := 0;
BEGIN
  -- ── Validación de seguridad multi-tenant ────────────────────────────────────
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  -- ── 1. Insertar comprobante (totales discriminados se actualizan al final) ──
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

  -- ── 2. Items + descuento de stock atómico + cálculo IVA ─────────────────────
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := (v_item->>'subtotal')::NUMERIC;
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');

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

    -- Factor de IVA según alícuota
    v_factor := CASE v_alicuota
      WHEN '21'   THEN 0.21
      WHEN '10.5' THEN 0.105
      ELSE 0  -- '0', 'exento', 'no_gravado' → sin IVA
    END;

    IF v_factor > 0 THEN
      v_neto_total := v_neto_total + (v_subtotal / (1 + v_factor));
      v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / (1 + v_factor)));
    ELSE
      v_neto_total := v_neto_total + v_subtotal;
    END IF;

    -- Item del comprobante (columnas en ESPAÑOL: producto_id, cantidad) + alicuota
    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id,
      producto_id, cantidad,
      precio_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_comprobante_id, p_empresa_id,
      v_producto_id, v_cantidad,
      (v_item->>'precio_unitario')::NUMERIC,
      v_subtotal, v_alicuota
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

  -- ── 2b. Actualizar comprobante con totales discriminados ────────────────────
  UPDATE public.comprobantes
  SET neto_gravado     = ROUND(v_neto_total, 2),
      iva_discriminado = ROUND(v_iva_total, 2)
  WHERE id = v_comprobante_id;

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
END;
$$;
