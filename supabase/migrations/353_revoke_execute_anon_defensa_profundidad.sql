-- migration 353 — revoca EXECUTE público en 3 funciones SECURITY DEFINER
-- que el advisor de Supabase venía marcando, defensa en profundidad
--
-- Hallazgo del barrido de seguridad (24/08): `registrar_cobro_cliente`,
-- `registrar_pago_proveedor` y `fn_entrega_snapshot_destino` son SECURITY
-- DEFINER y ejecutables por `anon` (rol sin sesión autenticada). Se probó el
-- ataque real (`SET LOCAL role anon` + llamada dentro de una transacción con
-- ROLLBACK) y las dos que mueven plata cortan correctamente con "No
-- autorizado: empresa_id no coincide con el usuario autenticado" — no hay un
-- agujero real hoy. Igual se revoca por defensa en profundidad.
--
-- GOTCHA (ya documentado en mig.304/305, casi lo repito): el ACL real de
-- estas 3 es `{=X/postgres, postgres=X/postgres}` — ese `=X` sin rol a la
-- izquierda es PUBLIC, no `anon`. `REVOKE ... FROM anon` es un NO-OP (no da
-- error, tampoco cambia nada — se verificó con `has_function_privilege`
-- antes de este archivo, seguía en `true` después de "revocar"). Y a
-- diferencia de mig.305, acá NO hay una entrada `authenticated=X/postgres`
-- explícita: `authenticated` también accede solo por herencia de PUBLIC. Si
-- se revoca de PUBLIC sin más, se rompe `registrar_cobro_cliente`/
-- `registrar_pago_proveedor` para usuarios reales — Cobros y Pagos dejarían
-- de andar. Por eso acá el revoke de PUBLIC va acompañado de un GRANT
-- explícito a `authenticated` en el mismo paso, probado con
-- `BEGIN...ROLLBACK` antes de aplicar (anon queda en `false`, authenticated
-- en `true`, en la misma transacción).

REVOKE EXECUTE ON FUNCTION public.registrar_cobro_cliente(
  uuid, uuid, uuid, text, numeric, text, timestamp with time zone,
  text, uuid, numeric, numeric, jsonb, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_cliente(
  uuid, uuid, uuid, text, numeric, text, timestamp with time zone,
  text, uuid, numeric, numeric, jsonb, uuid, text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_proveedor(
  uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb,
  timestamp with time zone, uuid, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor(
  uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb,
  timestamp with time zone, uuid, text
) TO authenticated;

-- Función de trigger — no necesita GRANT a nadie: Postgres la dispara con
-- los privilegios de su dueño cuando el trigger corre, no con los del rol
-- que hizo el INSERT/UPDATE que lo activó.
REVOKE EXECUTE ON FUNCTION public.fn_entrega_snapshot_destino() FROM PUBLIC;

-- ROLLBACK (comentado):
-- GRANT EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid, uuid, uuid, text, numeric, text, timestamp with time zone, text, uuid, numeric, numeric, jsonb, uuid, text) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb, timestamp with time zone, uuid, text) TO PUBLIC;
-- GRANT EXECUTE ON FUNCTION public.fn_entrega_snapshot_destino() TO PUBLIC;
