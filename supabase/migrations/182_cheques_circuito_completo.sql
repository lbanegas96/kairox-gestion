-- Circuito completo de Cheques (a pedido explícito del usuario, alcance A+B+C):
--
-- Cheques ya generaba asientos contables (mig.145/166) para recibido/endosado/cobrado/
-- rechazado, usando 1.1.6 "Cheques de Terceros en Cartera" como cuenta puente — pero
-- NUNCA tocaba `cuenta_corriente_movimientos`/`cuenta_corriente_proveedores` (la
-- subcuenta por cliente/proveedor que usan las pantallas de Cuenta Corriente), ni
-- `movimientos_bancarios` (por eso nunca aparecía en Bancos/conciliación).
--
-- (A) Recibir un cheque de un cliente cancela la factura puntual en Cuenta Corriente
--     (mismo patrón de imputación de la Fase 5: fila HABER + cuenta_corriente_imputaciones
--     si viene con comprobante_id).
-- (B) Si lo rechazan, se reabre: fila DEBE de reversión (queda en el historial para
--     siempre) + se borra el vínculo puntual en cuenta_corriente_imputaciones (esa
--     tabla exige monto > 0, no admite una fila negativa de reversión — lo que se
--     borra es solo el "a qué factura se aplicó", no el movimiento financiero).
--     Simétrico para cheques propios: 'entregado' cancela la compra puntual del
--     proveedor (tipo='pago'), 'rechazado' la reabre (tipo='nota_debito').
-- (C) Cobrar/debitar un cheque genera el movimiento en Bancos, linkeado al MISMO
--     asiento que ya crea el trigger de GL (para no duplicar el asiento) — por eso
--     esta parte vive en los triggers fn_asiento_cheque_tercero/propio (tienen
--     v_asiento_id en scope en el momento exacto), mientras que A/B viven en las RPCs
--     (crear_cheque_tercero/cambiar_estado_cheque), igual que el resto de CxC/CxP.
--
-- Fuera de alcance (documentado, no pedido): 'endosado' no cancela la compra del
-- proveedor endosado (requeriría capturar qué compra específica se paga en el
-- momento del endoso, que hoy la UI no pide) — 'descontado' tampoco tiene modelo
-- contable propio (no lo tenía antes de esta migración).

-- 1) Columnas de trazabilidad — link cheque -> movimiento de cta cte (para reversión)
ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS cheque_id uuid REFERENCES public.cheques(id);
ALTER TABLE public.cuenta_corriente_proveedores
  ADD COLUMN IF NOT EXISTS cheque_id uuid REFERENCES public.cheques(id);

-- 2) movimientos_bancarios: permitir origen='cheque'
ALTER TABLE public.movimientos_bancarios DROP CONSTRAINT movimientos_bancarios_origen_check;
ALTER TABLE public.movimientos_bancarios
  ADD CONSTRAINT movimientos_bancarios_origen_check
  CHECK (origen = ANY (ARRAY['manual','csv','email','webhook','mercadopago','uala','caja','cheque']));

-- 3) crear_cheque_tercero: además de crear el cheque, cancela la factura puntual
-- del cliente en Cuenta Corriente (si viene con cliente_id / comprobante_id).
CREATE OR REPLACE FUNCTION public.crear_cheque_tercero(
  p_empresa_id uuid, p_user_id uuid, p_numero text, p_banco text, p_monto numeric,
  p_fecha_emision date, p_fecha_vencimiento date, p_cliente_id uuid DEFAULT NULL::uuid,
  p_comprobante_id uuid DEFAULT NULL::uuid, p_observaciones text DEFAULT NULL::text,
  p_es_electronico boolean DEFAULT false
)
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

-- 4) cambiar_estado_cheque: agrega p_cuenta_bancaria_id (para elegir a qué cuenta se
-- deposita un cheque de tercero al cobrarlo) + reversión de Cuenta Corriente en rechazo
-- + cancelación/reversión de Cuenta Corriente Proveedores para cheques propios.
DROP FUNCTION IF EXISTS public.cambiar_estado_cheque(uuid, uuid, text, text, uuid);

