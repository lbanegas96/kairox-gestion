-- Migration 106: agrega columna ultimo_sync a integraciones_bancarias.
-- La Edge Function mp-webhook intenta actualizar esta columna después de
-- registrar un pago exitoso (para mostrar "Último sync: ..." en Integraciones).
-- La función maneja su ausencia con un WARN, pero es mejor que exista.

ALTER TABLE public.integraciones_bancarias
  ADD COLUMN IF NOT EXISTS ultimo_sync TIMESTAMPTZ;
