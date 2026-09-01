-- migration 377 — el botón "Avisar" de stock bajo (AlertasStockBanner.jsx)
-- nunca funcionó desde que se creó: al insert directo desde el cliente le
-- faltaban 3 capas distintas, encontradas una detrás de la otra al verificar
-- con BEGIN...ROLLBACK (mig.376 ya resolvió la 1ra, ésta resuelve la 2da y
-- 3ra):
--
--   1. GRANT USAGE sobre audit_log_id_seq a `authenticated` — resuelto en
--      mig.376.
--   2. `audit_log` tenía política RLS de SELECT (empresa_id = mi empresa)
--      pero NINGUNA de INSERT — un insert directo desde el cliente (no vía
--      trigger, que corre como owner y no pasa por RLS) siempre rebotaba.
--   3. `audit_log_operacion_check` sólo permitía 'INSERT'/'UPDATE'/'DELETE'
--      (pensado para el uso normal de auditoría vía trigger) — el valor
--      especial 'aviso_cajero_stock' que ya usa el código (comentario propio
--      del componente: "No existe tabla notificaciones — se registra en
--      audit_log con tipo especial") nunca estuvo permitido.
--
-- Impacto real: el cajero hacía clic en "Avisar" sobre un producto con stock
-- bajo, veía el toast "Encargado notificado" (el catch de la función tiene un
-- fallback amigable "modo offline" que oculta el error) y creía que había
-- avisado — pero la fila nunca se grababa. Nadie lo notó porque el toast
-- siempre se ve igual haya funcionado o no.
--
-- Fix (verificado con BEGIN...ROLLBACK, insert real de prueba con rollback):
--   - Política de INSERT nueva, acotada al propio empresa_id y user_id (no
--     abre nada más — sigue sin poder insertar auditoría de otra empresa ni
--     a nombre de otro usuario).
--   - Constraint ampliado para aceptar 'aviso_cajero_stock' además de los 3
--     valores de trigger existentes.

CREATE POLICY "audit_log_insert_propio" ON public.audit_log
  FOR INSERT
  WITH CHECK (empresa_id = public.get_my_empresa_id() AND user_id = auth.uid());

ALTER TABLE public.audit_log DROP CONSTRAINT audit_log_operacion_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_operacion_check
  CHECK (operacion = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text, 'aviso_cajero_stock'::text]));
