-- Gap #5 de la comparación con SAP Entrega: hoy una Entrega SOLO puede
-- nacer de un Pedido (crear_entrega, requiere p_pedido_id) o implícitamente
-- del POS — nunca standalone, violando el principio SAP de que todo
-- documento debe poder crearse de forma independiente. Caso real: mercadería
-- que sale sin que exista un Pedido formal (ej. entrega urgente, corrección
-- manual de stock documentada).
--
-- Función nueva (no se toca crear_entrega, que sigue siendo la única vía
-- para entregas atadas a un Pedido, con su propia validación de sobre-entrega).
CREATE OR REPLACE FUNCTION public.crear_entrega_manual(
  p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_items jsonb, p_observaciones text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entrega_id    UUID;
  v_numero_entrega TEXT;
  v_item          JSONB;
  v_stock_actual  INTEGER;
  v_producto_id   UUID;
  v_cantidad      NUMERIC;
  v_cliente_check UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La entrega necesita al menos un ítem';
  END IF;

  IF p_cliente_id IS NOT NULL THEN
    SELECT id INTO v_cliente_check FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
    IF v_cliente_check IS NULL THEN
      RAISE EXCEPTION 'Cliente no encontrado o no pertenece a la empresa: %', p_cliente_id;
    END IF;
  END IF;

  v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
  INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, cliente_id, origen, estado, fecha, observaciones)
  VALUES (p_empresa_id, p_user_id, v_numero_entrega, p_cliente_id, 'manual', 'entregado', CURRENT_DATE, p_observaciones)
  RETURNING id INTO v_entrega_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC;

    SELECT stock_actual INTO v_stock_actual FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
    IF v_stock_actual IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;
    IF v_stock_actual < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para producto %. Disponible: %, Solicitado: %', v_producto_id, v_stock_actual, v_cantidad;
    END IF;

    UPDATE public.productos SET stock_actual = stock_actual - v_cantidad::INTEGER
    WHERE id = v_producto_id AND empresa_id = p_empresa_id;

    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'salida', v_cantidad::INTEGER, 'Entrega manual ' || v_numero_entrega, NOW());

    INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad, pedido_item_id)
    VALUES (v_entrega_id, p_empresa_id, v_producto_id, v_cantidad, NULL);
  END LOOP;

  RETURN jsonb_build_object('entrega_id', v_entrega_id, 'numero_entrega', v_numero_entrega);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_entrega_manual(uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_entrega_manual(uuid, uuid, uuid, jsonb, text) TO authenticated;
