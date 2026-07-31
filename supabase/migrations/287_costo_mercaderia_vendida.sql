-- migration 287 — Costo de Mercadería Vendida (COGS) en el asiento de venta
--
-- HALLAZGO (auditoría de Inventario/COGS, sesión 2026-08): `crear_venta` decrementa
-- `productos.stock_actual` correctamente, pero el asiento contable de la venta
-- (`asientosAutoService.crearAsientoVenta`, planCuentasService.ts) nunca generó la
-- línea de Costo de Mercadería Vendida (Debe 5.1 Costo de Mercaderías / Haber 1.1.3
-- Mercaderías-Inventario). Verificado en producción (Nalux): Ventas acumuladas
-- $7.633.841, Costo de Mercaderías $0 real, y 1.1.3 Mercaderías/Inventario con
-- $8.285.520 de Debe (compras) y $0 de Haber histórico — el activo de Inventario
-- nunca se consume contablemente, y el Estado de Resultados nunca refleja el costo
-- de lo vendido (el margen que muestra el sistema hoy está sobreestimado en el 100%
-- del costo de mercadería).
--
-- Fix, en dos capas (mismo patrón que neto_gravado/iva_discriminado, mig.280):
-- 1) `crear_venta`: captura el costo del producto al momento exacto de la venta
--    (snapshot, no el costo "actual" que puede cambiar después) en la nueva columna
--    `comprobante_items.costo_unitario`, y acumula el total en la nueva columna
--    `comprobantes.costo_mercaderia_vendida`. Solo se captura cuando esta llamada
--    efectivamente mueve stock (`v_mueve_stock`) — si el producto viene de una
--    entrega manual previa, el stock ya se movió antes y el costo de ESE evento no
--    se captura acá (gap conocido y documentado, no corregido en esta migration).
-- 2) `crearAsientoVenta` (JS) y `regenerar_asiento_venta` (SQL, mig.281) agregan las
--    2 líneas de COGS al asiento cuando el monto es > 0 y existen las cuentas 5.1/1.1.3
--    — no bloqueante: si falta alguna cuenta, el resto del asiento se genera igual.

-- ── 1) Columnas nuevas ────────────────────────────────────────────────────────
ALTER TABLE public.comprobante_items
  ADD COLUMN IF NOT EXISTS costo_unitario numeric;

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS costo_mercaderia_vendida numeric;

-- ── 2) crear_venta: capturar costo_unitario snapshot + acumular costo total ────
CREATE OR REPLACE FUNCTION public.crear_venta(p_empresa_id uuid, p_user_id uuid, p_numero_venta text, p_fecha timestamp with time zone, p_cliente_id uuid, p_cliente_nombre text, p_total numeric, p_forma_pago text, p_estado_pago text, p_moneda text, p_tipo_cambio_tasa numeric, p_monto_paralelo numeric, p_tc_paralelo numeric, p_items jsonb, p_pagos jsonb, p_es_cc boolean, p_caja_sesion_id uuid, p_pedido_id uuid, p_monto_moneda_original numeric DEFAULT NULL::numeric, p_centro_costo_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  -- mig.287: costo de mercadería vendida
  v_costo_unitario NUMERIC; v_costo_total NUMERIC := 0;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF p_centro_costo_id IS NOT NULL THEN
    SELECT usa_centros_costo INTO v_usa_cc FROM public.empresas WHERE id = p_empresa_id;
    IF NOT COALESCE(v_usa_cc, false) THEN
      RAISE EXCEPTION 'Centros de Costo no está activado para esta empresa. Activalo en Configuración > Finanzas.';
    END IF;
  END IF;

  v_total := ROUND(p_total, 2);
  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito INTO v_dias_credito FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
  END IF;
  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);
  IF p_pedido_id IS NOT NULL THEN
    SELECT id INTO v_entrega_manual_id FROM public.entregas
    WHERE empresa_id = p_empresa_id AND pedido_id = p_pedido_id AND origen = 'manual' AND estado = 'entregado'
    ORDER BY fecha DESC LIMIT 1;
  END IF;
  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa, monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento, monto_moneda_original, centro_costo_id
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha, p_cliente_id, p_cliente_nombre, v_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa, p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento, ROUND(p_monto_moneda_original, 2), p_centro_costo_id
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
  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta', p_numero_venta,
    'neto_gravado', ROUND(v_neto_total, 2),
    'iva_discriminado', ROUND(v_iva_total, 2),
    'costo_mercaderia_vendida', ROUND(v_costo_total, 2)
  );
END;
$function$;

