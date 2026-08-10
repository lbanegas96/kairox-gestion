-- ════════════════════════════════════════════════════════════════════════════
-- Migration 316 — Fase 2 del plan de robustez AFIP/ARCA (PLAN_ROBUSTEZ_FACTURACION_ARCA.md)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Objetivo: que el primer intento de emisión ocurra en segundos, no en hasta
-- 5 minutos — sin tocar la arquitectura de cola async (el cron sigue como
-- red de seguridad, no se reemplaza).
--
--   1. `fn_queue_factura_arca` (trigger que encola en facturas_pendientes_arca,
--      mig.089) ahora también despierta a `arca-worker` con un
--      `net.http_post` fire-and-forget apenas encola algo nuevo — mismo
--      patrón que ya usa el cron de la mig.102 (pg_net es async por diseño:
--      encola el HTTP request y sigue, no bloquea la transacción que
--      confirma la venta). Si el ON CONFLICT DO NOTHING saltea el INSERT
--      (ya había una fila activa para ese comprobante), no se gasta una
--      invocación de más — el worker ya la va a ver en su próximo tick.
--      Si la transacción que disparó el trigger hace ROLLBACK por cualquier
--      otro motivo, el POST encolado también se descarta (mismo commit) —
--      no hay riesgo de despertar al worker para una venta que no se
--      confirmó.
--
--   2. Sincroniza `max_intentos`: el DEFAULT de la tabla era 3
--      (migración 082) pero el worker usa una constante hardcodeada de 5
--      (arca-worker/index.ts) — la barra de progreso del Monitor mostraba
--      "2/3" cuando en realidad el sistema seguía reintentando hasta 5. Se
--      alinea el DEFAULT de la columna al comportamiento real del worker.
--      Solo afecta filas nuevas — las existentes no se tocan.

-- ── 1. Despertar al worker apenas se encola algo nuevo ──────────────────────
CREATE OR REPLACE FUNCTION public.fn_queue_factura_arca()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo_interno TEXT;
  v_codigo_afip  SMALLINT;
  v_inserted_id  UUID;
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
    DO NOTHING
  RETURNING id INTO v_inserted_id;

  -- Fase 2: despertar al worker YA en vez de esperar hasta 5 min al próximo
  -- tick del cron. Solo si realmente se encoló algo nuevo (v_inserted_id no
  -- nulo) — si el ON CONFLICT saltó, ya había una fila activa y el worker
  -- la va a procesar de todos modos en su próximo ciclo.
  IF v_inserted_id IS NOT NULL THEN
    PERFORM net.http_post(
      url     := 'https://wuznppxeonmhfcvnqfbf.supabase.co/functions/v1/arca-worker',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1em5wcHhlb25taGZjdm5xZmJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2NTI4MzYsImV4cCI6MjA5NTIyODgzNn0.EIOpfN1vGA4ZTCZ0_NfIhPzV4Us4LZ9t7QbzeI2IO0U"}'::jsonb,
      body    := '{}'::jsonb
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_queue_factura_arca() FROM PUBLIC, anon;
-- Nota: el trigger trg_queue_factura_arca ya existe desde migration 087, solo
-- hace falta reemplazar la función.

-- ── 2. Sincronizar max_intentos con el comportamiento real del worker ──────
ALTER TABLE public.facturas_pendientes_arca ALTER COLUMN max_intentos SET DEFAULT 5;

-- ROLLBACK (comentado):
--   Restaurar fn_queue_factura_arca a la versión de la migración 089 (sin el
--   bloque PERFORM net.http_post ni la variable v_inserted_id).
--   ALTER TABLE public.facturas_pendientes_arca ALTER COLUMN max_intentos SET DEFAULT 3;