CREATE FUNCTION public.cambiar_estado_cheque(
  p_cheque_id uuid, p_user_id uuid, p_estado_nuevo text, p_observacion text DEFAULT NULL::text,
  p_proveedor_endoso_id uuid DEFAULT NULL::uuid, p_cuenta_bancaria_id uuid DEFAULT NULL::uuid
)
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
      DELETE FROM public.cuenta_corriente_imputaciones WHERE cobro_movimiento_id = v_cc_original_id;
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
    END IF;

  ELSIF v_tipo = 'propio' AND p_estado_nuevo = 'rechazado' AND v_estado_anterior = 'entregado' AND v_proveedor_id IS NOT NULL THEN
    SELECT id INTO v_ccp_original_id FROM public.cuenta_corriente_proveedores
     WHERE cheque_id = p_cheque_id AND tipo = 'pago' ORDER BY created_at ASC LIMIT 1;

    INSERT INTO public.cuenta_corriente_proveedores
      (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha, cheque_id)
    VALUES (v_empresa_id, v_proveedor_id, 'nota_debito', v_monto,
            'Cheque propio rechazado Nº ' || v_numero || ' (' || v_banco || ') — reversión', p_user_id, now(), p_cheque_id);

    IF v_ccp_original_id IS NOT NULL THEN
      DELETE FROM public.cuenta_corriente_proveedores_imputaciones WHERE pago_movimiento_id = v_ccp_original_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'estado_anterior', v_estado_anterior, 'estado_nuevo', p_estado_nuevo);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.cambiar_estado_cheque(uuid, uuid, text, text, uuid, uuid) TO authenticated;

-- 5) fn_asiento_cheque_tercero: (C) al cobrar, además del asiento de GL ya
-- existente, generar el movimiento en Bancos linkeado al MISMO asiento (evita
-- duplicar). Requiere que cuenta_bancaria_id esté seteada (cambiar_estado_cheque
-- ahora la setea cuando se pasa p_cuenta_bancaria_id).
CREATE OR REPLACE FUNCTION public.fn_asiento_cheque_tercero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cta_cartera   uuid;
  v_cta_contra    uuid;
  v_cta_rechazado uuid;
  v_asiento_id    uuid;
  v_fecha         date;
  v_cerrado       boolean;
  v_desc          text;
BEGIN
  IF NEW.tipo <> 'tercero' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_cta_cartera FROM public.plan_cuentas
    WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.6' AND activa LIMIT 1;
    IF v_cta_cartera IS NULL THEN RETURN NEW; END IF;

    IF TG_OP = 'INSERT' THEN
      v_fecha := COALESCE(NEW.fecha_emision, CURRENT_DATE);
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.cliente_id IS NOT NULL THEN
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
      ELSE
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '4.3' AND activa LIMIT 1;
      END IF;
      IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

      v_desc := 'Cheque de tercero recibido — ' || NEW.numero || ' (' || NEW.banco || ')';
      INSERT INTO public.asientos_contables
        (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
      VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
              'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
      RETURNING id INTO v_asiento_id;

      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
        (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, NEW.monto, 0),
        (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, 0, NEW.monto);

    ELSIF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
      v_fecha := CURRENT_DATE;
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.estado = 'endosado' AND OLD.estado <> 'endosado' THEN
        IF NEW.proveedor_id IS NULL THEN RETURN NEW; END IF;
        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque de tercero endosado a proveedor — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, 0, NEW.monto);

      ELSIF NEW.estado = 'cobrado' AND OLD.estado <> 'cobrado' THEN
        IF OLD.estado = 'endosado' THEN RETURN NEW; END IF;

        SELECT id INTO v_cta_contra FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
        IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque de tercero cobrado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_contra,  v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cartera, v_desc, 0, NEW.monto);

        -- (C) Bancos: mismo asiento, no uno nuevo.
        IF NEW.cuenta_bancaria_id IS NOT NULL THEN
          INSERT INTO public.movimientos_bancarios
            (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
          VALUES (NEW.empresa_id, NEW.cuenta_bancaria_id, v_fecha, v_desc, NEW.monto, 'ingreso', 'cheque', false, v_asiento_id, NEW.user_id);
        END IF;

      ELSIF NEW.estado = 'rechazado' AND OLD.estado <> 'rechazado' THEN
        SELECT id INTO v_cta_rechazado FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.7' AND activa LIMIT 1;
        IF v_cta_rechazado IS NULL THEN RETURN NEW; END IF;

        IF OLD.estado = 'endosado' THEN
          SELECT id INTO v_cta_contra FROM public.plan_cuentas
          WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
          IF v_cta_contra IS NULL THEN RETURN NEW; END IF;

          v_desc := 'Cheque de tercero rechazado (endosado a proveedor) — ' || NEW.numero || ' (' || NEW.banco || ')';
          INSERT INTO public.asientos_contables
            (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
          VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                  'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
          RETURNING id INTO v_asiento_id;

          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, NEW.empresa_id, v_cta_rechazado, v_desc, NEW.monto, 0),
            (v_asiento_id, NEW.empresa_id, v_cta_contra,    v_desc, 0, NEW.monto);
        ELSE
          v_desc := 'Cheque de tercero rechazado — ' || NEW.numero || ' (' || NEW.banco || ')';
          INSERT INTO public.asientos_contables
            (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
          VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                  'confirmado', NEW.monto, NEW.monto, 'cheque_tercero', NEW.id)
          RETURNING id INTO v_asiento_id;

          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, NEW.empresa_id, v_cta_rechazado, v_desc, NEW.monto, 0),
            (v_asiento_id, NEW.empresa_id, v_cta_cartera,   v_desc, 0, NEW.monto);
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$function$;

