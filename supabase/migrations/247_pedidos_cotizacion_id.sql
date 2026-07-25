-- Migration 247: Trazabilidad Cotización → Pedido ("Copiar a Pedido", estilo SAP B1)
-- pedidos no tenía forma de saber de qué cotización vino (comprobantes sí tiene
-- cotizacion_id/pedido_id desde la migration 021, pero pedidos quedó afuera).
-- No se toca el enum de estado de cotizaciones — "copiar a" es solo trazabilidad,
-- no un cambio de estado del documento origen (igual que en SAP B1).

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS cotizacion_id UUID REFERENCES public.cotizaciones(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_cotizacion ON public.pedidos(cotizacion_id);
