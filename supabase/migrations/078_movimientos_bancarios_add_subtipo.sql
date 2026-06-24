-- ════════════════════════════════════════════════════════════════════════════
-- migration 078 — Agregar columna subtipo a movimientos_bancarios
-- ════════════════════════════════════════════════════════════════════════════
--
-- Necesidad: el cliente contable del primer cliente real necesita segmentar
-- los cobros de MercadoPago por tipo: CVU/transferencia, QR/billetera,
-- tarjeta de crédito y tarjeta de débito.
--
-- La Edge Function mp-webhook ya recibe pago.payment_type_id de la API de MP,
-- pero lo descartaba. Con esta columna, lo persistimos estructuralmente.
--
-- Los callers existentes (Ualá trigger, conciliaciones manuales) no pasan
-- subtipo → queda NULL, sin impacto en data histórica.

ALTER TABLE public.movimientos_bancarios
  ADD COLUMN IF NOT EXISTS subtipo TEXT NULL;

NOTIFY pgrst, 'reload schema';

-- ROLLBACK (comentado):
-- ALTER TABLE public.movimientos_bancarios DROP COLUMN IF EXISTS subtipo;
