-- migration 155 — Auditoría: permiso de módulo faltante en RPCs "punto de entrada"
--
-- Hallazgo (descubierto al arreglar insertar_movimiento_bancario_externo, mig.154):
-- las RPCs SECURITY DEFINER que son el motor de dinero del sistema validan que
-- empresa_id coincida con el tenant del caller, pero NINGUNA valida
-- has_module_permission() — al estar otorgado EXECUTE a 'authenticated', cualquier
-- staff (sin importar sus permisos asignados en profiles.permissions) puede llamarlas
-- DIRECTAMENTE vía supabase.rpc(...), sin pasar por ninguna pantalla, y bypasear
-- por completo el sistema de permisos granulares (mig.132/134/146/153).
--
-- Antes de tocar nada se hizo un mapeo completo (pg_proc + grep de call-sites en src/)
-- para separar:
--   (a) RPCs "punto de entrada" — llamadas SOLO desde una pantalla del frontend,
--       nunca desde otra RPC → seguro gatearlas con el permiso de esa pantalla.
--   (b) RPCs "pieza interna" — llamadas por OTRAS RPCs de distintos módulos
--       (obtener_proximo_numero, fecha_en_periodo_cerrado) → NO se tocan, gatearlas
--       rompería flujos cruzados (ej. un vendedor sin permiso 'productos' fallaría
--       al vender si crear_venta llamara internamente algo gateado a 'productos').
--
-- Confirmado con una query a pg_proc que NINGUNA de las 16 funciones de abajo es
-- llamada por otra función SECURITY DEFINER — son 100% puntos de entrada directos.
--
-- Ya estaban bien (no se tocan): contabilizar_movimiento_bancario y
-- revertir_contabilizacion_movimiento ya exigían is_admin() desde su creación.
--
-- Módulo asignado por RPC (según el único call-site real confirmado por grep):
--  - crear_venta, crear_entrega, crear_nota_credito, registrar_cobro_cliente,
--    reencolar_caes_pendientes, usar_caea_en_venta*, siguiente_numero_documento*  → 'ventas'
--  - crear_recepcion, crear_recepcion_implicita, registrar_pago_proveedor,
--    aplicar_compra_producto, decrement_stock, increment_stock                   → 'compras'
--    (decrement_stock/increment_stock: único call-site real es CompraRapidaSection,
--    pantalla de compras — no confundir con ajustar_stock_manual, que es la
--    herramienta de ajuste manual de ProductosSection)
--  - ajustar_stock_manual                                                        → 'productos'
--  - crear_devolucion, crear_nota_debito                                         → 'ventas' OR 'compras'
--    (uso dual confirmado: tipo='cliente'/'emitida' es ventas, tipo='proveedor'/'recibida' es compras)
--  (* usar_caea_en_venta y siguiente_numero_documento no tienen ningún call-site
--    real en el frontend hoy — se gatean por defensa en profundidad igual)
--
-- Validado con BEGIN...ROLLBACK: staff sin el permiso correspondiente bloqueado en
-- cada RPC; staff/admin con el permiso correcto sigue operando normal.

