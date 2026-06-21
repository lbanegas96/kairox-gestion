-- Sesión 37: unifica los 2 caminos de "ajuste manual de stock" (mismo patrón de
-- caminos duplicados que causó el bug de recepción de OC en sesión 30/31).
-- Antes: ProductosSection.jsx hacía un UPDATE inline leyendo stock_actual del
-- estado de React (no fresco), sin lock, sin validar negativo. Esta RPC reemplaza
-- ese camino y a productosService.adjustStock() (dead code, semántica distinta
-- para 'ajuste').

CREATE OR REPLACE FUNCTION public.ajustar_stock_manual(
  p_producto_id uuid,
  p_tipo text,
  p_cantidad integer,
  p_motivo text DEFAULT NULL
)
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
    v_nuevo_stock := p_cantidad; -- ajuste: valor absoluto (inventario físico)
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

-- Rollback (comentado):
-- DROP FUNCTION IF EXISTS public.ajustar_stock_manual(uuid, text, integer, text);
