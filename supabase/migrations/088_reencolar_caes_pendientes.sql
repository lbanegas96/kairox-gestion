-- ════════════════════════════════════════════════════════════════════════════
-- migration 088 — RPC reencolar_caes_pendientes (reintento masivo vía worker)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: la función frontend reintentarCAEsPendientes() llamaba a la Edge
-- Function emitir-cae en loop desde el navegador. Eso compite con el arca-worker:
-- un comprobante en 'error' ya está encolado y el worker lo reintenta con backoff,
-- así que emitir-cae directo encima arriesga DOBLE EMISIÓN de CAE.
--
-- FIX: el reintento masivo ahora SOLO re-encola en facturas_pendientes_arca y deja
-- que el worker (única fuente de verdad para emitir) lo procese. Mismo patrón que
-- el botón per-fila handleReintentarFactura, pero en bloque y atómico server-side.
--
-- Reglas:
--   1. Guard multi-tenant: el caller debe pertenecer a p_empresa_id.
--   2. Por cada comprobante con cae_estado IN ('pendiente','error'):
--      - si tiene fila activa/recuperable en la cola → la resetea a 'pendiente'.
--      - si no → inserta una fila nueva (ON CONFLICT DO NOTHING para no chocar con
--        una fila 'procesando' que el worker esté tomando en ese instante).
--      - deja el comprobante en cae_estado='pendiente' para reflejar el reintento.
--   3. Tope de 50 por corrida (igual criterio que el resto de jobs).

CREATE OR REPLACE FUNCTION public.reencolar_caes_pendientes(p_empresa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r RECORD;
BEGIN
  -- Guard multi-tenant: nunca confiar en el empresa_id del cliente sin verificar.
  IF p_empresa_id IS NULL OR p_empresa_id <> get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el tenant del caller';
  END IF;

  FOR r IN
    SELECT c.id, c.punto_venta_id, COALESCE(c.tipo_comprobante_afip, 'B') AS tipo
    FROM public.comprobantes c
    WHERE c.empresa_id = p_empresa_id
      AND c.cae_estado IN ('pendiente', 'error')
    ORDER BY c.fecha ASC
    LIMIT 50
  LOOP
    -- 1. Reset de fila activa/recuperable (todas menos las que el worker está
    --    tomando ahora -'procesando'- o las ya emitidas).
    UPDATE public.facturas_pendientes_arca
       SET estado          = 'pendiente',
           intentos        = 0,
           proximo_intento = now(),
           error_mensaje   = NULL,
           updated_at      = now()
     WHERE comprobante_id = r.id
       AND estado IN ('pendiente', 'reintentando', 'error_datos', 'error_definitivo');

    -- 2. Si no había fila recuperable, encolar una nueva. El ON CONFLICT evita
    --    duplicar si justo existe una fila 'procesando' (cubierta por el índice
    --    único parcial uq_fpa_comprobante_activo).
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

    -- 3. Reflejar el reintento en el comprobante.
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

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.reencolar_caes_pendientes(uuid);
