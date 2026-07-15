-- Migration 206 — CAEA: uso manual desde el Monitor de Facturación AFIP.
--
-- Contexto: CAEA (migration 103/104) ya tiene toda la infraestructura de backend
-- (tablas, edge functions solicitar/verificar/informar) pero nunca se conectó a
-- ningún punto de la UI — quedaba documentado como "Pendiente (no implementado)"
-- en CAEA_IMPLEMENTACION.md. Este es el primer punto de enganche: dejar que un
-- admin, desde el Monitor de Facturación AFIP (mig.202), tome un comprobante
-- atascado en error/error_definitivo (típicamente porque ARCA está caído) y lo
-- autorice con el CAEA vigente de la empresa, en vez de seguir reintentando CAE.
--
-- Por qué un RPC nuevo y no llamar usar_caea_en_venta directo desde el frontend:
-- usar_caea_en_venta (mig.103/104) recibe p_nro_cbte ya calculado por el caller,
-- sin ningún lock — calcularlo en el frontend sería una carrera de numeración
-- (2 comprobantes podrían pedir el mismo número si se resuelven en paralelo),
-- exactamente el tipo de bug que este proyecto ya sufrió en producción con la
-- numeración de comprobantes (mig.054) y de recepciones de OC (mig.066). Este
-- RPC hace el cálculo con `FOR UPDATE` sobre caea_registros (mismo patrón que
-- obtener_proximo_numero) y después invoca usar_caea_en_venta con el número ya
-- reservado atómicamente.

