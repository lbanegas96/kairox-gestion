-- Sesión 42: agrega la trazabilidad faltante en decrement_stock e
-- increment_stock — hallazgo confirmado por los tests pgTAP de la sesión 41
-- (supabase/tests/decrement_stock.test.sql, increment_stock.test.sql, Caso 4).
-- Ambas actualizaban stock_actual sin insertar en movimientos_inventario, a
-- diferencia de crear_venta/crear_entrega/crear_devolucion/ajustar_stock_manual.
--
-- Se agrega p_motivo opcional (DEFAULT NULL, con fallback genérico) a ambas
-- firmas. Confirmado con grep fresco: decrement_stock no tiene ningún caller
-- (ni frontend ni SQL) — agregar un parámetro opcional con DEFAULT es 100%
-- compatible. increment_stock tiene exactamente 2 callers, ambos en
-- CompraRapidaSection.jsx (handleSaveEdit) — actualizados en este mismo cambio
-- para pasar un motivo descriptivo real en vez de depender del default.
--
-- Nota de diseño: increment_stock acepta quantity NEGATIVO (revertir stock al
-- borrar/reducir un ítem de una compra editada). El tipo de movimiento se
-- decide por el SIGNO real de la cantidad (quantity>=0 → 'entrada',
-- quantity<0 → 'salida'), no fijo en 'entrada' — porque revertir una compra
-- físicamente RETIRA stock, y la tabla movimientos_inventario debe reflejar lo
-- que pasó de verdad, no el nombre de la función que lo causó.

-- CREATE OR REPLACE no reemplaza una función cuando cambia la cantidad de
-- parámetros — crea un overload nuevo. Hay que dropear las firmas viejas de
-- 2 argumentos explícitamente o quedan 2 versiones ambiguas.
DROP FUNCTION IF EXISTS public.decrement_stock(uuid, integer);
DROP FUNCTION IF EXISTS public.increment_stock(uuid, numeric);

CREATE OR REPLACE FUNCTION public.decrement_stock(p_producto_id uuid, p_cantidad integer, p_motivo text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
BEGIN
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

CREATE OR REPLACE FUNCTION public.increment_stock(row_id uuid, quantity numeric, p_motivo text DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock_actual NUMERIC;
  v_empresa_id   uuid;
BEGIN
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

-- Rollback (comentado): restaurar ambas funciones a su versión de la
-- migration 060 (sin p_motivo ni INSERT en movimientos_inventario).
