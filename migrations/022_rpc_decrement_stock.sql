-- =============================================================================
-- MIGRATION 022 — RPC atómica decrement_stock
-- Evita race condition al decrementar stock en ventas concurrentes.
-- Equivale al pattern de increment_stock ya usado en Notas de Crédito.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.decrement_stock(p_producto_id UUID, p_cantidad INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.productos
  SET stock_actual = stock_actual - p_cantidad
  WHERE id = p_producto_id
    AND empresa_id = get_my_empresa_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  IF (SELECT stock_actual FROM public.productos WHERE id = p_producto_id) < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para el producto: %', p_producto_id;
  END IF;
END;
$$;
