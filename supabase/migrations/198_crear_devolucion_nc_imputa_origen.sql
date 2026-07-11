-- Migration 198 — crear_devolucion (rama compensación=nota_credito, sin reembolso
-- en efectivo) debe imputar contra la factura de origen — mismo gap de mig.197,
-- pero en una copia de la lógica de NC que vive DENTRO de crear_devolucion en vez
-- de reusar crear_nota_credito (sesión 60 cont., 2026-07-11).
--
-- crear_devolucion tiene su PROPIA lógica inline para crear una NC cuando
-- p_compensacion='nota_credito' — no llama a crear_nota_credito(), así que el fix
-- de mig.197 no la cubre. Cuando el reembolso NO es en efectivo
-- (p_reembolso_efectivo=false), inserta un HABER en cuenta_corriente_movimientos
-- pero nunca imputa contra p_comprobante_id (la factura de origen).
--
-- Impacto real verificado: de 5 devoluciones históricas con NC, 4 tienen
-- reembolso_efectivo=true (correctamente NO tocan el ledger de CC — son
-- reembolsos en efectivo, no crédito a cuenta corriente, comportamiento
-- correcto). Solo 1 caso real usa reembolso_efectivo=false, y ese YA quedó
-- corregido por el backfill de mig.197 (coincide con una de las 5 facturas
-- backfillleadas). No hace falta backfill adicional — este fix es solo hacia
-- adelante, para que la próxima devolución con esta combinación no repita el bug.
--
-- Fix: mismo patrón que mig.197 — capturar el id del HABER insertado, calcular
-- saldo pendiente de la factura de origen, imputar topado
-- (LEAST(total_dev, GREATEST(saldo_pendiente, 0))), sincronizar estado_pago.
-- Copia fiel del resto de la función (pg_get_functiondef).

