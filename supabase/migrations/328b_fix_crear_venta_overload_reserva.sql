-- 328b — Fix del mismo bug que 325b, esta vez para el parámetro nuevo de 328
-- (p_factura_reserva). CREATE OR REPLACE con un parámetro nuevo al final NO
-- reemplaza la función: crea una SOBRECARGA nueva (26 parámetros) y deja la
-- vieja (25 parámetros, de la migration 325) activa en paralelo — mismo
-- "function ... is not unique" que rompió el POS/ERP la vez anterior.
--
-- Fix: eliminar explícitamente la sobrecarga vieja de 25 parámetros. Queda
-- una sola función crear_venta (26 parámetros, con p_factura_reserva opcional
-- vía DEFAULT false) — vuelve a resolver sin ambigüedad para todos los
-- llamadores existentes (useConfirmarVenta.js, NuevaVentaModal.jsx,
-- NuevaFacturaModal.jsx), ninguno de los cuales pasa este parámetro nuevo.
--
-- Verificar después de aplicar:
-- SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname = 'crear_venta';
-- debe devolver UNA sola fila.

DROP FUNCTION IF EXISTS public.crear_venta(
  uuid, uuid, text, timestamp with time zone, uuid, text, numeric, text, text,
  text, numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric,
  uuid, uuid, integer, text, uuid, text
);

-- Hallazgo real (15/08, verificado en vivo contra la base): la migration 325
-- creó la sobrecarga de 25 parámetros SIN repetir el bloque REVOKE/GRANT que
-- tienen TODAS las migraciones anteriores de crear_venta (044, 047, 048, 112,
-- 123, 156, 170, 192, 194, 217, 309, 312) — se le olvidó, y Postgres le dio a
-- esa función nueva los privilegios por defecto: EXECUTE abierto a PUBLIC y
-- anon. Confirmado consultando pg_proc.proacl en producción: la versión de 25
-- parámetros tenía `anon=X` y `=X` (PUBLIC) además de `authenticated=X`. La
-- función es SECURITY DEFINER con sus propios checks internos
-- (get_my_empresa_id(), has_module_permission) que igual la habrían bloqueado
-- para un caller anónimo real, pero rompía la política de hardening explícita
-- del proyecto (mismo criterio que las migrations 304/305, "revocar anon/
-- public de funciones SECURITY DEFINER"). Se corrige acá mismo, ya que este
-- migration reemplaza esa versión de todos modos.
REVOKE ALL ON FUNCTION public.crear_venta(
  uuid, uuid, text, timestamp with time zone, uuid, text, numeric, text, text,
  text, numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric,
  uuid, uuid, integer, text, uuid, text, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_venta(
  uuid, uuid, text, timestamp with time zone, uuid, text, numeric, text, text,
  text, numeric, numeric, numeric, jsonb, jsonb, boolean, uuid, uuid, numeric,
  uuid, uuid, integer, text, uuid, text, boolean
) TO authenticated;
