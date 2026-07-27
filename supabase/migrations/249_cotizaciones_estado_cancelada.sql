-- Agrega el estado 'cancelada' a Cotizaciones (patrón SAP: todo documento de
-- marketing debe poder cerrarse/anularse, no solo eliminarse en estado borrador).
-- Ya existe el mismo patrón en pedidos_estado_check y ordenes_compra_estado_check.
ALTER TABLE public.cotizaciones DROP CONSTRAINT cotizaciones_estado_check;
ALTER TABLE public.cotizaciones ADD CONSTRAINT cotizaciones_estado_check
  CHECK (estado = ANY (ARRAY['borrador'::text, 'enviada'::text, 'aprobada'::text, 'rechazada'::text, 'vencida'::text, 'convertida'::text, 'cancelada'::text]));
