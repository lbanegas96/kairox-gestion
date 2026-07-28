-- migration 262 — devolucion_items.alicuota_iva (snapshot de la alícuota real)
--
-- HALLAZGO (comparación con SAP "Devolución", sesión O2C post-Facturas): la NC
-- que hoy genera automáticamente crear_devolucion siempre asume 21% por ítem
-- (default de comprobante_items.alicuota_iva) sin importar la alícuota real del
-- producto devuelto — corrompe el Libro IVA. Causa raíz: devolucion_items nunca
-- tuvo columna propia para guardar la alícuota, así que no había de dónde
-- copiarla. Se agrega acá; se completa desde crear_devolucion (mig.263) copiando
-- el valor real del comprobante_items/detalle_compras de origen.

ALTER TABLE public.devolucion_items
  ADD COLUMN IF NOT EXISTS alicuota_iva TEXT DEFAULT '21';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devolucion_items_alicuota_iva_check'
  ) THEN
    ALTER TABLE public.devolucion_items
      ADD CONSTRAINT devolucion_items_alicuota_iva_check
      CHECK (alicuota_iva IN ('21', '10.5', '0', 'exento', 'no_gravado'));
  END IF;
END $$;

-- ROLLBACK (comentado):
-- ALTER TABLE public.devolucion_items DROP CONSTRAINT IF EXISTS devolucion_items_alicuota_iva_check;
-- ALTER TABLE public.devolucion_items DROP COLUMN IF EXISTS alicuota_iva;
