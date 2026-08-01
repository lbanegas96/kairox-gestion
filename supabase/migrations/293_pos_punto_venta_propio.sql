-- migration 293 — Punto de venta propio para el POS (Modo Caja)
--
-- CONTEXTO (pedido de Luciano): el POS debería poder tener su propio punto de
-- venta, y poder elegir si sus ventas van a ARCA o no — pensando en el local
-- chico que no factura electrónicamente.
--
-- Esto continúa el pendiente que la migration 244 dejó documentado
-- explícitamente: allí se creó `puntos_venta.envia_arca` (serie fiscal vs.
-- serie interna, estilo SAP), pero el circuito de FACTURACIÓN nunca lo
-- consultó — `useAfipConfig` seguía tomando `.eq('activo', true).limit(1)`.
--
-- DOS BUGS LATENTES QUE ESTO CIERRA:
--   1. Ese `.limit(1)` no tiene ORDER BY ni filtra `envia_arca`: es NO
--      determinístico. Nalux tiene el PdV 1 (fiscal) y el 2 ("Remito",
--      envia_arca=false) — nada garantizaba cuál se elegía para facturar.
--   2. `envia_arca=false` no impedía que el comprobante se encolara a ARCA:
--      el trigger fn_queue_factura_arca sólo mira `relevante_fiscal`.
--      Ahora el frontend no marca `cae_estado='pendiente'` cuando el PdV
--      resuelto no envía a ARCA, así que el trigger nunca llega a dispararse.
--
-- MODELO: `empresas.pos_punto_venta_id` — el PdV que usa el Modo Caja.
--   - NULL  → el POS usa el mismo PdV fiscal que el resto del sistema
--             (primer PdV activo con envia_arca=true, ordenado por número).
--             Es el default: no cambia el comportamiento de nadie.
--   - Seteado a un PdV con envia_arca=true  → el POS factura por ESE PdV
--             (numeración fiscal independiente del back-office).
--   - Seteado a un PdV con envia_arca=false → el POS emite comprobante
--             interno, nunca va a ARCA (caso "local que no factura").

ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS pos_punto_venta_id uuid
    REFERENCES public.puntos_venta(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.empresas.pos_punto_venta_id IS
  'Punto de venta que usa el POS (Modo Caja). NULL = usa el PdV fiscal por defecto. Si apunta a un PdV con envia_arca=false, las ventas del POS no se encolan a ARCA.';

-- ROLLBACK (comentado):
-- ALTER TABLE public.empresas DROP COLUMN IF EXISTS pos_punto_venta_id;
