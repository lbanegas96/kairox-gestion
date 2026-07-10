-- Migration 189 — Unidad de VENTA por producto + venta por pack (roadmap SAP).
-- Sesión 59 (2026-07-10).
--
-- Tercer eslabón del modelo de unidades de SAP (inventario / compra / venta):
--   * unidad de inventario  → productos.unidad_medida_id (base, ya existía)
--   * unidad de compra       → productos.unidad_compra_id + factor (mig.186)
--   * unidad de VENTA (nueva) → productos.unidad_venta_id + factor (esta migración)
--
-- Permite VENDER en una unidad distinta a la de stock (ej: stock por Unidad,
-- vender por Six-pack de 6). Al vender por pack:
--   - cantidad_base (lo que descuenta stock) = cantidad_venta × factor_conversion_venta
--   - precio del pack:
--       · si precio_venta_pack IS NOT NULL → precio fijo del pack (independiente)
--       · si NULL → proporcional (factor × precio_venta unitario)
--   - descuento_pack_pct (%) se aplica AUTOMÁTICO al vender por pack (encima del precio)
--   - el descuento manual del vendedor sigue siendo el de siempre
--     (comprobante_items.descuento_manual_pct, ya existente) — se aplica arriba de todo.
--
-- IMPORTANTE — impacto AFIP: el payload de FECAESolicitar manda SOLO totales
-- (ImpTotal/ImpNeto/ImpIVA/nro), NO líneas — confirmado en _shared/wsfe.ts. Mostrar
-- el pack en el comprobante impreso NO cambia lo que se envía a AFIP; la plata y el
-- IVA se siguen calculando exactamente igual (en unidad base). Estas columnas nuevas
-- en comprobante_items son SOLO para representar/mostrar el pack en el impreso.
--
-- Todo aditivo: columnas nullable / con default. Ventas sin pack siguen idénticas.

-- ─── productos: configuración de venta por pack ──────────────────────────────
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS unidad_venta_id         uuid REFERENCES public.unidades_medida(id),
  ADD COLUMN IF NOT EXISTS factor_conversion_venta numeric NOT NULL DEFAULT 1
    CHECK (factor_conversion_venta > 0),
  ADD COLUMN IF NOT EXISTS precio_venta_pack        numeric
    CHECK (precio_venta_pack IS NULL OR precio_venta_pack >= 0),
  ADD COLUMN IF NOT EXISTS descuento_pack_pct       numeric NOT NULL DEFAULT 0
    CHECK (descuento_pack_pct >= 0 AND descuento_pack_pct <= 100);

-- ─── comprobante_items: representación del pack en el documento (display only) ─
-- Cuando unidad_venta_id IS NULL → línea normal en unidad base (como hoy).
-- Cuando está seteado → la línea se vendió por pack; cantidad/precio_unitario/subtotal
-- SIGUEN en unidad base (no cambia la plata), y estos 3 campos guardan cómo mostrarlo.
ALTER TABLE public.comprobante_items
  ADD COLUMN IF NOT EXISTS unidad_venta_id     uuid REFERENCES public.unidades_medida(id),
  ADD COLUMN IF NOT EXISTS cantidad_venta      numeric
    CHECK (cantidad_venta IS NULL OR cantidad_venta > 0),
  ADD COLUMN IF NOT EXISTS precio_unidad_venta numeric
    CHECK (precio_unidad_venta IS NULL OR precio_unidad_venta >= 0);

-- ─── ROLLBACK (comentado) ────────────────────────────────────────────────────
-- ALTER TABLE public.comprobante_items
--   DROP COLUMN IF EXISTS unidad_venta_id,
--   DROP COLUMN IF EXISTS cantidad_venta,
--   DROP COLUMN IF EXISTS precio_unidad_venta;
-- ALTER TABLE public.productos
--   DROP COLUMN IF EXISTS unidad_venta_id,
--   DROP COLUMN IF EXISTS factor_conversion_venta,
--   DROP COLUMN IF EXISTS precio_venta_pack,
--   DROP COLUMN IF EXISTS descuento_pack_pct;
