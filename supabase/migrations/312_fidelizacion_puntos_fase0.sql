-- Fidelización por Puntos — Fase 0 (backend). Plan completo en
-- PLAN_FIDELIZACION_PUNTOS.md. Decisiones de negocio ya tomadas por Nadia
-- (07/08): canje = descuento directo en pesos, gratis para todas las
-- empresas, los puntos no vencen. Sin UI todavía — se prueba por SQL
-- directo, mismo criterio que las fases de backend anteriores (309/310/311).

-- ── 1. Configuración por empresa (mismo patrón que usa_tc_paralelo/usa_centros_costo) ──
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS usa_fidelizacion boolean NOT NULL DEFAULT false,
  -- Cuántos pesos gastados = 1 punto ganado.
  ADD COLUMN IF NOT EXISTS puntos_pesos_por_punto numeric,
  -- Cuántos pesos de descuento vale 1 punto al canjear. Ratios separados a
  -- propósito (patrón estándar de la industria) — protege el margen: ganar
  -- 1 punto cada $100 y que cada punto valga $1 al canjear da ~1% de
  -- devolución efectiva, no 100%.
  ADD COLUMN IF NOT EXISTS puntos_valor_pesos numeric,
  ADD CONSTRAINT chk_puntos_pesos_por_punto_positivo
    CHECK (puntos_pesos_por_punto IS NULL OR puntos_pesos_por_punto > 0),
  ADD CONSTRAINT chk_puntos_valor_pesos_positivo
    CHECK (puntos_valor_pesos IS NULL OR puntos_valor_pesos > 0);

-- ── 2. Saldo por cliente (mismo patrón visual/mental que saldo_actual de cta. cte.) ──
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS saldo_puntos integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT chk_saldo_puntos_no_negativo CHECK (saldo_puntos >= 0);

-- ── 3. Movimientos — ledger auditable, no sólo el saldo final (mismo criterio ──
-- que movimientos_caja sobre caja_sesiones: siempre poder explicar cómo se
-- llegó al saldo actual, nunca guardar sólo el número).
CREATE TABLE public.movimientos_puntos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  cliente_id       uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  comprobante_id   uuid REFERENCES public.comprobantes(id) ON DELETE SET NULL,
  tipo             text NOT NULL CHECK (tipo IN ('ganado', 'canjeado', 'ajuste_manual')),
  puntos           integer NOT NULL CHECK (puntos > 0), -- magnitud; el signo lo da `tipo`
  saldo_posterior  integer NOT NULL,
  user_id          uuid REFERENCES auth.users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimientos_puntos_cliente ON public.movimientos_puntos (cliente_id, created_at);
CREATE INDEX idx_movimientos_puntos_comprobante ON public.movimientos_puntos (comprobante_id);

ALTER TABLE public.movimientos_puntos ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que cuenta_corriente_movimientos: select por empresa, cud
-- atado al permiso de módulo 'ventas' (los puntos se generan/canjean como
-- parte de una venta).
CREATE POLICY "movimientos_puntos_select" ON public.movimientos_puntos
  FOR SELECT USING (empresa_id = get_my_empresa_id());
CREATE POLICY "movimientos_puntos_insert" ON public.movimientos_puntos
  FOR INSERT WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));
CREATE POLICY "movimientos_puntos_update" ON public.movimientos_puntos
  FOR UPDATE USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'))
  WITH CHECK (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));
CREATE POLICY "movimientos_puntos_delete" ON public.movimientos_puntos
  FOR DELETE USING (empresa_id = get_my_empresa_id() AND has_module_permission('ventas'));

