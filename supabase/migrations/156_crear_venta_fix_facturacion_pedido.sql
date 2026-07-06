-- ════════════════════════════════════════════════════════════════════════════
-- migration 156 — crear_venta: fix sobre-facturación de pedidos + doble
-- descuento de stock (hallazgo sesión 48, Nadia, Bloque 5 de PLAN_PRUEBAS_
-- NADIA_2026-07-04.md)
-- ════════════════════════════════════════════════════════════════════════════
--
-- HALLAZGO: "Facturar pedido" (TablaPedidos → handleFacturarPedido →
-- NuevaVentaModal con prop `pedido` → crear_venta con p_pedido_id) tenía tres
-- defectos de Document Flow (viola la Regla 8 de SAP-reference: "el stock se
-- mueve UNA SOLA VEZ, en el evento físico"):
--
--   1) El loop de ítems descontaba stock_actual e insertaba movimientos_
--      inventario 'salida' de forma INCONDICIONAL, sin chequear si el pedido
--      ya había pasado por un Generar Entrega (crear_entrega) que ya movió
--      ese stock. Resultado: 2 descuentos de stock por la misma mercadería.
--   2) No existía ningún tope entre la cantidad a facturar y lo realmente
--      entregado (pedido_items.cantidad_entregada) ni lo ya facturado
--      (cantidad_facturada) — se podía facturar más de lo pedido/entregado
--      sin ningún error.
--   3) pedidos.comprobante_id (columna existente en schema, nunca escrita)
--      nunca se vinculaba — el pedido facturado quedaba sin trazabilidad
--      directa hacia el comprobante generado.
--
-- FIX (mismo criterio que crear_entrega, migration 139):
--   - Antes del loop, si p_pedido_id IS NOT NULL, se busca si ya existe una
--     Entrega manual 'entregado' para ese pedido (v_entrega_manual_id).
--   - Por cada ítem que matchea un pedido_item (mismo producto_id), se topea
--     la cantidad a facturar:
--       · si YA hubo entrega manual → tope = cantidad_entregada - cantidad_facturada
--         (no se puede facturar lo no entregado) y el stock NO se vuelve a
--         mover (ya lo hizo crear_entrega).
--       · si NUNCA hubo entrega manual → tope = cantidad - cantidad_facturada
--         (factura implica entrega ahora, comportamiento previo preservado)
--         y el stock SÍ se mueve (entrega implícita, como antes).
--   - Ítems que no matchean ningún pedido_item (productos agregados a mano
--     al carrito pre-cargado) siempre mueven stock — no fueron entregados
--     por ningún camino.
--   - Se actualiza pedido_items.cantidad_facturada por ítem facturado.
--   - Se vincula pedidos.comprobante_id al comprobante recién creado.
--
-- Nota de alcance: se asume que un pedido se factura en una sola operación
-- (pedidos.comprobante_id es una columna singular, y el estado 'facturado'
-- saca el botón "Facturar" de la UI — TablaPedidos.jsx). No se modela
-- facturación parcial de un mismo pedido en múltiples comprobantes.
--
-- ROLLBACK: recrear crear_venta como en migration 123 (sin los bloques de
-- validación/tope contra pedido_items ni el UPDATE de pedidos.comprobante_id).

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
  v_precio_unitario        NUMERIC;
  v_precio_original        NUMERIC;
  v_descuento_pct          NUMERIC;
  v_descuento_monto_item   NUMERIC;
  v_oferta_id              UUID;
  v_descuento_manual_pct   NUMERIC;
  v_descuento_global_monto NUMERIC := 0;
  v_descuento_global_pct   NUMERIC := 0;
  v_bruto_total            NUMERIC := 0;
  v_total                  NUMERIC;
  v_pedido_item_id         UUID;
  v_ped_cantidad           NUMERIC;
  v_ped_entregada          NUMERIC;
  v_ped_facturada          NUMERIC;
  v_max_facturable         NUMERIC;
  v_mueve_stock            BOOLEAN;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  -- Redondeo defensivo: el total llega calculado en JS (punto flotante), puede traer
  -- ruido de 1e-14 en combinaciones precio*cantidad comunes.
  v_total := ROUND(p_total, 2);

  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito INTO v_dias_credito
    FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
  END IF;
  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);

  -- Si la venta viene de un Pedido, determinar ANTES del loop si ya hubo una
  -- Entrega manual previa: si la hubo, el stock de esos ítems ya se movió en
  -- crear_entrega y NO debe volver a moverse acá (Regla 8 SAP-reference).
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

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha,
    cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa,
    monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha,
    p_cliente_id, p_cliente_nombre, v_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa,
    p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento
  )
  RETURNING id INTO v_comprobante_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');

    v_precio_unitario      := ROUND((v_item->>'precio_unitario')::NUMERIC, 2);
    v_precio_original      := ROUND(COALESCE((v_item->>'precio_original')::NUMERIC,
                                              (v_item->>'precio_unitario')::NUMERIC), 2);
    v_descuento_pct        := COALESCE((v_item->>'descuento_pct')::NUMERIC, 0);
    v_descuento_monto_item := ROUND(COALESCE((v_item->>'descuento_monto')::NUMERIC, 0), 2);
    v_oferta_id            := NULLIF(v_item->>'oferta_id', '')::UUID;
    v_descuento_manual_pct := COALESCE((v_item->>'descuento_manual_pct')::NUMERIC, 0);

    -- ── Validación contra el Pedido origen (sobre-facturación) ──────────────
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
          -- Ya hubo entrega explícita: no se puede facturar más de lo entregado,
          -- y el stock de este ítem ya se movió en esa entrega.
          v_max_facturable := COALESCE(v_ped_entregada, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := FALSE;
        ELSE
          -- Nunca hubo entrega: facturar implica entregar ahora (comportamiento
          -- histórico) — tope = lo pedido, el stock sí se mueve acá.
          v_max_facturable := COALESCE(v_ped_cantidad, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := TRUE;
        END IF;

        IF v_cantidad > v_max_facturable THEN
          RAISE EXCEPTION 'Cantidad a facturar (%) supera lo disponible para el producto % del pedido (máximo facturable: %)',
            v_cantidad, v_producto_id, v_max_facturable;
        END IF;

        UPDATE public.pedido_items
        SET cantidad_facturada = COALESCE(cantidad_facturada, 0) + v_cantidad
        WHERE id = v_pedido_item_id;
      END IF;
    END IF;

    IF v_mueve_stock THEN
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
    END IF;

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
      v_cantidad, v_precio_unitario,
      v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item,
      v_oferta_id, v_descuento_manual_pct
    );

    v_descuento_global_monto := v_descuento_global_monto
                                + (v_descuento_monto_item * v_cantidad);
    v_bruto_total := v_bruto_total + (v_precio_original * v_cantidad);

    IF v_mueve_stock THEN
      INSERT INTO public.movimientos_inventario (
        empresa_id, tenant_id, producto_id,
        tipo, cantidad, motivo, fecha
      ) VALUES (
        p_empresa_id, p_empresa_id, v_producto_id,
        'salida', v_cantidad,
        'Venta #' || p_numero_venta,
        p_fecha
      );
    END IF;
  END LOOP;

  v_descuento_global_pct := CASE
    WHEN v_bruto_total > 0
    THEN ROUND(v_descuento_global_monto / v_bruto_total * 100, 2)
    ELSE 0
  END;

  UPDATE public.comprobantes
  SET neto_gravado     = ROUND(v_neto_total, 2),
      iva_discriminado = ROUND(v_iva_total, 2),
      descuento_global_monto = ROUND(v_descuento_global_monto, 2),
      descuento_global_pct = v_descuento_global_pct
  WHERE id = v_comprobante_id;

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

  -- Vincular el pedido con el comprobante recién generado (trazabilidad
  -- Document Flow — pedidos.comprobante_id existía en schema pero nunca se
  -- escribía).
  IF p_pedido_id IS NOT NULL THEN
    UPDATE public.pedidos
    SET comprobante_id = v_comprobante_id
    WHERE id = p_pedido_id AND comprobante_id IS NULL;
  END IF;

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
        ROUND((v_pago->>'monto')::NUMERIC, 2),
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
      'DEBE', v_total,
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
