-- Roadmap SAP (sap-reference): "unidad de medida de inventario" vs. "unidad de medida de
-- compra" con factor de conversión — hoy `productos` solo tiene una unidad (unidad_medida_id),
-- la misma para stock y compra. Nalux ya tiene cargadas en el maestro unidades como "Caja",
-- "Docena", "Paquete" (mig.043) que hoy no sirven para nada funcional por falta de este factor.
--
-- Alcance (confirmado con el usuario): solo unidad de COMPRA opcional + factor. La venta sigue
-- siendo en la unidad base — no se agrega una 3ª "unidad de venta" (sin evidencia de que se
-- necesite). Aplica a Compra Rápida (único flujo que mueve stock directo vía
-- aplicar_compra_producto); NuevaFacturaProveedorModal.jsx es puramente financiero y no toca
-- stock, así que no aplica ahí. OC → Recepción queda fuera de esta pasada (documentado como
-- próximo paso natural, reutilizando este mismo esquema).
--
-- factor_conversion_compra: cuántas unidades BASE (stock) equivalen a 1 unidad de compra.
-- Ej: unidad base = Unidad, unidad de compra = Caja, factor = 12 → "1 Caja = 12 Unidades".
-- Default 1 (sin cambio de comportamiento para productos que no configuren esto).

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS unidad_compra_id uuid REFERENCES public.unidades_medida(id),
  ADD COLUMN IF NOT EXISTS factor_conversion_compra numeric NOT NULL DEFAULT 1
    CHECK (factor_conversion_compra > 0);
