-- Fix de reproducibilidad, NO de seguridad en producción — mismo patron que las
-- migrations 217 (crear_venta) y 218 (is_admin), esta vez encontrado durante la
-- Fase 4 del sometimiento a estres (sesion 78) al confirmar una venta real por
-- UI en el POS (ModoCajaLayout -> PanelCarrito) contra el stack local.
--
-- La migration 063 (revocar_anon_y_search_path, sesion 47) revoco EXECUTE FROM
-- PUBLIC (que incluye lo heredado por `authenticated`) de 28 funciones de golpe,
-- incluyendo calcular_ofertas_carrito(). A diferencia de is_admin() (migration
-- 218), esta SI es un RPC de entrada (el frontend la llama directo via
-- /rpc/calcular_ofertas_carrito), asi que el gap es aun mas directo: sin el
-- grant, cada carga del carrito del POS falla en consola con
-- "permission denied for function calcular_ofertas_carrito" (42501) y el motor
-- de ofertas automaticas queda inoperante en silencio (no bloquea la venta,
-- simplemente no aplica descuentos).
--
-- Confirmado con has_function_privilege contra el proyecto hosted (wuznppxeonmhfcvnqfbf):
-- ya tiene el grant puesto a mano (true). El replay desde cero (supabase db reset
-- local) no lo tenia (false) — mismo patron exacto que crear_venta e is_admin.
--
-- Impacto en producción: NINGUNO — producción ya tiene este grant. El efecto es
-- que ahora `supabase db reset` local reproduce fielmente el estado real, y que
-- el motor de ofertas automaticas del POS funciona sin errores contra el stack
-- local.

GRANT EXECUTE ON FUNCTION public.calcular_ofertas_carrito(uuid, jsonb, character varying, numeric) TO authenticated;

-- ROLLBACK (comentado): REVOKE EXECUTE ON FUNCTION public.calcular_ofertas_carrito(uuid, jsonb, character varying, numeric) FROM authenticated;
-- (no debería hacer falta — esto solo iguala el estado local al que producción ya tenía).
