-- migrations/046_fecha_vencimiento_comprobantes.sql
-- Agrega la fecha de vencimiento del comprobante según el plazo de pago
-- acordado con el cliente (clientes.dias_credito). Concepto distinto de
-- cae_vencimiento (vencimiento del CAE de AFIP) — no confundir.
--
-- Nullable: comprobantes históricos (anteriores a esta migration) quedan en
-- NULL — no hay forma de saber con certeza qué dias_credito tenía el cliente
-- en el momento de cada venta vieja, no se intenta backfill retroactivo.

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS fecha_vencimiento DATE;
