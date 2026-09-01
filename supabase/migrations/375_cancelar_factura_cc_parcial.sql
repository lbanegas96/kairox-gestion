-- migration 375 — cancelar_factura reversaba el monto TOTAL del comprobante a
-- Cuenta Corriente, no la porción real que había sido cargada a CC.
--
-- HALLAZGO real (31/08, repaso completo del plan de Ferretería NADIA): se
-- probó en vivo el ciclo completo de una venta mixta Efectivo + Cuenta
-- Corriente (mig.369-372, "CC combinable") — venta $2.500 (Efectivo $1.500 +
-- CC $1.000) y su cancelación. El DEBE real registrado en
-- cuenta_corriente_movimientos fue $1.000 (correcto). Pero la reversa HABER
-- que generó cancelar_factura fue de $2.500 (el total del comprobante, NO
-- los $1.000 que realmente estaban en CC) — un crédito de $1.500 de más
-- para el cliente, sin respaldo real.
--
-- Causa raíz: exactamente la misma clase de bug que mig.374 ya había
-- corregido en otros 3 lugares (facturas_saldo_pendiente,
-- registrar_cobro_cliente, crear_nota_credito) — usar comprobantes.total
-- como "lo que se cargó a CC" dejó de ser válido desde que mig.372 permite
-- que el DEBE de CC sea PARCIAL (venta con CC combinable con otros medios de
-- pago). cancelar_factura (mig.351, anterior a 372/374) quedó afuera de esa
-- corrección porque el bug de "Open Item con CC parcial" recién se detectó
-- después.
--
-- Fix: usar public.monto_cc_original_comprobante(p_comprobante_id) (mig.374)
-- en vez de v_comp.total para el monto de la reversa HABER. Para ventas
-- 100% Efectivo/Transferencia/Tarjeta con un poco de CC "todo o nada" (el
-- caso de siempre, antes de mig.372) esto no cambia nada — DEBE ya era
-- exactamente comprobantes.total, cero regresión. Solo corrige el caso
-- nuevo de venta con CC parcial.
--
-- No hace falta tocar cancelar_nota_credito ni cancelar_nota_debito: el
-- HABER de una NC (crear_nota_credito) y el DEBE de una ND siempre son el
-- 100% de su propio total — no existe concepto de "parcial" para esos dos
-- tipos (ya documentado así en el comentario de mig.374).
--
-- Corrección puntual de datos: la venta de prueba usada para verificar esto
-- en vivo (Ferretería NADIA, comprobante d8a944ae-71a8-4858-a480-bfeda8fb0a70,
-- 20260831-001, Marcos Herrera) ya fue cancelada con el bug activo y dejó una
-- fila HABER de $2.500 en vez de $1.000 — se corrige puntualmente esa fila al
-- final para no dejar a Marcos Herrera con un saldo a favor incorrecto.

CREATE OR REPLACE FUNCTION public.cancelar_factura(p_empresa_id uuid, p_user_id uuid, p_comprobante_id uuid, p_motivo text DEFAULT NULL::text)
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

  -- 1. Reversar stock SOLO de la entrega 'implicita' ligada a esta factura
  --    (nace junto con crear_venta en el mismo paso — cancelar la factura
  --    deshace también esa entrega). Una entrega 'manual' preexistente NO
  --    se toca: la mercadería salió en ESE evento, sigue afuera, y la
  --    entrega sigue siendo un documento válido — solo se desvincula para
  --    poder refacturarla.
  FOR v_entrega IN
    SELECT * FROM public.entregas
    WHERE comprobante_id = p_comprobante_id AND empresa_id = p_empresa_id AND estado <> 'anulado'
  LOOP
    IF v_entrega.origen = 'implicita' THEN
      FOR v_item IN
        SELECT * FROM public.entrega_items WHERE entrega_id = v_entrega.id
      LOOP
        UPDATE public.productos SET stock_actual = stock_actual + v_item.cantidad
        WHERE id = v_item.producto_id AND empresa_id = p_empresa_id;

        INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
        VALUES (p_empresa_id, p_empresa_id, v_item.producto_id, 'entrada', v_item.cantidad,
                'Cancelación de Factura ' || v_comp.numero_venta, now());
      END LOOP;

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
  --    especular, nunca se borra el DEBE original. mig.375: el monto de la
  --    reversa es lo que REALMENTE se cargó a CC (monto_cc_original_comprobante,
  --    mig.374), no comprobantes.total — una venta con CC combinable (mig.372)
  --    puede tener CC parcial.
  IF v_comp.cliente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos
    WHERE comprobante_id = p_comprobante_id AND tipo = 'DEBE'
  ) THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, auth.uid(), v_comp.cliente_id, p_comprobante_id, 'HABER',
      public.monto_cc_original_comprobante(p_comprobante_id),
      'Cancelación Factura ' || v_comp.numero_venta || COALESCE(' — ' || NULLIF(p_motivo, ''), ''), now()
    );
  END IF;

  -- 5. Estado final — mig.351: cae_estado también pasa a 'no_aplica', no sólo
  --    estado_pago='cancelada' (antes quedaba huérfana en el Monitor AFIP para siempre).
  UPDATE public.comprobantes SET estado_pago = 'cancelada', cae_estado = 'no_aplica' WHERE id = p_comprobante_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;

-- Corrección puntual del único caso ya afectado (la venta de prueba de esta
-- misma verificación, ver comentario arriba): la fila HABER de reversa queda
-- en $1.000 (monto real que estaba en CC) en vez de $2.500.
UPDATE public.cuenta_corriente_movimientos
   SET monto = 1000.00
 WHERE id = '3e54e7bf-d875-4970-a3f8-6d3e5b94a8b2'
   AND comprobante_id = 'd8a944ae-71a8-4858-a480-bfeda8fb0a70'
   AND tipo = 'HABER'
   AND monto = 2500.00;
