-- =============================================================================
-- MIGRATION 050 — RPC increment_stock
-- CompraRapidaSection.handleSaveEdit llama a esta RPC en 3 puntos (revertir item
-- borrado, sumar item nuevo, ajustar diff de cantidad) pero nunca existió en la
-- base — solo decrement_stock (migration 022). Toda edición de compra que
-- cambiara cantidades tiraba "function increment_stock does not exist".
-- =============================================================================

CREATE OR REPLACE FUNCTION public.increment_stock(row_id UUID, quantity NUMERIC)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.productos
  SET stock_actual = stock_actual + quantity
  WHERE id = row_id
    AND empresa_id = get_my_empresa_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', row_id;
  END IF;
END;
$$;
