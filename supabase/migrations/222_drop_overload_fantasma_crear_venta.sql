-- Elimina un overload "fantasma" de crear_venta (17 parametros, sin
-- p_pedido_id) que quedo huerfano en el historial de migrations desde la
-- migration 033 y NUNCA fue dropeado por ninguna migration posterior.
--
-- Hallazgo de la investigacion de la Fase 4 (task "Investigar overloads
-- duplicados de crear_venta"). En PRODUCCION no existe (verificado con
-- pg_proc: un unico overload, el de 20 params). Pero en cualquier stack
-- levantado desde cero via `supabase db reset` / `supabase db push` (local
-- de desarrollo, o un proyecto nuevo si algun dia hay que migrar de cuenta
-- por MIGRACION_SUPABASE.md) SI aparece, porque las migrations 112/122/123/
-- 170/174/175 solo dropean la firma de 18 params (con p_pedido_id, desde
-- la migration 108) -- ninguna apunta a la firma vieja de 17 params.
--
-- Ese overload fantasma es mas grave que un simple duplicado: tenia
-- EXECUTE otorgado a `anon` (sin autenticar) y NO validaba
-- has_module_permission('ventas') como el overload vigente. Cualquier
-- caller que armara el payload exacto de 17 params podia invocarlo
-- directo por RPC, creando ventas reales sin pasar por el chequeo de
-- licenciamiento de modulo, y con una numeracion de entrega que usa
-- siguiente_numero_documento (COUNT(*) no atomico) en vez de
-- obtener_proximo_numero -- la causa original del choque de clave
-- duplicada en entregas.numero_entrega que dio pie a esta investigacion.
--
-- Impacto en produccion: NINGUNO (el overload no existe ahi). El efecto es
-- que `supabase db reset` local, y cualquier restore futuro a un proyecto
-- nuevo, dejan de reproducir este hueco.

DROP FUNCTION IF EXISTS public.crear_venta(
  uuid, uuid, text, timestamptz, uuid, text, numeric, text, text, text,
  numeric, numeric, numeric, jsonb, jsonb, boolean, uuid
);
