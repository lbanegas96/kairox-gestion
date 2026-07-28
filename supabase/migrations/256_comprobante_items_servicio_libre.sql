-- migration 256 — comprobante_items admite ítems de servicio (sin producto)
--
-- HALLAZGO (sesión Facturas, cierre O2C): NuevaFacturaModal.jsx ofrece en la UI
-- un ítem "SERV" (descripción libre, sin producto del catálogo) además de
-- "PROD" — pero comprobante_items.producto_id es NOT NULL desde el schema
-- base, y la tabla no tiene columna para guardar una descripción propia del
-- ítem. Resultado: crear una factura con al menos un ítem de servicio tira
-- 23502 (null value in column "producto_id") DESPUÉS de insertar el
-- comprobante (que ya quedó huérfano, sin items) — reproducido en vivo.
--
-- FIX: producto_id pasa a nullable (un ítem de servicio no tiene producto de
-- catálogo) y se agrega comprobante_items.descripcion para poder guardar qué
-- fue ese ítem. Sin esta columna, permitir producto_id NULL dejaría el ítem
-- sin ningún texto identificable — igual de roto que el bug original.
--
-- Todos los consumidores de comprobante_items ya leen productos?.nombre con
-- optional chaining (verificado por grep) — no hay riesgo de crash, solo de
-- mostrar "Producto Eliminado" en vez de la descripción real. Ese fallback se
-- corrige en el mismo pase (frontend, commit aparte) para preferir
-- item.descripcion cuando producto_id es null.

ALTER TABLE public.comprobante_items
  ALTER COLUMN producto_id DROP NOT NULL;

ALTER TABLE public.comprobante_items
  ADD COLUMN IF NOT EXISTS descripcion TEXT;

-- ROLLBACK (comentado):
-- ALTER TABLE public.comprobante_items ALTER COLUMN producto_id SET NOT NULL;  -- falla si ya hay filas con NULL
-- ALTER TABLE public.comprobante_items DROP COLUMN IF EXISTS descripcion;
