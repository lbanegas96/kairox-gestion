-- migration 267 — RPC cancelar_nota_credito: reversión total, mismo patrón que cancelar_factura (mig.259)
--
-- HALLAZGO (gap-analysis NC vs SAP): una NC cargada mal hoy no se puede
-- deshacer — no hay forma de revertir la reducción de deuda que generó en
-- Cuenta Corriente. Falta el mismo "documento de reversa" que ya existe para
-- Factura.
--
-- Mismas reglas que cancelar_factura, adaptadas a NC (que no toca stock ni
-- caja — solo Cuenta Corriente):
--   1. Bloqueada si ya tiene CAE emitido/pendiente ante AFIP — el documento ya
--      es (o puede llegar a ser) fiscalmente válido, no se "deshace".
--   2. Bloqueada si esta NC ya fue imputada contra la factura de origen
--      (cuenta_corriente_imputaciones) — mismo criterio que cancelar_factura:
--      revertir un cobro/crédito ya aplicado excede una reversión simple.
--   3. Reversa el HABER original con un DEBE especular (nunca se borra el
--      HABER original).
--   4. Si esta NC vino de una Devolución (p_devolucion_id en su momento),
--      se desvincula (nota_credito_id=NULL, compensacion='pendiente') para
--      que la Devolución quede disponible para generar una NC nueva.
--
-- No hay asiento contable que reversar: crear_nota_credito nunca generó uno
-- (gap real, distinto y más grande — pendiente de decisión aparte, no se
-- toca en esta migración).

CREATE OR REPLACE FUNCTION public.cancelar_nota_credito(
  p_empresa_id     uuid,
  p_user_id        uuid,
  p_comprobante_id uuid,
  p_motivo         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp RECORD;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes
  WHERE id = p_comprobante_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  IF v_comp.tipo <> 'nota_credito' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar Notas de Crédito (tipo actual: %)', v_comp.tipo;
  END IF;

  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Esta Nota de Crédito ya está cancelada';
  END IF;

  IF COALESCE(v_comp.cae_estado, 'no_aplica') IN ('emitido', 'pendiente', 'pendiente_caea') THEN
    RAISE EXCEPTION 'Esta Nota de Crédito tiene CAE emitido (o en trámite ante AFIP) — no se puede cancelar directamente.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cuenta_corriente_imputaciones ci
    JOIN public.cuenta_corriente_movimientos cm ON cm.id = ci.cobro_movimiento_id
    WHERE cm.comprobante_id = p_comprobante_id
  ) THEN
    RAISE EXCEPTION 'Esta Nota de Crédito ya fue imputada contra la factura de origen — no se puede cancelar directamente.';
  END IF;

  -- Reversar cuenta corriente (HABER original) — DEBE especular, nunca se
  -- borra el HABER original.
  IF v_comp.cliente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos
    WHERE comprobante_id = p_comprobante_id AND tipo = 'HABER'
  ) THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, auth.uid(), v_comp.cliente_id, p_comprobante_id, 'DEBE', v_comp.total,
      'Cancelación NC ' || v_comp.numero_venta || COALESCE(' — ' || NULLIF(p_motivo, ''), ''), now()
    );
  END IF;

  -- Desvincular de la Devolución origen (si la hubo) para que quede
  -- disponible y se pueda generar una NC nueva más adelante.
  UPDATE public.devoluciones
     SET nota_credito_id = NULL, compensacion = 'pendiente'
   WHERE nota_credito_id = p_comprobante_id AND empresa_id = p_empresa_id;

  UPDATE public.comprobantes SET estado_pago = 'cancelada' WHERE id = p_comprobante_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_nota_credito(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancelar_nota_credito(uuid, uuid, uuid, text) TO authenticated;

-- ROLLBACK (comentado): DROP FUNCTION IF EXISTS public.cancelar_nota_credito(uuid, uuid, uuid, text);
