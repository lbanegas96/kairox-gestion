-- Migration 200 — cambiar_estado_cheque debe resincronizar estado_pago al
-- rechazar un cheque (hallazgo sesión 60 cont. 3, revisión de Cheques a
-- pedido del usuario, 2026-07-11).
--
-- El bug: cuando se rechaza un cheque (de tercero o propio), la función
-- correctamente reabre la deuda (INSERT del movimiento de reversión DEBE/
-- nota_debito) y borra la imputación puntual contra la factura/compra de
-- origen (`DELETE FROM cuenta_corriente_imputaciones` /
-- `cuenta_corriente_proveedores_imputaciones`) — pero NUNCA vuelve a calcular
-- `comprobantes.estado_pago` / `compras.estado_pago` después de borrar esa
-- imputación. Mismo patrón exacto de gap que mig.196-199 (esta sesión), en un
-- código que no pasó por ese fix porque vive en una función distinta
-- (`cambiar_estado_cheque`, no `registrar_cobro_cliente`/`registrar_pago_proveedor`).
--
-- Impacto: una factura/compra que había quedado 'pagada' porque un cheque la
-- canceló, si ese cheque después rebota, se reabre correctamente en el saldo
-- real (la vista `facturas_saldo_pendiente` ya lo hace bien porque calcula
-- total - imputado en vivo) pero el campo denormalizado `estado_pago` queda
-- pegado en 'pagada' para siempre — el mismo síntoma que mig.196 corrigió
-- para el cobro/pago normal (badge "Vencido" nunca se dispara, reportes que
-- filtran por estado_pago la siguen contando como cobrada).
--
-- Verificado con datos reales de Nalux: CERO casos ya corrompidos ahora mismo
-- (0 facturas 'pagada' con forma_pago='Cuenta Corriente' y saldo_pendiente >
-- 0) — de los 3 cheques de tercero rechazados existentes, ninguno tenía en
-- realidad una imputación puntual contra una factura (fueron cobros sin
-- imputar, o la factura de origen no aplicaba). El fix es puramente
-- preventivo/hacia adelante: el próximo cheque que rebote con una imputación
-- real detrás sí hubiera dejado la factura mal.
--
-- Fix: antes de borrar cada imputación, se recorre cada factura/compra
-- afectada y se recalcula estado_pago con el mismo patrón de mig.196-199
-- (`pagada` si ya_imputado >= total, `parcial` si > 0, `pendiente` si no).
--
-- Copia fiel del resto de la función (pg_get_functiondef).

