-- migration 278 — Cancelación con reversa para NC/ND de Proveedor
--
-- CONTEXTO: cierra el último pendiente del espejo Ventas→Compras. Ventas ya
-- tiene cancelar_nota_credito (mig.267, documento de reversa — nunca borra
-- el original) para NC de Cliente. NC/ND de Proveedor (mig.276/277, de hoy)
-- no tenían forma de deshacerse si se cargaban mal.
--
-- Mismo patrón que mig.267: nunca se borra el movimiento original, se
-- inserta un movimiento especular en cuenta_corriente_proveedores y se
-- marca el documento como 'cancelada'. Ninguna de las 2 toca AFIP (nunca la
-- tocaron) así que no hay guard de CAE — el único guard real es no permitir
-- cancelar una NC que ya se cobró en efectivo (el dinero ya cambió de manos
-- en la vida real, deshacerlo automáticamente sería más peligroso que útil
-- — mismo criterio que cancelar_nota_credito bloqueando si ya fue imputada).

-- ── 1. Columna estado en ambas tablas ─────────────────────────────────────
ALTER TABLE public.notas_credito_proveedor
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa', 'cancelada'));

ALTER TABLE public.notas_debito
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'activa'
    CHECK (estado IN ('activa', 'cancelada'));

-- ── 2. cancelar_nota_credito_proveedor ────────────────────────────────────
-- Reversa: la NC redujo la deuda (tipo='nota_credito', -monto en
-- v_saldo_proveedores) → la reversa la vuelve a subir con tipo='nota_debito'.
CREATE OR REPLACE FUNCTION public.cancelar_nota_credito_proveedor(
  p_empresa_id uuid,
  p_user_id    uuid,
  p_ncp_id     uuid,
  p_motivo     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ncp RECORD;
  v_cc_id UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT * INTO v_ncp FROM public.notas_credito_proveedor
  WHERE id = p_ncp_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de Crédito de Proveedor no encontrada';
  END IF;

  IF v_ncp.estado = 'cancelada' THEN
    RAISE EXCEPTION 'Esta Nota de Crédito ya está cancelada';
  END IF;

  IF v_ncp.reembolso_efectivo THEN
    RAISE EXCEPTION 'Esta NC ya se cobró en efectivo — el dinero ya cambió de manos, no se puede cancelar automáticamente. Hacé el ajuste manual en Caja primero.';
  END IF;

  -- Reversa del HABER original (redujo deuda) con un DEBE especular (sube
  -- la deuda de vuelta) — nunca se borra el movimiento original.
  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_ncp.proveedor_id, 'nota_debito', v_ncp.monto,
    'Cancelación NC ' || v_ncp.numero_ncp || COALESCE(' — ' || NULLIF(p_motivo, ''), ''),
    p_ncp_id, 'cancelacion_nc_proveedor', now()
  ) RETURNING id INTO v_cc_id;

  UPDATE public.notas_credito_proveedor SET estado = 'cancelada' WHERE id = p_ncp_id;

  RETURN jsonb_build_object(
    'nota_credito_proveedor_id', p_ncp_id,
    'numero_ncp', v_ncp.numero_ncp,
    'monto', v_ncp.monto,
    'reversa_id', v_cc_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_nota_credito_proveedor(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_nota_credito_proveedor(uuid, uuid, uuid, text) TO authenticated;

-- ── 3. cancelar_nota_debito_proveedor ─────────────────────────────────────
-- Solo rama 'recibida' (proveedor) — la rama 'emitida' (cliente) ya está en
-- desuso desde el rediseño de ND de Cliente (mig.268/269), no se toca acá.
-- Reversa: la ND subió la deuda (tipo='nota_debito', +monto) → la reversa
-- la baja con tipo='nota_credito'.
CREATE OR REPLACE FUNCTION public.cancelar_nota_debito_proveedor(
  p_empresa_id uuid,
  p_user_id    uuid,
  p_nd_id      uuid,
  p_motivo     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nd RECORD;
  v_cc_id UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT * INTO v_nd FROM public.notas_debito
  WHERE id = p_nd_id AND empresa_id = p_empresa_id AND tipo = 'recibida'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nota de Débito recibida no encontrada';
  END IF;

  IF v_nd.estado = 'cancelada' THEN
    RAISE EXCEPTION 'Esta Nota de Débito ya está cancelada';
  END IF;

  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_nd.proveedor_id, 'nota_credito', v_nd.monto,
    'Cancelación ND ' || v_nd.numero_nd || COALESCE(' — ' || NULLIF(p_motivo, ''), ''),
    p_nd_id, 'cancelacion_nd_proveedor', now()
  ) RETURNING id INTO v_cc_id;

  UPDATE public.notas_debito SET estado = 'cancelada' WHERE id = p_nd_id;

  RETURN jsonb_build_object(
    'nota_debito_id', p_nd_id,
    'numero_nd', v_nd.numero_nd,
    'monto', v_nd.monto,
    'reversa_id', v_cc_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.cancelar_nota_debito_proveedor(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancelar_nota_debito_proveedor(uuid, uuid, uuid, text) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.cancelar_nota_credito_proveedor(uuid, uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.cancelar_nota_debito_proveedor(uuid, uuid, uuid, text);
-- ALTER TABLE public.notas_credito_proveedor DROP COLUMN IF EXISTS estado;
-- ALTER TABLE public.notas_debito DROP COLUMN IF EXISTS estado;
