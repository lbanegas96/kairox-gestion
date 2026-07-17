-- migration 211 — Hardening: validar tenant de cliente_id/proveedor_id/cuenta_bancaria_id
-- al crear un cheque
--
-- HALLAZGO (barrido de seguridad de Cheques + Cuenta Corriente, sesión 72): registrar_cobro_cliente
-- y registrar_pago_proveedor (mig.130/131) SÍ validan que el cliente/proveedor recibido pertenezca
-- a la empresa del caller:
--   IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN RAISE EXCEPTION ...
--
-- Pero crear_cheque_propio y crear_cheque_tercero (mig.028/166) NUNCA tuvieron ese mismo guard:
--   - crear_cheque_propio insertaba p_proveedor_id y p_cuenta_bancaria_id tal cual llegaban, sin
--     validar empresa_id en absoluto.
--   - crear_cheque_tercero solo validaba p_cliente_id INDIRECTAMENTE, y sólo si además se mandaba
--     p_comprobante_id (vía el JOIN empresa_id+cliente_id contra comprobantes). Si comprobante_id
--     venía NULL (cheque en cartera sin factura puntual asociada), cliente_id quedaba sin validar.
--
-- Mismo patrón de hardening que la migration 187 aplicó a centro_costo_id: nunca confiar en que un
-- UUID recibido de un RPC autenticado pertenezca al tenant del caller, aunque adivinarlo sea difícil
-- en la práctica (UUID v4). Esto es defensa en profundidad, no una vulnerabilidad explotada — no se
-- encontró evidencia de cross-tenant real en los datos existentes.

CREATE OR REPLACE FUNCTION public.crear_cheque_propio(p_empresa_id uuid, p_user_id uuid, p_numero text, p_banco text, p_monto numeric, p_fecha_emision date, p_fecha_vencimiento date, p_cuenta_bancaria_id uuid DEFAULT NULL::uuid, p_proveedor_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid, p_observaciones text DEFAULT NULL::text, p_es_electronico boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cheque_id uuid;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;
  IF p_proveedor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'El proveedor no pertenece a la empresa';
  END IF;
  IF p_cuenta_bancaria_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cuentas_bancarias WHERE id = p_cuenta_bancaria_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'La cuenta bancaria no pertenece a la empresa';
  END IF;

  INSERT INTO public.cheques (
    empresa_id, user_id, tipo, numero, banco, cuenta_bancaria_id, monto,
    fecha_emision, fecha_vencimiento, proveedor_id, compra_id, observaciones, estado, es_electronico
  ) VALUES (
    p_empresa_id, p_user_id, 'propio', p_numero, p_banco, p_cuenta_bancaria_id, p_monto,
    p_fecha_emision, p_fecha_vencimiento, p_proveedor_id, p_compra_id, p_observaciones, 'pendiente',
    COALESCE(p_es_electronico, false)
  ) RETURNING id INTO v_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (v_cheque_id, p_empresa_id, p_user_id, NULL, 'pendiente', 'Registro inicial');

  RETURN jsonb_build_object('id', v_cheque_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_cheque_tercero(p_empresa_id uuid, p_user_id uuid, p_numero text, p_banco text, p_monto numeric, p_fecha_emision date, p_fecha_vencimiento date, p_cliente_id uuid DEFAULT NULL::uuid, p_comprobante_id uuid DEFAULT NULL::uuid, p_observaciones text DEFAULT NULL::text, p_es_electronico boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cheque_id uuid;
  v_cc_id uuid;
  v_total_factura numeric;
  v_ya_imputado numeric;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('cheques') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo cheques';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto debe ser mayor a cero';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'El cliente no pertenece a la empresa';
  END IF;

  INSERT INTO public.cheques (
    empresa_id, user_id, tipo, numero, banco, monto, fecha_emision, fecha_vencimiento,
    cliente_id, comprobante_id, observaciones, estado, es_electronico
  ) VALUES (
    p_empresa_id, p_user_id, 'tercero', p_numero, p_banco, p_monto, p_fecha_emision, p_fecha_vencimiento,
    p_cliente_id, p_comprobante_id, p_observaciones, 'en_cartera', COALESCE(p_es_electronico, false)
  ) RETURNING id INTO v_cheque_id;

  INSERT INTO public.cheques_historial (cheque_id, empresa_id, user_id, estado_anterior, estado_nuevo, observacion)
  VALUES (v_cheque_id, p_empresa_id, p_user_id, NULL, 'en_cartera', 'Registro inicial');

  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos
      (empresa_id, user_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, cheque_id)
    VALUES (p_empresa_id, p_user_id, p_cliente_id, 'HABER', p_monto,
            'Cheque recibido Nº ' || p_numero || ' (' || p_banco || ')', p_fecha_emision, 'Cheque', v_cheque_id)
    RETURNING id INTO v_cc_id;

    IF p_comprobante_id IS NOT NULL THEN
      SELECT total INTO v_total_factura FROM public.comprobantes
       WHERE id = p_comprobante_id AND empresa_id = p_empresa_id AND cliente_id = p_cliente_id
       FOR UPDATE;
      IF v_total_factura IS NULL THEN
        RAISE EXCEPTION 'La factura % no existe o no pertenece a este cliente', p_comprobante_id;
      END IF;
      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
        FROM public.cuenta_corriente_imputaciones WHERE factura_comprobante_id = p_comprobante_id;
      IF p_monto > (v_total_factura - v_ya_imputado) THEN
        RAISE EXCEPTION 'El monto del cheque (%) supera el saldo pendiente de la factura (%)', p_monto, v_total_factura - v_ya_imputado;
      END IF;
      INSERT INTO public.cuenta_corriente_imputaciones (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto)
      VALUES (p_empresa_id, v_cc_id, p_comprobante_id, p_monto);
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_cheque_id);
END;
$function$;

-- ROLLBACK (comentado): CREATE OR REPLACE FUNCTION de ambas con el body previo a esta migration
-- (sin los bloques IF ... NOT EXISTS agregados arriba).