-- ── 4. crear_venta gana p_puntos_canjeados (patrón DROP+CREATE, nunca ──
-- CREATE OR REPLACE agregando un parámetro — crea un overload huérfano en
-- vez de reemplazar, ya pasó 2 veces en este proyecto: mig.264/308).
--
-- Diseño: el FRONTEND ya calcula p_total neto de cualquier descuento,
-- incluido el propio canje de puntos (mismo criterio que ya usa esta función
-- para ofertas/descuentos por ítem — nunca recalcula precios, sólo registra
-- lo que ya viene calculado). Acá sólo se valida el saldo y se mueve el
-- ledger — no se toca el cálculo de v_total.
--
-- Orden: primero canjear (contra el saldo ANTES de esta venta), después
-- ganar (sobre el total ya cobrado) — así un cliente nunca puede gastar en
-- la misma compra los puntos que esa misma compra le está por dar.
--
-- De paso: `anon` seguía con EXECUTE directo sobre esta función (mig.309
-- sólo había revocado PUBLIC — un grant aparte a `anon`, de antes de esa
-- migración, nunca se había tocado). Se revoca acá explícitamente,
-- verificado con has_function_privilege antes y después.
DROP FUNCTION IF EXISTS public.crear_venta(
  uuid, uuid, text, timestamptz, uuid, text, numeric, text, text, text,
  numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric, uuid, uuid
);

