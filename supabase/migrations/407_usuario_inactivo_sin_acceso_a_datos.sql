-- 407 — Un usuario desactivado no tiene acceso a los datos de su empresa
--
-- Auditoría 24/09/2026, hallazgo SEG-13. `get_my_empresa_id()` (la base de casi todo el RLS y de las
-- funciones SECURITY DEFINER) no miraba `profiles.active`: el botón «Desactivar» del panel de Usuarios
-- solo dejaba en falso a `has_module_permission` e `is_admin` (o sea, cortaba ESCRIBIR en los módulos),
-- pero un usuario desactivado conservaba su empresa y seguía LEYENDO todas las tablas de lectura abierta
-- (productos con su costo de compra, asientos, movimientos y cuentas bancarias, registro de auditoría…)
-- y ejecutando las RPC que solo validan la empresa. Su sesión además sigue vigente hasta que venza el token
-- (Auth no sabe de `active`). Confirmado con una prueba con datos inventados.
--
-- Arreglo: si el perfil está inactivo, `get_my_empresa_id()` devuelve NULL. Como todas las políticas y
-- funciones comparan contra ese valor (`empresa_id = get_my_empresa_id()`), un usuario inactivo pasa a no
-- ver ni tocar nada de la empresa, sin necesidad de tocar cada política.
--
-- Lo que NO cambia:
--   - el usuario inactivo sigue pudiendo leer SU PROPIA fila de `profiles` (la política es por `id = auth.uid()`),
--     que es lo que usa la app para detectar la cuenta inactiva, mostrar «Cuenta inactiva» y cerrar la sesión;
--   - `get_my_role()` no se toca (no da acceso a datos);
--   - las Edge Functions con `service_role` no dependen de esta función.
-- Definición idéntica a la anterior salvo `AND active` (mismos atributos: LANGUAGE sql, STABLE, SECURITY
-- DEFINER, search_path = public).

CREATE OR REPLACE FUNCTION public.get_my_empresa_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT empresa_id FROM public.profiles WHERE id = auth.uid() AND active
$function$;
