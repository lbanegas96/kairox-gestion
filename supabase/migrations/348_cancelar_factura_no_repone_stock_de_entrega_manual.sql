-- migration 348 — cancelar_factura (mig.259): no repone stock de una
-- Entrega manual que sigue vigente
--
-- HALLAZGO (Luciano, 23/08, caso real FAC-20260823-001 / ENT-2026-0149): la
-- función reponía stock para CUALQUIER entrega ligada al comprobante, sin
-- importar su origen. Eso es correcto para una entrega 'implicita' (nace
-- junto con la factura en el mismo crear_venta — cancelar la factura
-- legítimamente deshace también esa entrega), pero es un bug real para una
-- entrega 'manual' preexistente (Pedido → Generar Entrega → Facturar
-- Entrega): esa entrega la descontó ella misma, sigue en pantalla como
-- 'entregado' (nunca se anula — ver el propio IF de abajo), y sin embargo el
-- stock volvía a subir igual. Resultado: `productos.stock_actual` mentía —
-- la mercadería sigue físicamente afuera (la entrega dice "entregado") pero
-- el sistema la contaba como si hubiera vuelto. Viola Regla 8 del
-- sap-reference (el stock se mueve UNA sola vez, en el evento físico): acá
-- se estaba moviendo una segunda vez sin que hubiera un segundo evento.
--
-- Fix: el bloque de reversión de stock (UPDATE productos + INSERT
-- movimientos_inventario 'entrada') pasa a ejecutarse SOLO para entregas
-- 'implicita' — el único caso donde cancelar la factura implica también
-- deshacer la entrega. Para 'manual', el comportamiento ya era el correcto
-- (desvincular con comprobante_id = NULL, dejando la entrega disponible para
-- "Facturar Entrega" de nuevo — Nadia ya lo tiene resuelto del lado de
-- EntregasSection/ModalDetalleEntrega, `puedeFacturar` solo exige
-- `!comprobante_id`) — lo único que estaba de más era tocar el stock.
--
-- No se toca nada del rastro documental: la factura cancelada sigue
-- existiendo (`estado_pago='cancelada'`, nunca se borra), el asiento
-- original queda posteado tal cual, y Mapa de Relaciones/DocumentFlow siguen
-- mostrando el comprobante cancelado como parte de la cadena — no hacía
-- falta ningún cambio ahí, ya no se borra ni se oculta nada.

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

-- ROLLBACK (comentado): CREATE OR REPLACE la definición de migration 259.
