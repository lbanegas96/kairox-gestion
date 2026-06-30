-- migration 110 — REVOKE anon/public en calcular_ofertas_carrito
-- La función fue creada en migration 108 sin REVOKE explícito.
-- SECURITY DEFINER + acceso anon = cualquier request sin autenticar podría
-- consultar ofertas de cualquier empresa (violación de tenant isolation).
-- ROLLBACK: GRANT EXECUTE ON FUNCTION calcular_ofertas_carrito(...) TO anon;

REVOKE EXECUTE ON FUNCTION public.calcular_ofertas_carrito(
  uuid, jsonb, varchar, numeric
) FROM public;

REVOKE EXECUTE ON FUNCTION public.calcular_ofertas_carrito(
  uuid, jsonb, varchar, numeric
) FROM anon;
