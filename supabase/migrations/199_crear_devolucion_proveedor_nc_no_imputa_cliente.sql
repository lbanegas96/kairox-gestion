-- Migration 199 — crear_devolucion: la NC de una devolución a PROVEEDOR no debe
-- crear un comprobante de venta ni tocar la cuenta corriente del CLIENTE
-- (hallazgo sesión 60 cont. 2, revisión punto por punto de Compras, 2026-07-11).
--
-- El bug: dentro de `IF p_compensacion = 'nota_credito' THEN`, crear_devolucion
-- SIEMPRE ejecutaba la rama pensada para clientes — sin importar `p_tipo`:
--   1. Creaba un comprobante tipo='nota_credito' en la tabla de VENTAS, con
--      cliente_id = p_cliente_id. Para devoluciones a PROVEEDOR, p_cliente_id
--      nunca se pasa (el frontend solo envía p_proveedor_id) → quedaba NULL,
--      'Consumidor Final'. Consumía la MISMA numeración de NC que las ventas
--      reales (obtener_proximo_numero(..., 'nota_credito')).
--   2. Si NOT p_reembolso_efectivo, insertaba el HABER en
--      `cuenta_corriente_movimientos` (ledger de CLIENTES) con cliente_id=NULL
--      — un movimiento sin cliente real, invisible en cualquier pantalla,
--      que nunca imputaba nada.
--   3. NUNCA tocaba `cuenta_corriente_proveedores` — la deuda real con el
--      proveedor jamás bajaba, pese a que la UI (NuevaDevolucionModal) le dice
--      al usuario "La ND ajustará el saldo de Cuenta Corriente del proveedor
--      (recomendado)".
--
-- Confirmado con datos reales de Nalux: 5 devoluciones a proveedor con
-- compensacion='nota_credito' generaron 5 comprobantes-NC huérfanos
-- (cliente_id NULL, sin neto_gravado/iva_discriminado, cae_estado='no_aplica'
-- → sin impacto AFIP/Libro IVA, confirmado). De esas 5, las 3 con
-- reembolso_efectivo=false (el camino "recomendado" por la UI) NUNCA
-- acreditaron `cuenta_corriente_proveedores` — el sistema sigue mostrando que
-- se les debe el monto completo a esos proveedores.
--
-- Ya existe el patrón correcto en el propio código base: `NuevaNCProveedorModal.jsx`
-- ("NC financiera recibida — reduce la deuda con el proveedor en Cuenta
-- Corriente") inserta directo en `cuenta_corriente_proveedores` con
-- tipo='nota_credito', sin crear ningún comprobante de venta. Este fix alinea
-- la rama de `crear_devolucion` para p_tipo <> 'cliente' con ese mismo patrón
-- ya validado, en vez de reusar la lógica de ventas.
--
-- Fix: dentro de `p_compensacion = 'nota_credito'`, todo lo que crea el
-- comprobante/comprobante_items de venta y toca `cuenta_corriente_movimientos`
-- queda gateado a `p_tipo = 'cliente'` (comportamiento sin cambios para
-- clientes, ya corregido en mig.198). Para `p_tipo <> 'cliente'`, cuando
-- NOT p_reembolso_efectivo, se inserta directo en `cuenta_corriente_proveedores`
-- (mismo patrón que NuevaNCProveedorModal — sin imputación contra una compra
-- puntual, porque muchas compras reales se pagan fuera de CC — Efectivo/
-- Transferencia — al momento de la compra, y "saldo pendiente de la compra"
-- no aplicaría ahí). `v_nc_id`/`v_numero_nc` quedan NULL para proveedor (no se
-- genera ningún documento de venta) — `devoluciones.nota_credito_id` queda
-- NULL, igual que ya pasa hoy para compensacion IN ('reemplazo','pendiente').
-- La rama de reembolso en efectivo (caja) no cambia — ya era correcta para
-- ambos tipos.
--
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
    IF p_tipo = 'cliente' THEN
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
    END IF;

    IF NOT p_reembolso_efectivo THEN
      IF p_tipo = 'cliente' THEN
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
        -- Proveedor: NC financiera recibida — acredita cuenta_corriente_proveedores
        -- directamente (mismo patrón que NuevaNCProveedorModal.jsx). Sin
        -- comprobante de venta, sin imputación contra una compra puntual: la
        -- mayoría de las compras reales se pagan fuera de CC al momento de la
        -- compra (Efectivo/Transferencia), así que "saldo pendiente de la
        -- compra" no es un concepto aplicable acá — el crédito es contra el
        -- saldo agregado del proveedor, tal como ya lo hace el modal de NC
        -- financiera.
        INSERT INTO public.cuenta_corriente_proveedores
          (empresa_id, proveedor_id, tipo, monto, descripcion, referencia_id, referencia_tipo, user_id, fecha)
        VALUES
          (p_empresa_id, p_proveedor_id, 'nota_credito', v_total_dev,
           'NC recibida por devolucion ' || v_numero_dev, p_compra_id, 'devolucion_proveedor', p_user_id, now());
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
