-- migration 258 — comprobantes.referencia_cliente (N° de PO del cliente)
--
-- SAP muestra "No.Ref.cliente" en la Factura de Deudores. Ya se agregó el
-- mismo campo a Pedidos (migration 252) — Factura quedaba afuera. Mismo
-- criterio: texto libre, opcional, sin impacto en ningún cálculo.

ALTER TABLE public.comprobantes ADD COLUMN IF NOT EXISTS referencia_cliente TEXT;

-- ROLLBACK (comentado):
-- ALTER TABLE public.comprobantes DROP COLUMN IF EXISTS referencia_cliente;
