-- 392 — Duplicar Entregas/Recepciones + Nueva Recepción manual (Luciano, 06/09,
-- resuelve el pendiente del 14/08 que había quedado abierto a propósito por el
-- problema de que duplicar estos documentos mueve stock real).
--
-- Decisión de diseño (confirmada con Luciano): duplicar SÍ vuelve a mover stock
-- real (descuenta en Entrega, suma en Recepción) — igual que "Copiar A" en SAP
-- B1: es un nuevo evento físico real (otro envío/otra recepción), no un clon
-- inerte. La alternativa (clon sin efecto) no tiene un caso de uso real y no
-- es lo que hace SAP.
--
-- Entregas ya tenía creación standalone (crear_entrega_manual, mig.254) — acá
-- solo se agrega la columna de trazabilidad y el parámetro nuevo. Recepciones
-- NUNCA tuvo creación standalone (siempre nace de confirmar una OC o de
-- Compra Rápida, mig.324/crear_recepcion_implicita) — se agrega
-- crear_recepcion_manual nueva, mismo patrón espejado.

ALTER TABLE public.entregas    ADD COLUMN IF NOT EXISTS duplicado_de_id uuid REFERENCES public.entregas(id);
ALTER TABLE public.recepciones ADD COLUMN IF NOT EXISTS duplicado_de_id uuid REFERENCES public.recepciones(id);

-- CREATE OR REPLACE con un parámetro nuevo NO reemplaza la función vieja, crea
-- un overload huérfano (mismo gotcha que mig.308/criterio fiscal unificado) —
-- hay que DROPear la firma vieja de 5 args antes de crear la de 6.
DROP FUNCTION IF EXISTS public.crear_entrega_manual(uuid, uuid, uuid, jsonb, text);

CREATE FUNCTION public.crear_entrega_manual(
  p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_items jsonb,
  p_observaciones text DEFAULT NULL, p_duplicado_de_id uuid DEFAULT NULL
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

  IF p_duplicado_de_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.entregas WHERE id = p_duplicado_de_id AND empresa_id = p_empresa_id) THEN
      RAISE EXCEPTION 'Entrega de origen no encontrada o no pertenece a la empresa: %', p_duplicado_de_id;
    END IF;
  END IF;

  v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
  INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, cliente_id, origen, estado, fecha, observaciones, duplicado_de_id)
  VALUES (p_empresa_id, p_user_id, v_numero_entrega, p_cliente_id, 'manual', 'entregado', CURRENT_DATE, p_observaciones, p_duplicado_de_id)
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

REVOKE EXECUTE ON FUNCTION public.crear_entrega_manual(uuid, uuid, uuid, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_entrega_manual(uuid, uuid, uuid, jsonb, text, uuid) TO authenticated;

-- Recepción manual standalone — nunca existió (crear_recepcion, mig.324,
-- siempre pide una p_orden_compra_id obligatoria). Mismo patrón que
-- crear_entrega_manual, espejado: suma stock en vez de restarlo, proveedor
-- opcional en vez de cliente, sin validación de "stock insuficiente" (no
-- aplica al sumar).
CREATE FUNCTION public.crear_recepcion_manual(
  p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_items jsonb,
  p_observaciones text DEFAULT NULL, p_duplicado_de_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recepcion_id     UUID;
  v_numero_recepcion TEXT;
  v_item             JSONB;
  v_producto_id      UUID;
  v_cantidad         NUMERIC;
  v_proveedor_check  UUID;
  v_producto_check   UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La recepción necesita al menos un ítem';
  END IF;

  IF p_proveedor_id IS NOT NULL THEN
    SELECT id INTO v_proveedor_check FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id;
    IF v_proveedor_check IS NULL THEN
      RAISE EXCEPTION 'Proveedor no encontrado o no pertenece a la empresa: %', p_proveedor_id;
    END IF;
  END IF;

  IF p_duplicado_de_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.recepciones WHERE id = p_duplicado_de_id AND empresa_id = p_empresa_id) THEN
      RAISE EXCEPTION 'Recepción de origen no encontrada o no pertenece a la empresa: %', p_duplicado_de_id;
    END IF;
  END IF;

  v_numero_recepcion := public.obtener_proximo_numero(p_empresa_id, 'recepcion');
  INSERT INTO public.recepciones (empresa_id, user_id, numero_recepcion, proveedor_id, origen, estado, fecha, observaciones, duplicado_de_id)
  VALUES (p_empresa_id, p_user_id, v_numero_recepcion, p_proveedor_id, 'manual', 'recibido', CURRENT_DATE, p_observaciones, p_duplicado_de_id)
  RETURNING id INTO v_recepcion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC;

    IF v_cantidad IS NULL OR v_cantidad <= 0 THEN
      RAISE EXCEPTION 'Cantidad inválida para producto %: %', v_producto_id, v_cantidad;
    END IF;

    SELECT id INTO v_producto_check FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
    IF v_producto_check IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;

    UPDATE public.productos SET stock_actual = stock_actual + v_cantidad::INTEGER
    WHERE id = v_producto_id AND empresa_id = p_empresa_id;

    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'ingreso', v_cantidad::INTEGER, 'Recepción manual ' || v_numero_recepcion, NOW());

    INSERT INTO public.recepcion_items (recepcion_id, empresa_id, producto_id, cantidad, orden_compra_item_id)
    VALUES (v_recepcion_id, p_empresa_id, v_producto_id, v_cantidad, NULL);
  END LOOP;

  RETURN jsonb_build_object('recepcion_id', v_recepcion_id, 'numero_recepcion', v_numero_recepcion);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_recepcion_manual(uuid, uuid, uuid, jsonb, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_recepcion_manual(uuid, uuid, uuid, jsonb, text, uuid) TO authenticated;
