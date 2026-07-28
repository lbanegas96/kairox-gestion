-- migration 263 — crear_devolucion deja de generar NC automáticamente
--
-- DECISIÓN DE NEGOCIO (usuario, sesión O2C Devoluciones): una Devolución debe
-- ser una copia fiel del movimiento que anula (mismos ítems, precio y alícuota
-- de IVA reales) pero NO debe disparar sola una Nota de Crédito — "muchas veces
-- las devoluciones no se pagan con dinero". Investigado el comportamiento real
-- de SAP B1 (Return vs A/R Credit Memo son documentos alternativos según si ya
-- existe Factura, nunca uno dispara al otro) — se adapta a KAIROX manteniendo un
-- único concepto de Devolución, pero sacando la generación de NC de la RPC.
--
-- HALLAZGOS que este cambio corrige de raíz (mismo pase, no ameritan una
-- migration aparte porque comparten la causa: la rama de NC dentro de esta RPC
-- duplicaba —mal— lo que crear_nota_credito ya hace bien):
--   1. La NC que generaba esta rama NUNCA se encolaba a AFIP (a diferencia de
--      NuevaNCModal, que sí setea cae_estado='pendiente' cuando corresponde) —
--      quedaba para siempre como comprobante no fiscal.
--   2. Esa NC siempre asumía IVA 21% por ítem (default de la columna) sin
--      importar la alícuota real, y nunca completaba neto_gravado/iva_discriminado
--      en el comprobante — distorsionaba el Libro IVA.
--
-- FIX: se saca por completo la creación de comprobante-NC (rama cliente) y el
-- INSERT en cuenta_corriente_proveedores (rama proveedor) de esta función.
-- `compensacion` queda siempre 'pendiente' al crear la devolución — pasa a ser
-- un ESTADO QUE SE ACTUALIZA DESPUÉS, cuando el usuario elige explícitamente
-- generar una NC (crear_nota_credito con el nuevo parámetro p_devolucion_id,
-- mig.264) desde el detalle de la Devolución. `reembolso_efectivo` (caja) se
-- independiza de `compensacion` — es una acción legítima que puede pasar en el
-- momento sin que eso implique nunca una NC fiscal.
--
-- alicuota_iva ahora viaja en cada ítem del payload (copiada por el frontend
-- desde comprobante_items/detalle_compras de origen — mig.262 le dio dónde
-- guardarse) y se persiste en devolucion_items.
--
-- DROP explícito: se elimina el parámetro p_compensacion — CREATE OR REPLACE
-- con distinta firma crea una sobrecarga ambigua en vez de reemplazar (lección
-- de mig.169).

DROP FUNCTION IF EXISTS public.crear_devolucion(uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, boolean, text, boolean, text);