-- ── 3) regenerar_asiento_venta: incluir COGS si comprobantes.costo_mercaderia_vendida > 0 ──
CREATE OR REPLACE FUNCTION public.regenerar_asiento_venta(
  p_comprobante_id uuid,
  p_user_id        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
  v_cerrado boolean;
  v_cta_cobro uuid; v_cta_ventas uuid; v_cta_iva uuid;
  v_cta_costo uuid; v_cta_inventario uuid;
  v_es_credito boolean;
  v_asiento_id uuid;
  v_fecha_dia date;
  v_total_debe numeric; v_total_haber numeric;
BEGIN
  SELECT c.empresa_id, c.total, c.neto_gravado, c.iva_discriminado, c.forma_pago,
         c.numero_venta, c.fecha::date, c.asiento_id, c.estado_pago, c.tipo, c.costo_mercaderia_vendida
    INTO v_comp
    FROM public.comprobantes c
   WHERE c.id = p_comprobante_id;

  IF v_comp.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;
  IF v_comp.empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el comprobante no pertenece a esta empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF v_comp.tipo NOT IN ('venta') THEN
    RAISE EXCEPTION 'Solo se puede regenerar el asiento de una Venta/Factura (usá el flujo de NC/ND para esos documentos)';
  END IF;
  IF v_comp.asiento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este comprobante ya tiene un asiento contable generado';
  END IF;
  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Este comprobante está cancelado — no aplica generar asiento';
  END IF;

  v_fecha_dia := v_comp.fecha;
  SELECT fecha_en_periodo_cerrado(v_comp.empresa_id, v_fecha_dia) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'El período de esta venta (%) está cerrado — reabrilo en Plan de Cuentas antes de regenerar el asiento', v_fecha_dia;
  END IF;

  v_es_credito := v_comp.forma_pago = 'Cuenta Corriente';
  SELECT id INTO v_cta_cobro  FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = (CASE WHEN v_es_credito THEN '1.1.2' ELSE '1.1.1' END) AND activa LIMIT 1;
  SELECT id INTO v_cta_ventas FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = '4.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_iva    FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = '2.1.3' AND activa LIMIT 1;
  IF v_cta_cobro IS NULL OR v_cta_ventas IS NULL THEN
    RAISE EXCEPTION 'Falta configurar las cuentas contables de Cobro o Ventas en Plan de Cuentas';
  END IF;

  IF COALESCE(v_comp.costo_mercaderia_vendida, 0) > 0 THEN
    SELECT id INTO v_cta_costo      FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = '5.1' AND activa LIMIT 1;
    SELECT id INTO v_cta_inventario FROM public.plan_cuentas WHERE empresa_id = v_comp.empresa_id AND codigo = '1.1.3' AND activa LIMIT 1;
  END IF;

  v_total_debe := v_comp.total;
  v_total_haber := v_comp.total;
  IF v_cta_costo IS NOT NULL AND v_cta_inventario IS NOT NULL THEN
    v_total_debe := v_total_debe + v_comp.costo_mercaderia_vendida;
    v_total_haber := v_total_haber + v_comp.costo_mercaderia_vendida;
  END IF;

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_comp.empresa_id, p_user_id, next_numero_asiento(v_comp.empresa_id), v_fecha_dia,
    'Factura ' || v_comp.numero_venta || ' (regenerado)',
    'confirmado', v_total_debe, v_total_haber, 'venta', p_comprobante_id
  ) RETURNING id INTO v_asiento_id;

  IF v_cta_iva IS NOT NULL AND COALESCE(v_comp.neto_gravado, 0) + COALESCE(v_comp.iva_discriminado, 0) > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_comp.empresa_id, v_cta_cobro,  'Cobro por venta (regenerado)', v_comp.total, 0),
      (v_asiento_id, v_comp.empresa_id, v_cta_ventas, 'Ingreso por venta (neto, regenerado)', 0, v_comp.neto_gravado),
      (v_asiento_id, v_comp.empresa_id, v_cta_iva,    'IVA Débito Fiscal (regenerado)', 0, v_comp.iva_discriminado);
  ELSE
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_comp.empresa_id, v_cta_cobro,  'Cobro por venta (regenerado)', v_comp.total, 0),
      (v_asiento_id, v_comp.empresa_id, v_cta_ventas, 'Ingreso por venta (regenerado)', 0, v_comp.total);
  END IF;

  IF v_cta_costo IS NOT NULL AND v_cta_inventario IS NOT NULL THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_comp.empresa_id, v_cta_costo,      'Costo de mercadería vendida (regenerado)', v_comp.costo_mercaderia_vendida, 0),
      (v_asiento_id, v_comp.empresa_id, v_cta_inventario, 'Salida de mercadería por venta (regenerado)', 0, v_comp.costo_mercaderia_vendida);
  END IF;

  UPDATE public.comprobantes SET asiento_id = v_asiento_id WHERE id = p_comprobante_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;

-- ROLLBACK (comentado): CREATE OR REPLACE crear_venta y regenerar_asiento_venta con
-- los bodies previos a esta migration (mig.280/281, sin costo_unitario/costo_mercaderia_vendida);
-- ALTER TABLE comprobante_items DROP COLUMN costo_unitario;
-- ALTER TABLE comprobantes DROP COLUMN costo_mercaderia_vendida.
