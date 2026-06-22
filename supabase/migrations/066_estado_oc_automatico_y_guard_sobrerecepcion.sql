-- Sesión 50: cierra los 2 gaps funcionales documentados en sesión 44
-- (PLAN_SEMANA.md secciones 2.1 y 2.2), decisiones confirmadas por Luciano:
-- trigger automático para el estado de la OC + bloquear sobre-recepción.

-- ───────────────────────────────────────────────────────────────────────────
-- 2.1: ordenes_compra.estado nunca se actualizaba solo. Trigger nuevo
-- (separado de trg_oc_stock — responsabilidad distinta) que recalcula el
-- estado del padre cada vez que cambia cantidad_recibida de algún ítem.
-- No toca OCs en 'borrador'/'pendiente_aprobacion' (todavía no enviadas) ni
-- 'cancelada' (no debe revivirlas a recibida_parcial/recibida).
-- ───────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_oc_recalcular_estado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_estado_actual  text;
  v_total_pedido   numeric;
  v_total_recibido numeric;
  v_nuevo_estado   text;
BEGIN
  SELECT estado INTO v_estado_actual FROM public.ordenes_compra WHERE id = NEW.orden_id;

  IF v_estado_actual IS NULL OR v_estado_actual IN ('borrador', 'pendiente_aprobacion', 'cancelada') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(cantidad_pedida), 0), COALESCE(SUM(cantidad_recibida), 0)
    INTO v_total_pedido, v_total_recibido
  FROM public.ordenes_compra_items
  WHERE orden_id = NEW.orden_id;

  IF v_total_recibido <= 0 THEN
    v_nuevo_estado := 'enviada';
  ELSIF v_total_recibido >= v_total_pedido THEN
    v_nuevo_estado := 'recibida';
  ELSE
    v_nuevo_estado := 'recibida_parcial';
  END IF;

  IF v_nuevo_estado IS DISTINCT FROM v_estado_actual THEN
    UPDATE public.ordenes_compra SET estado = v_nuevo_estado WHERE id = NEW.orden_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_oc_recalcular_estado ON public.ordenes_compra_items;
CREATE TRIGGER trg_oc_recalcular_estado
  AFTER UPDATE OF cantidad_recibida ON public.ordenes_compra_items
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_oc_recalcular_estado();

-- ───────────────────────────────────────────────────────────────────────────
-- 2.2: crear_recepcion no validaba que cantidad_recibida no supere
-- cantidad_pedida. Se agrega SELECT...FOR UPDATE + guard antes de cualquier
-- INSERT del loop (falla rápido, sin dejar nada a medio insertar).
-- ───────────────────────────────────────────────────────────────────────────

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

    -- Guard sesión 50: no permitir recibir más de lo pedido. Lock explícito
    -- (FOR UPDATE) antes de decidir, mismo patrón que el resto de las RPC de
    -- stock — evita que 2 recepciones concurrentes del mismo ítem superen el
    -- límite pasando ambas el chequeo antes de que cualquiera confirme.
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

-- Rollback (comentado):
-- DROP TRIGGER IF EXISTS trg_oc_recalcular_estado ON public.ordenes_compra_items;
-- DROP FUNCTION IF EXISTS public.fn_oc_recalcular_estado();
-- (para crear_recepcion: restaurar la versión de migration 060, sin el guard)
