-- migration 130 — Cobro de CxC atómico (auditoría sesión 44, Hallazgo A)
--
-- PROBLEMA: CuentaCorrienteSection registraba el cobro con DOS inserts independientes
-- desde el frontend (cada uno su propia transacción HTTP):
--   1) cuenta_corriente_movimientos (HABER → el trigger baja clientes.saldo_actual)
--   2) movimientos_caja (ingreso)
-- El paso 1 commitea ANTES del paso 2. Si el 2 falla (red/RLS/transitorio), la deuda
-- del cliente queda reducida SIN registro de la plata en caja. Y si el usuario reintenta
-- tras el error, el paso 1 corre de nuevo → la deuda se reduce DOS veces. Descuadre de
-- dinero, silencioso.
--
-- SOLUCIÓN: un RPC que hace ambos inserts en UNA transacción (o todo o nada), con guard
-- de tenant. Mismo criterio que crear_venta. El trigger puente Caja→Bancos (mig.122) sigue
-- disparando dentro del RPC para cobros no-efectivo, sin cambios.
--
-- NOTA: el cobro sigue sin generar asiento contable (Hallazgo B, gap sistémico de
-- contabilización de sub-libros) — se resuelve aparte con la Determinación de Cuentas +
-- decisión del contador. Este fix cierra SOLO la atomicidad.
--
-- ROLLBACK: DROP FUNCTION public.registrar_cobro_cliente(...);

CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(
  p_empresa_id      uuid,
  p_user_id         uuid,
  p_cliente_id      uuid,
  p_cliente_nombre  text,
  p_monto           numeric,
  p_metodo          text,
  p_fecha           timestamptz,
  p_descripcion     text        DEFAULT NULL,
  p_caja_sesion_id  uuid        DEFAULT NULL,
  p_monto_paralelo  numeric     DEFAULT NULL,
  p_tc_paralelo     numeric     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monto     numeric;
  v_paralelo  numeric;
  v_cc_id     uuid;
  v_caja_id   uuid;
BEGIN
  -- Guard multi-tenant
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

  -- 1) Cuenta corriente (HABER reduce la deuda; el trigger ajusta clientes.saldo_actual)
  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, p_metodo, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_cc_id;

  -- 2) Caja (ingreso). Trigger puente Caja→Bancos dispara acá para no-efectivo.
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || p_metodo,
     v_monto, p_metodo, true, v_paralelo, p_tc_paralelo)
  RETURNING id INTO v_caja_id;

  RETURN jsonb_build_object('ok', true, 'cc_id', v_cc_id, 'caja_id', v_caja_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric) TO authenticated;
