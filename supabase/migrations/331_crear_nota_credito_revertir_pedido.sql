-- ════════════════════════════════════════════════════════════════════════════
-- Migration 331 — crear_nota_credito revierte cantidad_facturada del pedido
-- de origen, e informa si el pedido queda "reabrible" (auditoría 18/08)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: el Frente 2 de "Facturar Pedido" (15/08) habilitó facturar un
-- mismo pedido en varias facturas parciales, y el fix de Nadia del 18/08 hizo
-- que `pedidos.estado` solo pase a 'facturado' cuando TODOS los pedido_items
-- quedan con cantidad_facturada >= cantidad. Pero `crear_nota_credito` nunca
-- tocó `pedido_items.cantidad_facturada` ni `pedidos.estado` — si se factura
-- un pedido completo y después se hace una NC sobre esa factura, el pedido
-- queda "Facturado" para siempre, sin ningún camino para volver a facturar
-- el saldo real. Encontrado en la auditoría contable del circuito de Ventas.
--
-- FIX (decisión de Luciano, 18/08): la NC revierte cantidad_facturada por
-- producto — mismo patrón exacto que ya usa `cancelar_factura` (migración
-- 259, líneas 107-118) para una cancelación total, acá aplicado parcial (la
-- cantidad que la NC efectivamente acredita). Si eso deja al pedido con
-- saldo pendiente mientras seguía marcado 'facturado', la función NO lo
-- reabre sola — solo lo informa (`pedido_reabrible: true` en el jsonb de
-- retorno) para que el frontend le pregunte al usuario. Mismo criterio que
-- el Close/Reopen manual de SAP B1: el sistema nunca reabre un documento
-- solo, la decisión de negocio queda en manos de la persona.
--
-- Mismo signature de 10 argumentos que la 296 — CREATE OR REPLACE puro, sin
-- riesgo de overload huérfano (no se agrega ni saca ningún parámetro).

