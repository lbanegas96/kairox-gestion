-- =============================================================================
-- MIGRATION 055 — Ampliar CHECK origen de movimientos_bancarios ('mercadopago')
-- =============================================================================
-- Bug de PRODUCCIÓN (hallazgo colateral de la auditoría de estabilización,
-- sesión 33 / task_02f2207b): la tabla public.movimientos_bancarios tiene el
-- CHECK `movimientos_bancarios_origen_check` que solo admite
-- origen IN ('manual','csv','email','webhook').
--
-- Pero supabase/functions/mp-webhook/index.ts llama a la RPC
-- insertar_movimiento_bancario_externo con p_origen = 'mercadopago'. Como ese
-- valor NO está en el CHECK, el INSERT interno de la RPC falla con error 23514
-- (check_violation), la RPC propaga la excepción y el webhook responde 500.
-- Resultado: TODOS los cobros aprobados de MercadoPago vienen fallando
-- silenciosamente al registrarse como movimiento bancario; MP reintenta el
-- webhook y siempre recibe 500. La sincronización automática de cobros MP — la
-- feature estrella de la integración — está rota.
--
-- DECISIÓN (Opción A, confirmada con el usuario): ampliar el CHECK para incluir
-- 'mercadopago' en vez de degradar el webhook a 'webhook' (Opción B). El origen
-- real de la pasarela queda registrado a nivel de columna, lo que sirve para
-- reportes y trazabilidad; el sistema ya distingue MercadoPago en otros lados
-- (la descripción del movimiento arranca con "MP #...").
--
-- 'uala' NO se incluye todavía: se agregará en su propia migration cuando esa
-- integración exista realmente (no hay caller hoy). Set mínimo necesario.
--
-- NOTA: esta migration NO toca la RPC ni el guard multi-tenant de la
-- migration 054 — solo modifica el constraint de la tabla.
-- =============================================================================

ALTER TABLE public.movimientos_bancarios
  DROP CONSTRAINT IF EXISTS movimientos_bancarios_origen_check;

ALTER TABLE public.movimientos_bancarios
  ADD CONSTRAINT movimientos_bancarios_origen_check
  CHECK (origen IN ('manual', 'csv', 'email', 'webhook', 'mercadopago'));