CREATE OR REPLACE FUNCTION public.crear_devolucion(p_empresa_id uuid, p_user_id uuid, p_tipo text, p_items jsonb, p_entrega_id uuid DEFAULT NULL::uuid, p_recepcion_id uuid DEFAULT NULL::uuid, p_comprobante_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_proveedor_id uuid DEFAULT NULL::uuid, p_reingresa_stock boolean DEFAULT false, p_compensacion text DEFAULT 'pendiente'::text, p_reembolso_efectivo boolean DEFAULT false, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_devolucion_id UUID; v_numero_dev TEXT; v_item JSONB; v_producto_id UUID; v_cantidad NUMERIC;
  v_precio_unit NUMERIC; v_subtotal NUMERIC; v_total_dev NUMERIC := 0; v_nc_id UUID := NULL;
  v_numero_nc TEXT := NULL; v_cliente_nombre TEXT; v_caja_sesion_id UUID; v_stock_actual_dev NUMERIC;
  v_cc_mov_id UUID; v_total_factura_origen NUMERIC; v_ya_imputado_origen NUMERIC; v_saldo_pendiente_origen NUMERIC; v_monto_a_imputar NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF NOT (has_module_permission('ventas') OR has_module_permission('compras')) THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas o compras';
  END IF;
  v_numero_dev := public.obtener_proximo_numero(p_empresa_id, 'devolucion');
  INSERT INTO public.devoluciones (empresa_id, user_id, numero_devolucion, tipo, entrega_id, recepcion_id, comprobante_id, compra_id, cliente_id, proveedor_id, reingresa_stock, compensacion, reembolso_efectivo, motivo)
  VALUES (p_empresa_id, p_user_id, v_numero_dev, p_tipo, p_entrega_id, p_recepcion_id, p_comprobante_id, p_compra_id, p_cliente_id, p_proveedor_id, p_reingresa_stock, p_compensacion, p_reembolso_efectivo, p_motivo)
  RETURNING id INTO v_devolucion_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID; v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio_unit := (v_item->>'precio_unitario')::NUMERIC; v_subtotal := v_cantidad * v_precio_unit; v_total_dev := v_total_dev + v_subtotal;
    INSERT INTO public.devolucion_items (devolucion_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, comprobante_item_id, detalle_compra_item_id)
    VALUES (v_devolucion_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unit, v_subtotal, NULLIF(v_item->>'comprobante_item_id', '')::UUID, NULLIF(v_item->>'detalle_compra_item_id', '')::UUID);
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
  IF p_compensacion = 'nota_credito' THEN
    v_numero_nc := public.obtener_proximo_numero(p_empresa_id, 'nota_credito');
    SELECT nombre INTO v_cliente_nombre FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
    INSERT INTO public.comprobantes (empresa_id, numero_venta, tipo, cliente_id, cliente_nombre, total, comprobante_origen_id, motivo_nc, forma_pago, estado_pago)
    VALUES (p_empresa_id, v_numero_nc, 'nota_credito', p_cliente_id, COALESCE(v_cliente_nombre, 'Consumidor Final'), v_total_dev, p_comprobante_id, p_motivo, 'Efectivo', CASE WHEN p_reembolso_efectivo THEN 'pagada' ELSE 'pendiente' END)
    RETURNING id INTO v_nc_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_producto_id := (v_item->>'producto_id')::UUID; v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio_unit := (v_item->>'precio_unitario')::NUMERIC;
      INSERT INTO public.comprobante_items (empresa_id, comprobante_id, producto_id, cantidad, precio_unitario, subtotal)
      VALUES (p_empresa_id, v_nc_id, v_producto_id, v_cantidad::INTEGER, v_precio_unit, v_cantidad * v_precio_unit);
    END LOOP;
    IF NOT p_reembolso_efectivo THEN
      INSERT INTO public.cuenta_corriente_movimientos (empresa_id, cliente_id, tipo, monto, descripcion, comprobante_id)
      VALUES (p_empresa_id, p_cliente_id, 'HABER', v_total_dev, 'NC ' || v_numero_nc || ' por devolucion ' || v_numero_dev, v_nc_id)
      RETURNING id INTO v_cc_mov_id;

      -- Imputar contra la factura de origen (mismo hallazgo/fix de mig.197, acá
      -- porque esta rama duplica la lógica de crear_nota_credito en vez de
      -- reusarla).
      IF p_comprobante_id IS NOT NULL THEN
        SELECT total INTO v_total_factura_origen
          FROM public.comprobantes
         WHERE id = p_comprobante_id
         FOR UPDATE;

        IF v_total_factura_origen IS NOT NULL THEN
          SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado_origen
            FROM public.cuenta_corriente_imputaciones
           WHERE factura_comprobante_id = p_comprobante_id;
          v_saldo_pendiente_origen := v_total_factura_origen - v_ya_imputado_origen;
          v_monto_a_imputar := LEAST(v_total_dev, GREATEST(v_saldo_pendiente_origen, 0));

          IF v_monto_a_imputar > 0 THEN
            INSERT INTO public.cuenta_corriente_imputaciones
              (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto)
            VALUES (p_empresa_id, v_cc_mov_id, p_comprobante_id, v_monto_a_imputar);

            UPDATE public.comprobantes
               SET estado_pago = CASE
                                    WHEN (v_ya_imputado_origen + v_monto_a_imputar) >= v_total_factura_origen THEN 'pagada'
                                    WHEN (v_ya_imputado_origen + v_monto_a_imputar) > 0 THEN 'parcial'
                                    ELSE 'pendiente'
                                  END
             WHERE id = p_comprobante_id;
          END IF;
        END IF;
      END IF;
    ELSE
      SELECT id INTO v_caja_sesion_id FROM public.caja_sesiones WHERE empresa_id = p_empresa_id AND estado = 'abierta' ORDER BY apertura_fecha DESC LIMIT 1;
      IF v_caja_sesion_id IS NULL THEN RAISE EXCEPTION 'Caja cerrada: abri la caja para procesar reembolsos en efectivo'; END IF;
      INSERT INTO public.movimientos_caja (empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
      VALUES (p_empresa_id, p_user_id, v_caja_sesion_id, CASE WHEN p_tipo = 'cliente' THEN 'egreso' ELSE 'ingreso' END, 'Devoluciones', 'Reembolso devolucion ' || v_numero_dev, v_total_dev, 'Efectivo', TRUE);
    END IF;
    UPDATE public.devoluciones SET nota_credito_id = v_nc_id WHERE id = v_devolucion_id;
  END IF;
  RETURN jsonb_build_object('devolucion_id', v_devolucion_id, 'numero_devolucion', v_numero_dev, 'nota_credito_id', v_nc_id, 'numero_nc', v_numero_nc, 'total', v_total_dev);
END;
$function$;
