-- ════════════════════════════════════════════════════════════════════════════
-- Migration 089 — fn_queue_factura_arca: enqueue on 'pendiente' (SAP async posting)
-- ════════════════════════════════════════════════════════════════════════════
--
-- PROBLEMA: el trigger 087 solo encolaba cuando cae_estado cambiaba a 'error'.
-- El frontend tenía que llamar a `emitir-cae` directamente desde el navegador,
-- lo que genera riesgo de doble emisión si el worker también estaba procesando.
--
-- FIX (patrón SAP S/4HANA — async document posting):
--   El trigger ahora también se activa cuando cae_estado pasa a 'pendiente'
--   (primera emisión). El arca-worker es la ÚNICA fuente de verdad para llamar
--   a ARCA. El frontend solo actualiza el estado y espera.
--
-- Cambios respecto a migration 087:
--   1. Condición ampliada: IN ('pendiente', 'error') en vez de = 'error'.
--   2. proximo_intento = now() para 'pendiente' (inmediato),
--      now() + 1 minute para 'error' (backoff mínimo).
--   3. Guard explícito: punto_venta_id IS NULL → return (sin PdV no hay emisión).
--   4. ON CONFLICT: corregido de "ON CONSTRAINT" (no existe para partial indexes) a
--      predicado explícito que matchea uq_fpa_comprobante_activo.
--   5. error_mensaje solo se propaga cuando el estado que dispara el trigger es 'error'.

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
  -- Solo actuar en transiciones a 'pendiente' (primera emisión) o 'error' (re-encolar).
  IF NEW.cae_estado NOT IN ('pendiente', 'error') THEN RETURN NEW; END IF;
  -- Evitar re-encolar si el estado no cambió (UPDATE que toca otra columna).
  IF OLD.cae_estado = NEW.cae_estado THEN RETURN NEW; END IF;
  -- Sin punto_venta_id no hay PdV para emitir → no encolar.
  IF NEW.punto_venta_id IS NULL THEN RETURN NEW; END IF;

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
    NEW.empresa_id,
    NEW.id,
    NEW.punto_venta_id,
    v_tipo_interno,
    v_codigo_afip,
    '{}',
    'pendiente',
    CASE NEW.cae_estado
      WHEN 'pendiente' THEN now()                      -- primera emisión: inmediato
      ELSE              now() + interval '1 minute'     -- tras error: backoff mínimo
    END,
    CASE NEW.cae_estado
      WHEN 'error' THEN NEW.error_afip
      ELSE NULL
    END
  )
  -- ON CONFLICT con predicado explícito (no ON CONSTRAINT — uq_fpa_comprobante_activo
  -- es un partial UNIQUE INDEX, no una constraint nombrada; no admite ON CONSTRAINT).
  ON CONFLICT (comprobante_id)
    WHERE comprobante_id IS NOT NULL
      AND estado NOT IN ('emitida', 'error_definitivo')
    DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_factura_arca() FROM PUBLIC, anon;
-- Nota: el trigger trg_queue_factura_arca ya existe desde migration 087.
-- Solo es necesario reemplazar la función con CREATE OR REPLACE.

-- ROLLBACK (comentado):
-- Restaurar la versión 087 de fn_queue_factura_arca (condición solo 'error').
