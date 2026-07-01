-- MIGRATION 121 — Agregar 'caja' al CHECK constraint de origen en movimientos_bancarios
-- El puente Caja→Bancos (migration 112) inserta con origen='caja' pero el constraint
-- (migration 069) solo admite: manual, csv, email, webhook, mercadopago, uala.

ALTER TABLE public.movimientos_bancarios
  DROP CONSTRAINT movimientos_bancarios_origen_check;

ALTER TABLE public.movimientos_bancarios
  ADD CONSTRAINT movimientos_bancarios_origen_check
  CHECK (origen = ANY (ARRAY['manual'::text, 'csv'::text, 'email'::text, 'webhook'::text, 'mercadopago'::text, 'uala'::text, 'caja'::text]));
