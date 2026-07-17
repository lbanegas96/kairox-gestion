-- migration 210 — Guard de idempotencia en cambiar_estado_cheque (cuenta corriente)
--
-- HALLAZGO (barrido de seguridad de Cheques + Cuenta Corriente, sesión 72): los triggers de
-- asiento contable fn_asiento_cheque_propio/fn_asiento_cheque_tercero (mig.145/166/200) SÍ
-- comparan `OLD.estado <> NEW.estado` antes de postear al libro diario (asientos_contables) —
-- son correctamente idempotentes. Pero el RPC cambiar_estado_cheque (mig.166/200), que además
-- de cambiar el estado escribe DIRECTO en cuenta_corriente_movimientos (reversión al rechazar un
-- cheque de tercero) y cuenta_corriente_proveedores (pago al entregar un cheque propio), NO tiene
-- ese mismo guard: solo valida `p_estado_nuevo`, nunca compara contra el estado ANTERIOR real.
--
-- BUG REAL: si cambiar_estado_cheque se llama 2 veces con el mismo p_estado_nuevo para un cheque
-- que YA está en ese estado (doble click en 2 pestañas/usuarios, un retry de red, o una llamada
-- repetida deliberada al RPC por un usuario autenticado con permiso 'cheques'), el SELECT ... FOR
-- UPDATE serializa las 2 transacciones pero NO evita el reproceso: la 2da vuelve a insertar el
-- movimiento financiero.
--   - Cheque de TERCERO → 'rechazado': inserta una 2da fila DEBE en cuenta_corriente_movimientos,
--     duplicando la deuda reabierta al cliente.
--   - Cheque PROPIO → 'entregado' SIN compra_id asociada: inserta una 2da fila 'pago' en
--     cuenta_corriente_proveedores, duplicando el crédito a favor del proveedor. (Si HAY
--     compra_id, el guard de sobre-imputación ya existente lo frena — por eso no se vio antes).
--
-- Resultado: el libro diario (asientos_contables) queda correcto — pero el subdiario de cuenta
-- corriente (lo que el cliente/proveedor "debe" según el sistema) puede quedar desincronizado del
-- libro diario. Fix: mismo guard `estado_anterior <> estado_nuevo` que ya usan los triggers de GL,
-- aplicado a las 2 ramas de cambiar_estado_cheque que escriben cuenta corriente directamente.

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
  -- nosotros — mismo criterio que el trigger de GL). mig.210: tampoco aplica si YA
  -- estaba 'rechazado' — evita duplicar la reversión en una 2da invocación (mismo
  -- guard que ya usa fn_asiento_cheque_tercero para el asiento contable).
  IF v_tipo = 'tercero' AND p_estado_nuevo = 'rechazado' AND v_estado_anterior <> 'endosado' AND v_estado_anterior <> 'rechazado' AND v_cliente_id IS NOT NULL THEN
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
  -- mig.210: se agrega `v_estado_anterior <> 'entregado'` — sin esto, una 2da
  -- invocación con p_estado_nuevo='entregado' sobre un cheque YA entregado (sin
  -- compra_id, que es el único caso que no tenía el guard de sobre-imputación)
  -- duplicaba el crédito 'pago' a favor del proveedor.
  IF v_tipo = 'propio' AND p_estado_nuevo = 'entregado' AND v_estado_anterior <> 'entregado' AND v_proveedor_id IS NOT NULL THEN
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

-- ROLLBACK (comentado): CREATE OR REPLACE FUNCTION cambiar_estado_cheque con el body previo a
-- esta migration (sin los 2 guards `v_estado_anterior <> ...` agregados arriba).
