-- migration 326 — Factura de Compra: descuento por ítem + global
--
-- Fase 2 del plan de comprobantes (15/08): Factura de Compra era el único documento
-- con precio real que no tenía descuento en absoluto, ni por línea ni global — a
-- diferencia de Cotización/Pedido/OC/Factura de Venta, que ya lo tienen.
--
-- Mismo patrón que mig.318/322 (cotizacion_items/ordenes_compra_items): NUMERIC con
-- CHECK 0-100, sin trigger de auditoría porque Factura de Compra NO gana edición en
-- esta fase (documento de una sola vez, sin CAE pero tampoco con RPC de diffing —
-- el plan la excluyó explícitamente de "edición + historial").

ALTER TABLE public.detalle_compras
  ADD COLUMN IF NOT EXISTS descuento_item NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'detalle_compras_descuento_item_check'
  ) THEN
    ALTER TABLE public.detalle_compras
      ADD CONSTRAINT detalle_compras_descuento_item_check
      CHECK (descuento_item >= 0 AND descuento_item <= 100);
  END IF;
END $$;

ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS descuento_global_pct NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compras_descuento_global_pct_check'
  ) THEN
    ALTER TABLE public.compras
      ADD CONSTRAINT compras_descuento_global_pct_check
      CHECK (descuento_global_pct >= 0 AND descuento_global_pct <= 100);
  END IF;
END $$;
