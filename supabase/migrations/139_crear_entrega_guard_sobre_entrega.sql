-- ════════════════════════════════════════════════════════════════════════════
-- migration 139 — Auditoria area #12 (Cotizaciones / Pedidos)
-- crear_entrega: guard contra sobre-entrega (cantidad_entregada > cantidad_pedida)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Hallazgo (confirmado con BEGIN...ROLLBACK): crear_entrega solo validaba stock
-- disponible, no que la entrega respetara lo pedido. Se pudo generar una 2da
-- entrega de 5 unidades sobre un pedido_item de cantidad=5 ya entregado por
-- completo, dejando cantidad_entregada=10 (el doble de lo pedido) sin ningun
-- error. Rompe el invariante de Document Flow (cantidad_entregada <=
-- cantidad_pedida) del que dependen Pedidos/Entregas/Facturacion.
--
-- Fix: cuando el item de entrega referencia un pedido_item_id, validar que
-- cantidad_entregada + cantidad_a_entregar no supere pedido_items.cantidad
-- (con FOR UPDATE para que sea consistente bajo concurrencia).

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
  v_cant_pedida    NUMERIC;
  v_cant_entregada NUMERIC;
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

    IF v_pedido_item_id IS NOT NULL THEN
      SELECT cantidad, cantidad_entregada INTO v_cant_pedida, v_cant_entregada
      FROM public.pedido_items
      WHERE id = v_pedido_item_id AND empresa_id = p_empresa_id
      FOR UPDATE;

      IF v_cant_pedida IS NULL THEN
        RAISE EXCEPTION 'Ítem de pedido no encontrado: %', v_pedido_item_id;
      END IF;

      IF COALESCE(v_cant_entregada, 0) + v_cantidad > v_cant_pedida THEN
        RAISE EXCEPTION 'Sobre-entrega: el ítem tiene % pedido(s) y ya se entregaron %. No se puede entregar % más.',
          v_cant_pedida, COALESCE(v_cant_entregada, 0), v_cantidad;
      END IF;
    END IF;

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
