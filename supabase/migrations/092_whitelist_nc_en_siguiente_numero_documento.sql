-- Migration 092: agregar (comprobantes, numero_venta, NC) al whitelist de
-- siguiente_numero_documento.
--
-- Síntoma: al registrar una devolución con compensación 'nota_credito',
-- crear_devolucion fallaba con:
--   "Combinación (tabla, columna, prefijo) no permitida:
--    (comprobantes, numero_venta, NC)"
--
-- Causa: migration 086 introdujo un 3er callsite de siguiente_numero_documento
-- para numerar la NC de compensación dentro de crear_devolucion, pero el
-- whitelist creado en migration 075 solo contemplaba los 2 callsites
-- existentes en ese momento (entregas/ENT y devoluciones/DEV).
--
-- Este fix es un hotfix mínimo (1 entrada nueva al whitelist) que preserva
-- el formato NC-YYYY-NNNN que ya está en producción.
--
-- Deuda técnica: el callsite usa COUNT(*) sin lock (race condition teórica
-- bajo concurrencia). El fix definitivo es migrar ese callsite a
-- obtener_proximo_numero(p_empresa_id, 'nota_credito') una vez que se
-- decida si unificar el formato o ajustar series_numeracion al legacy.

CREATE OR REPLACE FUNCTION public.siguiente_numero_documento(
  p_empresa_id UUID,
  p_tabla      TEXT,
  p_columna    TEXT,
  p_prefijo    TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_anio  TEXT    := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
  v_count INTEGER;
  v_query TEXT;
BEGIN
  -- Guard de tenant
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  -- Whitelist de combinaciones (tabla, columna, prefijo) permitidas.
  -- Si se agrega un caller nuevo, agregar acá explícitamente.
  IF NOT (
       (p_tabla = 'entregas'     AND p_columna = 'numero_entrega'    AND p_prefijo = 'ENT')
    OR (p_tabla = 'devoluciones' AND p_columna = 'numero_devolucion' AND p_prefijo = 'DEV')
    OR (p_tabla = 'comprobantes' AND p_columna = 'numero_venta'      AND p_prefijo = 'NC')
  ) THEN
    RAISE EXCEPTION 'Combinación (tabla, columna, prefijo) no permitida: (%, %, %)',
      p_tabla, p_columna, p_prefijo;
  END IF;

  v_query := format(
    'SELECT COUNT(*) FROM public.%I WHERE empresa_id = $1 AND %I LIKE $2',
    p_tabla, p_columna
  );
  EXECUTE v_query INTO v_count
    USING p_empresa_id, p_prefijo || '-' || v_anio || '-%';
  RETURN p_prefijo || '-' || v_anio || '-' || LPAD((v_count + 1)::TEXT, 4, '0');
END;
$$;
