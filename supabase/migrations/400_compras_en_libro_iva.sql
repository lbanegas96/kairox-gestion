-- 400_compras_en_libro_iva.sql
-- Compra Rápida: "Libro" / "No libro" (pedido de Luciano, 23/09).
--
-- Una compra "No libro" (ticket, compra sin factura, uso interno) NO va al
-- Libro IVA Compras (pantalla ni TXT de ARCA) ni a la Posición IVA, y no suma
-- crédito fiscal: su IVA queda dentro del costo (neto_gravado = total,
-- iva_discriminado = 0, y el asiento no lleva la línea de IVA Crédito Fiscal).
-- Una compra "Libro" exige los 3 datos del comprobante del proveedor (mig.398)
-- — eso se valida en el frontend, no acá, para no romper las ~40 filas
-- históricas que no los tienen.
--
-- DEFAULT true: todo lo que ya existe queda exactamente como estaba (entra al
-- Libro y a la Posición). Agregar una columna NOT NULL con un default
-- constante es solo metadata en Postgres 11+ — no reescribe la tabla ni toma
-- un lock largo.

ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS en_libro_iva BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.compras.en_libro_iva IS
  'true = va al Libro IVA Compras y suma crédito fiscal (exige los datos del comprobante del proveedor). false = "No libro": fuera del Libro y de la Posición IVA, sin crédito fiscal (neto_gravado = total, iva_discriminado = 0).';
