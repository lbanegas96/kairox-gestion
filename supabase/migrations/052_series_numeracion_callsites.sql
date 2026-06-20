-- =============================================================================
-- MIGRATION 052 — Migrar call-sites SQL a obtener_proximo_numero()
-- =============================================================================
-- Reemplaza, dentro de las RPCs existentes, el único punto donde generaban su
-- número (antes via siguiente_numero_documento(), que usaba COUNT(*) sin lock —
-- vulnerable a duplicados/saltos si se llamaba dos veces casi en simultáneo, o
-- tras borrar una fila). El resto de la lógica de negocio de cada función
-- (stock, items, cuenta corriente) queda exactamente igual, sin tocar.
--
-- siguiente_numero_documento() NO se borra ni se modifica: la sigue usando
-- crear_devolucion() para 'devolucion', que no está en el alcance de esta tarea.
-- =============================================================================

-- crear_entrega: ENT-YYYY-NNNN
CREATE OR REPLACE FUNCTION public.crear_entrega(p_empresa_id uuid, p_user_id uuid, p_pedido_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');

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
$function$;

-- crear_recepcion: REC-YYYY-NNNN
CREATE OR REPLACE FUNCTION public.crear_recepcion(p_empresa_id uuid, p_user_id uuid, p_orden_compra_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recepcion_id     UUID;
  v_numero_recepcion TEXT;
  v_proveedor_id     UUID;
  v_item             JSONB;
  v_producto_id      UUID;
  v_cantidad         NUMERIC;
  v_oc_item_id       UUID;
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

  v_numero_recepcion := public.obtener_proximo_numero(p_empresa_id, 'recepcion');

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
$function$;

-- crear_recepcion_implicita: REC-YYYY-NNNN (mismo contador que crear_recepcion)
CREATE OR REPLACE FUNCTION public.crear_recepcion_implicita(p_empresa_id uuid, p_user_id uuid, p_compra_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  v_numero_recepcion := public.obtener_proximo_numero(p_empresa_id, 'recepcion');

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
$function$;

-- crear_nota_debito: ND-YYYY-NNNN
CREATE OR REPLACE FUNCTION public.crear_nota_debito(
  p_empresa_id uuid, p_user_id uuid, p_tipo text, p_concepto text, p_monto numeric,
  p_comprobante_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid,
  p_cliente_id uuid DEFAULT NULL::uuid, p_proveedor_id uuid DEFAULT NULL::uuid,
  p_moneda text DEFAULT 'ARS'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nd_id     UUID;
  v_numero_nd TEXT;
  v_cc_id     UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_numero_nd := public.obtener_proximo_numero(p_empresa_id, 'nota_debito');

  INSERT INTO public.notas_debito (
    empresa_id, user_id, numero_nd, tipo,
    comprobante_id, compra_id, cliente_id, proveedor_id,
    concepto, monto, moneda
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_nd, p_tipo,
    p_comprobante_id, p_compra_id, p_cliente_id, p_proveedor_id,
    p_concepto, p_monto, p_moneda
  ) RETURNING id INTO v_nd_id;

  -- ND emitida al cliente → cliente nos debe más → CC DEBE
  IF p_tipo = 'emitida' AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, cliente_id, tipo, monto, descripcion, comprobante_id
    ) VALUES (
      p_empresa_id, p_cliente_id, 'DEBE', p_monto,
      'ND ' || v_numero_nd || ' - ' || p_concepto,
      p_comprobante_id
    ) RETURNING id INTO v_cc_id;

    UPDATE public.notas_debito SET cc_movimiento_id = v_cc_id WHERE id = v_nd_id;
  END IF;

  RETURN jsonb_build_object('nota_debito_id', v_nd_id, 'numero_nd', v_numero_nd);
END;
$function$;