-- ═══════════════════════════════ VENTAS ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION public.crear_venta(p_empresa_id uuid, p_user_id uuid, p_numero_venta text, p_fecha timestamp with time zone, p_cliente_id uuid, p_cliente_nombre text, p_total numeric, p_forma_pago text, p_estado_pago text, p_moneda text, p_tipo_cambio_tasa numeric, p_monto_paralelo numeric, p_tc_paralelo numeric, p_items jsonb, p_pagos jsonb, p_es_cc boolean, p_caja_sesion_id uuid, p_pedido_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comprobante_id         UUID;
  v_item                   JSONB;
  v_pago                   JSONB;
  v_stock_actual           INTEGER;
  v_cantidad               INTEGER;
  v_producto_id            UUID;
  v_alicuota               TEXT;
  v_factor                 NUMERIC;
  v_subtotal               NUMERIC;
  v_neto_total             NUMERIC := 0;
  v_iva_total              NUMERIC := 0;
  v_entrega_id             UUID;
  v_numero_entrega         TEXT;
  v_entrega_manual_id      UUID := NULL;
  v_dias_credito           INTEGER;
  v_fecha_vencimiento      DATE;
  v_precio_unitario        NUMERIC;
  v_precio_original        NUMERIC;
  v_descuento_pct          NUMERIC;
  v_descuento_monto_item   NUMERIC;
  v_oferta_id              UUID;
  v_descuento_manual_pct   NUMERIC;
  v_descuento_global_monto NUMERIC := 0;
  v_descuento_global_pct   NUMERIC := 0;
  v_bruto_total            NUMERIC := 0;
  v_total                  NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  v_total := ROUND(p_total, 2);

  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito INTO v_dias_credito
    FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
  END IF;
  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha,
    cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa,
    monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha,
    p_cliente_id, p_cliente_nombre, v_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa,
    p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento
  )
  RETURNING id INTO v_comprobante_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');

    v_precio_unitario      := ROUND((v_item->>'precio_unitario')::NUMERIC, 2);
    v_precio_original      := ROUND(COALESCE((v_item->>'precio_original')::NUMERIC,
                                              (v_item->>'precio_unitario')::NUMERIC), 2);
    v_descuento_pct        := COALESCE((v_item->>'descuento_pct')::NUMERIC, 0);
    v_descuento_monto_item := ROUND(COALESCE((v_item->>'descuento_monto')::NUMERIC, 0), 2);
    v_oferta_id            := NULLIF(v_item->>'oferta_id', '')::UUID;
    v_descuento_manual_pct := COALESCE((v_item->>'descuento_manual_pct')::NUMERIC, 0);

    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_producto_id AND empresa_id = p_empresa_id
    FOR UPDATE;

    IF v_stock_actual IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;
    IF v_stock_actual < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)',
        v_producto_id, v_stock_actual, v_cantidad;
    END IF;

    UPDATE public.productos
    SET stock_actual = stock_actual - v_cantidad
    WHERE id = v_producto_id;

    v_factor := CASE v_alicuota
      WHEN '21'   THEN 1.21
      WHEN '10.5' THEN 1.105
      ELSE 1
    END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));

    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id,
      cantidad, precio_unitario, subtotal, alicuota_iva,
      precio_original, descuento_pct, descuento_monto,
      oferta_id, descuento_manual_pct
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id,
      v_cantidad, v_precio_unitario,
      v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item,
      v_oferta_id, v_descuento_manual_pct
    );

    v_descuento_global_monto := v_descuento_global_monto
                                + (v_descuento_monto_item * v_cantidad);
    v_bruto_total := v_bruto_total + (v_precio_original * v_cantidad);

    INSERT INTO public.movimientos_inventario (
      empresa_id, tenant_id, producto_id,
      tipo, cantidad, motivo, fecha
    ) VALUES (
      p_empresa_id, p_empresa_id, v_producto_id,
      'salida', v_cantidad,
      'Venta #' || p_numero_venta,
      p_fecha
    );
  END LOOP;

  v_descuento_global_pct := CASE
    WHEN v_bruto_total > 0
    THEN ROUND(v_descuento_global_monto / v_bruto_total * 100, 2)
    ELSE 0
  END;

  UPDATE public.comprobantes
  SET neto_gravado     = ROUND(v_neto_total, 2),
      iva_discriminado = ROUND(v_iva_total, 2),
      descuento_global_monto = ROUND(v_descuento_global_monto, 2),
      descuento_global_pct = v_descuento_global_pct
  WHERE id = v_comprobante_id;

  IF p_pedido_id IS NOT NULL THEN
    SELECT id INTO v_entrega_manual_id
    FROM public.entregas
    WHERE empresa_id = p_empresa_id
      AND pedido_id  = p_pedido_id
      AND origen     = 'manual'
      AND estado     = 'entregado'
    ORDER BY fecha DESC
    LIMIT 1;
  END IF;

  IF v_entrega_manual_id IS NOT NULL THEN
    UPDATE public.entregas
    SET comprobante_id = v_comprobante_id
    WHERE id = v_entrega_manual_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      UPDATE public.comprobante_items
      SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id
        AND producto_id   = (v_item->>'producto_id')::UUID;
    END LOOP;
  ELSE
    v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
    INSERT INTO public.entregas (
      empresa_id, user_id, numero_entrega, comprobante_id, cliente_id,
      origen, estado, fecha, pedido_id
    ) VALUES (
      p_empresa_id, p_user_id, v_numero_entrega, v_comprobante_id, p_cliente_id,
      'implicita', 'entregado', CURRENT_DATE, p_pedido_id
    ) RETURNING id INTO v_entrega_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
      VALUES (
        v_entrega_id, p_empresa_id,
        (v_item->>'producto_id')::UUID,
        (v_item->>'cantidad')::INTEGER
      );
      UPDATE public.comprobante_items
      SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id
        AND producto_id   = (v_item->>'producto_id')::UUID;
    END LOOP;
  END IF;

  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    IF (v_pago->>'metodo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id,
        tipo, categoria, concepto,
        monto, metodo_pago, fecha, is_automatic,
        monto_paralelo, tc_paralelo
      ) VALUES (
        p_empresa_id, p_user_id, p_caja_sesion_id,
        'ingreso', 'Venta',
        'Venta #' || p_numero_venta,
        ROUND((v_pago->>'monto')::NUMERIC, 2),
        v_pago->>'metodo',
        p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC,
        NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC
      );
    END IF;
  END LOOP;

  IF p_es_cc AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id,
      tipo, monto, descripcion, fecha,
      comprobante_id,
      monto_paralelo, tc_paralelo
    ) VALUES (
      p_empresa_id, p_user_id, p_cliente_id,
      'DEBE', v_total,
      'Venta #' || p_numero_venta,
      p_fecha,
      v_comprobante_id,
      p_monto_paralelo, p_tc_paralelo
    );
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta',   p_numero_venta
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_entrega(p_empresa_id uuid, p_user_id uuid, p_pedido_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_entrega_id     UUID;
  v_numero_entrega TEXT;
  v_cliente_id     UUID;
  v_item           JSONB;
  v_stock_actual   INTEGER;
  v_producto_id    UUID;
  v_cantidad       NUMERIC;
  v_pedido_item_id UUID;
  v_cant_pedida    NUMERIC;
  v_cant_entregada NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT cliente_id INTO v_cliente_id
  FROM public.pedidos
  WHERE id = p_pedido_id AND empresa_id = p_empresa_id;

  IF v_cliente_id IS NULL THEN
    RAISE EXCEPTION 'Pedido no encontrado o no pertenece a la empresa: %', p_pedido_id;
  END IF;

  v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');

  INSERT INTO public.entregas (
    empresa_id, user_id, numero_entrega, pedido_id, cliente_id,
    origen, estado, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_entrega, p_pedido_id, v_cliente_id,
    'manual', 'entregado', CURRENT_DATE
  ) RETURNING id INTO v_entrega_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id    := (v_item->>'producto_id')::UUID;
    v_cantidad       := (v_item->>'cantidad')::NUMERIC;
    v_pedido_item_id := NULLIF(v_item->>'pedido_item_id', '')::UUID;

    IF v_pedido_item_id IS NOT NULL THEN
      SELECT cantidad, cantidad_entregada INTO v_cant_pedida, v_cant_entregada
      FROM public.pedido_items
      WHERE id = v_pedido_item_id AND empresa_id = p_empresa_id
      FOR UPDATE;

      IF v_cant_pedida IS NULL THEN
        RAISE EXCEPTION 'Ítem de pedido no encontrado: %', v_pedido_item_id;
      END IF;

      IF COALESCE(v_cant_entregada, 0) + v_cantidad > v_cant_pedida THEN
        RAISE EXCEPTION 'Sobre-entrega: el ítem tiene % pedido(s) y ya se entregaron %. No se puede entregar % más.',
          v_cant_pedida, COALESCE(v_cant_entregada, 0), v_cantidad;
      END IF;
    END IF;

    SELECT stock_actual INTO v_stock_actual
    FROM public.productos
    WHERE id = v_producto_id AND empresa_id = p_empresa_id
    FOR UPDATE;

    IF v_stock_actual IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;

    IF v_stock_actual < v_cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para producto %. Disponible: %, Solicitado: %',
        v_producto_id, v_stock_actual, v_cantidad;
    END IF;

    UPDATE public.productos
    SET stock_actual = stock_actual - v_cantidad::INTEGER
    WHERE id = v_producto_id AND empresa_id = p_empresa_id;

    INSERT INTO public.movimientos_inventario (
      empresa_id, tenant_id, producto_id,
      tipo, cantidad, motivo, fecha
    ) VALUES (
      p_empresa_id, p_empresa_id, v_producto_id,
      'salida', v_cantidad::INTEGER,
      'Entrega ' || v_numero_entrega,
      NOW()
    );

    INSERT INTO public.entrega_items (
      entrega_id, empresa_id, producto_id, cantidad, pedido_item_id
    ) VALUES (
      v_entrega_id, p_empresa_id, v_producto_id, v_cantidad, v_pedido_item_id
    );

    IF v_pedido_item_id IS NOT NULL THEN
      UPDATE public.pedido_items
      SET cantidad_entregada = cantidad_entregada + v_cantidad
      WHERE id = v_pedido_item_id AND empresa_id = p_empresa_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('entrega_id', v_entrega_id, 'numero_entrega', v_numero_entrega);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_nota_credito(p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_motivo_nc text, p_items jsonb, p_comprobante_origen_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_id       UUID;
  v_numero        TEXT;
  v_item          JSONB;
  v_subtotal_neto NUMERIC := 0;
  v_total_iva     NUMERIC := 0;
  v_total         NUMERIC;
  v_cantidad      NUMERIC;
  v_precio        NUMERIC;
  v_alicuota      NUMERIC;
  v_neto_item     NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;

  IF p_comprobante_origen_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_origen_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'comprobante_origen_id no pertenece a la empresa';
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La NC debe tener al menos un ítem';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad  := (v_item->>'cantidad')::NUMERIC;
    v_precio    := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota  := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_neto_item := v_cantidad * v_precio;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva     := v_total_iva + (v_neto_item * v_alicuota / 100);
  END LOOP;

  v_total := v_subtotal_neto + v_total_iva;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'El total de la NC debe ser mayor a cero';
  END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito');

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre,
    total, neto_gravado, iva_discriminado, forma_pago, estado_pago,
    moneda, tipo_cambio_tasa, tipo, comprobante_origen_id, motivo_nc
  ) VALUES (
    p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id,
    COALESCE(p_cliente_nombre, 'Consumidor Final'),
    v_total, v_subtotal_neto, v_total_iva, 'Nota de Crédito', 'pagada',
    'ARS', 1, 'nota_credito', p_comprobante_origen_id, p_motivo_nc
  ) RETURNING id INTO v_comp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;

    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id, cantidad,
      precio_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_comp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, v_cantidad,
      v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21')
    );
  END LOOP;

  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_cliente_id, v_comp_id, 'HABER', v_total,
      'NC ' || v_numero || ' — ' || p_motivo_nc, now()
    );
  END IF;

  RETURN jsonb_build_object('comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_monto numeric, p_metodo text, p_fecha timestamp with time zone, p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid, p_monto_paralelo numeric DEFAULT NULL::numeric, p_tc_paralelo numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_monto      numeric;
  v_paralelo   numeric;
  v_cc_id      uuid;
  v_caja_id    uuid;
  v_fecha_dia  date;
  v_cerrado    boolean;
  v_cta_caja   uuid;
  v_cta_cxc    uuid;
  v_asiento_id uuid;
  v_asiento_generado boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('ventas') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
    END IF;
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del cobro debe ser mayor a cero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El cliente no pertenece a la empresa';
  END IF;

  v_monto    := ROUND(p_monto, 2);
  v_paralelo := CASE WHEN p_monto_paralelo IS NOT NULL THEN ROUND(p_monto_paralelo, 2) END;

  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, p_metodo, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_cc_id;

  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || p_metodo,
     v_monto, p_metodo, true, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_caja_id;

  BEGIN
    v_fecha_dia := p_fecha::date;
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;

    IF NOT COALESCE(v_cerrado, false) THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      SELECT id INTO v_cta_cxc  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;

      IF v_cta_caja IS NOT NULL AND v_cta_cxc IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente'),
          'confirmado', v_monto, v_monto, 'cobro_cliente', v_cc_id
        ) RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Cobro recibido', v_monto, 0),
          (v_asiento_id, p_empresa_id, v_cta_cxc,  'Cancelación parcial/total de deuda', 0, v_monto);

        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  RETURN jsonb_build_object('ok', true, 'cc_id', v_cc_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reencolar_caes_pendientes(p_empresa_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  r RECORD;
BEGIN
  IF p_empresa_id IS NULL OR p_empresa_id <> get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el tenant del caller';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  FOR r IN
    SELECT c.id, c.punto_venta_id, COALESCE(c.tipo_comprobante_afip, 'B') AS tipo
    FROM public.comprobantes c
    WHERE c.empresa_id = p_empresa_id
      AND c.cae_estado IN ('pendiente', 'error')
    ORDER BY c.fecha ASC
    LIMIT 50
  LOOP
    UPDATE public.facturas_pendientes_arca
       SET estado          = 'pendiente',
           intentos        = 0,
           proximo_intento = now(),
           error_mensaje   = NULL,
           updated_at      = now()
     WHERE comprobante_id = r.id
       AND estado IN ('pendiente', 'reintentando', 'error_datos', 'error_definitivo');

    IF NOT FOUND THEN
      INSERT INTO public.facturas_pendientes_arca (
        empresa_id, comprobante_id, punto_venta_id,
        tipo_comprobante, codigo_afip, payload_arca,
        estado, proximo_intento
      ) VALUES (
        p_empresa_id, r.id, r.punto_venta_id,
        r.tipo,
        CASE r.tipo WHEN 'A' THEN 1::smallint WHEN 'C' THEN 11::smallint ELSE 6::smallint END,
        '{}'::jsonb, 'pendiente', now()
      )
      ON CONFLICT (comprobante_id)
        WHERE comprobante_id IS NOT NULL AND estado NOT IN ('emitida', 'error_definitivo')
        DO NOTHING;
    END IF;

    UPDATE public.comprobantes
       SET cae_estado = 'pendiente', error_afip = NULL
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.usar_caea_en_venta(p_empresa_id uuid, p_comprobante_id uuid, p_caea_registro_id uuid, p_tipo_cbte integer, p_nro_cbte integer, p_fecha_cbte date, p_doc_tipo integer, p_doc_nro character varying, p_imp_total numeric, p_imp_neto numeric, p_imp_iva numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pv integer;
BEGIN
  IF p_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.caea_registros
    WHERE id = p_caea_registro_id
      AND empresa_id = p_empresa_id
      AND estado = 'activo'
      AND fecha_hasta >= CURRENT_DATE
  ) THEN
    RAISE EXCEPTION 'CAEA no vigente o no pertenece a la empresa';
  END IF;

  SELECT punto_venta INTO v_pv
  FROM public.caea_registros
  WHERE id = p_caea_registro_id;

  INSERT INTO public.caea_comprobantes (
    empresa_id, caea_registro_id, comprobante_id,
    tipo_cbte, punto_venta,
    nro_cbte_desde, nro_cbte_hasta,
    fecha_cbte, doc_tipo, doc_nro,
    imp_total, imp_neto, imp_iva
  ) VALUES (
    p_empresa_id, p_caea_registro_id, p_comprobante_id,
    p_tipo_cbte, COALESCE(v_pv, 1),
    p_nro_cbte, p_nro_cbte,
    p_fecha_cbte, p_doc_tipo, p_doc_nro,
    p_imp_total, p_imp_neto, p_imp_iva
  );

  UPDATE public.comprobantes
  SET modo_autorizacion = 'CAEA',
      caea_registro_id  = p_caea_registro_id,
      cae_estado        = 'no_aplica'
  WHERE id = p_comprobante_id
    AND empresa_id = p_empresa_id;

  UPDATE public.caea_registros
  SET comprobantes_emitidos = comprobantes_emitidos + 1,
      updated_at            = now()
  WHERE id = p_caea_registro_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.siguiente_numero_documento(p_empresa_id uuid, p_tabla text, p_columna text, p_prefijo text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anio  TEXT    := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  v_count INTEGER;
  v_query TEXT;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF NOT (
       (p_tabla = 'entregas'     AND p_columna = 'numero_entrega'    AND p_prefijo = 'ENT')
    OR (p_tabla = 'devoluciones' AND p_columna = 'numero_devolucion' AND p_prefijo = 'DEV')
    OR (p_tabla = 'comprobantes' AND p_columna = 'numero_venta'      AND p_prefijo = 'NC')
  ) THEN
    RAISE EXCEPTION 'Combinacion (tabla, columna, prefijo) no permitida: (%, %, %)',
      p_tabla, p_columna, p_prefijo;
  END IF;

  v_query := format(
    'SELECT COUNT(*) FROM public.%I WHERE empresa_id = $1 AND %I LIKE $2',
    p_tabla, p_columna
  );
  EXECUTE v_query INTO v_count
    USING p_empresa_id, p_prefijo || '-' || v_anio || '-%';
  RETURN p_prefijo || '-' || v_anio || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$function$;

-- ═══════════════════════════════ COMPRAS ══════════════════════════════════════

CREATE OR REPLACE FUNCTION public.crear_recepcion(p_empresa_id uuid, p_user_id uuid, p_orden_compra_id uuid, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recepcion_id     UUID;
  v_numero_recepcion TEXT;
  v_proveedor_id     UUID;
  v_item             JSONB;
  v_producto_id      UUID;
  v_cantidad         NUMERIC;
  v_oc_item_id       UUID;
  v_cantidad_pedida  NUMERIC;
  v_cantidad_recibida_actual NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT proveedor_id INTO v_proveedor_id
  FROM public.ordenes_compra
  WHERE id = p_orden_compra_id AND empresa_id = p_empresa_id;

  IF v_proveedor_id IS NULL THEN
    RAISE EXCEPTION 'Orden de compra no encontrada o no pertenece a la empresa: %', p_orden_compra_id;
  END IF;

  v_numero_recepcion := public.obtener_proximo_numero(p_empresa_id, 'recepcion');

  INSERT INTO public.recepciones (
    empresa_id, user_id, numero_recepcion, orden_compra_id, proveedor_id,
    origen, estado, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_recepcion, p_orden_compra_id, v_proveedor_id,
    'manual', 'recibido', CURRENT_DATE
  ) RETURNING id INTO v_recepcion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC;
    v_oc_item_id  := NULLIF(v_item->>'orden_compra_item_id', '')::UUID;

    IF v_oc_item_id IS NOT NULL THEN
      SELECT cantidad_pedida, cantidad_recibida
        INTO v_cantidad_pedida, v_cantidad_recibida_actual
      FROM public.ordenes_compra_items
      WHERE id = v_oc_item_id
      FOR UPDATE;

      IF v_cantidad_recibida_actual + v_cantidad > v_cantidad_pedida THEN
        RAISE EXCEPTION 'La cantidad a recibir (%) superaria lo pedido para el item % (pedido: %, ya recibido: %)',
          v_cantidad, v_oc_item_id, v_cantidad_pedida, v_cantidad_recibida_actual;
      END IF;
    END IF;

    IF v_oc_item_id IS NULL THEN
      UPDATE public.productos
      SET stock_actual = stock_actual + v_cantidad::INTEGER
      WHERE id = v_producto_id AND empresa_id = p_empresa_id;
    END IF;

    INSERT INTO public.movimientos_inventario (
      empresa_id, tenant_id, producto_id,
      tipo, cantidad, motivo, fecha
    ) VALUES (
      p_empresa_id, p_empresa_id, v_producto_id,
      'ingreso', v_cantidad::INTEGER,
      'Recepción ' || v_numero_recepcion,
      NOW()
    );

    INSERT INTO public.recepcion_items (
      recepcion_id, empresa_id, producto_id, cantidad, orden_compra_item_id
    ) VALUES (
      v_recepcion_id, p_empresa_id, v_producto_id, v_cantidad, v_oc_item_id
    );

    IF v_oc_item_id IS NOT NULL THEN
      UPDATE public.ordenes_compra_items
      SET cantidad_recibida = cantidad_recibida + v_cantidad
      WHERE id = v_oc_item_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('recepcion_id', v_recepcion_id, 'numero_recepcion', v_numero_recepcion);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_recepcion_implicita(p_empresa_id uuid, p_user_id uuid, p_compra_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recepcion_id     UUID;
  v_numero_recepcion TEXT;
  v_proveedor_id     UUID;
  v_item             RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT proveedor_id INTO v_proveedor_id
  FROM public.compras
  WHERE id = p_compra_id AND empresa_id = p_empresa_id;

  IF v_proveedor_id IS NULL THEN
    RAISE EXCEPTION 'Compra no encontrada o no pertenece a la empresa: %', p_compra_id;
  END IF;

  v_numero_recepcion := public.obtener_proximo_numero(p_empresa_id, 'recepcion');

  INSERT INTO public.recepciones (
    empresa_id, user_id, numero_recepcion, compra_id, proveedor_id,
    origen, estado, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_recepcion, p_compra_id, v_proveedor_id,
    'implicita', 'recibido', CURRENT_DATE
  ) RETURNING id INTO v_recepcion_id;

  FOR v_item IN
    SELECT id, producto_id, cantidad
    FROM public.detalle_compras
    WHERE compra_id = p_compra_id AND empresa_id = p_empresa_id
  LOOP
    INSERT INTO public.recepcion_items (recepcion_id, empresa_id, producto_id, cantidad)
    VALUES (v_recepcion_id, p_empresa_id, v_item.producto_id, v_item.cantidad);

    UPDATE public.detalle_compras
    SET cantidad_recibida = v_item.cantidad
    WHERE id = v_item.id;
  END LOOP;

  RETURN jsonb_build_object('recepcion_id', v_recepcion_id, 'numero_recepcion', v_numero_recepcion);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_proveedor_nombre text, p_monto numeric, p_metodo text, p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_monto      numeric;
  v_ccp_id     uuid;
  v_caja_id    uuid;
  v_fecha_dia  date := now()::date;
  v_cerrado    boolean;
  v_cta_caja   uuid;
  v_cta_cxp    uuid;
  v_asiento_id uuid;
  v_asiento_generado boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('compras') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
    END IF;
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El proveedor no pertenece a la empresa';
  END IF;

  v_monto := ROUND(p_monto, 2);

  INSERT INTO public.cuenta_corriente_proveedores
    (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha)
  VALUES
    (p_empresa_id, p_proveedor_id, 'pago', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago a proveedor'), p_user_id, now())
  RETURNING id INTO v_ccp_id;

  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, now(), 'egreso', 'Pago Proveedor',
     'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor') || ' - ' || p_metodo,
     v_monto, p_metodo, true)
  RETURNING id INTO v_caja_id;

  BEGIN
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;

    IF NOT COALESCE(v_cerrado, false) THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      SELECT id INTO v_cta_cxp  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;

      IF v_cta_caja IS NOT NULL AND v_cta_cxp IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor'),
          'confirmado', v_monto, v_monto, 'pago_proveedor', v_ccp_id
        ) RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_cxp,  'Cancelación parcial/total de deuda', v_monto, 0),
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Pago realizado', 0, v_monto);

        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  RETURN jsonb_build_object('ok', true, 'ccp_id', v_ccp_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.aplicar_compra_producto(p_producto_id uuid, p_cantidad numeric, p_costo_nuevo numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id   UUID;
  v_stock_previo NUMERIC;
  v_costo_previo NUMERIC;
  v_metodo       TEXT;
  v_costo_final  NUMERIC;
BEGIN
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT empresa_id, stock_actual, costo_compra
    INTO v_empresa_id, v_stock_previo, v_costo_previo
  FROM public.productos
  WHERE id = p_producto_id AND empresa_id = get_my_empresa_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  SELECT metodo_valoracion_stock INTO v_metodo
  FROM public.empresas WHERE id = v_empresa_id;

  v_costo_final := public.fn_calcular_costo_valoracion(
    COALESCE(v_metodo, 'ultimo_costo'), v_stock_previo, v_costo_previo, p_cantidad, p_costo_nuevo
  );

  UPDATE public.productos
  SET stock_actual = COALESCE(stock_actual, 0) + p_cantidad,
      costo_compra  = v_costo_final
  WHERE id = p_producto_id;

  RETURN v_costo_final;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrement_stock(p_producto_id uuid, p_cantidad integer, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
BEGIN
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  UPDATE public.productos
  SET stock_actual = stock_actual - p_cantidad
  WHERE id = p_producto_id AND empresa_id = get_my_empresa_id()
  RETURNING empresa_id INTO v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  IF (SELECT stock_actual FROM public.productos WHERE id = p_producto_id) < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para el producto: %', p_producto_id;
  END IF;

  INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
  VALUES (v_empresa_id, p_producto_id, 'salida', p_cantidad, COALESCE(p_motivo, 'Ajuste de stock (decrement_stock)'), auth.uid());
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_stock(row_id uuid, quantity numeric, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock_actual NUMERIC;
  v_empresa_id   uuid;
BEGIN
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT stock_actual, empresa_id INTO v_stock_actual, v_empresa_id
  FROM public.productos
  WHERE id = row_id AND empresa_id = get_my_empresa_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', row_id;
  END IF;

  IF COALESCE(v_stock_actual, 0) + quantity < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para el producto: %', row_id;
  END IF;

  UPDATE public.productos
  SET stock_actual = COALESCE(stock_actual, 0) + quantity
  WHERE id = row_id;

  INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
  VALUES (
    v_empresa_id, row_id,
    CASE WHEN quantity >= 0 THEN 'entrada' ELSE 'salida' END,
    ABS(quantity)::integer,
    COALESCE(p_motivo, 'Ajuste de stock (increment_stock)'),
    auth.uid()
  );
END;
$function$;

-- ═══════════════════════════════ PRODUCTOS ════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ajustar_stock_manual(p_producto_id uuid, p_tipo text, p_cantidad integer, p_motivo text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_stock_actual integer;
  v_nuevo_stock integer;
BEGIN
  v_empresa_id := get_my_empresa_id();

  IF NOT has_module_permission('productos') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo productos';
  END IF;

  IF p_tipo NOT IN ('entrada', 'salida', 'ajuste') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', p_tipo;
  END IF;

  IF p_cantidad < 0 THEN
    RAISE EXCEPTION 'Cantidad inválida: %', p_cantidad;
  END IF;

  SELECT stock_actual INTO v_stock_actual
  FROM public.productos
  WHERE id = p_producto_id AND empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  IF p_tipo = 'entrada' THEN
    v_nuevo_stock := v_stock_actual + p_cantidad;
  ELSIF p_tipo = 'salida' THEN
    v_nuevo_stock := v_stock_actual - p_cantidad;
  ELSE
    v_nuevo_stock := p_cantidad;
  END IF;

  IF v_nuevo_stock < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para el producto: %', p_producto_id;
  END IF;

  UPDATE public.productos
  SET stock_actual = v_nuevo_stock
  WHERE id = p_producto_id;

  INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
  VALUES (v_empresa_id, p_producto_id, p_tipo, p_cantidad, p_motivo, auth.uid());
END;
$function$;

-- ═══════════════════════════ DUAL (VENTAS O COMPRAS) ══════════════════════════

CREATE OR REPLACE FUNCTION public.crear_devolucion(p_empresa_id uuid, p_user_id uuid, p_tipo text, p_items jsonb, p_entrega_id uuid DEFAULT NULL::uuid, p_recepcion_id uuid DEFAULT NULL::uuid, p_comprobante_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_proveedor_id uuid DEFAULT NULL::uuid, p_reingresa_stock boolean DEFAULT false, p_compensacion text DEFAULT 'pendiente'::text, p_reembolso_efectivo boolean DEFAULT false, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_devolucion_id    UUID;
  v_numero_dev       TEXT;
  v_item             JSONB;
  v_producto_id      UUID;
  v_cantidad         NUMERIC;
  v_precio_unit      NUMERIC;
  v_subtotal         NUMERIC;
  v_total_dev        NUMERIC := 0;
  v_nc_id            UUID    := NULL;
  v_numero_nc        TEXT    := NULL;
  v_cliente_nombre   TEXT;
  v_caja_sesion_id   UUID;
  v_stock_actual_dev NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF NOT (has_module_permission('ventas') OR has_module_permission('compras')) THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas o compras';
  END IF;

  v_numero_dev := public.obtener_proximo_numero(p_empresa_id, 'devolucion');

  INSERT INTO public.devoluciones (
    empresa_id, user_id, numero_devolucion, tipo,
    entrega_id, recepcion_id, comprobante_id, compra_id,
    cliente_id, proveedor_id,
    reingresa_stock, compensacion, reembolso_efectivo, motivo
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_dev, p_tipo,
    p_entrega_id, p_recepcion_id, p_comprobante_id, p_compra_id,
    p_cliente_id, p_proveedor_id,
    p_reingresa_stock, p_compensacion, p_reembolso_efectivo, p_motivo
  ) RETURNING id INTO v_devolucion_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC;
    v_precio_unit := (v_item->>'precio_unitario')::NUMERIC;
    v_subtotal    := v_cantidad * v_precio_unit;
    v_total_dev   := v_total_dev + v_subtotal;

    INSERT INTO public.devolucion_items (
      devolucion_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal,
      comprobante_item_id, detalle_compra_item_id
    ) VALUES (
      v_devolucion_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unit, v_subtotal,
      NULLIF(v_item->>'comprobante_item_id', '')::UUID,
      NULLIF(v_item->>'detalle_compra_item_id', '')::UUID
    );

    IF (v_item->>'comprobante_item_id') IS NOT NULL AND (v_item->>'comprobante_item_id') <> '' THEN
      UPDATE public.comprobante_items
      SET cantidad_devuelta = cantidad_devuelta + v_cantidad
      WHERE id = (v_item->>'comprobante_item_id')::UUID;
    END IF;

    IF (v_item->>'detalle_compra_item_id') IS NOT NULL AND (v_item->>'detalle_compra_item_id') <> '' THEN
      UPDATE public.detalle_compras
      SET cantidad_devuelta = cantidad_devuelta + v_cantidad
      WHERE id = (v_item->>'detalle_compra_item_id')::UUID;
    END IF;

    IF p_reingresa_stock THEN
      IF p_tipo = 'cliente' THEN
        UPDATE public.productos
        SET stock_actual = stock_actual + v_cantidad
        WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (
          empresa_id, producto_id, tipo, cantidad, motivo, user_id
        ) VALUES (
          p_empresa_id, v_producto_id, 'ingreso', v_cantidad::INTEGER,
          'Devolucion cliente ' || v_numero_dev, p_user_id
        );
      ELSE
        SELECT stock_actual INTO v_stock_actual_dev
        FROM public.productos
        WHERE id = v_producto_id AND empresa_id = p_empresa_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', v_producto_id;
        END IF;

        IF COALESCE(v_stock_actual_dev, 0) - v_cantidad < 0 THEN
          RAISE EXCEPTION 'Stock insuficiente para devolver al proveedor el producto: %', v_producto_id;
        END IF;

        UPDATE public.productos
        SET stock_actual = stock_actual - v_cantidad
        WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (
          empresa_id, producto_id, tipo, cantidad, motivo, user_id
        ) VALUES (
          p_empresa_id, v_producto_id, 'salida', v_cantidad::INTEGER,
          'Devolucion a proveedor ' || v_numero_dev, p_user_id
        );
      END IF;
    END IF;
  END LOOP;

  IF p_compensacion = 'nota_credito' THEN
    v_numero_nc := public.obtener_proximo_numero(p_empresa_id, 'nota_credito');

    SELECT nombre INTO v_cliente_nombre
    FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id;

    INSERT INTO public.comprobantes (
      empresa_id, numero_venta, tipo, cliente_id, cliente_nombre, total,
      comprobante_origen_id, motivo_nc, forma_pago, estado_pago
    ) VALUES (
      p_empresa_id, v_numero_nc, 'nota_credito',
      p_cliente_id, COALESCE(v_cliente_nombre, 'Consumidor Final'),
      v_total_dev, p_comprobante_id, p_motivo,
      'Efectivo',
      CASE WHEN p_reembolso_efectivo THEN 'pagada' ELSE 'pendiente' END
    ) RETURNING id INTO v_nc_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      v_producto_id := (v_item->>'producto_id')::UUID;
      v_cantidad    := (v_item->>'cantidad')::NUMERIC;
      v_precio_unit := (v_item->>'precio_unitario')::NUMERIC;
      INSERT INTO public.comprobante_items (
        empresa_id, comprobante_id, producto_id,
        cantidad, precio_unitario, subtotal
      ) VALUES (
        p_empresa_id, v_nc_id, v_producto_id,
        v_cantidad::INTEGER, v_precio_unit, v_cantidad * v_precio_unit
      );
    END LOOP;

    IF NOT p_reembolso_efectivo THEN
      INSERT INTO public.cuenta_corriente_movimientos (
        empresa_id, cliente_id, tipo, monto, descripcion, comprobante_id
      ) VALUES (
        p_empresa_id, p_cliente_id, 'HABER', v_total_dev,
        'NC ' || v_numero_nc || ' por devolucion ' || v_numero_dev,
        v_nc_id
      );
    ELSE
      SELECT id INTO v_caja_sesion_id
      FROM public.caja_sesiones
      WHERE empresa_id = p_empresa_id AND estado = 'abierta'
      ORDER BY apertura_fecha DESC LIMIT 1;

      IF v_caja_sesion_id IS NULL THEN
        RAISE EXCEPTION 'Caja cerrada: abri la caja para procesar reembolsos en efectivo';
      END IF;

      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo,
        categoria, concepto, monto, metodo_pago, is_automatic
      ) VALUES (
        p_empresa_id, p_user_id, v_caja_sesion_id,
        CASE WHEN p_tipo = 'cliente' THEN 'egreso' ELSE 'ingreso' END,
        'Devoluciones',
        'Reembolso devolucion ' || v_numero_dev,
        v_total_dev, 'Efectivo', TRUE
      );
    END IF;

    UPDATE public.devoluciones SET nota_credito_id = v_nc_id WHERE id = v_devolucion_id;
  END IF;

  RETURN jsonb_build_object(
    'devolucion_id',     v_devolucion_id,
    'numero_devolucion', v_numero_dev,
    'nota_credito_id',   v_nc_id,
    'numero_nc',         v_numero_nc,
    'total',             v_total_dev
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_nota_debito(p_empresa_id uuid, p_user_id uuid, p_tipo text, p_concepto text, p_monto numeric, p_comprobante_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_proveedor_id uuid DEFAULT NULL::uuid, p_moneda text DEFAULT 'ARS'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nd_id     UUID;
  v_numero_nd TEXT;
  v_cc_id     UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF NOT (has_module_permission('ventas') OR has_module_permission('compras')) THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas o compras';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto de la nota de débito debe ser mayor a cero';
  END IF;

  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;

  IF p_proveedor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'proveedor_id no pertenece a la empresa';
  END IF;

  IF p_comprobante_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'comprobante_id no pertenece a la empresa';
  END IF;

  IF p_compra_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compras WHERE id = p_compra_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'compra_id no pertenece a la empresa';
  END IF;

  v_numero_nd := public.obtener_proximo_numero(p_empresa_id, 'nota_debito');

  INSERT INTO public.notas_debito (
    empresa_id, user_id, numero_nd, tipo,
    comprobante_id, compra_id, cliente_id, proveedor_id,
    concepto, monto, moneda
  ) VALUES (
    p_empresa_id, p_user_id, v_numero_nd, p_tipo,
    p_comprobante_id, p_compra_id, p_cliente_id, p_proveedor_id,
    p_concepto, p_monto, p_moneda
  ) RETURNING id INTO v_nd_id;

  IF p_tipo = 'emitida' AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, cliente_id, tipo, monto, descripcion, comprobante_id
    ) VALUES (
      p_empresa_id, p_cliente_id, 'DEBE', p_monto,
      'ND ' || v_numero_nd || ' - ' || p_concepto,
      p_comprobante_id
    ) RETURNING id INTO v_cc_id;

    UPDATE public.notas_debito SET cc_movimiento_id = v_cc_id WHERE id = v_nd_id;

  ELSIF p_tipo = 'recibida' AND p_proveedor_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_proveedores (
      empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
      referencia_id, referencia_tipo, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_proveedor_id, 'nota_debito', p_monto,
      'ND ' || v_numero_nd || ' recibida - ' || p_concepto,
      v_nd_id, 'nd_proveedor', now()
    ) RETURNING id INTO v_cc_id;

    UPDATE public.notas_debito SET cc_movimiento_id = v_cc_id WHERE id = v_nd_id;
  END IF;

  RETURN jsonb_build_object('nota_debito_id', v_nd_id, 'numero_nd', v_numero_nd);
END;
$function$;
