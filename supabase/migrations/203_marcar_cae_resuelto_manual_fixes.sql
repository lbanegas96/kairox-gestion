-- migration 203 — Fix de dos bugs en marcar_cae_resuelto_manual (2026-07-13).
--
-- Hallazgos verificados en producción durante testeo del Monitor de Facturación
-- AFIP (mig.202) contra datos reales de Nalux:
--
-- 1. El RPC hacía `UPDATE facturas_pendientes_arca SET estado='emitida'
--    WHERE comprobante_id = p_comprobante_id` sin filtrar por la fila más
--    reciente. Cuando un comprobante tenía varias filas de historial en la
--    cola (típico tras varios reintentos con fixes intermedios como el de RG
--    5616), TODAS quedaban marcadas 'emitida', perdiendo el contexto
--    histórico del error viejo. Se agrega WHERE id = (última por created_at).
--
-- 2. No validaba el estado actual del comprobante. Un click accidental sobre
--    una fila 'pendiente' (o incluso 'emitido' si el frontend cambiara) la
--    forzaba a 'emitido' sin CAE ni Nº AFIP. Se agrega guard: solo permitir
--    la transición desde 'error' / 'error_definitivo' (mismo criterio que
--    reintentar_caes_lote pero excluyendo 'pendiente', que no es "resolver
--    algo roto" sino "está en proceso normal").

CREATE OR REPLACE FUNCTION public.marcar_cae_resuelto_manual(p_comprobante_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_empresa_id uuid;
  v_estado_actual text;
  v_fila_id uuid;
BEGIN
  SELECT empresa_id, cae_estado
    INTO v_empresa_id, v_estado_actual
    FROM public.comprobantes WHERE id = p_comprobante_id;

  IF v_empresa_id IS NULL OR v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: comprobante no encontrado o de otra empresa';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  -- Guard: solo tiene sentido "marcar resuelto manualmente" un error.
  IF v_estado_actual NOT IN ('error', 'error_definitivo') THEN
    RAISE EXCEPTION 'El comprobante no está en error (estado actual: %). Solo se puede marcar como resuelto un comprobante en error o error_definitivo.', v_estado_actual;
  END IF;

  -- Solo actualiza la fila más reciente de la cola, no todas las históricas.
  SELECT id INTO v_fila_id
    FROM public.facturas_pendientes_arca
   WHERE comprobante_id = p_comprobante_id
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;

  IF v_fila_id IS NOT NULL THEN
    UPDATE public.facturas_pendientes_arca
       SET estado='emitida', updated_at=now()
     WHERE id = v_fila_id;
  END IF;

  UPDATE public.comprobantes
     SET cae_estado='emitido', error_afip=NULL
   WHERE id = p_comprobante_id;

  RETURN true;
END;
$$;

-- Mismo REVOKE que la versión original (mig.202, convención del proyecto).
REVOKE EXECUTE ON FUNCTION public.marcar_cae_resuelto_manual(uuid) FROM anon;
