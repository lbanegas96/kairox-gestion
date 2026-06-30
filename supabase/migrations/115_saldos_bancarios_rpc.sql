-- migration 115 — RPC saldos_bancarios(): agrega el saldo por cuenta en SQL
--
-- ANTES: el frontend (CuentasBancariasSection) traía TODOS los movimientos
-- bancarios al cliente y sumaba en JS (computeSaldos). Con volumen alto: lento
-- y costoso en red. Esta RPC calcula el saldo agregado en la base, scoped a la
-- empresa del caller, devolviendo una fila por cuenta activa.
--
-- Lógica replicada de computeSaldos: saldo = Σ(ingreso) − Σ(egreso/otros).
-- Cuentas sin movimientos devuelven 0 (LEFT JOIN + COALESCE).
--
-- ROLLBACK: DROP FUNCTION public.saldos_bancarios();

CREATE OR REPLACE FUNCTION public.saldos_bancarios()
RETURNS TABLE (cuenta_bancaria_id uuid, saldo numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cb.id AS cuenta_bancaria_id,
         COALESCE(SUM(
           CASE WHEN mb.tipo = 'ingreso' THEN mb.monto ELSE -mb.monto END
         ), 0) AS saldo
  FROM public.cuentas_bancarias cb
  LEFT JOIN public.movimientos_bancarios mb
    ON mb.cuenta_bancaria_id = cb.id
   AND mb.empresa_id = cb.empresa_id
  WHERE cb.empresa_id = get_my_empresa_id()
    AND cb.activo = true
  GROUP BY cb.id;
$$;

REVOKE ALL ON FUNCTION public.saldos_bancarios() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.saldos_bancarios() TO authenticated;
