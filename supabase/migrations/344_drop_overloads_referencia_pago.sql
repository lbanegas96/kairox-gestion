-- CREATE OR REPLACE con un parámetro nuevo NO reemplaza la función vieja —
-- crea un overload (misma lección que la migración del criterio fiscal
-- unificado, ver CONTEXT.md). Confirmado en prod tras aplicar 343: quedaron
-- 2 versiones de cada RPC (13 y 14 args). Se dropean las firmas viejas (sin
-- p_referencia_pago) para evitar ambigüedad de PostgREST.
DROP FUNCTION IF EXISTS public.registrar_cobro_cliente(
  uuid, uuid, uuid, text, numeric, text, timestamp with time zone,
  text, uuid, numeric, numeric, jsonb, uuid
);

DROP FUNCTION IF EXISTS public.registrar_pago_proveedor(
  uuid, uuid, uuid, text, numeric, text, text, uuid, jsonb,
  timestamp with time zone, uuid
);
