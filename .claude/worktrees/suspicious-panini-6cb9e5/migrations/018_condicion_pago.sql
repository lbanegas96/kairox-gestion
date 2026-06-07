-- Migration 018: Condiciones de venta y crédito en clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS condicion_pago  text    DEFAULT NULL;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dias_credito    integer DEFAULT NULL;