CREATE OR REPLACE FUNCTION public.cambiar_estado_cheque(p_cheque_id uuid, p_user_id uuid, p_estado_nuevo text, p_observacion text DEFAULT NULL::text, p_proveedor_endoso_id uuid DEFAULT NULL::uuid, p_cuenta_bancaria_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_estado_anterior text;
  v_tipo text;
  v_cliente_id uuid;
  v_proveedor_id uuid;
  v_compra_id uuid;
  v_monto numeric;
  v_numero text;
  v_banco text;
  v_cc_original_id uuid;
  v_ccp_original_id uuid;
  v_ccp_id uuid;
  v_total_factura numeric;
  v_ya_imputado numeric;
  v_factura_afectada RECORD;
BEGIN
  SELECT empresa_id, estado, tipo, cliente_id, proveedor_id, compra_id, monto, numero, banco
    INTO v_empresa_id, v_estado_anterior, v_tipo, v_cliente_id, v_proveedor_id, v_compra_id, v_monto, v_numero, v_banco
  FROM public.cheques WHERE id = p_cheque_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Cheque no encontrado';
  END IF;
  IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: el cheque no pertenece a tu empresa';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;

  UPDATE public.cheques
  SET estado = p_estado_nuevo,
      proveedor_id = COALESCE(p_proveedor_endoso_id, proveedor_id),
      cuenta_bancaria_id = COALESCE(p_cuenta_bancaria_id, cuenta_bancaria_id),
      updated_at = now()
  WHERE id = p_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (p_cheque_id, v_empresa_id, p_user_id, v_estado_anterior, p_estado_nuevo, p_observacion);

  -- (B) Cheque de tercero rechazado: reabre la deuda del cliente y, si estaba
  -- imputado a una factura puntual, la reabre también. cuenta_corriente_imputaciones
  -- exige monto > 0 (no admite fila negativa de reversión) — se borra el vínculo
  -- puntual con la factura; el movimiento financiero en sí (HABER original + DEBE
  -- de reversión) queda íntegro en cuenta_corriente_movimientos para siempre. No
  -- aplica si venía de 'endosado' (ya no es responsabilidad de este cliente ante
  -- nosotros — mismo criterio que el trigger de GL).
  IF v_tipo = 'tercero' AND p_estado_nuevo = 'rechazado' AND v_estado_anterior <> 'endosado' AND v_cliente_id IS NOT NULL THEN
    SELECT id INTO v_cc_original_id FROM public.cuenta_corriente_movimientos
     WHERE cheque_id = p_cheque_id AND tipo = 'HABER' ORDER BY created_at ASC LIMIT 1;

    INSERT INTO public.cuenta_corriente_movimientos
      (empresa_id, user_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, cheque_id)
    VALUES (v_empresa_id, p_user_id, v_cliente_id, 'DEBE', v_monto,
            'Cheque rechazado Nº ' || v_numero || ' (' || v_banco || ') — reversión', CURRENT_DATE, 'Cheque', p_cheque_id);

    IF v_cc_original_id IS NOT NULL THEN
      -- Antes de borrar cada imputación puntual, resincronizar estado_pago de
      -- la factura afectada (mismo patrón mig.196-199) — sin esto la factura
      -- queda 'pagada' para siempre aunque la deuda ya se reabrió.
      FOR v_factura_afectada IN
        SELECT DISTINCT factura_comprobante_id
          FROM public.cuenta_corriente_imputaciones
         WHERE cobro_movimiento_id = v_cc_original_id
      LOOP
        DELETE FROM public.cuenta_corriente_imputaciones
         WHERE cobro_movimiento_id = v_cc_original_id
           AND factura_comprobante_id = v_factura_afectada.factura_comprobante_id;

        SELECT total INTO v_total_factura
          FROM public.comprobantes
         WHERE id = v_factura_afectada.factura_comprobante_id
         FOR UPDATE;

        IF v_total_factura IS NOT NULL THEN
          SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
            FROM public.cuenta_corriente_imputaciones
           WHERE factura_comprobante_id = v_factura_afectada.factura_comprobante_id;

          UPDATE public.comprobantes
             SET estado_pago = CASE
                                  WHEN v_ya_imputado >= v_total_factura THEN 'pagada'
                                  WHEN v_ya_imputado > 0 THEN 'parcial'
                                  ELSE 'pendiente'
                                END
           WHERE id = v_factura_afectada.factura_comprobante_id;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- (A) Cheque propio entregado: cancela la deuda puntual del proveedor (mismo peso
  -- que un pago), imputando contra compra_id si vino con una (misma validación de
  -- sobre-imputación que el lado cliente). (B) Si luego lo rechazan, se reabre.
  IF v_tipo = 'propio' AND p_estado_nuevo = 'entregado' AND v_proveedor_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_proveedores
      (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha, cheque_id)
    VALUES (v_empresa_id, v_proveedor_id, 'pago', v_monto,
            'Cheque propio entregado Nº ' || v_numero || ' (' || v_banco || ')', p_user_id, now(), p_cheque_id)
    RETURNING id INTO v_ccp_id;

    IF v_compra_id IS NOT NULL THEN
      SELECT total INTO v_total_factura FROM public.compras
       WHERE id = v_compra_id AND empresa_id = v_empresa_id AND proveedor_id = v_proveedor_id
       FOR UPDATE;
      IF v_total_factura IS NULL THEN
        RAISE EXCEPTION 'La compra % no existe o no pertenece a este proveedor', v_compra_id;
      END IF;
      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
        FROM public.cuenta_corriente_proveedores_imputaciones WHERE factura_compra_id = v_compra_id;
      IF v_monto > (v_total_factura - v_ya_imputado) THEN
        RAISE EXCEPTION 'El monto del cheque (%) supera el saldo pendiente de la compra (%)', v_monto, v_total_factura - v_ya_imputado;
      END IF;
      INSERT INTO public.cuenta_corriente_proveedores_imputaciones (empresa_id, pago_movimiento_id, factura_compra_id, monto)
      VALUES (v_empresa_id, v_ccp_id, v_compra_id, v_monto);

      UPDATE public.compras
         SET estado_pago = CASE
                              WHEN (v_ya_imputado + v_monto) >= v_total_factura THEN 'pagada'
                              WHEN (v_ya_imputado + v_monto) > 0 THEN 'parcial'
                              ELSE 'pendiente'
                            END
       WHERE id = v_compra_id;
    END IF;

  ELSIF v_tipo = 'propio' AND p_estado_nuevo = 'rechazado' AND v_estado_anterior = 'entregado' AND v_proveedor_id IS NOT NULL THEN
    SELECT id INTO v_ccp_original_id FROM public.cuenta_corriente_proveedores
     WHERE cheque_id = p_cheque_id AND tipo = 'pago' ORDER BY created_at ASC LIMIT 1;

    INSERT INTO public.cuenta_corriente_proveedores
      (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha, cheque_id)
    VALUES (v_empresa_id, v_proveedor_id, 'nota_debito', v_monto,
            'Cheque propio rechazado Nº ' || v_numero || ' (' || v_banco || ') — reversión', p_user_id, now(), p_cheque_id);

    IF v_ccp_original_id IS NOT NULL THEN
      FOR v_factura_afectada IN
        SELECT DISTINCT factura_compra_id
          FROM public.cuenta_corriente_proveedores_imputaciones
         WHERE pago_movimiento_id = v_ccp_original_id
      LOOP
        DELETE FROM public.cuenta_corriente_proveedores_imputaciones
         WHERE pago_movimiento_id = v_ccp_original_id
           AND factura_compra_id = v_factura_afectada.factura_compra_id;

        SELECT total INTO v_total_factura
          FROM public.compras
         WHERE id = v_factura_afectada.factura_compra_id
         FOR UPDATE;

        IF v_total_factura IS NOT NULL THEN
          SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
            FROM public.cuenta_corriente_proveedores_imputaciones
           WHERE factura_compra_id = v_factura_afectada.factura_compra_id;

          UPDATE public.compras
             SET estado_pago = CASE
                                  WHEN v_ya_imputado >= v_total_factura THEN 'pagada'
                                  WHEN v_ya_imputado > 0 THEN 'parcial'
                                  ELSE 'pendiente'
                                END
           WHERE id = v_factura_afectada.factura_compra_id;
        END IF;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado_anterior', v_estado_anterior, 'estado_nuevo', p_estado_nuevo);
END;
$function$;
