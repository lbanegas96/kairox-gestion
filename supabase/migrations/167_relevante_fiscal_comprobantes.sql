-- ════════════════════════════════════════════════════════════════════════════
-- migration 167 — comprobantes.relevante_fiscal (patrón SAP "Relevante para
-- impuestos") + backfill de las 19 facturas atascadas por RG 5616
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: SAP B1/S4 tiene en cada documento fiscal un flag "Relevante a
-- efectos fiscales" — por defecto todo documento ES relevante, pero un
-- documento interno (ajuste, prueba, corrección manual) puede tildarse como NO
-- relevante para que nunca se presente ante el fisco. KAIROX no tenía este
-- concepto: todo comprobante con AFIP activo se encolaba sí o sí para CAE.
--
-- MOTIVO INMEDIATO: 19 comprobantes reales (ventas + NC de Nalux, 2026-07-03 a
-- 2026-07-08) quedaron en facturas_pendientes_arca.estado='error_datos' porque
-- WSFE rechaza el comprobante con error AFIP [10246] Condicion Frente al IVA
-- del receptor obligatoria (RG 5616) — el campo CondicionIVAReceptorId nunca
-- se mandaba en el request. El fix de código (wsfe.ts + afip.ts + arca-worker/
-- index.ts) ya está escrito pero AÚN NO deployado a la Edge Function en
-- producción. Mientras tanto, cualquier reintento (botón "Reintentar CAE" →
-- reencolar_caes_pendientes, o el reintento por fila del historial) fallaría
-- exactamente igual con el mismo error. Se marcan como no relevante para
-- frenar el ruido de reintentos sin perder trazabilidad de que existen.
--
-- IMPORTANTE — reversión pendiente: una vez deployado el fix de
-- CondicionIVAReceptorId, estas 19 facturas siguen siendo fiscalmente válidas
-- y DEBEN emitir CAE real (no es una decisión de "documento interno" real,
-- es un freno temporal). Revertir con:
--   UPDATE comprobantes SET relevante_fiscal = true, cae_estado = 'error'
--   WHERE id IN (<ids de abajo>) y llamar reencolar_caes_pendientes.
--
-- FIX:
--   1. Columna comprobantes.relevante_fiscal (default true — no rompe nada
--      existente).
--   2. Trigger fn_queue_factura_arca: guard adicional, no encola si
--      relevante_fiscal=false (cubre CUALQUIER camino que ponga cae_estado en
--      'pendiente'/'error' — el modal de creación, el botón de reintento por
--      fila, etc.).
--   3. RPC reencolar_caes_pendientes: excluye relevante_fiscal=false del
--      reintento masivo (defensa en profundidad además del trigger).
--   4. Backfill: las 19 facturas con error 10246 → relevante_fiscal=false,
--      cae_estado='no_aplica' (mismo estado ya usado para "no necesita CAE
--      individual", ver migration 104/CAEA) y sus filas en
--      facturas_pendientes_arca → estado='error_definitivo' (fuera del filtro
--      del worker, que solo lee 'pendiente'/'reintentando').

-- ─── Paso 1: columna nueva ───────────────────────────────────────────────────
ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS relevante_fiscal BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.comprobantes.relevante_fiscal IS
  'Patrón SAP "Relevante para impuestos". false = documento interno/ajuste que nunca debe encolarse para CAE ante AFIP, incluso con facturación electrónica activa.';

-- ─── Paso 2: guard en el trigger de encolado ─────────────────────────────────
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
  -- Documento marcado como no relevante para AFIP (SAP-style) → nunca encolar.
  IF NEW.relevante_fiscal = false THEN RETURN NEW; END IF;

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
  ON CONFLICT (comprobante_id)
    WHERE comprobante_id IS NOT NULL
      AND estado NOT IN ('emitida', 'error_definitivo')
    DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_factura_arca() FROM PUBLIC, anon;

-- ─── Paso 3: guard en el reintento masivo ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reencolar_caes_pendientes(p_empresa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer := 0;
  r RECORD;
BEGIN
  IF p_empresa_id IS NULL OR p_empresa_id <> get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el tenant del caller';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  FOR r IN
    SELECT c.id, c.punto_venta_id, COALESCE(c.tipo_comprobante_afip, 'B') AS tipo
    FROM public.comprobantes c
    WHERE c.empresa_id = p_empresa_id
      AND c.cae_estado IN ('pendiente', 'error')
      AND c.relevante_fiscal = true
    ORDER BY c.fecha ASC
    LIMIT 50
  LOOP
    UPDATE public.facturas_pendientes_arca
       SET estado          = 'pendiente',
           intentos        = 0,
           proximo_intento = now(),
           error_mensaje   = NULL,
           updated_at      = now()
     WHERE comprobante_id = r.id
       AND estado IN ('pendiente', 'reintentando', 'error_datos', 'error_definitivo');

    IF NOT FOUND THEN
      INSERT INTO public.facturas_pendientes_arca (
        empresa_id, comprobante_id, punto_venta_id,
        tipo_comprobante, codigo_afip, payload_arca,
        estado, proximo_intento
      ) VALUES (
        p_empresa_id, r.id, r.punto_venta_id,
        r.tipo,
        CASE r.tipo WHEN 'A' THEN 1::smallint WHEN 'C' THEN 11::smallint ELSE 6::smallint END,
        '{}'::jsonb, 'pendiente', now()
      )
      ON CONFLICT (comprobante_id)
        WHERE comprobante_id IS NOT NULL AND estado NOT IN ('emitida', 'error_definitivo')
        DO NOTHING;
    END IF;

    UPDATE public.comprobantes
       SET cae_estado = 'pendiente', error_afip = NULL
     WHERE id = r.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reencolar_caes_pendientes(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reencolar_caes_pendientes(uuid) TO authenticated;

-- ─── Paso 4: backfill de las 19 facturas atascadas por error 10246 ──────────
WITH afectadas AS (
  SELECT fpa.id AS fpa_id, fpa.comprobante_id
  FROM public.facturas_pendientes_arca fpa
  WHERE fpa.estado = 'error_datos'
    AND fpa.error_mensaje ILIKE '%10246%'
)
UPDATE public.comprobantes c
SET relevante_fiscal = false,
    cae_estado       = 'no_aplica'
FROM afectadas a
WHERE c.id = a.comprobante_id;

UPDATE public.facturas_pendientes_arca fpa
SET estado        = 'error_definitivo',
    error_mensaje  = COALESCE(fpa.error_mensaje, '')
                     || ' [KAIROX: marcado no-relevante temporalmente el 2026-07-08 —'
                     || ' fix de CondicionIVAReceptorId (RG 5616) escrito pero no deployado.'
                     || ' Revertir a relevante_fiscal=true + reencolar_caes_pendientes tras deployar.]',
    updated_at    = now()
WHERE fpa.estado = 'error_datos'
  AND fpa.error_mensaje ILIKE '%10246%';

-- ROLLBACK (comentado):
-- UPDATE public.facturas_pendientes_arca SET estado = 'error_datos' WHERE error_mensaje ILIKE '%KAIROX: marcado no-relevante%';
-- UPDATE public.comprobantes SET relevante_fiscal = true, cae_estado = 'error' WHERE relevante_fiscal = false;
-- (restaurar reencolar_caes_pendientes y fn_queue_factura_arca a su versión anterior a esta migration)
-- ALTER TABLE public.comprobantes DROP COLUMN IF EXISTS relevante_fiscal;