CREATE FUNCTION public.crear_venta(
  p_empresa_id uuid, p_user_id uuid, p_numero_venta text, p_fecha timestamptz,
  p_cliente_id uuid, p_cliente_nombre text, p_total numeric, p_forma_pago text,
  p_estado_pago text, p_moneda text, p_tipo_cambio_tasa numeric, p_monto_paralelo numeric,
  p_tc_paralelo numeric, p_items jsonb, p_pagos jsonb, p_es_cc boolean,
  p_caja_sesion_id uuid, p_pedido_id uuid,
  p_monto_moneda_original numeric DEFAULT NULL, p_centro_costo_id uuid DEFAULT NULL,
  p_client_uuid uuid DEFAULT NULL, p_puntos_canjeados integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_comprobante_id UUID; v_item JSONB; v_pago JSONB; v_stock_actual INTEGER;
  v_cantidad INTEGER; v_producto_id UUID; v_alicuota TEXT; v_factor NUMERIC;
  v_subtotal NUMERIC; v_neto_total NUMERIC := 0; v_iva_total NUMERIC := 0;
  v_entrega_id UUID; v_numero_entrega TEXT; v_entrega_manual_id UUID := NULL;
  v_dias_credito INTEGER; v_fecha_vencimiento DATE; v_precio_unitario NUMERIC;
  v_precio_original NUMERIC; v_descuento_pct NUMERIC; v_descuento_monto_item NUMERIC;
  v_oferta_id UUID; v_descuento_manual_pct NUMERIC; v_descuento_global_monto NUMERIC := 0;
  v_descuento_global_pct NUMERIC := 0; v_bruto_total NUMERIC := 0; v_total NUMERIC;
  v_pedido_item_id UUID; v_ped_cantidad NUMERIC; v_ped_entregada NUMERIC;
  v_ped_facturada NUMERIC; v_max_facturable NUMERIC; v_mueve_stock BOOLEAN;
  v_usa_cc BOOLEAN;
  v_unidad_venta_id UUID; v_cantidad_venta NUMERIC; v_precio_unidad_venta NUMERIC;
  v_forma_pago_id UUID; v_metodo_pago TEXT;
  v_costo_unitario NUMERIC; v_costo_total NUMERIC := 0;
  v_existente RECORD;
  -- Fidelización por puntos (Fase 0)
  v_usa_fidelizacion BOOLEAN; v_pesos_por_punto NUMERIC; v_saldo_puntos INTEGER;
  v_puntos_ganados INTEGER := 0;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF p_client_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_client_uuid::text, 0));
    SELECT id, numero_venta, neto_gravado, iva_discriminado, costo_mercaderia_vendida
      INTO v_existente
    FROM public.comprobantes
    WHERE empresa_id = p_empresa_id AND client_uuid = p_client_uuid;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'comprobante_id', v_existente.id,
        'numero_venta', v_existente.numero_venta,
        'neto_gravado', v_existente.neto_gravado,
        'iva_discriminado', v_existente.iva_discriminado,
        'costo_mercaderia_vendida', v_existente.costo_mercaderia_vendida,
        -- No se recalcula en el retry de un duplicado — ya se le mostró al
        -- cajero la primera vez que esta venta se procesó de verdad.
        'puntos_ganados', 0,
        'duplicate', true
      );
    END IF;
  END IF;

  IF p_centro_costo_id IS NOT NULL THEN
    SELECT usa_centros_costo INTO v_usa_cc FROM public.empresas WHERE id = p_empresa_id;
    IF NOT COALESCE(v_usa_cc, false) THEN
      RAISE EXCEPTION 'Centros de Costo no está activado para esta empresa. Activalo en Configuración > Finanzas.';
    END IF;
  END IF;

  v_total := ROUND(p_total, 2);
  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito, saldo_puntos INTO v_dias_credito, v_saldo_puntos
    FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id FOR UPDATE;

    SELECT usa_fidelizacion, puntos_pesos_por_punto
      INTO v_usa_fidelizacion, v_pesos_por_punto
    FROM public.empresas WHERE id = p_empresa_id;
  END IF;

  IF p_puntos_canjeados > 0 THEN
    IF p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'No se pueden canjear puntos sin un cliente asociado a la venta';
    END IF;
    IF NOT COALESCE(v_usa_fidelizacion, false) THEN
      RAISE EXCEPTION 'Fidelización por puntos no está activada para esta empresa';
    END IF;
    IF COALESCE(v_saldo_puntos, 0) < p_puntos_canjeados THEN
      RAISE EXCEPTION 'Saldo de puntos insuficiente (disponible: %, solicitado: %)', COALESCE(v_saldo_puntos, 0), p_puntos_canjeados;
    END IF;
  END IF;

  IF p_pedido_id IS NOT NULL THEN
    SELECT id INTO v_entrega_manual_id FROM public.entregas
    WHERE empresa_id = p_empresa_id AND pedido_id = p_pedido_id AND origen = 'manual' AND estado = 'entregado'
    ORDER BY fecha DESC LIMIT 1;
  END IF;
  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa, monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento, monto_moneda_original, centro_costo_id, client_uuid
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha, p_cliente_id, p_cliente_nombre, v_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa, p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento, ROUND(p_monto_moneda_original, 2), p_centro_costo_id, p_client_uuid
  )
  RETURNING id INTO v_comprobante_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');
    v_precio_unitario      := ROUND((v_item->>'precio_unitario')::NUMERIC, 2);
    v_precio_original      := ROUND(COALESCE((v_item->>'precio_original')::NUMERIC, (v_item->>'precio_unitario')::NUMERIC), 2);
    v_descuento_pct        := COALESCE((v_item->>'descuento_pct')::NUMERIC, 0);
    v_descuento_monto_item := ROUND(COALESCE((v_item->>'descuento_monto')::NUMERIC, 0), 2);
    v_oferta_id            := NULLIF(v_item->>'oferta_id', '')::UUID;
    v_descuento_manual_pct := COALESCE((v_item->>'descuento_manual_pct')::NUMERIC, 0);
    v_unidad_venta_id     := NULLIF(v_item->>'unidad_venta_id', '')::UUID;
    v_cantidad_venta      := NULLIF(v_item->>'cantidad_venta', '')::NUMERIC;
    v_precio_unidad_venta := NULLIF(v_item->>'precio_unidad_venta', '')::NUMERIC;
    v_mueve_stock    := TRUE;
    v_pedido_item_id := NULL;
    v_costo_unitario := NULL;
    IF p_pedido_id IS NOT NULL THEN
      SELECT id, cantidad, cantidad_entregada, cantidad_facturada
        INTO v_pedido_item_id, v_ped_cantidad, v_ped_entregada, v_ped_facturada
      FROM public.pedido_items
      WHERE pedido_id = p_pedido_id AND producto_id = v_producto_id AND empresa_id = p_empresa_id
      FOR UPDATE;
      IF v_pedido_item_id IS NOT NULL THEN
        IF v_entrega_manual_id IS NOT NULL THEN
          v_max_facturable := COALESCE(v_ped_entregada, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := FALSE;
        ELSE
          v_max_facturable := COALESCE(v_ped_cantidad, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := TRUE;
        END IF;
        IF v_cantidad > v_max_facturable THEN
          RAISE EXCEPTION 'Cantidad a facturar (%) supera lo disponible para el producto % del pedido (máximo facturable: %)', v_cantidad, v_producto_id, v_max_facturable;
        END IF;
        UPDATE public.pedido_items SET cantidad_facturada = COALESCE(cantidad_facturada, 0) + v_cantidad WHERE id = v_pedido_item_id;
      END IF;
    END IF;
    IF v_mueve_stock THEN
      SELECT stock_actual, costo_compra INTO v_stock_actual, v_costo_unitario
      FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
      IF v_stock_actual IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
      END IF;
      IF v_stock_actual < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)', v_producto_id, v_stock_actual, v_cantidad;
      END IF;
      UPDATE public.productos SET stock_actual = stock_actual - v_cantidad WHERE id = v_producto_id;
      v_costo_total := v_costo_total + (COALESCE(v_costo_unitario, 0) * v_cantidad);
    END IF;
    v_factor := CASE v_alicuota WHEN '21' THEN 1.21 WHEN '10.5' THEN 1.105 ELSE 1 END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));
    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva,
      precio_original, descuento_pct, descuento_monto, oferta_id, descuento_manual_pct,
      unidad_venta_id, cantidad_venta, precio_unidad_venta, costo_unitario
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unitario, v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item, v_oferta_id, v_descuento_manual_pct,
      v_unidad_venta_id, v_cantidad_venta, v_precio_unidad_venta, v_costo_unitario
    );
    v_descuento_global_monto := v_descuento_global_monto + (v_descuento_monto_item * v_cantidad);
    v_bruto_total := v_bruto_total + (v_precio_original * v_cantidad);
    IF v_mueve_stock THEN
      INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
      VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'salida', v_cantidad, 'Venta #' || p_numero_venta, p_fecha);
    END IF;
  END LOOP;
  v_descuento_global_pct := CASE WHEN v_bruto_total > 0 THEN ROUND(v_descuento_global_monto / v_bruto_total * 100, 2) ELSE 0 END;
  UPDATE public.comprobantes SET neto_gravado = ROUND(v_neto_total, 2), iva_discriminado = ROUND(v_iva_total, 2),
    descuento_global_monto = ROUND(v_descuento_global_monto, 2), descuento_global_pct = v_descuento_global_pct,
    costo_mercaderia_vendida = ROUND(v_costo_total, 2)
  WHERE id = v_comprobante_id;
  IF v_entrega_manual_id IS NOT NULL THEN
    UPDATE public.entregas SET comprobante_id = v_comprobante_id WHERE id = v_entrega_manual_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      UPDATE public.comprobante_items SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id AND producto_id = (v_item->>'producto_id')::UUID;
    END LOOP;
  ELSE
    v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
    INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, comprobante_id, cliente_id, origen, estado, fecha, pedido_id)
    VALUES (p_empresa_id, auth.uid(), v_numero_entrega, v_comprobante_id, p_cliente_id, 'implicita', 'entregado', CURRENT_DATE, p_pedido_id)
    RETURNING id INTO v_entrega_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
      VALUES (v_entrega_id, p_empresa_id, (v_item->>'producto_id')::UUID, (v_item->>'cantidad')::INTEGER);
      UPDATE public.comprobante_items SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id AND producto_id = (v_item->>'producto_id')::UUID;
    END LOOP;
  END IF;
  IF p_pedido_id IS NOT NULL THEN
    UPDATE public.pedidos SET comprobante_id = v_comprobante_id WHERE id = p_pedido_id AND comprobante_id IS NULL;
  END IF;
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    IF (v_pago->>'metodo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      v_forma_pago_id := NULLIF(v_pago->>'forma_pago_id', '')::uuid;
      v_metodo_pago := v_pago->>'metodo';
      IF v_forma_pago_id IS NOT NULL THEN
        SELECT nombre INTO v_metodo_pago FROM public.formas_pago
         WHERE id = v_forma_pago_id AND empresa_id = p_empresa_id;
        IF v_metodo_pago IS NULL THEN
          RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
        END IF;
      END IF;
      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, fecha, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id, comprobante_id
      ) VALUES (
        p_empresa_id, auth.uid(), p_caja_sesion_id, 'ingreso', 'Venta', 'Venta #' || p_numero_venta,
        ROUND((v_pago->>'monto')::NUMERIC, 2), v_metodo_pago, p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC, NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC, v_forma_pago_id, v_comprobante_id
      );
    END IF;
  END LOOP;
  IF p_es_cc AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, tipo, monto, descripcion, fecha, comprobante_id, monto_paralelo, tc_paralelo
    ) VALUES (
      p_empresa_id, auth.uid(), p_cliente_id, 'DEBE', v_total, 'Venta #' || p_numero_venta, p_fecha,
      v_comprobante_id, p_monto_paralelo, p_tc_paralelo
    );
  END IF;

  -- Fidelización por puntos (Fase 0) — canjear primero (contra el saldo de
  -- ANTES de esta venta, ya validado arriba), ganar después (sobre el total
  -- ya cobrado). Así un cliente nunca gasta en la misma compra los puntos
  -- que esa misma compra le está por dar.
  IF p_puntos_canjeados > 0 THEN
    UPDATE public.clientes SET saldo_puntos = saldo_puntos - p_puntos_canjeados
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id
    RETURNING saldo_puntos INTO v_saldo_puntos;
    INSERT INTO public.movimientos_puntos (empresa_id, cliente_id, comprobante_id, tipo, puntos, saldo_posterior, user_id)
    VALUES (p_empresa_id, p_cliente_id, v_comprobante_id, 'canjeado', p_puntos_canjeados, v_saldo_puntos, auth.uid());
  END IF;

  IF p_cliente_id IS NOT NULL AND COALESCE(v_usa_fidelizacion, false) AND COALESCE(v_pesos_por_punto, 0) > 0 THEN
    v_puntos_ganados := FLOOR(v_total / v_pesos_por_punto)::integer;
    IF v_puntos_ganados > 0 THEN
      UPDATE public.clientes SET saldo_puntos = saldo_puntos + v_puntos_ganados
      WHERE id = p_cliente_id AND empresa_id = p_empresa_id
      RETURNING saldo_puntos INTO v_saldo_puntos;
      INSERT INTO public.movimientos_puntos (empresa_id, cliente_id, comprobante_id, tipo, puntos, saldo_posterior, user_id)
      VALUES (p_empresa_id, p_cliente_id, v_comprobante_id, 'ganado', v_puntos_ganados, v_saldo_puntos, auth.uid());
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta', p_numero_venta,
    'neto_gravado', ROUND(v_neto_total, 2),
    'iva_discriminado', ROUND(v_iva_total, 2),
    'costo_mercaderia_vendida', ROUND(v_costo_total, 2),
    'puntos_ganados', v_puntos_ganados,
    'duplicate', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.crear_venta(
  uuid, uuid, text, timestamptz, uuid, text, numeric, text, text, text,
  numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric, uuid, uuid, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crear_venta(
  uuid, uuid, text, timestamptz, uuid, text, numeric, text, text, text,
  numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric, uuid, uuid, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION public.crear_venta(
  uuid, uuid, text, timestamptz, uuid, text, numeric, text, text, text,
  numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric, uuid, uuid, integer
) TO authenticated;
