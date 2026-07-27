-- Cierra los gaps de Pedido detectados en la comparación con SAP Orden de Venta:
--   - Sin moneda/tipo de cambio -> "Copiar a Pedido" reinterpretaba silenciosamente
--     montos en moneda extranjera de la cotización como si fueran ARS.
--   - Sin %descuento por línea (cotizacion_items sí lo tiene desde antes).
--   - Sin "Número de Referencia del Cliente" (PO), campo estándar de la Orden de
--     Venta en SAP B1.
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS tipo_cambio_tasa NUMERIC NOT NULL DEFAULT 1;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS descuento NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS referencia_cliente TEXT;
ALTER TABLE public.pedido_items ADD COLUMN IF NOT EXISTS descuento_item NUMERIC NOT NULL DEFAULT 0;