CREATE OR REPLACE FUNCTION public.crear_devolucion(
  p_empresa_id         uuid,
  p_user_id            uuid,
  p_tipo               text,
  p_items              jsonb,
  p_entrega_id         uuid DEFAULT NULL::uuid,
  p_recepcion_id       uuid DEFAULT NULL::uuid,
  p_comprobante_id     uuid DEFAULT NULL::uuid,
  p_compra_id          uuid DEFAULT NULL::uuid,
  p_cliente_id         uuid DEFAULT NULL::uuid,
  p_proveedor_id       uuid DEFAULT NULL::uuid,
  p_reingresa_stock    boolean DEFAULT false,
  p_reembolso_efectivo boolean DEFAULT false,
  p_motivo             text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_devolucion_id UUID; v_numero_dev TEXT; v_item JSONB; v_producto_id UUID; v_cantidad NUMERIC;
  v_precio_unit NUMERIC; v_subtotal NUMERIC; v_total_dev NUMERIC := 0; v_alicuota TEXT;
  v_caja_sesion_id UUID; v_stock_actual_dev NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF NOT (has_module_permission('ventas') OR has_module_permission('compras')) THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas o compras';
  END IF;
  v_numero_dev := public.obtener_proximo_numero(p_empresa_id, 'devolucion');
  INSERT INTO public.devoluciones (empresa_id, user_id, numero_devolucion, tipo, entrega_id, recepcion_id, comprobante_id, compra_id, cliente_id, proveedor_id, reingresa_stock, compensacion, reembolso_efectivo, motivo)
  VALUES (p_empresa_id, p_user_id, v_numero_dev, p_tipo, p_entrega_id, p_recepcion_id, p_comprobante_id, p_compra_id, p_cliente_id, p_proveedor_id, p_reingresa_stock, 'pendiente', p_reembolso_efectivo, p_motivo)
  RETURNING id INTO v_devolucion_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID; v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio_unit := (v_item->>'precio_unitario')::NUMERIC; v_subtotal := v_cantidad * v_precio_unit; v_total_dev := v_total_dev + v_subtotal;
    v_alicuota := COALESCE(v_item->>'alicuota_iva', '21');
    INSERT INTO public.devolucion_items (devolucion_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva, comprobante_item_id, detalle_compra_item_id)
    VALUES (v_devolucion_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unit, v_subtotal, v_alicuota, NULLIF(v_item->>'comprobante_item_id', '')::UUID, NULLIF(v_item->>'detalle_compra_item_id', '')::UUID);
    IF (v_item->>'comprobante_item_id') IS NOT NULL AND (v_item->>'comprobante_item_id') <> '' THEN
      UPDATE public.comprobante_items SET cantidad_devuelta = cantidad_devuelta + v_cantidad WHERE id = (v_item->>'comprobante_item_id')::UUID;
    END IF;
    IF (v_item->>'detalle_compra_item_id') IS NOT NULL AND (v_item->>'detalle_compra_item_id') <> '' THEN
      UPDATE public.detalle_compras SET cantidad_devuelta = cantidad_devuelta + v_cantidad WHERE id = (v_item->>'detalle_compra_item_id')::UUID;
    END IF;
    IF p_reingresa_stock THEN
      IF p_tipo = 'cliente' THEN
        UPDATE public.productos SET stock_actual = stock_actual + v_cantidad WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
        VALUES (p_empresa_id, v_producto_id, 'ingreso', v_cantidad::INTEGER, 'Devolucion cliente ' || v_numero_dev, p_user_id);
      ELSE
        SELECT stock_actual INTO v_stock_actual_dev FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', v_producto_id; END IF;
        IF COALESCE(v_stock_actual_dev, 0) - v_cantidad < 0 THEN RAISE EXCEPTION 'Stock insuficiente para devolver al proveedor el producto: %', v_producto_id; END IF;
        UPDATE public.productos SET stock_actual = stock_actual - v_cantidad WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
        VALUES (p_empresa_id, v_producto_id, 'salida', v_cantidad::INTEGER, 'Devolucion a proveedor ' || v_numero_dev, p_user_id);
      END IF;
    END IF;
  END LOOP;

  -- Reembolso en efectivo — independiente de cómo se termine compensando la
  -- devolución (si nunca se genera NC, esto puede ser la única compensación).
  IF p_reembolso_efectivo THEN
    SELECT id INTO v_caja_sesion_id FROM public.caja_sesiones WHERE empresa_id = p_empresa_id AND estado = 'abierta' ORDER BY apertura_fecha DESC LIMIT 1;
    IF v_caja_sesion_id IS NULL THEN RAISE EXCEPTION 'Caja cerrada: abri la caja para procesar reembolsos en efectivo'; END IF;
    INSERT INTO public.movimientos_caja (empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
    VALUES (p_empresa_id, p_user_id, v_caja_sesion_id, CASE WHEN p_tipo = 'cliente' THEN 'egreso' ELSE 'ingreso' END, 'Devoluciones', 'Reembolso devolucion ' || v_numero_dev, v_total_dev, 'Efectivo', TRUE);
  END IF;

  RETURN jsonb_build_object('devolucion_id', v_devolucion_id, 'numero_devolucion', v_numero_dev, 'total', v_total_dev);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_devolucion(uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, boolean, boolean, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_devolucion(uuid, uuid, text, jsonb, uuid, uuid, uuid, uuid, uuid, uuid, boolean, boolean, text) TO authenticated;

-- ROLLBACK (comentado): restaurar el body de migration 199 (con p_compensacion
-- y la rama de creación automática de NC).