CREATE OR REPLACE FUNCTION public.usar_caea_para_comprobante(p_comprobante_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_empresa_id       uuid;
  v_estado_actual     text;
  v_tipo_afip         text;   -- 'A' | 'B' | 'C'
  v_tipo_cbte         integer;
  v_total             numeric;
  v_neto               numeric;
  v_iva                numeric;
  v_fecha              date;
  v_cliente_id         uuid;
  v_documento          text;
  v_doc_digits         text;
  v_doc_tipo           integer;
  v_doc_nro            text;
  v_caea_registro_id   uuid;
  v_caea               varchar(14);
  v_fecha_hasta        date;
  v_nro_cbte           integer;
  v_fila_cola_id       uuid;
BEGIN
  -- ── Guards de tenant + permiso + estado ──────────────────────────────────
  SELECT empresa_id, cae_estado, tipo_comprobante_afip, total, neto_gravado,
         iva_discriminado, fecha::date, cliente_id
    INTO v_empresa_id, v_estado_actual, v_tipo_afip, v_total, v_neto,
         v_iva, v_fecha, v_cliente_id
    FROM public.comprobantes
   WHERE id = p_comprobante_id;

  IF v_empresa_id IS NULL OR v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: comprobante no encontrado o de otra empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF v_estado_actual NOT IN ('error', 'error_definitivo') THEN
    RAISE EXCEPTION 'El comprobante no está en error (estado actual: %). Solo se puede usar CAEA sobre un comprobante en error o error_definitivo.', v_estado_actual;
  END IF;

  v_tipo_cbte := CASE COALESCE(v_tipo_afip, 'B') WHEN 'A' THEN 1 WHEN 'C' THEN 11 ELSE 6 END;

  -- ── CAEA vigente para este tipo de comprobante, con lock de numeración ──
  SELECT id, caea, fecha_hasta
    INTO v_caea_registro_id, v_caea, v_fecha_hasta
    FROM public.caea_registros
   WHERE empresa_id = v_empresa_id
     AND tipo_cbte   = v_tipo_cbte
     AND estado      = 'activo'
     AND fecha_hasta >= CURRENT_DATE
   ORDER BY fecha_hasta DESC
   LIMIT 1
   FOR UPDATE;

  IF v_caea_registro_id IS NULL THEN
    RAISE EXCEPTION 'No hay un CAEA vigente para comprobantes tipo % de esta empresa. Solicitalo primero desde Configuración → Facturación.',
      COALESCE(v_tipo_afip, 'B');
  END IF;

  -- Próximo número dentro de este CAEA (mismo patrón de lock que obtener_proximo_numero).
  SELECT comprobantes_emitidos + 1 INTO v_nro_cbte
    FROM public.caea_registros WHERE id = v_caea_registro_id;

  -- ── Documento del receptor (mismo mapeo que docTipoAfip en el edge function) ──
  v_documento := NULL;
  IF v_cliente_id IS NOT NULL THEN
    SELECT documento INTO v_documento FROM public.clientes WHERE id = v_cliente_id;
  END IF;
  v_doc_digits := regexp_replace(COALESCE(v_documento, ''), '\D', '', 'g');
  IF length(v_doc_digits) = 11 THEN
    v_doc_tipo := 80; v_doc_nro := v_doc_digits;              -- CUIT
  ELSIF length(v_doc_digits) BETWEEN 7 AND 8 THEN
    v_doc_tipo := 96; v_doc_nro := v_doc_digits;              -- DNI
  ELSE
    v_doc_tipo := 99; v_doc_nro := '0';                        -- Consumidor Final
  END IF;

  -- ── Delegar en usar_caea_en_venta (mig.103/104) con el número ya reservado ──
  PERFORM public.usar_caea_en_venta(
    v_empresa_id,
    p_comprobante_id,
    v_caea_registro_id,
    v_tipo_cbte,
    v_nro_cbte,
    v_fecha,
    v_doc_tipo,
    v_doc_nro,
    COALESCE(v_total, 0),
    COALESCE(v_neto, v_total, 0),
    COALESCE(v_iva, 0)
  );

  -- ── Cerrar la cola de CAE — el worker ya no debe tocar este comprobante ──
  -- Mismo criterio que marcar_cae_resuelto_manual: solo la fila más reciente.
  SELECT id INTO v_fila_cola_id
    FROM public.facturas_pendientes_arca
   WHERE comprobante_id = p_comprobante_id
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;

  IF v_fila_cola_id IS NOT NULL THEN
    UPDATE public.facturas_pendientes_arca
       SET estado = 'emitida', error_mensaje = NULL, updated_at = now()
     WHERE id = v_fila_cola_id;
  END IF;

  RETURN jsonb_build_object(
    'caea', v_caea,
    'nro_cbte', v_nro_cbte,
    'fecha_hasta', v_fecha_hasta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.usar_caea_para_comprobante(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usar_caea_para_comprobante(uuid) TO authenticated;

-- ── Exponer modo_autorizacion/caea en el Monitor ─────────────────────────────
-- Sin esto, un comprobante autorizado por CAEA se ve idéntico a uno genuinamente
-- "No relevante" (ambos tienen cae_estado='no_aplica') — el Monitor necesita
-- distinguirlos para no confundir al usuario.
-- CREATE OR REPLACE VIEW exige mantener el orden/nombre de las columnas ya
-- existentes — las columnas nuevas van al final, no intercaladas, para no
-- romper con "cannot change name of view column".
CREATE OR REPLACE VIEW public.v_facturas_arca_monitor
WITH (security_invoker = on) AS
SELECT
  c.id                     AS comprobante_id,
  c.empresa_id,
  c.numero_venta,
  c.fecha,
  c.total,
  c.tipo,
  c.tipo_comprobante_afip,
  c.cliente_nombre,
  c.cae_estado,
  c.cae,
  c.cae_vencimiento,
  c.numero_afip,
  c.error_afip,
  c.relevante_fiscal,
  fpa.intentos,
  fpa.max_intentos,
  fpa.estado            AS estado_cola,
  fpa.error_mensaje     AS error_cola,
  fpa.proximo_intento,
  fpa.updated_at        AS ultima_actividad,
  c.modo_autorizacion,
  c.caea_registro_id,
  cr.caea               AS caea_codigo
FROM public.comprobantes c
LEFT JOIN public.caea_registros cr ON cr.id = c.caea_registro_id
LEFT JOIN LATERAL (
  SELECT intentos, max_intentos, estado, error_mensaje, proximo_intento, updated_at
  FROM public.facturas_pendientes_arca f
  WHERE f.comprobante_id = c.id
  ORDER BY f.created_at DESC
  LIMIT 1
) fpa ON true;

GRANT SELECT ON public.v_facturas_arca_monitor TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.usar_caea_para_comprobante(uuid);
