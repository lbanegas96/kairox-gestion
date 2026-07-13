-- Migration 201 — lock de ejecución única para arca-worker
-- (hallazgo sesión 60 cont. 4, condición de carrera al reencolar facturas AFIP, 2026-07-12).
--
-- El bug: nada impide que dos invocaciones de la Edge Function arca-worker corran
-- en simultáneo. El cron dispara cada 5 min sin esperar a que la corrida anterior
-- termine; si un lote de reencolado tarda más que eso (varias facturas, cada una con
-- 2 llamadas SOAP reales a AFIP), la siguiente invocación arranca mientras la
-- anterior sigue procesando. Cada invocación consulta `feCompUltimoAutorizado()` y
-- envía "el próximo número" de forma independiente — dos invocaciones concurrentes
-- pueden pedir el MISMO número a la vez; AFIP acepta una y rechaza la otra con
-- [10016], aunque el número en sí no tenía ningún problema real.
--
-- Confirmado en producción: al reencolar 9 facturas, todas se procesaron en un
-- lapso de ~3 segundos y en un orden que NO respeta `fecha ASC` (el orden que el
-- propio worker pide) — señal de que al menos 2 invocaciones corrieron en paralelo
-- sobre el mismo lote.
--
-- Fix: tabla de lock de una sola fila. arca-worker reclama el lock al empezar
-- (UPDATE condicional: solo si no está tomado, o si quedó tomado por una corrida
-- que ya debería haber terminado hace más de 10 minutos — evita un deadlock
-- permanente si una invocación anterior crasheó sin liberar) y lo libera en un
-- finally, tanto en éxito como en error.

CREATE TABLE IF NOT EXISTS public.arca_worker_run (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  running boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.arca_worker_run (id, running)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.arca_worker_run ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo el service_role (que bypassea RLS) la toca, igual que
-- afip_tickets/facturas_pendientes_arca — no hay acceso desde el cliente.
