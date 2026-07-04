-- ════════════════════════════════════════════════════════════════════════════
-- migration 144 — Cierre de gap sistémico: Cobro CxC y Pago CxP generan asiento
-- ════════════════════════════════════════════════════════════════════════════
--
-- Gap documentado en PLAN_AUDITORIA.md: registrar_cobro_cliente y
-- registrar_pago_proveedor mueven Caja/CC pero nunca generan asiento contable
-- — el mayor puede divergir de los sub-libros. Se cierra reusando el MISMO
-- patrón ya validado para Ventas/Compras/Caja (asientosAutoService.ts):
-- mismos códigos de cuenta (1.1.1 Caja y Bancos, 1.1.2 Cuentas a Cobrar,
-- 2.1.1 Cuentas a Pagar), mismo comportamiento "no bloqueante" ante período
-- cerrado o plan de cuentas sin seedear (la operación de plata se completa
-- igual; el asiento se omite si no puede generarse, sin abortar la
-- transacción).
--
-- ESQUEMA PROPUESTO (a validar por el contador — documentado en
-- PLAN_AUDITORIA.md):
--   Cobro a cliente:    DEBE 1.1.1 Caja y Bancos   / HABER 1.1.2 Cuentas a Cobrar
--   Pago a proveedor:   DEBE 2.1.1 Cuentas a Pagar / HABER 1.1.1 Caja y Bancos

CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(
  p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text,
  p_monto numeric, p_metodo text, p_fecha timestamp with time zone,
  p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid,
  p_monto_paralelo numeric DEFAULT NULL::numeric, p_tc_paralelo numeric DEFAULT NULL::numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monto      numeric;
  v_paralelo   numeric;
  v_cc_id      uuid;
  v_caja_id    uuid;
  v_fecha_dia  date;
  v_cerrado    boolean;
  v_cta_caja   uuid;
  v_cta_cxc    uuid;
  v_asiento_id uuid;
  v_asiento_generado boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del cobro debe ser mayor a cero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El cliente no pertenece a la empresa';
  END IF;

  v_monto    := ROUND(p_monto, 2);
  v_paralelo := CASE WHEN p_monto_paralelo IS NOT NULL THEN ROUND(p_monto_paralelo, 2) END;

  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, p_metodo, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_cc_id;

  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || p_metodo,
     v_monto, p_metodo, true, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_caja_id;

  -- Asiento contable automático — no bloqueante (mismo patrón que
  -- asientosAutoService.ts para Ventas/Compras/Caja manual).
  BEGIN
    v_fecha_dia := p_fecha::date;
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;

    IF NOT COALESCE(v_cerrado, false) THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      SELECT id INTO v_cta_cxc  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;

      IF v_cta_caja IS NOT NULL AND v_cta_cxc IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente'),
          'confirmado', v_monto, v_monto, 'cobro_cliente', v_cc_id
        ) RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Cobro recibido', v_monto, 0),
          (v_asiento_id, p_empresa_id, v_cta_cxc,  'Cancelación parcial/total de deuda', 0, v_monto);

        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  RETURN jsonb_build_object('ok', true, 'cc_id', v_cc_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_proveedor_nombre text,
  p_monto numeric, p_metodo text, p_descripcion text DEFAULT NULL::text,
  p_caja_sesion_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monto      numeric;
  v_ccp_id     uuid;
  v_caja_id    uuid;
  v_fecha_dia  date := now()::date;
  v_cerrado    boolean;
  v_cta_caja   uuid;
  v_cta_cxp    uuid;
  v_asiento_id uuid;
  v_asiento_generado boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del pago debe ser mayor a cero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El proveedor no pertenece a la empresa';
  END IF;

  v_monto := ROUND(p_monto, 2);

  INSERT INTO public.cuenta_corriente_proveedores
    (empresa_id, proveedor_id, tipo, monto, descripcion, user_id, fecha)
  VALUES
    (p_empresa_id, p_proveedor_id, 'pago', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago a proveedor'), p_user_id, now())
  RETURNING id INTO v_ccp_id;

  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, now(), 'egreso', 'Pago Proveedor',
     'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor') || ' - ' || p_metodo,
     v_monto, p_metodo, true)
  RETURNING id INTO v_caja_id;

  BEGIN
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;

    IF NOT COALESCE(v_cerrado, false) THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      SELECT id INTO v_cta_cxp  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;

      IF v_cta_caja IS NOT NULL AND v_cta_cxp IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor'),
          'confirmado', v_monto, v_monto, 'pago_proveedor', v_ccp_id
        ) RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_cxp,  'Cancelación parcial/total de deuda', v_monto, 0),
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Pago realizado', 0, v_monto);

        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  RETURN jsonb_build_object('ok', true, 'ccp_id', v_ccp_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado);
END;
$function$;
