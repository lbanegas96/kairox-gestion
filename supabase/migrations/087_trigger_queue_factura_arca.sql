-- ════════════════════════════════════════════════════════════════════════════
-- migration 087 — Trigger fn_queue_factura_arca + ampliar CHECK cae_estado
-- ════════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA: emitir-cae solo actualiza comprobantes.cae_estado='error' cuando
-- falla, pero NUNCA inserta en facturas_pendientes_arca. El arca-worker no
-- puede procesar la cola si está vacía.
--
-- FIX:
--   1. Ampliar el CHECK de comprobantes.cae_estado para incluir 'error_definitivo'
--      (el worker lo pone cuando se agotan los intentos y no hay esperanza).
--   2. Índice UNIQUE parcial en facturas_pendientes_arca(comprobante_id) donde
--      estado NOT IN ('emitida','error_definitivo') — evita encolar 2 veces el
--      mismo comprobante si todavía está activo en la cola.
--   3. Trigger AFTER UPDATE OF cae_estado ON comprobantes:
--      cuando cae_estado cambia a 'error' por primera vez, inserta en
--      facturas_pendientes_arca con proximo_intento = now() + 1 minute.
--   4. Backfill de comprobantes con cae_estado='error' que no están en la cola.

-- ─── Paso 1: ampliar CHECK cae_estado ────────────────────────────────────────
ALTER TABLE public.comprobantes
  DROP CONSTRAINT IF EXISTS comprobantes_cae_estado_check;

ALTER TABLE public.comprobantes
  ADD CONSTRAINT comprobantes_cae_estado_check
  CHECK (cae_estado IN ('no_aplica', 'pendiente', 'emitido', 'error', 'error_definitivo'));

-- ─── Paso 2: índice UNIQUE parcial en facturas_pendientes_arca ───────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_fpa_comprobante_activo
  ON public.facturas_pendientes_arca (comprobante_id)
  WHERE comprobante_id IS NOT NULL
    AND estado NOT IN ('emitida', 'error_definitivo');

-- ─── Paso 3: función y trigger fn_queue_factura_arca ─────────────────────────
CREATE OR REPLACE FUNCTION public.fn_queue_factura_arca()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo_interno TEXT;
  v_codigo_afip  SMALLINT;
BEGIN
  IF NEW.cae_estado <> 'error' THEN RETURN NEW; END IF;
  IF OLD.cae_estado = 'error' THEN RETURN NEW; END IF;

  v_tipo_interno := COALESCE(NEW.tipo_comprobante_afip, 'B');
  v_codigo_afip  := CASE v_tipo_interno
    WHEN 'A' THEN 1
    WHEN 'C' THEN 11
    ELSE 6
  END;

  INSERT INTO public.facturas_pendientes_arca (
    empresa_id, comprobante_id, punto_venta_id,
    tipo_comprobante, codigo_afip, payload_arca,
    estado, proximo_intento, error_mensaje
  ) VALUES (
    NEW.empresa_id, NEW.id, NEW.punto_venta_id,
    v_tipo_interno, v_codigo_afip, '{}',
    'pendiente',
    now() + interval '1 minute',
    NEW.error_afip
  )
  ON CONFLICT ON CONSTRAINT uq_fpa_comprobante_activo DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_factura_arca() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_queue_factura_arca ON public.comprobantes;
CREATE TRIGGER trg_queue_factura_arca
  AFTER UPDATE OF cae_estado ON public.comprobantes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_queue_factura_arca();

-- ─── Paso 4: backfill comprobantes con cae_estado='error' ───────────────────
INSERT INTO public.facturas_pendientes_arca (
  empresa_id, comprobante_id, punto_venta_id,
  tipo_comprobante, codigo_afip, payload_arca,
  estado, proximo_intento, error_mensaje
)
SELECT
  c.empresa_id, c.id, c.punto_venta_id,
  COALESCE(c.tipo_comprobante_afip, 'B'),
  CASE COALESCE(c.tipo_comprobante_afip, 'B')
    WHEN 'A' THEN 1::SMALLINT WHEN 'C' THEN 11::SMALLINT ELSE 6::SMALLINT
  END,
  '{}', 'pendiente', now(), c.error_afip
FROM public.comprobantes c
WHERE c.cae_estado = 'error'
  AND NOT EXISTS (
    SELECT 1 FROM public.facturas_pendientes_arca fpa
    WHERE fpa.comprobante_id = c.id
      AND fpa.estado NOT IN ('emitida', 'error_definitivo')
  );

-- ROLLBACK (comentado):
-- DROP TRIGGER IF EXISTS trg_queue_factura_arca ON public.comprobantes;
-- DROP FUNCTION IF EXISTS public.fn_queue_factura_arca();
-- DROP INDEX IF EXISTS uq_fpa_comprobante_activo;
-- ALTER TABLE public.comprobantes DROP CONSTRAINT IF EXISTS comprobantes_cae_estado_check;
-- ALTER TABLE public.comprobantes ADD CONSTRAINT comprobantes_cae_estado_check
--   CHECK (cae_estado IN ('no_aplica','pendiente','emitido','error'));
