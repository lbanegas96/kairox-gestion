-- Sesión 39: cierra los 4 riesgos latentes documentados en el Mapa de escritores
-- de stock_actual (CONTEXT.md, sesión 36) — cierra por completo la auditoría de
-- estabilización de sesión 32.

-- ───────────────────────────────────────────────────────────────────────────
-- Riesgo 1: crear_devolucion (rama proveedor) podía dejar stock_actual negativo.
-- Devolver a un proveedor más de lo que hay en stock es un error de dato, no un
-- caso de negocio legítimo (a diferencia de una venta, no hay "devolución
-- anticipada" razonable: solo se devuelve lo que físicamente se tiene). Se
-- aplica el mismo criterio que crear_venta/crear_entrega: SELECT...FOR UPDATE +
-- RAISE si el resultado sería negativo. La rama 'cliente' (ingreso de stock) no
-- necesita lock: un incremento relativo nunca puede generar negativo.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crear_devolucion(p_empresa_id uuid, p_user_id uuid, p_tipo text, p_items jsonb, p_entrega_id uuid DEFAULT NULL::uuid, p_recepcion_id uuid DEFAULT NULL::uuid, p_comprobante_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_proveedor_id uuid DEFAULT NULL::uuid, p_reingresa_stock boolean DEFAULT false, p_compensacion text DEFAULT 'pendiente'::text, p_reembolso_efectivo boolean DEFAULT false, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_devolucion_id  UUID;
  v_numero_dev     TEXT;
  v_item           JSONB;
  v_producto_id    UUID;
  v_cantidad       NUMERIC;
  v_precio_unit    NUMERIC;
  v_subtotal       NUMERIC;
  v_total_dev      NUMERIC := 0;
  v_nc_id          UUID    := NULL;
  v_numero_nc      TEXT    := NULL;
  v_cliente_nombre TEXT;
  v_caja_sesion_id UUID;
  v_stock_actual_dev NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  v_numero_dev := public.siguiente_numero_documento(
    p_empresa_id, 'devoluciones', 'numero_devolucion', 'DEV'
  );

  -- ── 1. Cabecera devolución ──────────────────────────────────────────────
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

  -- ── 2. Procesar items ───────────────────────────────────────────────────
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

    -- Actualizar contador en línea origen
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

    -- ── 3. Reingreso de stock ──────────────────────────────────────────────
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

  -- ── 4. Compensación: Nota de Crédito ──────────────────────────────────
  IF p_compensacion = 'nota_credito' THEN
    v_numero_nc := public.siguiente_numero_documento(
      p_empresa_id, 'comprobantes', 'numero_venta', 'NC'
    );

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

    -- Items de la NC (replica devolucion_items)
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

    -- Impacto financiero
    IF NOT p_reembolso_efectivo THEN
      -- CC HABER → reduce lo que el cliente nos debe
      INSERT INTO public.cuenta_corriente_movimientos (
        empresa_id, cliente_id, tipo, monto, descripcion, comprobante_id
      ) VALUES (
        p_empresa_id, p_cliente_id, 'HABER', v_total_dev,
        'NC ' || v_numero_nc || ' por devolucion ' || v_numero_dev,
        v_nc_id
      );
    ELSE
      -- Reembolso efectivo: verificar caja abierta
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

-- ───────────────────────────────────────────────────────────────────────────
-- Riesgo 2: increment_stock no validaba negativo. OJO: hay 2 callers reales en
-- CompraRapidaSection.jsx que pasan `quantity` NEGATIVO a propósito (revertir
-- stock al borrar un ítem de una compra editada, o al reducir la cantidad de un
-- ítem ya existente) — rechazar quantity<0 rompería esos 2 flujos legítimos.
-- El fix correcto es validar el RESULTADO (stock_actual + quantity >= 0), no el
-- signo del parámetro, igual criterio que decrement_stock/ajustar_stock_manual.
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.increment_stock(row_id uuid, quantity numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock_actual NUMERIC;
BEGIN
  SELECT stock_actual INTO v_stock_actual
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
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- Riesgos 3 y 4: el cálculo de costo PPP en fn_oc_update_stock y
-- aplicar_compra_producto leía stock_actual/costo_compra de productos SIN lock.
-- fn_oc_update_stock es un trigger sobre ordenes_compra_items: el UPDATE que lo
-- dispara bloquea la fila de ordenes_compra_items, NO la de productos — el lock
-- implícito no cubre la lectura que necesita el cálculo de PPP. Se agrega
-- FOR UPDATE explícito en ambas para serializar lecturas concurrentes del mismo
-- producto (análogo al problema de numeración sin lock de la sesión 30).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_oc_update_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  delta          NUMERIC;
  v_stock_previo NUMERIC;
  v_costo_previo NUMERIC;
  v_metodo       TEXT;
  v_costo_final  NUMERIC;
BEGIN
  delta := NEW.cantidad_recibida - OLD.cantidad_recibida;
  IF delta > 0 AND NEW.producto_id IS NOT NULL THEN
    SELECT stock_actual, costo_compra INTO v_stock_previo, v_costo_previo
    FROM public.productos WHERE id = NEW.producto_id
    FOR UPDATE;

    SELECT metodo_valoracion_stock INTO v_metodo
    FROM public.empresas WHERE id = NEW.empresa_id;

    v_costo_final := public.fn_calcular_costo_valoracion(
      COALESCE(v_metodo, 'ultimo_costo'), COALESCE(v_stock_previo, 0), COALESCE(v_costo_previo, 0),
      delta, NEW.costo_unitario
    );

    UPDATE public.productos
    SET stock_actual = COALESCE(stock_actual, 0) + delta,
        costo_compra  = v_costo_final
    WHERE id = NEW.producto_id;
  END IF;
  RETURN NEW;
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

-- Rollback (comentado): restaurar cada función a su versión previa a esta
-- migration (ver migrations 050/053/etc. para el texto original de cada una).
