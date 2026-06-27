-- ════════════════════════════════════════════════════════════════════════════
-- migration 100 — obtener_proximo_numero: self-heal anti-colisión para 'venta'
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO (sesión 64): al facturar saltaba
--   "duplicate key value violates unique constraint comprobantes_empresa_id_numero_venta_key".
-- Causa: el contador series_numeracion.proximo_numero de 'venta' quedó ATRÁS del
-- máximo real en comprobantes. Hasta hoy el POS (PanelCarrito → useConfirmarVenta)
-- generaba el número con MAX+1 en el frontend SIN incrementar la serie, mientras
-- NuevaVentaModal sí usaba esta RPC → la serie se desincronizó. Hoy se unificó el
-- POS a esta RPC, pero el contador ya había quedado desfasado y colisionaba.
--
-- FIX (defensa en profundidad): para 'venta', antes de devolver el número, la RPC
-- reconcilia el contador contra el máximo real de comprobantes del período. Sólo
-- puede SUBIR el número (GREATEST), nunca bajarlo → nunca genera colisiones; a lo
-- sumo deja un hueco. Así, ante cualquier alta futura fuera de esta RPC (import,
-- fix manual, etc.) la numeración se auto-corrige y no vuelve a romper la facturación.
--
-- También re-sincroniza de una vez todas las series 'venta' ya desfasadas.

-- ── 1. RPC con self-heal ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.obtener_proximo_numero(p_empresa_id uuid, p_tipo_documento text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_serie     RECORD;
  v_periodo   TEXT;
  v_numero    INTEGER;
  v_max_real  INTEGER;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_serie
  FROM public.series_numeracion
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM public.seed_series_numeracion(p_empresa_id);
    SELECT * INTO v_serie
    FROM public.series_numeracion
    WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de documento no reconocido: %', p_tipo_documento;
  END IF;

  v_periodo := CASE v_serie.formato_fecha
    WHEN 'YYYYMMDD' THEN to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')
    WHEN 'YYYY'     THEN to_char(NOW() - INTERVAL '3 hours', 'YYYY')
    ELSE NULL
  END;

  IF v_periodo IS NOT NULL AND v_periodo IS DISTINCT FROM v_serie.periodo_actual THEN
    v_numero := 1;
  ELSE
    v_numero := v_serie.proximo_numero;
  END IF;

  -- Self-heal anti-colisión (sólo 'venta'): si el contador quedó atrás del máximo
  -- real en comprobantes para el período, avanzar al máximo+1. Sólo sube el número.
  IF p_tipo_documento = 'venta' AND v_periodo IS NOT NULL THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
      INTO v_max_real
    FROM public.comprobantes c
    WHERE c.empresa_id = p_empresa_id
      AND c.tipo = 'venta'
      AND c.numero_venta LIKE v_serie.prefijo || v_periodo || '-%'
      AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';

    IF v_max_real + 1 > v_numero THEN
      v_numero := v_max_real + 1;
    END IF;
  END IF;

  UPDATE public.series_numeracion
  SET proximo_numero = v_numero + 1,
      periodo_actual = v_periodo
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento;

  RETURN v_serie.prefijo
    || CASE WHEN v_periodo IS NOT NULL THEN v_periodo || '-' ELSE '' END
    || LPAD(v_numero::TEXT, v_serie.digitos, '0');
END;
$function$;

-- ── 2. Re-sincronizar series 'venta' ya desfasadas (one-shot) ────────────────
-- Para cada serie 'venta', subir proximo_numero al menos al (máximo real + 1) del
-- período actual de la serie. GREATEST asegura que sólo sube.
UPDATE public.series_numeracion s
SET proximo_numero = GREATEST(
  s.proximo_numero,
  COALESCE((
    SELECT MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int)
    FROM public.comprobantes c
    WHERE c.empresa_id = s.empresa_id
      AND c.tipo = 'venta'
      AND c.numero_venta LIKE s.prefijo || s.periodo_actual || '-%'
      AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$'
  ), 0) + 1
)
WHERE s.tipo_documento = 'venta' AND s.periodo_actual IS NOT NULL;

-- ROLLBACK (comentado): restaurar la versión sin self-heal desde migration 054/083.
