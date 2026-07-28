-- Gap #2 de la comparación con SAP Entrega: 'anulado' está definido como
-- estado válido (entregas_estado_check) desde siempre pero no existe
-- ninguna función ni UI que lo alcance — mismo patrón de estado "fantasma"
-- que encontramos y cerramos en Cotizaciones.
--
-- A diferencia de Cotización, anular una Entrega tiene efectos reales que
-- hay que revertir simétricamente a como los aplica crear_entrega():
--   1. productos.stock_actual  (crear_entrega resta, acá se repone)
--   2. movimientos_inventario  (se registra el reverso, nunca se borra el
--      movimiento original — trazabilidad de auditoría)
--   3. pedido_items.cantidad_entregada (crear_entrega suma, acá se resta)
--
-- Bloqueo: si la entrega ya tiene comprobante_id (fue facturada), NO se
-- puede anular acá — la factura ya registró esos ítems como vendidos;
-- hay que anular/notacreditar la factura primero. Evita que el stock quede
-- revertido mientras la factura sigue viva con esos ítems facturados.
CREATE OR REPLACE FUNCTION public.anular_entrega(p_empresa_id uuid, p_user_id uuid, p_entrega_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entrega RECORD;
  v_item    RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_entrega
  FROM public.entregas
  WHERE id = p_entrega_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entrega no encontrada';
  END IF;
  IF v_entrega.estado = 'anulado' THEN
    RAISE EXCEPTION 'Esta entrega ya está anulada';
  END IF;
  IF v_entrega.comprobante_id IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede anular: esta entrega ya fue facturada. Anulá o generá una nota de crédito sobre esa factura primero.';
  END IF;

  FOR v_item IN
    SELECT * FROM public.entrega_items WHERE entrega_id = p_entrega_id AND empresa_id = p_empresa_id
  LOOP
    UPDATE public.productos
    SET stock_actual = stock_actual + v_item.cantidad::INTEGER
    WHERE id = v_item.producto_id AND empresa_id = p_empresa_id;

    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_item.producto_id, 'entrada', v_item.cantidad::INTEGER,
            'Anulación de Entrega ' || v_entrega.numero_entrega, NOW());

    IF v_item.pedido_item_id IS NOT NULL THEN
      UPDATE public.pedido_items
      SET cantidad_entregada = GREATEST(0, cantidad_entregada - v_item.cantidad)
      WHERE id = v_item.pedido_item_id AND empresa_id = p_empresa_id;
    END IF;
  END LOOP;

  UPDATE public.entregas
  SET estado = 'anulado'
  WHERE id = p_entrega_id;

  RETURN jsonb_build_object('entrega_id', p_entrega_id, 'numero_entrega', v_entrega.numero_entrega);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.anular_entrega(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.anular_entrega(uuid, uuid, uuid) TO authenticated;
