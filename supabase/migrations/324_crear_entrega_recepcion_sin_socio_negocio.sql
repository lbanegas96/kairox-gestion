-- 324 — Bug real (14/08, encontrado probando en vivo con Luciano):
-- no se podía generar una Entrega de un pedido SIN cliente, ni una Recepción
-- de una OC SIN proveedor_id, y el error mentía diciendo que el documento
-- "no existe o no pertenece a la empresa".
--
-- Causa: ambas funciones usaban el valor del socio de negocio como prueba de
-- existencia de la fila:
--
--   SELECT cliente_id INTO v_cliente_id FROM pedidos WHERE id = ... ;
--   IF v_cliente_id IS NULL THEN RAISE EXCEPTION 'Pedido no encontrado...';
--
-- Pero cliente_id/proveedor_id son NULL legítimamente (KAIROX permite crear
-- pedidos y OC con el socio de negocio en texto libre, "Sin cliente"), así que
-- un documento perfectamente válido disparaba el error de "no encontrado".
--
-- Fix: separar las dos preguntas — FOUND responde "¿existe la fila?", y el
-- valor del socio de negocio se deja pasar tal cual (NULL incluido), que es lo
-- que las tablas entregas/recepciones ya aceptan.
--
-- Nada más del cuerpo cambia respecto de la versión en producción.

CREATE OR REPLACE FUNCTION public.crear_entrega(p_empresa_id uuid, p_user_id uuid, p_pedido_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entrega_id UUID; v_numero_entrega TEXT; v_cliente_id UUID; v_item JSONB; v_stock_actual INTEGER;
  v_producto_id UUID; v_cantidad NUMERIC; v_pedido_item_id UUID; v_cant_pedida NUMERIC; v_cant_entregada NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  -- FOUND, no "v_cliente_id IS NULL": un pedido sin cliente es válido.
  SELECT cliente_id INTO v_cliente_id FROM public.pedidos WHERE id = p_pedido_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado o no pertenece a la empresa: %', p_pedido_id; END IF;
  v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
  INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, pedido_id, cliente_id, origen, estado, fecha)
  VALUES (p_empresa_id, p_user_id, v_numero_entrega, p_pedido_id, v_cliente_id, 'manual', 'entregado', CURRENT_DATE) RETURNING id INTO v_entrega_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID; v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_pedido_item_id := NULLIF(v_item->>'pedido_item_id', '')::UUID;
    IF v_pedido_item_id IS NOT NULL THEN
      SELECT cantidad, cantidad_entregada INTO v_cant_pedida, v_cant_entregada FROM public.pedido_items WHERE id = v_pedido_item_id AND empresa_id = p_empresa_id FOR UPDATE;
      IF v_cant_pedida IS NULL THEN RAISE EXCEPTION 'Ítem de pedido no encontrado: %', v_pedido_item_id; END IF;
      IF COALESCE(v_cant_entregada, 0) + v_cantidad > v_cant_pedida THEN
        RAISE EXCEPTION 'Sobre-entrega: el ítem tiene % pedido(s) y ya se entregaron %. No se puede entregar % más.', v_cant_pedida, COALESCE(v_cant_entregada, 0), v_cantidad;
      END IF;
    END IF;
    SELECT stock_actual INTO v_stock_actual FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
    IF v_stock_actual IS NULL THEN RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id; END IF;
    IF v_stock_actual < v_cantidad THEN RAISE EXCEPTION 'Stock insuficiente para producto %. Disponible: %, Solicitado: %', v_producto_id, v_stock_actual, v_cantidad; END IF;
    UPDATE public.productos SET stock_actual = stock_actual - v_cantidad::INTEGER WHERE id = v_producto_id AND empresa_id = p_empresa_id;
    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'salida', v_cantidad::INTEGER, 'Entrega ' || v_numero_entrega, NOW());
    INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad, pedido_item_id)
    VALUES (v_entrega_id, p_empresa_id, v_producto_id, v_cantidad, v_pedido_item_id);
    IF v_pedido_item_id IS NOT NULL THEN
      UPDATE public.pedido_items SET cantidad_entregada = cantidad_entregada + v_cantidad WHERE id = v_pedido_item_id AND empresa_id = p_empresa_id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('entrega_id', v_entrega_id, 'numero_entrega', v_numero_entrega);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_recepcion(p_empresa_id uuid, p_user_id uuid, p_orden_compra_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recepcion_id UUID; v_numero_recepcion TEXT; v_proveedor_id UUID; v_item JSONB; v_producto_id UUID;
  v_cantidad NUMERIC; v_oc_item_id UUID; v_cantidad_pedida NUMERIC; v_cantidad_recibida_actual NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras'; END IF;
  -- Mismo bug que crear_entrega: una OC con el proveedor en texto libre
  -- (proveedor_id NULL) es válida y debe poder recibirse.
  SELECT proveedor_id INTO v_proveedor_id FROM public.ordenes_compra WHERE id = p_orden_compra_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden de compra no encontrada o no pertenece a la empresa: %', p_orden_compra_id; END IF;
  v_numero_recepcion := public.obtener_proximo_numero(p_empresa_id, 'recepcion');
  INSERT INTO public.recepciones (empresa_id, user_id, numero_recepcion, orden_compra_id, proveedor_id, origen, estado, fecha)
  VALUES (p_empresa_id, p_user_id, v_numero_recepcion, p_orden_compra_id, v_proveedor_id, 'manual', 'recibido', CURRENT_DATE) RETURNING id INTO v_recepcion_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID; v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_oc_item_id := NULLIF(v_item->>'orden_compra_item_id', '')::UUID;
    IF v_oc_item_id IS NOT NULL THEN
      SELECT cantidad_pedida, cantidad_recibida INTO v_cantidad_pedida, v_cantidad_recibida_actual FROM public.ordenes_compra_items WHERE id = v_oc_item_id FOR UPDATE;
      IF v_cantidad_recibida_actual + v_cantidad > v_cantidad_pedida THEN
        RAISE EXCEPTION 'La cantidad a recibir (%) superaria lo pedido para el item % (pedido: %, ya recibido: %)', v_cantidad, v_oc_item_id, v_cantidad_pedida, v_cantidad_recibida_actual;
      END IF;
    END IF;
    IF v_oc_item_id IS NULL THEN
      UPDATE public.productos SET stock_actual = stock_actual + v_cantidad::INTEGER WHERE id = v_producto_id AND empresa_id = p_empresa_id;
    END IF;
    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'ingreso', v_cantidad::INTEGER, 'Recepción ' || v_numero_recepcion, NOW());
    INSERT INTO public.recepcion_items (recepcion_id, empresa_id, producto_id, cantidad, orden_compra_item_id)
    VALUES (v_recepcion_id, p_empresa_id, v_producto_id, v_cantidad, v_oc_item_id);
    IF v_oc_item_id IS NOT NULL THEN
      UPDATE public.ordenes_compra_items SET cantidad_recibida = cantidad_recibida + v_cantidad WHERE id = v_oc_item_id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('recepcion_id', v_recepcion_id, 'numero_recepcion', v_numero_recepcion);
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_entrega(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_entrega(uuid, uuid, uuid, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.crear_recepcion(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_recepcion(uuid, uuid, uuid, jsonb) TO authenticated;
