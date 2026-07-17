-- migration 212 — Eliminar el overload de 9 params de registrar_pago_proveedor
--
-- HALLAZGO (barrido de seguridad de Cheques + Cuenta Corriente, sesión 72): misma clase de bug
-- que la migration 208 (insertar_movimiento_bancario_externo). La migration 184 agregó p_fecha a
-- registrar_pago_proveedor con `CREATE OR REPLACE FUNCTION` pero SIN dropear antes la firma vieja
-- de 9 parámetros (mig.131/144/169/181/191/196) — quedaron 2 versiones registradas en prod:
--   - registrar_pago_proveedor(9 params, sin p_fecha)
--   - registrar_pago_proveedor(10 params, con p_fecha DEFAULT NULL)
--
-- Cualquier llamada que mande exactamente los 9 params sin p_fecha (positional o, como hace
-- siempre supabase-js, con notación NOMBRADA) puede resolver de forma ambigua entre ambas y
-- romper con `function registrar_pago_proveedor(...) is not unique` — el mismo síntoma exacto
-- documentado en la 208.
--
-- Verificado: el único caller real (proveedoresService.ts → registrarPago()) SIEMPRE manda
-- p_fecha explícito, así que HOY no está roto — pero el overload de 9 params es un cheque en
-- blanco: el primer caller nuevo (un script, una integración, un botón agregado sin copiar el
-- p_fecha) que lo invoque sin esa columna revienta con el mismo error que ya vimos en Ualá.
-- Se elimina la versión de 9 params; la de 10 (con DEFAULT NULL) cubre exactamente el mismo caso
-- de uso — mismo criterio y misma solución que la 208.

DROP FUNCTION IF EXISTS public.registrar_pago_proveedor(
  uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb
);

-- ROLLBACK (comentado): recrear la versión de 9 params desde la migration 169/181 (la última
-- que la redefinió antes de la 184) si aparece un caller que dependa de ella — no se encontró
-- ninguno al auditar el repo (proveedoresService.ts es el único).
