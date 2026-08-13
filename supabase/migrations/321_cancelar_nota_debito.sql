-- migration 321 — RPC cancelar_nota_debito: reversión total, mismo patrón que cancelar_nota_credito (mig.267)
--
-- HALLAZGO (auditoría "estándar Cotizaciones" contra el resto de comprobantes, 13/08): una Nota
-- de Débito emitida (crear_nota_debito_cliente, mig.275, tipo='nota_debito' en comprobantes) no
-- tenía NINGUNA forma de revertirse — a diferencia de Factura (cancelar_factura, mig.259) y NC
-- (cancelar_nota_credito, mig.267), no existía ningún RPC de cancelación para ND. SaleDetailModal.jsx
-- ni siquiera ofrecía el botón (su guard `esNC`/`puedeCancelar` solo contemplaba 'venta'/'nota_credito').
--
-- Mismas reglas que cancelar_nota_credito, adaptadas a ND (que aumenta la deuda del cliente con un
-- DEBE en vez de reducirla con un HABER — la reversión es la especular: un HABER que compensa el
-- DEBE original, nunca se borra el DEBE original):
--   1. Bloqueada si ya tiene CAE emitido/pendiente ante AFIP.
--   2. Bloqueada si esta ND ya fue imputada como cobro contra otra factura (mismo criterio que NC).
--   3. No hay concepto de "Devolución origen" para ND (a diferencia de NC) — no aplica ese paso.

CREATE OR REPLACE FUNCTION public.cancelar_nota_debito(
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

  IF v_comp.tipo <> 'nota_debito' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar Notas de Débito (tipo actual: %)', v_comp.tipo;
  END IF;

  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Esta Nota de Débito ya está cancelada';
  END IF;

  IF COALESCE(v_comp.cae_estado, 'no_aplica') IN ('emitido', 'pendiente', 'pendiente_caea') THEN
    RAISE EXCEPTION 'Esta Nota de Débito tiene CAE emitido (o en trámite ante AFIP) — no se puede cancelar directamente.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cuenta_corriente_imputaciones ci
    JOIN public.cuenta_corriente_movimientos cm ON cm.id = ci.cobro_movimiento_id
    WHERE cm.comprobante_id = p_comprobante_id
  ) THEN
    RAISE EXCEPTION 'Esta Nota de Débito ya fue imputada — no se puede cancelar directamente.';
  END IF;

  -- Reversar cuenta corriente (DEBE original) — HABER especular, nunca se
  -- borra el DEBE original.
  IF v_comp.cliente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos
    WHERE comprobante_id = p_comprobante_id AND tipo = 'DEBE'
  ) THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, auth.uid(), v_comp.cliente_id, p_comprobante_id, 'HABER', v_comp.total,
      'Cancelación ND ' || v_comp.numero_venta || COALESCE(' — ' || NULLIF(p_motivo, ''), ''), now()
    );
  END IF;

  UPDATE public.comprobantes SET estado_pago = 'cancelada' WHERE id = p_comprobante_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_nota_debito(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancelar_nota_debito(uuid, uuid, uuid, text) TO authenticated;

-- ROLLBACK (comentado): DROP FUNCTION IF EXISTS public.cancelar_nota_debito(uuid, uuid, uuid, text);
