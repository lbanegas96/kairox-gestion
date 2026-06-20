-- =============================================================================
-- MIGRATION 053 — Fix: doble incremento de stock al recibir contra una OC
-- =============================================================================
-- Bug encontrado durante la sesión 30 (numeración), fuera de ese alcance, sin
-- tocar hasta ahora.
--
-- crear_recepcion(), para cada item con orden_compra_item_id != NULL, hacía:
--   1. UPDATE productos SET stock_actual = stock_actual + v_cantidad   (directo)
--   2. UPDATE ordenes_compra_items SET cantidad_recibida = cantidad_recibida + v_cantidad
-- El paso 2 dispara trg_oc_stock → fn_oc_update_stock() (migration 003,
-- redefinida en 049), que TAMBIÉN hace
--   UPDATE productos SET stock_actual = stock_actual + delta
-- con delta = el mismo v_cantidad. Resultado: stock_actual queda incrementado
-- EL DOBLE de lo recibido, cada vez que la recepción viene de una OC con item
-- vinculado.
--
-- Además, desde la migration 049, fn_oc_update_stock() también recalcula
-- productos.costo_compra bajo Promedio Ponderado leyendo stock_actual COMO
-- "stock previo" — pero para el momento en que el trigger corre, ese stock ya
-- fue inflado por el UPDATE directo del paso 1 dentro de la misma función. Es
-- decir, el bug no solo duplica la cantidad: también corrompe el cálculo de
-- PPP (usa un stock_previo que ya no es el previo real).
--
-- NO afecta a crear_recepcion_implicita() (compras directas sin OC, vía
-- CompraRapidaSection) — esa función nunca toca ordenes_compra_items.
--
-- Fix: el UPDATE directo de productos pasa a ejecutarse SOLO cuando
-- v_oc_item_id IS NULL (item de recepción sin vínculo a ningún ítem de OC,
-- caso en el que el trigger nunca se dispara y sigue siendo la única fuente
-- que toca stock_actual). Cuando v_oc_item_id IS NOT NULL, el trigger
-- trg_oc_stock queda como única fuente de verdad para stock_actual y
-- costo_compra — sin cambios en fn_oc_update_stock() ni en
-- fn_calcular_costo_valoracion().
--
-- Resto de la función (numeración vía obtener_proximo_numero, movimientos_inventario,
-- recepcion_items) idéntico a la versión vigente desde migration 052 — no se
-- tocó nada más.
-- =============================================================================

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
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
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

    -- Fix migration 053: si el item está vinculado a un ordenes_compra_items,
    -- el UPDATE de cantidad_recibida más abajo dispara trg_oc_stock, que ya
    -- incrementa stock_actual (y recalcula costo_compra). Hacerlo también
    -- aquí duplicaba el incremento. Solo se actualiza stock_actual
    -- directamente cuando NO hay item de OC vinculado (el trigger nunca se
    -- dispara en ese caso).
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
