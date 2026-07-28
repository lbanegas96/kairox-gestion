-- migration 259 — RPC cancelar_factura: cancelación real con reversión total
--
-- HALLAZGO (auditoría "fantasma estado", mismo patrón ya cerrado esta sesión
-- en Cotización y Entrega): SaleDetailModal.jsx permite poner
-- estado_pago='cancelada' vía un UPDATE crudo sin ningún tipo de reversión —
-- el stock no vuelve, el cobro en caja queda, la deuda en cuenta corriente
-- queda, el asiento contable queda. Es un flag que miente.
--
-- DECISIÓN DE NEGOCIO (usuario, sesión O2C Facturas): la cancelación real con
-- reversión SOLO se permite si la factura NO tiene CAE (no fue autorizada
-- ante AFIP/ARCA) — para corregir errores de carga. Si ya tiene CAE, la única
-- vía de anulación es una Nota de Crédito (crear_nota_credito, mig.140/197),
-- porque el documento ya es fiscalmente válido y no puede borrarse ni
-- "deshacerse" ante el fisco.
--
-- Patrón "documento de reversa" (estilo SAP, pedido explícito del usuario):
-- nunca se borra ni se reescribe el rastro original — se INSERTAN
-- contra-movimientos (stock, caja, cuenta corriente) y, en el frontend
-- (asientosAutoService.crearAsientoReversaVenta, commit aparte), un asiento
-- contable nuevo que reversa al original. El asiento original queda
-- 'confirmado' tal cual quedó posteado — igual que anular_entrega (mig.253)
-- nunca borra el movimiento de inventario original, solo agrega el inverso.
--
-- Guard adicional: si la factura ya tiene cobros imputados desde Cuenta
-- Corriente (cuenta_corriente_imputaciones, Open Item clearing — mig.169),
-- se bloquea la cancelación directa. Revertir un cobro que ya se aplicó
-- (posiblemente repartido en FIFO entre varias facturas) es un caso que
-- excede una simple reversión 1:1 — ahí corresponde NC.

CREATE OR REPLACE FUNCTION public.cancelar_factura(
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
  v_comp     RECORD;
  v_entrega  RECORD;
  v_item     RECORD;
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

  IF v_comp.tipo <> 'venta' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar Facturas de Venta (tipo actual: %)', v_comp.tipo;
  END IF;

  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Esta factura ya está cancelada';
  END IF;

  IF COALESCE(v_comp.cae_estado, 'no_aplica') IN ('emitido', 'pendiente', 'pendiente_caea') THEN
    RAISE EXCEPTION 'Esta factura tiene CAE emitido (o en trámite ante AFIP) — no se puede cancelar directamente. Generá una Nota de Crédito para anularla.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cuenta_corriente_imputaciones WHERE factura_comprobante_id = p_comprobante_id
  ) THEN
    RAISE EXCEPTION 'Esta factura ya tiene cobros imputados desde Cuenta Corriente — no se puede cancelar directamente. Generá una Nota de Crédito.';
  END IF;

  -- 1. Reversar stock de cualquier entrega (implícita o manual) ligada a esta
  --    factura — mismo patrón que anular_entrega (mig.253): INSERT 'entrada',
  --    nunca se borra el movimiento original de 'salida'.
  FOR v_entrega IN
    SELECT * FROM public.entregas
    WHERE comprobante_id = p_comprobante_id AND empresa_id = p_empresa_id AND estado <> 'anulado'
  LOOP
    FOR v_item IN
      SELECT * FROM public.entrega_items WHERE entrega_id = v_entrega.id
    LOOP
      UPDATE public.productos SET stock_actual = stock_actual + v_item.cantidad
      WHERE id = v_item.producto_id AND empresa_id = p_empresa_id;

      INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
      VALUES (p_empresa_id, p_empresa_id, v_item.producto_id, 'entrada', v_item.cantidad,
              'Cancelación de Factura ' || v_comp.numero_venta, now());
    END LOOP;

    -- La entrega implícita (creada por crear_venta junto con la factura) se
    -- anula. Una entrega manual pre-existente (factura sobre "lo entregado")
    -- solo se desvincula: la entrega en sí sigue siendo un documento válido.
    IF v_entrega.origen = 'implicita' THEN
      UPDATE public.entregas SET estado = 'anulado' WHERE id = v_entrega.id;
    ELSE
      UPDATE public.entregas SET comprobante_id = NULL WHERE id = v_entrega.id;
    END IF;
  END LOOP;

  -- 2. Revertir cantidad_facturada en pedido_items si esta factura vino de un pedido
  IF v_comp.pedido_id IS NOT NULL THEN
    FOR v_item IN
      SELECT ci.producto_id, ci.cantidad
      FROM public.comprobante_items ci
      WHERE ci.comprobante_id = p_comprobante_id AND ci.producto_id IS NOT NULL
    LOOP
      UPDATE public.pedido_items
      SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - v_item.cantidad)
      WHERE pedido_id = v_comp.pedido_id AND producto_id = v_item.producto_id AND empresa_id = p_empresa_id;
    END LOOP;
  END IF;

  -- 3. Reversar movimientos_caja — documento de reversa (egreso especular),
  --    nunca se borra el ingreso original. Match por comprobante_id (mig.257)
  --    con fallback por concepto para filas legacy sin ese vínculo.
  INSERT INTO public.movimientos_caja (
    empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha, comprobante_id
  )
  SELECT empresa_id, auth.uid(), caja_sesion_id, 'egreso', 'Venta',
         'Cancelación Factura ' || v_comp.numero_venta, monto, metodo_pago, true, now(), p_comprobante_id
  FROM public.movimientos_caja mc
  WHERE mc.empresa_id = p_empresa_id
    AND mc.tipo = 'ingreso'
    AND (
      mc.comprobante_id = p_comprobante_id
      OR (mc.comprobante_id IS NULL AND mc.concepto IN ('Venta #' || v_comp.numero_venta, 'Factura ' || v_comp.numero_venta))
    );

  -- 4. Reversar cuenta corriente (si la factura generó deuda) — HABER
  --    especular, nunca se borra el DEBE original.
  IF v_comp.cliente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos
    WHERE comprobante_id = p_comprobante_id AND tipo = 'DEBE'
  ) THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, auth.uid(), v_comp.cliente_id, p_comprobante_id, 'HABER', v_comp.total,
      'Cancelación Factura ' || v_comp.numero_venta || COALESCE(' — ' || NULLIF(p_motivo, ''), ''), now()
    );
  END IF;

  -- 5. Estado final
  UPDATE public.comprobantes SET estado_pago = 'cancelada' WHERE id = p_comprobante_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_factura(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancelar_factura(uuid, uuid, uuid, text) TO authenticated;

-- ROLLBACK (comentado): DROP FUNCTION IF EXISTS public.cancelar_factura(uuid, uuid, uuid, text);