-- 6) fn_asiento_cheque_propio: (C) al cobrar/debitar, movimiento egreso en Bancos
-- linkeado al mismo asiento.
CREATE OR REPLACE FUNCTION public.fn_asiento_cheque_propio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cta_documentos uuid;
  v_cta_cxp        uuid;
  v_cta_caja       uuid;
  v_asiento_id     uuid;
  v_fecha          date;
  v_cerrado        boolean;
  v_desc           text;
BEGIN
  IF NEW.tipo <> 'propio' THEN
    RETURN NEW;
  END IF;

  BEGIN
    SELECT id INTO v_cta_documentos FROM public.plan_cuentas
    WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.6' AND activa LIMIT 1;
    IF v_cta_documentos IS NULL THEN RETURN NEW; END IF;

    IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
      v_fecha := CURRENT_DATE;
      SELECT fecha_en_periodo_cerrado(NEW.empresa_id, v_fecha) INTO v_cerrado;
      IF COALESCE(v_cerrado, false) THEN RETURN NEW; END IF;

      IF NEW.estado = 'entregado' AND OLD.estado <> 'entregado' THEN
        IF NEW.proveedor_id IS NULL THEN RETURN NEW; END IF;
        SELECT id INTO v_cta_cxp FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_cxp IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio entregado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_cxp,        v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, 0, NEW.monto);

      ELSIF NEW.estado = 'cobrado' AND OLD.estado <> 'cobrado' THEN
        SELECT id INTO v_cta_caja FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
        IF v_cta_caja IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio cobrado/debitado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_caja,       v_desc, 0, NEW.monto);

        -- (C) Bancos: mismo asiento, no uno nuevo.
        IF NEW.cuenta_bancaria_id IS NOT NULL THEN
          INSERT INTO public.movimientos_bancarios
            (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id, created_by)
          VALUES (NEW.empresa_id, NEW.cuenta_bancaria_id, v_fecha, v_desc, NEW.monto, 'egreso', 'cheque', false, v_asiento_id, NEW.user_id);
        END IF;

      ELSIF NEW.estado = 'rechazado' AND OLD.estado = 'entregado' THEN
        SELECT id INTO v_cta_cxp FROM public.plan_cuentas
        WHERE empresa_id = NEW.empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;
        IF v_cta_cxp IS NULL THEN RETURN NEW; END IF;

        v_desc := 'Cheque propio rechazado — ' || NEW.numero || ' (' || NEW.banco || ')';
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (NEW.empresa_id, NEW.user_id, next_numero_asiento(NEW.empresa_id), v_fecha, v_desc,
                'confirmado', NEW.monto, NEW.monto, 'cheque_propio', NEW.id)
        RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, NEW.empresa_id, v_cta_documentos, v_desc, NEW.monto, 0),
          (v_asiento_id, NEW.empresa_id, v_cta_cxp,        v_desc, 0, NEW.monto);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$function$;