CREATE OR REPLACE FUNCTION public.crear_nota_credito(
  p_empresa_id uuid,
  p_user_id uuid,
  p_cliente_id uuid,
  p_cliente_nombre text,
  p_motivo_nc text,
  p_items jsonb,
  p_comprobante_origen_id uuid DEFAULT NULL::uuid,
  p_devolucion_id uuid DEFAULT NULL::uuid,
  p_referencia_cliente text DEFAULT NULL::text,
  p_punto_venta_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_id UUID; v_numero TEXT; v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0;
  v_total NUMERIC; v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
  v_cc_mov_id UUID; v_total_factura_origen NUMERIC; v_ya_imputado_origen NUMERIC; v_saldo_pendiente_origen NUMERIC; v_monto_a_imputar NUMERIC;
  v_reingresa_stock BOOLEAN; v_costo_revertido NUMERIC := 0;
  -- Nuevas variables (mig.331): reversión de cantidad_facturada del pedido origen
  v_pedido_id UUID; v_pedido_estado TEXT; v_totalmente_facturado BOOLEAN; v_pedido_reabrible BOOLEAN := false;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;
  IF p_comprobante_origen_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_origen_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'comprobante_origen_id no pertenece a la empresa';
  END IF;
  IF p_devolucion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.devoluciones WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'cliente' AND nota_credito_id IS NULL
  ) THEN
    RAISE EXCEPTION 'devolucion_id no pertenece a la empresa, no es de cliente, o ya tiene una NC generada';
  END IF;
  IF p_punto_venta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.puntos_venta WHERE id = p_punto_venta_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'punto_venta_id no pertenece a la empresa';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'La NC debe tener al menos un ítem'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la NC debe ser mayor a cero'; END IF;

  IF p_devolucion_id IS NOT NULL THEN
    SELECT reingresa_stock INTO v_reingresa_stock FROM public.devoluciones WHERE id = p_devolucion_id;
    IF COALESCE(v_reingresa_stock, false) THEN
      SELECT COALESCE(SUM(di.cantidad * ci.costo_unitario), 0) INTO v_costo_revertido
      FROM public.devolucion_items di
      JOIN public.comprobante_items ci ON ci.id = di.comprobante_item_id
      WHERE di.devolucion_id = p_devolucion_id AND ci.costo_unitario IS NOT NULL;
    END IF;
  END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito', p_punto_venta_id);
  INSERT INTO public.comprobantes (empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, neto_gravado, iva_discriminado, forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo, comprobante_origen_id, motivo_nc, referencia_cliente, costo_mercaderia_vendida, punto_venta_id)
  VALUES (p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id, COALESCE(p_cliente_nombre, 'Consumidor Final'), v_total, v_subtotal_neto, v_total_iva, 'Nota de Crédito', 'pagada', 'ARS', 1, 'nota_credito', p_comprobante_origen_id, p_motivo_nc, NULLIF(p_referencia_cliente, ''), ROUND(v_costo_revertido, 2), p_punto_venta_id)
  RETURNING id INTO v_comp_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.comprobante_items (comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva)
    VALUES (v_comp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21'));
  END LOOP;
  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha)
    VALUES (p_empresa_id, p_user_id, p_cliente_id, v_comp_id, 'HABER', v_total, 'NC ' || v_numero || ' — ' || p_motivo_nc, now())
    RETURNING id INTO v_cc_mov_id;

    IF p_comprobante_origen_id IS NOT NULL THEN
      SELECT total INTO v_total_factura_origen
        FROM public.comprobantes
       WHERE id = p_comprobante_origen_id
       FOR UPDATE;

      IF v_total_factura_origen IS NOT NULL THEN
        SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado_origen
          FROM public.cuenta_corriente_imputaciones
         WHERE factura_comprobante_id = p_comprobante_origen_id;
        v_saldo_pendiente_origen := v_total_factura_origen - v_ya_imputado_origen;
        v_monto_a_imputar := LEAST(v_total, GREATEST(v_saldo_pendiente_origen, 0));

        IF v_monto_a_imputar > 0 THEN
          INSERT INTO public.cuenta_corriente_imputaciones
            (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto)
          VALUES (p_empresa_id, v_cc_mov_id, p_comprobante_origen_id, v_monto_a_imputar);

          UPDATE public.comprobantes
             SET estado_pago = CASE
                                  WHEN (v_ya_imputado_origen + v_monto_a_imputar) >= v_total_factura_origen THEN 'pagada'
                                  WHEN (v_ya_imputado_origen + v_monto_a_imputar) > 0 THEN 'parcial'
                                  ELSE 'pendiente'
                                END
           WHERE id = p_comprobante_origen_id;
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_devolucion_id IS NOT NULL THEN
    UPDATE public.devoluciones
       SET nota_credito_id = v_comp_id, compensacion = 'nota_credito'
     WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'cliente';
  END IF;

  -- Revertir cantidad_facturada en el pedido de origen (mig.331) — mismo
  -- patrón que cancelar_factura (259:107-118), pero parcial: solo la
  -- cantidad que esta NC efectivamente acredita, por producto.
  IF p_comprobante_origen_id IS NOT NULL THEN
    SELECT pedido_id INTO v_pedido_id FROM public.comprobantes WHERE id = p_comprobante_origen_id;

    IF v_pedido_id IS NOT NULL THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF NULLIF(v_item->>'producto_id', '') IS NOT NULL THEN
          UPDATE public.pedido_items
             SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - (v_item->>'cantidad')::NUMERIC)
           WHERE pedido_id = v_pedido_id
             AND producto_id = (v_item->>'producto_id')::UUID
             AND empresa_id = p_empresa_id;
        END IF;
      END LOOP;

      -- No se reabre sola: solo se informa si conviene (pedido estaba
      -- 'facturado' y, tras la reversión, ya no está 100% facturado). El
      -- UPDATE de pedidos.estado lo dispara el frontend si el usuario elige
      -- reabrir.
      SELECT estado INTO v_pedido_estado FROM public.pedidos WHERE id = v_pedido_id;
      SELECT bool_and(cantidad_facturada >= cantidad) INTO v_totalmente_facturado
        FROM public.pedido_items WHERE pedido_id = v_pedido_id;
      v_pedido_reabrible := (v_pedido_estado = 'facturado') AND NOT COALESCE(v_totalmente_facturado, true);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total,
    'costo_mercaderia_vendida', ROUND(v_costo_revertido, 2),
    'pedido_id', v_pedido_id, 'pedido_reabrible', v_pedido_reabrible
  );
END;
$function$;

-- ROLLBACK (comentado): restaurar el cuerpo de la 296 sin el bloque de
-- reversión de pedido_items ni los campos pedido_id/pedido_reabrible en el
-- RETURN (ver supabase/migrations/296_numeracion_nc_nd_por_punto_venta.sql:225-344).
