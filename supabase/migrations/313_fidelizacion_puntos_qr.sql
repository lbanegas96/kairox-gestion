-- Fidelización por puntos — cierra el gap documentado en PLAN_FIDELIZACION_PUNTOS.md
-- (Fase 2): las ventas cobradas por QR MercadoPago no ganaban puntos, porque
-- ese circuito usa crear_venta_pendiente_qr + confirmar_pago_qr, no
-- crear_venta (donde vive la lógica de puntos desde mig.312).
--
-- Por qué en confirmar_pago_qr y no en crear_venta_pendiente_qr: el QR deja la
-- venta en 'pendiente' hasta que MP confirma el cobro. Si el QR expira o se
-- cancela (cancelar_venta_pendiente_qr, mig.306), la venta nunca pasó — no
-- corresponde sumar puntos por algo que no se cobró. Ganar recién al
-- confirmar es el mismo momento en que crear_venta gana puntos en el camino
-- síncrono (justo después de que el cobro es un hecho), sólo que acá ese
-- momento llega vía el pago confirmado, no vía la llamada RPC en sí.
--
-- CREATE OR REPLACE (no DROP+CREATE): la firma de confirmar_pago_qr no
-- cambia (sigue siendo uuid, text, text) — sólo el cuerpo. A diferencia de
-- agregar un parámetro nuevo, reemplazar el cuerpo sin tocar la firma SÍ
-- preserva el OID de la función y sus GRANT/REVOKE existentes en Postgres;
-- el patrón DROP+CREATE de otras migraciones de este proyecto es sólo
-- necesario cuando cambia la lista de parámetros.
CREATE OR REPLACE FUNCTION public.confirmar_pago_qr(
  p_empresa_id         uuid,
  p_external_reference text,
  p_payment_id         text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_qr RECORD; v_comp RECORD;
  v_cta_cobro uuid; v_cta_ventas uuid; v_cta_iva uuid;
  v_cta_costo uuid; v_cta_inventario uuid;
  v_asiento_id uuid; v_total_debe numeric; v_total_haber numeric;
  v_forma_pago_id uuid;
  -- Fidelización por puntos
  v_usa_fidelizacion boolean; v_pesos_por_punto numeric; v_saldo_puntos integer;
  v_puntos_ganados integer := 0;
BEGIN
  SELECT * INTO v_qr FROM public.qr_pagos_mp
   WHERE external_reference = p_external_reference AND empresa_id = p_empresa_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR no encontrado para external_reference: %', p_external_reference;
  END IF;

  IF v_qr.estado <> 'pendiente' THEN
    RETURN jsonb_build_object('ok', true, 'ya_procesado', true, 'estado', v_qr.estado);
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes WHERE id = v_qr.comprobante_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado para el QR %', p_external_reference;
  END IF;

  SELECT id INTO v_forma_pago_id FROM public.formas_pago
   WHERE empresa_id = p_empresa_id AND nombre = 'QR MercadoPago';

  -- 1. Reconocer el cobro en caja.
  INSERT INTO public.movimientos_caja (
    empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto,
    metodo_pago, fecha, is_automatic, forma_pago_id, comprobante_id
  ) VALUES (
    p_empresa_id, v_qr.user_id, v_qr.caja_sesion_id, 'ingreso', 'Venta',
    'Venta #' || v_comp.numero_venta, v_qr.monto, 'QR MercadoPago', now(), true,
    v_forma_pago_id, v_comp.id
  );

  -- 2. Asiento contable (SQL puro, sin auth.uid() — ver comentario de arriba).
  SELECT id INTO v_cta_cobro     FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_ventas    FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '4.1'   AND activa LIMIT 1;
  SELECT id INTO v_cta_iva       FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.3' AND activa LIMIT 1;
  IF COALESCE(v_comp.costo_mercaderia_vendida, 0) > 0 THEN
    SELECT id INTO v_cta_costo      FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.1'   AND activa LIMIT 1;
    SELECT id INTO v_cta_inventario FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.3' AND activa LIMIT 1;
  END IF;

  IF v_cta_cobro IS NOT NULL AND v_cta_ventas IS NOT NULL THEN
    v_total_debe := v_comp.total;
    v_total_haber := v_comp.total;
    IF v_cta_costo IS NOT NULL AND v_cta_inventario IS NOT NULL THEN
      v_total_debe := v_total_debe + v_comp.costo_mercaderia_vendida;
      v_total_haber := v_total_haber + v_comp.costo_mercaderia_vendida;
    END IF;

    INSERT INTO public.asientos_contables
      (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
    VALUES (
      p_empresa_id, v_qr.user_id, next_numero_asiento(p_empresa_id), CURRENT_DATE,
      'Venta ' || v_comp.numero_venta || ' (QR MercadoPago)', 'confirmado', v_total_debe, v_total_haber,
      'venta', v_comp.id
    ) RETURNING id INTO v_asiento_id;

    IF v_cta_iva IS NOT NULL AND COALESCE(v_comp.neto_gravado, 0) + COALESCE(v_comp.iva_discriminado, 0) > 0 THEN
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, p_empresa_id, v_cta_cobro,  'Cobro por venta (QR MercadoPago)', v_comp.total, 0),
        (v_asiento_id, p_empresa_id, v_cta_ventas, 'Ingreso por venta (neto)', 0, v_comp.neto_gravado),
        (v_asiento_id, p_empresa_id, v_cta_iva,    'IVA Débito Fiscal', 0, v_comp.iva_discriminado);
    ELSE
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, p_empresa_id, v_cta_cobro,  'Cobro por venta (QR MercadoPago)', v_comp.total, 0),
        (v_asiento_id, p_empresa_id, v_cta_ventas, 'Ingreso por venta', 0, v_comp.total);
    END IF;

    IF v_cta_costo IS NOT NULL AND v_cta_inventario IS NOT NULL THEN
      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, p_empresa_id, v_cta_costo,      'Costo de mercadería vendida', v_comp.costo_mercaderia_vendida, 0),
        (v_asiento_id, p_empresa_id, v_cta_inventario, 'Salida de mercadería por venta', 0, v_comp.costo_mercaderia_vendida);
    END IF;

    UPDATE public.comprobantes SET asiento_id = v_asiento_id WHERE id = v_comp.id;
  END IF;

  UPDATE public.comprobantes SET estado_pago = 'pagada' WHERE id = v_comp.id;
  UPDATE public.qr_pagos_mp SET estado = 'pagado', payment_id = p_payment_id, updated_at = now()
   WHERE id = v_qr.id;

  -- 3. Fidelización por puntos — mismo criterio que crear_venta (mig.312):
  -- sólo si hay cliente asociado y la empresa tiene la fidelización activa.
  -- El canje de puntos NO existe en el circuito QR (no es parte de este
  -- fix) — el QR cubre el 100% de la venta, no admite descuentos manuales
  -- en el checkout (ver PanelCarrito.jsx, esCobroQR bloquea pago mixto).
  IF v_comp.cliente_id IS NOT NULL THEN
    SELECT usa_fidelizacion, puntos_pesos_por_punto
      INTO v_usa_fidelizacion, v_pesos_por_punto
    FROM public.empresas WHERE id = p_empresa_id;

    IF COALESCE(v_usa_fidelizacion, false) AND COALESCE(v_pesos_por_punto, 0) > 0 THEN
      v_puntos_ganados := FLOOR(v_comp.total / v_pesos_por_punto)::integer;
      IF v_puntos_ganados > 0 THEN
        UPDATE public.clientes SET saldo_puntos = saldo_puntos + v_puntos_ganados
        WHERE id = v_comp.cliente_id AND empresa_id = p_empresa_id
        RETURNING saldo_puntos INTO v_saldo_puntos;
        -- user_id: v_qr.user_id (el cajero que generó el QR), no auth.uid()
        -- — esta función corre sin sesión de usuario (comentario de arriba),
        -- mismo criterio que ya usa el INSERT de movimientos_caja más arriba.
        INSERT INTO public.movimientos_puntos (empresa_id, cliente_id, comprobante_id, tipo, puntos, saldo_posterior, user_id)
        VALUES (p_empresa_id, v_comp.cliente_id, v_comp.id, 'ganado', v_puntos_ganados, v_saldo_puntos, v_qr.user_id);
      END IF;
    END IF;
  END IF;

  -- 4. Encolar AFIP recién ahora — reusa el trigger fn_queue_factura_arca ya
  --    existente (dispara con UPDATE OF cae_estado a 'pendiente'). Sólo si
  --    crear_venta_pendiente_qr guardó una letra (empresa con factura
  --    electrónica activa y PdV que envía a ARCA — decidido en el momento de
  --    generar el QR, mismo criterio que useConfirmarVenta.js hoy).
  IF v_comp.tipo_comprobante_afip IS NOT NULL THEN
    UPDATE public.comprobantes SET cae_estado = 'pendiente' WHERE id = v_comp.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'comprobante_id', v_comp.id, 'numero_venta', v_comp.numero_venta,
    'puntos_ganados', v_puntos_ganados
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.confirmar_pago_qr(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.confirmar_pago_qr(uuid, text, text) TO service_role;
