-- migration 394 — Nueva Recepción manual: agrega Fecha de recepción
-- (hallazgo Luciano 11/09, restructurando ModalNuevaRecepcion.jsx para que
-- tenga más datos, igual que Nueva OC tiene "Entrega esperada"): la fecha
-- quedaba hardcodeada a CURRENT_DATE en crear_recepcion_manual (mig.392), sin
-- forma de backdatear una recepción que físicamente pasó otro día.
--
-- CREATE OR REPLACE con un parámetro nuevo NO reemplaza la función existente,
-- crea un overload nuevo (lección ya aprendida en mig.294/295/296) — se hace
-- DROP explícito de la firma vieja antes de crear la nueva.

DROP FUNCTION IF EXISTS public.crear_recepcion_manual(uuid, uuid, uuid, jsonb, text, uuid);

CREATE FUNCTION public.crear_recepcion_manual(
  p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_items jsonb,
  p_observaciones text DEFAULT NULL, p_duplicado_de_id uuid DEFAULT NULL,
  p_fecha date DEFAULT NULL
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

  -- Backdatear se permite (recepción física de días anteriores) — pero no
  -- adelantar: no tiene sentido registrar mercadería recibida a futuro.
  IF p_fecha IS NOT NULL AND p_fecha > CURRENT_DATE THEN
    RAISE EXCEPTION 'La fecha de recepción no puede ser futura';
  END IF;

  v_numero_recepcion := public.obtener_proximo_numero(p_empresa_id, 'recepcion');
  INSERT INTO public.recepciones (empresa_id, user_id, numero_recepcion, proveedor_id, origen, estado, fecha, observaciones, duplicado_de_id)
  VALUES (p_empresa_id, p_user_id, v_numero_recepcion, p_proveedor_id, 'manual', 'recibido', COALESCE(p_fecha, CURRENT_DATE), p_observaciones, p_duplicado_de_id)
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

REVOKE EXECUTE ON FUNCTION public.crear_recepcion_manual(uuid, uuid, uuid, jsonb, text, uuid, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_recepcion_manual(uuid, uuid, uuid, jsonb, text, uuid, date) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.crear_recepcion_manual(uuid, uuid, uuid, jsonb, text, uuid, date);
-- (para restaurar la versión sin p_fecha: ver mig.392)
