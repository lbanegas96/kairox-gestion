-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 036 — Document Flow: RPCs de negocio (Prompt 2/6)
--
-- COPIA EXACTA de crear_venta desde la DB (migration 033) + bloque
-- de Entrega implícita agregado. Verificado con pg_get_functiondef().
--
-- Funciones nuevas (aditivas, sin efecto hasta que el frontend las llame):
--   crear_entrega                — camino largo Ventas (desde Pedido)
--   crear_recepcion              — camino largo Compras (desde OC)
--   crear_recepcion_implicita    — recepción documental para compras directas
--   crear_factura_desde_entrega  — factura camino largo (sin tocar stock)
-- ═══════════════════════════════════════════════════════════════════════════


-- ── Parte 1: crear_venta + Entrega implícita ─────────────────────────────
--
-- Único cambio respecto a la versión 033:
--   DECLARE  → +v_entrega_id UUID, +v_numero_entrega TEXT
--   Nuevo bloque entre UPDATE neto_gravado y el loop de pagos:
--     genera registro en entregas (origen='implicita') + entrega_items
--     + actualiza comprobante_items.cantidad_entregada
-- Todo lo demás es palabra por palabra idéntico a pg_get_functiondef().

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
  p_caja_sesion_id   UUID
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
  v_alicuota        TEXT;
  v_factor          NUMERIC;
  v_subtotal        NUMERIC;
  v_neto_total      NUMERIC := 0;
  v_iva_total       NUMERIC := 0;
  -- Añadido en migration 036 — entrega implícita
  v_entrega_id      UUID;
  v_numero_entrega  TEXT;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

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

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := (v_item->>'subtotal')::NUMERIC;
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');

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

    v_factor := CASE v_alicuota
      WHEN '21'   THEN 0.21
      WHEN '10.5' THEN 0.105
      ELSE 0
    END;

    IF v_factor > 0 THEN
      v_neto_total := v_neto_total + (v_subtotal / (1 + v_factor));
      v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / (1 + v_factor)));
    ELSE
      v_neto_total := v_neto_total + v_subtotal;
    END IF;

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

    UPDATE public.productos
    SET stock_actual = stock_actual - v_cantidad
    WHERE id = v_producto_id AND empresa_id = p_empresa_id;

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

  UPDATE public.comprobantes
  SET neto_gravado     = ROUND(v_neto_total, 2),
      iva_discriminado = ROUND(v_iva_total, 2)
  WHERE id = v_comprobante_id;

  -- ── BLOQUE NUEVO: Entrega implícita (camino corto / POS) ─────────────────
  -- Registra la salida física en entregas + entrega_items.
  -- Stock ya fue descontado arriba — este bloque NO toca stock.
  v_numero_entrega := public.siguiente_numero_documento(
    p_empresa_id, 'entregas', 'numero_entrega', 'ENT'
  );
  INSERT INTO public.entregas (
    empresa_id, user_id, numero_entrega, comprobante_id, cliente_id,
    origen, estado, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_entrega, v_comprobante_id, p_cliente_id,
    'implicita', 'entregado', CURRENT_DATE
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
  -- ── FIN bloque entrega implícita ─────────────────────────────────────────

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


-- ── Parte 2: crear_entrega (camino largo, desde Pedido) ──────────────────
-- Este es el evento físico real de salida de stock para el flujo largo.
-- Precondición: los items deben pertenecer al pedido y tener stock suficiente.
-- Post: stock decrementado + movimientos_inventario + entrega_items + contador
--       en pedido_items.cantidad_entregada.

CREATE OR REPLACE FUNCTION public.crear_entrega(
  p_empresa_id UUID,
  p_user_id    UUID,
  p_pedido_id  UUID,
  p_items      JSONB  -- [{ pedido_item_id, producto_id, cantidad }]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entrega_id     UUID;
  v_numero_entrega TEXT;
  v_cliente_id     UUID;
  v_item           JSONB;
  v_stock_actual   INTEGER;
  v_producto_id    UUID;
  v_cantidad       NUMERIC;
  v_pedido_item_id UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  SELECT cliente_id INTO v_cliente_id
  FROM public.pedidos
  WHERE id = p_pedido_id AND empresa_id = p_empresa_id;

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado o no pertenece a la empresa: %', p_pedido_id;
  END IF;

  v_numero_entrega := public.siguiente_numero_documento(
    p_empresa_id, 'entregas', 'numero_entrega', 'ENT'
  );

  INSERT INTO public.entregas (
    empresa_id, user_id, numero_entrega, pedido_id, cliente_id,
    origen, estado, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_entrega, p_pedido_id, v_cliente_id,
    'manual', 'entregado', CURRENT_DATE
  ) RETURNING id INTO v_entrega_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id    := (v_item->>'producto_id')::UUID;
    v_cantidad       := (v_item->>'cantidad')::NUMERIC;
    v_pedido_item_id := NULLIF(v_item->>'pedido_item_id', '')::UUID;

    -- Lock + check stock
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

    -- Descuento de stock (evento físico real en camino largo)
    UPDATE public.productos
    SET stock_actual = stock_actual - v_cantidad::INTEGER
    WHERE id = v_producto_id AND empresa_id = p_empresa_id;

    INSERT INTO public.movimientos_inventario (
      empresa_id, tenant_id, producto_id,
      tipo, cantidad, motivo, fecha
    ) VALUES (
      p_empresa_id, p_empresa_id, v_producto_id,
      'salida', v_cantidad::INTEGER,
      'Entrega ' || v_numero_entrega,
      NOW()
    );

    INSERT INTO public.entrega_items (
      entrega_id, empresa_id, producto_id, cantidad, pedido_item_id
    ) VALUES (
      v_entrega_id, p_empresa_id, v_producto_id, v_cantidad, v_pedido_item_id
    );

    IF v_pedido_item_id IS NOT NULL THEN
      UPDATE public.pedido_items
      SET cantidad_entregada = cantidad_entregada + v_cantidad
      WHERE id = v_pedido_item_id AND empresa_id = p_empresa_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('entrega_id', v_entrega_id, 'numero_entrega', v_numero_entrega);
END;
$$;

REVOKE ALL ON FUNCTION public.crear_entrega(UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_entrega(UUID, UUID, UUID, JSONB) TO authenticated;


-- ── Parte 3a: crear_recepcion (camino largo, desde OC) ───────────────────
-- Espejo de crear_entrega para el flujo de Compras.
-- Post: stock incrementado + movimientos_inventario + recepcion_items +
--       contador en ordenes_compra_items.cantidad_recibida.

CREATE OR REPLACE FUNCTION public.crear_recepcion(
  p_empresa_id      UUID,
  p_user_id         UUID,
  p_orden_compra_id UUID,
  p_items           JSONB  -- [{ orden_compra_item_id, producto_id, cantidad }]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recepcion_id        UUID;
  v_numero_recepcion    TEXT;
  v_proveedor_id        UUID;
  v_item                JSONB;
  v_producto_id         UUID;
  v_cantidad            NUMERIC;
  v_oc_item_id          UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  SELECT proveedor_id INTO v_proveedor_id
  FROM public.ordenes_compra
  WHERE id = p_orden_compra_id AND empresa_id = p_empresa_id;

  IF v_proveedor_id IS NULL THEN
    RAISE EXCEPTION 'Orden de compra no encontrada o no pertenece a la empresa: %', p_orden_compra_id;
  END IF;

  v_numero_recepcion := public.siguiente_numero_documento(
    p_empresa_id, 'recepciones', 'numero_recepcion', 'REC'
  );

  INSERT INTO public.recepciones (
    empresa_id, user_id, numero_recepcion, orden_compra_id, proveedor_id,
    origen, estado, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_recepcion, p_orden_compra_id, v_proveedor_id,
    'manual', 'recibido', CURRENT_DATE
  ) RETURNING id INTO v_recepcion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC;
    v_oc_item_id  := NULLIF(v_item->>'orden_compra_item_id', '')::UUID;

    -- Aumento de stock (ingreso físico desde proveedor)
    UPDATE public.productos
    SET stock_actual = stock_actual + v_cantidad::INTEGER
    WHERE id = v_producto_id AND empresa_id = p_empresa_id;

    INSERT INTO public.movimientos_inventario (
      empresa_id, tenant_id, producto_id,
      tipo, cantidad, motivo, fecha
    ) VALUES (
      p_empresa_id, p_empresa_id, v_producto_id,
      'ingreso', v_cantidad::INTEGER,
      'Recepción ' || v_numero_recepcion,
      NOW()
    );

    INSERT INTO public.recepcion_items (
      recepcion_id, empresa_id, producto_id, cantidad, orden_compra_item_id
    ) VALUES (
      v_recepcion_id, p_empresa_id, v_producto_id, v_cantidad, v_oc_item_id
    );

    IF v_oc_item_id IS NOT NULL THEN
      UPDATE public.ordenes_compra_items
      SET cantidad_recibida = cantidad_recibida + v_cantidad
      WHERE id = v_oc_item_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('recepcion_id', v_recepcion_id, 'numero_recepcion', v_numero_recepcion);
END;
$$;

REVOKE ALL ON FUNCTION public.crear_recepcion(UUID, UUID, UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_recepcion(UUID, UUID, UUID, JSONB) TO authenticated;


-- ── Parte 3b: crear_recepcion_implicita (compras directas sin OC) ────────
-- Para compras registradas como INSERTs directos desde el frontend
-- (sin RPC crear_compra). Solo crea el registro documental —
-- NO toca stock (ya actualizado por el frontend al guardar la compra).
-- Se llamará desde el frontend en el Prompt 5 (UI Compras).

CREATE OR REPLACE FUNCTION public.crear_recepcion_implicita(
  p_empresa_id UUID,
  p_user_id    UUID,
  p_compra_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recepcion_id     UUID;
  v_numero_recepcion TEXT;
  v_proveedor_id     UUID;
  v_item             RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  SELECT proveedor_id INTO v_proveedor_id
  FROM public.compras
  WHERE id = p_compra_id AND empresa_id = p_empresa_id;

  IF v_proveedor_id IS NULL THEN
    RAISE EXCEPTION 'Compra no encontrada o no pertenece a la empresa: %', p_compra_id;
  END IF;

  v_numero_recepcion := public.siguiente_numero_documento(
    p_empresa_id, 'recepciones', 'numero_recepcion', 'REC'
  );

  INSERT INTO public.recepciones (
    empresa_id, user_id, numero_recepcion, compra_id, proveedor_id,
    origen, estado, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_recepcion, p_compra_id, v_proveedor_id,
    'implicita', 'recibido', CURRENT_DATE
  ) RETURNING id INTO v_recepcion_id;

  FOR v_item IN
    SELECT id, producto_id, cantidad
    FROM public.detalle_compras
    WHERE compra_id = p_compra_id AND empresa_id = p_empresa_id
  LOOP
    INSERT INTO public.recepcion_items (recepcion_id, empresa_id, producto_id, cantidad)
    VALUES (v_recepcion_id, p_empresa_id, v_item.producto_id, v_item.cantidad);

    UPDATE public.detalle_compras
    SET cantidad_recibida = v_item.cantidad
    WHERE id = v_item.id;
  END LOOP;

  RETURN jsonb_build_object('recepcion_id', v_recepcion_id, 'numero_recepcion', v_numero_recepcion);
END;
$$;

REVOKE ALL ON FUNCTION public.crear_recepcion_implicita(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_recepcion_implicita(UUID, UUID, UUID) TO authenticated;


-- ── Parte 4: crear_factura_desde_entrega (cierra camino largo Ventas) ────
-- Crea el comprobante/factura a partir de una Entrega ya realizada.
-- NUNCA toca stock ni movimientos_inventario (ya ocurrió en crear_entrega).
-- Lógica de facturación/pago/CC copiada íntegra de crear_venta (033→036).
--
-- p_items: [{ producto_id, cantidad, precio_unitario, subtotal, alicuota_iva,
--             pedido_item_id? }]
-- p_pagos: mismo formato que crear_venta

CREATE OR REPLACE FUNCTION public.crear_factura_desde_entrega(
  p_empresa_id       UUID,
  p_user_id          UUID,
  p_numero_venta     TEXT,
  p_fecha            TIMESTAMPTZ,
  p_entrega_id       UUID,
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
  p_caja_sesion_id   UUID
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
  v_alicuota        TEXT;
  v_factor          NUMERIC;
  v_subtotal        NUMERIC;
  v_neto_total      NUMERIC := 0;
  v_iva_total       NUMERIC := 0;
  v_entrega         RECORD;
  v_pedido_id       UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  -- Verificar que la entrega pertenece a la empresa y obtener pedido_id
  SELECT * INTO v_entrega
  FROM public.entregas
  WHERE id = p_entrega_id AND empresa_id = p_empresa_id;

  IF v_entrega IS NULL THEN
    RAISE EXCEPTION 'Entrega no encontrada o no pertenece a la empresa: %', p_entrega_id;
  END IF;

  v_pedido_id := v_entrega.pedido_id;

  -- Insertar comprobante — SIN stock, SIN movimientos_inventario
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

  -- Items: insertar comprobante_items con cantidad_entregada ya poblada
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_subtotal := (v_item->>'subtotal')::NUMERIC;
    v_alicuota := COALESCE(v_item->>'alicuota_iva', '21');

    v_factor := CASE v_alicuota
      WHEN '21'   THEN 0.21
      WHEN '10.5' THEN 0.105
      ELSE 0
    END;

    IF v_factor > 0 THEN
      v_neto_total := v_neto_total + (v_subtotal / (1 + v_factor));
      v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / (1 + v_factor)));
    ELSE
      v_neto_total := v_neto_total + v_subtotal;
    END IF;

    -- cantidad_entregada = cantidad: mercadería ya salió física en crear_entrega
    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id,
      producto_id, cantidad, precio_unitario, subtotal, alicuota_iva,
      cantidad_entregada
    ) VALUES (
      v_comprobante_id, p_empresa_id,
      (v_item->>'producto_id')::UUID,
      (v_item->>'cantidad')::INTEGER,
      (v_item->>'precio_unitario')::NUMERIC,
      v_subtotal, v_alicuota,
      (v_item->>'cantidad')::NUMERIC
    );

    -- Actualizar contador en pedido_items si viene del flujo largo (pedido → entrega → factura)
    IF (v_item->>'pedido_item_id') IS NOT NULL AND (v_item->>'pedido_item_id') != '' THEN
      UPDATE public.pedido_items
      SET cantidad_facturada = cantidad_facturada + (v_item->>'cantidad')::NUMERIC
      WHERE id = (v_item->>'pedido_item_id')::UUID AND empresa_id = p_empresa_id;
    END IF;
  END LOOP;

  UPDATE public.comprobantes
  SET neto_gravado     = ROUND(v_neto_total, 2),
      iva_discriminado = ROUND(v_iva_total, 2)
  WHERE id = v_comprobante_id;

  -- Vincular la entrega a su comprobante
  UPDATE public.entregas
  SET comprobante_id = v_comprobante_id
  WHERE id = p_entrega_id;

  -- Pagos — idéntico a crear_venta
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

  -- Cuenta Corriente — idéntico a crear_venta
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

REVOKE ALL ON FUNCTION public.crear_factura_desde_entrega(UUID,UUID,TEXT,TIMESTAMPTZ,UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,JSONB,JSONB,BOOLEAN,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_factura_desde_entrega(UUID,UUID,TEXT,TIMESTAMPTZ,UUID,UUID,TEXT,NUMERIC,TEXT,TEXT,TEXT,NUMERIC,NUMERIC,NUMERIC,JSONB,JSONB,BOOLEAN,UUID) TO authenticated;
