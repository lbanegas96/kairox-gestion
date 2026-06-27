-- Migration 104 — Fix CHECK constraint para CAEA
--
-- PROBLEMA: usar_caea_en_venta intentaba poner cae_estado = 'pendiente_caea'
-- pero el CHECK solo permite: no_aplica|pendiente|emitido|error|error_definitivo
--
-- SOLUCIÓN: los comprobantes CAEA usan cae_estado = 'no_aplica' (no necesitan
-- CAE individual). El campo modo_autorizacion = 'CAEA' ya los distingue.
-- La tabla caea_comprobantes.estado_informado rastrea si se informaron a AFIP.

CREATE OR REPLACE FUNCTION public.usar_caea_en_venta(
  p_empresa_id       uuid,
  p_comprobante_id   uuid,
  p_caea_registro_id uuid,
  p_tipo_cbte        integer,
  p_nro_cbte         integer,
  p_fecha_cbte       date,
  p_doc_tipo         integer,
  p_doc_nro          varchar,
  p_imp_total        numeric,
  p_imp_neto         numeric,
  p_imp_iva          numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pv integer;
BEGIN
  IF p_empresa_id IS DISTINCT FROM public.get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.caea_registros
    WHERE id = p_caea_registro_id
      AND empresa_id = p_empresa_id
      AND estado = 'activo'
      AND fecha_hasta >= CURRENT_DATE
  ) THEN
    RAISE EXCEPTION 'CAEA no vigente o no pertenece a la empresa';
  END IF;

  SELECT punto_venta INTO v_pv
  FROM public.caea_registros
  WHERE id = p_caea_registro_id;

  INSERT INTO public.caea_comprobantes (
    empresa_id, caea_registro_id, comprobante_id,
    tipo_cbte, punto_venta,
    nro_cbte_desde, nro_cbte_hasta,
    fecha_cbte, doc_tipo, doc_nro,
    imp_total, imp_neto, imp_iva
  ) VALUES (
    p_empresa_id, p_caea_registro_id, p_comprobante_id,
    p_tipo_cbte, COALESCE(v_pv, 1),
    p_nro_cbte, p_nro_cbte,
    p_fecha_cbte, p_doc_tipo, p_doc_nro,
    p_imp_total, p_imp_neto, p_imp_iva
  );

  -- Usar 'no_aplica' (no 'pendiente_caea') para respetar el CHECK constraint.
  -- modo_autorizacion='CAEA' + caea_registro_id es suficiente para identificarlos.
  UPDATE public.comprobantes
  SET modo_autorizacion = 'CAEA',
      caea_registro_id  = p_caea_registro_id,
      cae_estado        = 'no_aplica'
  WHERE id = p_comprobante_id
    AND empresa_id = p_empresa_id;

  UPDATE public.caea_registros
  SET comprobantes_emitidos = comprobantes_emitidos + 1,
      updated_at            = now()
  WHERE id = p_caea_registro_id;
END;
$$;

REVOKE ALL ON FUNCTION public.usar_caea_en_venta FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.usar_caea_en_venta TO authenticated;

-- Agregar CHECK constraint a modo_autorizacion (faltaba en migration 103)
ALTER TABLE public.comprobantes
  ADD CONSTRAINT comprobantes_modo_autorizacion_check
  CHECK (modo_autorizacion IN ('CAE', 'CAEA'));
