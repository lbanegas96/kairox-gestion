-- migration 367 — Cancelar Cobro (pedido de Luciano 29/08: "que me permita
-- cancelarlo o modificarlo también por si cometí un error en la creación").
--
-- Un Cobro (fila HABER en cuenta_corriente_movimientos) es una transacción
-- financiera confirmada — mismo criterio SAP que Factura/NC/ND: nunca se
-- edita en el lugar, se cancela con un documento de reversa y, si hace
-- falta, se vuelve a cargar bien. Esta migration agrega el circuito de
-- cancelación que hoy no existe para cobros (sí existe para
-- cancelar_factura/cancelar_nota_credito/cancelar_nota_debito).
--
-- Diseño (Open Item clearing, mismo patrón que mig.169):
--   1. `estado` en cuenta_corriente_movimientos — nunca se borra la fila,
--      se marca 'cancelado'. facturas_saldo_pendiente y el cálculo de
--      "ya imputado" en registrar_cobro_cliente pasan a filtrar por
--      estado='confirmado', así una imputación cancelada deja de contar
--      sin borrar el rastro de auditoría.
--   2. `cc_movimiento_id` en movimientos_caja — link explícito para poder
--      revertir el ingreso de caja sin heurística de texto (cancelar_factura
--      sí necesita esa heurística porque ese link nunca existió; acá se
--      agrega desde el arranque). Cobros históricos anteriores a esta
--      migration quedan sin el link — se cae a un fallback por
--      categoria+monto+fecha, mismo criterio que cancelar_factura.
--   3. cancelar_cobro_cliente(...) — reversa movimientos_caja, recalcula
--      estado_pago de cada factura afectada (usando solo imputaciones de
--      cobros 'confirmado'), marca el movimiento 'cancelado'. El asiento se
--      reversa aparte, en el frontend (asientosAutoService.crearAsientoReversaCobro),
--      mismo criterio que crearAsientoReversaVenta.

-- ─── Paso 1: estado del cobro ────────────────────────────────────────────
ALTER TABLE public.cuenta_corriente_movimientos
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'confirmado';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cuenta_corriente_movimientos_estado_check'
  ) THEN
    ALTER TABLE public.cuenta_corriente_movimientos
      ADD CONSTRAINT cuenta_corriente_movimientos_estado_check
      CHECK (estado IN ('confirmado', 'cancelado'));
  END IF;
END $$;

-- ─── Paso 2: link cobro -> su movimiento de caja ─────────────────────────
ALTER TABLE public.movimientos_caja
  ADD COLUMN IF NOT EXISTS cc_movimiento_id uuid REFERENCES public.cuenta_corriente_movimientos(id);

CREATE INDEX IF NOT EXISTS idx_movimientos_caja_cc_movimiento ON public.movimientos_caja(cc_movimiento_id);

-- ─── Paso 3: registrar_cobro_cliente — completa el link + ignora cobros
-- cancelados al calcular "ya imputado" (si no, un cobro cancelado seguía
-- bloqueando saldo de la factura para siempre) ─────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(
  p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text,
  p_monto numeric, p_metodo text, p_fecha timestamp with time zone,
  p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid,
  p_monto_paralelo numeric DEFAULT NULL::numeric, p_tc_paralelo numeric DEFAULT NULL::numeric,
  p_imputaciones jsonb DEFAULT NULL::jsonb,
  p_forma_pago_id uuid DEFAULT NULL::uuid, p_referencia_pago text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_monto numeric; v_paralelo numeric; v_cc_id uuid; v_caja_id uuid; v_fecha_dia date;
  v_cerrado boolean; v_cta_caja uuid; v_cta_cxc uuid; v_asiento_id uuid;
  v_asiento_generado boolean := false; v_item jsonb; v_factura_id uuid; v_monto_imp numeric;
  v_total_factura numeric; v_ya_imputado numeric; v_saldo_pendiente numeric; v_suma_imputada numeric := 0;
  v_factura_moneda text; v_factura_tc_origen numeric; v_monto_moneda_ext numeric; v_tc_actual numeric;
  v_monto_imp_actual numeric; v_dif_cambio numeric; v_dif_cambio_total numeric := 0;
  v_cta_dif_gan uuid; v_cta_dif_perd uuid; v_monto_cxc_cancelado numeric; v_total_asiento numeric;
  v_metodo text;
  v_dias_acreditacion integer := 0; v_comision_pct numeric := 0;
  v_estado_liq text := 'acreditado'; v_monto_comision numeric := 0; v_monto_neto numeric;
  v_fecha_acred_est date; v_cta_puente uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('ventas') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
    END IF;
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El monto del cobro debe ser mayor a cero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'El cliente no pertenece a la empresa';
  END IF;

  v_metodo := p_metodo;
  IF p_forma_pago_id IS NOT NULL THEN
    SELECT nombre, dias_acreditacion, comision_porcentaje
      INTO v_metodo, v_dias_acreditacion, v_comision_pct
    FROM public.formas_pago
     WHERE id = p_forma_pago_id AND empresa_id = p_empresa_id;
    IF v_metodo IS NULL THEN
      RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
    END IF;
  END IF;

  v_monto    := ROUND(p_monto, 2);
  v_paralelo := CASE WHEN p_monto_paralelo IS NOT NULL THEN ROUND(p_monto_paralelo, 2) END;

  IF COALESCE(v_dias_acreditacion, 0) > 0 THEN
    v_estado_liq     := 'pendiente';
    v_monto_comision := ROUND(v_monto * COALESCE(v_comision_pct, 0) / 100, 2);
    v_monto_neto     := v_monto - v_monto_comision;
    v_fecha_acred_est := p_fecha::date + v_dias_acreditacion;
  END IF;

  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo, forma_pago_id, referencia_pago)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, v_metodo, v_paralelo, p_tc_paralelo, p_forma_pago_id, NULLIF(p_referencia_pago, ''))
  RETURNING id INTO v_cc_id;

  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id,
     estado_liquidacion, monto_comision, monto_neto, fecha_acreditacion_estimada, cc_movimiento_id)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || v_metodo,
     v_monto, v_metodo, true, v_paralelo, p_tc_paralelo, p_forma_pago_id,
     v_estado_liq, v_monto_comision, v_monto_neto, v_fecha_acred_est, v_cc_id)
  RETURNING id INTO v_caja_id;

  IF p_imputaciones IS NOT NULL AND jsonb_array_length(p_imputaciones) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
    LOOP
      v_factura_id := (v_item->>'comprobante_id')::uuid;
      SELECT total, moneda, tipo_cambio_tasa
      INTO v_total_factura, v_factura_moneda, v_factura_tc_origen
      FROM public.comprobantes
      WHERE id = v_factura_id AND empresa_id = p_empresa_id AND cliente_id = p_cliente_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La factura % no existe o no pertenece a este cliente', v_factura_id;
      END IF;
      v_monto_moneda_ext := NULLIF(v_item->>'monto_moneda_extranjera', '')::numeric;
      IF v_factura_moneda IS DISTINCT FROM 'ARS' AND v_monto_moneda_ext IS NOT NULL AND v_monto_moneda_ext > 0 THEN
        v_tc_actual        := COALESCE(public.get_tasa_cambio(p_empresa_id, v_factura_moneda, p_fecha::date), v_factura_tc_origen);
        v_monto_imp        := ROUND(v_monto_moneda_ext * v_factura_tc_origen, 2);
        v_monto_imp_actual := ROUND(v_monto_moneda_ext * v_tc_actual, 2);
        v_dif_cambio       := v_monto_imp_actual - v_monto_imp;
        v_dif_cambio_total := v_dif_cambio_total + v_dif_cambio;
      ELSE
        v_monto_imp        := ROUND((v_item->>'monto')::numeric, 2);
        v_monto_imp_actual := v_monto_imp;
        v_monto_moneda_ext := NULL;
      END IF;
      IF v_monto_imp IS NULL OR v_monto_imp <= 0 THEN
        RAISE EXCEPTION 'El monto imputado a la factura % debe ser mayor a cero', v_factura_id;
      END IF;
      -- Solo cuenta lo imputado por cobros TODAVÍA confirmados — un cobro
      -- cancelado ya no debe seguir bloqueando saldo de la factura (mig.367).
      SELECT COALESCE(SUM(cci.monto), 0) INTO v_ya_imputado
      FROM public.cuenta_corriente_imputaciones cci
      JOIN public.cuenta_corriente_movimientos ccm ON ccm.id = cci.cobro_movimiento_id
      WHERE cci.factura_comprobante_id = v_factura_id AND ccm.estado = 'confirmado';
      v_saldo_pendiente := v_total_factura - v_ya_imputado;
      IF v_monto_imp > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto imputado (%) supera el saldo pendiente de la factura (%)', v_monto_imp, v_saldo_pendiente;
      END IF;
      INSERT INTO public.cuenta_corriente_imputaciones
        (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto, monto_moneda_extranjera)
      VALUES (p_empresa_id, v_cc_id, v_factura_id, v_monto_imp, v_monto_moneda_ext);
      UPDATE public.comprobantes
         SET estado_pago = CASE
                              WHEN (v_ya_imputado + v_monto_imp) >= v_total_factura THEN 'pagada'
                              WHEN (v_ya_imputado + v_monto_imp) > 0 THEN 'parcial'
                              ELSE 'pendiente'
                            END
       WHERE id = v_factura_id;
      v_suma_imputada := v_suma_imputada + v_monto_imp_actual;
    END LOOP;
    IF v_suma_imputada > v_monto THEN
      RAISE EXCEPTION 'La suma imputada a facturas (%) no puede superar el monto del cobro (%)', v_suma_imputada, v_monto;
    END IF;
  END IF;
  BEGIN
    v_fecha_dia := p_fecha::date;
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;
    IF NOT COALESCE(v_cerrado, false) THEN
      IF v_estado_liq = 'pendiente' THEN
        SELECT id INTO v_cta_puente FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.8' AND activa LIMIT 1;
        v_cta_caja := v_cta_puente;
      ELSE
        v_cta_caja := public.obtener_cuenta_forma_pago(p_empresa_id, p_forma_pago_id, '1.1.1');
      END IF;
      SELECT id INTO v_cta_cxc  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.2' AND activa LIMIT 1;
      IF v_dif_cambio_total <> 0 THEN
        SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
        SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
        IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
          v_dif_cambio_total := 0;
        END IF;
      END IF;
      v_monto_cxc_cancelado := v_monto - v_dif_cambio_total;
      v_total_asiento       := v_monto + GREATEST(-v_dif_cambio_total, 0);
      IF v_cta_caja IS NOT NULL AND v_cta_cxc IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente'),
          'confirmado', v_total_asiento, v_total_asiento, 'cobro_cliente', v_cc_id
        ) RETURNING id INTO v_asiento_id;
        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_caja, CASE WHEN v_estado_liq = 'pendiente' THEN 'Cobro recibido (pendiente de acreditar)' ELSE 'Cobro recibido' END, v_monto, 0),
          (v_asiento_id, p_empresa_id, v_cta_cxc,  'Cancelación parcial/total de deuda', 0, v_monto_cxc_cancelado);
        IF v_dif_cambio_total > 0 THEN
          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, p_empresa_id, v_cta_dif_gan, 'Diferencia de cambio ganada (clearing)', 0, v_dif_cambio_total);
        ELSIF v_dif_cambio_total < 0 THEN
          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, p_empresa_id, v_cta_dif_perd, 'Diferencia de cambio perdida (clearing)', -v_dif_cambio_total, 0);
        END IF;
        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
    v_asiento_id := NULL;
  END;
  UPDATE public.cuenta_corriente_movimientos
     SET asiento_id = v_asiento_id, dif_cambio_total = v_dif_cambio_total
   WHERE id = v_cc_id;
  RETURN jsonb_build_object('ok', true, 'cc_id', v_cc_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado, 'diferencia_cambio', v_dif_cambio_total, 'estado_liquidacion', v_estado_liq);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric,jsonb,uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric,jsonb,uuid,text) TO authenticated;

-- ─── Paso 4: facturas_saldo_pendiente — ignora imputaciones de cobros
-- cancelados (si no, una factura con un cobro cancelado se veía "pagada"
-- para siempre, con la deuda escondida) ──────────────────────────────────
CREATE OR REPLACE VIEW public.facturas_saldo_pendiente
WITH (security_invoker = true) AS
SELECT
  c.id            AS comprobante_id,
  c.empresa_id,
  c.cliente_id,
  c.numero_venta,
  c.fecha,
  c.fecha_vencimiento,
  c.total,
  COALESCE(i.total_imputado, 0)                    AS total_imputado,
  c.total - COALESCE(i.total_imputado, 0)           AS saldo_pendiente,
  c.cliente_nombre,
  c.moneda,
  c.tipo_cambio_tasa,
  c.monto_moneda_original
FROM public.comprobantes c
LEFT JOIN (
  SELECT cci.factura_comprobante_id, SUM(cci.monto) AS total_imputado
  FROM public.cuenta_corriente_imputaciones cci
  JOIN public.cuenta_corriente_movimientos ccm ON ccm.id = cci.cobro_movimiento_id
  WHERE ccm.estado = 'confirmado'
  GROUP BY cci.factura_comprobante_id
) i ON i.factura_comprobante_id = c.id
WHERE c.tipo = ANY (ARRAY['venta','nota_debito']) AND c.cliente_id IS NOT NULL AND c.estado_pago <> 'pagada';

-- ─── Paso 5: cancelar_cobro_cliente ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancelar_cobro_cliente(
  p_empresa_id uuid, p_user_id uuid, p_movimiento_id uuid, p_motivo text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_mov RECORD;
  v_fact RECORD;
  v_nueva_imputada numeric;
  v_total_factura numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('ventas') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
    END IF;
  END IF;

  SELECT * INTO v_mov FROM public.cuenta_corriente_movimientos
  WHERE id = p_movimiento_id AND empresa_id = p_empresa_id AND tipo = 'HABER'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cobro no encontrado';
  END IF;

  IF v_mov.estado = 'cancelado' THEN
    RAISE EXCEPTION 'Este cobro ya está cancelado';
  END IF;

  IF v_mov.cheque_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este cobro corresponde a un cheque — anulalo desde el módulo Cheques';
  END IF;

  -- 1. Reversar movimientos_caja — documento de reversa (egreso especular),
  --    nunca se borra el ingreso original. Match por cc_movimiento_id
  --    (mig.367) con fallback por categoría+monto+fecha para cobros
  --    anteriores a esta migration que no tienen el link.
  INSERT INTO public.movimientos_caja (
    empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha, cc_movimiento_id
  )
  SELECT mc.empresa_id, p_user_id, mc.caja_sesion_id, 'egreso', 'Cobro Cliente',
         'Cancelación de cobro — ' || COALESCE(mc.concepto, 'Cobro'), mc.monto, mc.metodo_pago, true, now(), p_movimiento_id
  FROM public.movimientos_caja mc
  WHERE mc.empresa_id = p_empresa_id
    AND mc.tipo = 'ingreso'
    AND (
      mc.cc_movimiento_id = p_movimiento_id
      OR (mc.cc_movimiento_id IS NULL AND mc.categoria = 'Cobro Cliente' AND mc.monto = v_mov.monto AND mc.fecha = v_mov.fecha)
    );

  -- 2. Recalcular estado_pago de cada factura que este cobro imputaba,
  --    ahora excluyéndolo (Open Item clearing) — la fila de
  --    cuenta_corriente_imputaciones NO se borra, solo deja de contar
  --    porque el movimiento padre pasa a estado='cancelado'.
  FOR v_fact IN
    SELECT DISTINCT factura_comprobante_id FROM public.cuenta_corriente_imputaciones
    WHERE cobro_movimiento_id = p_movimiento_id
  LOOP
    SELECT total INTO v_total_factura FROM public.comprobantes WHERE id = v_fact.factura_comprobante_id FOR UPDATE;

    SELECT COALESCE(SUM(cci.monto), 0) INTO v_nueva_imputada
    FROM public.cuenta_corriente_imputaciones cci
    JOIN public.cuenta_corriente_movimientos ccm ON ccm.id = cci.cobro_movimiento_id
    WHERE cci.factura_comprobante_id = v_fact.factura_comprobante_id
      AND ccm.estado = 'confirmado' AND ccm.id <> p_movimiento_id;

    UPDATE public.comprobantes
       SET estado_pago = CASE
                            WHEN v_nueva_imputada >= v_total_factura THEN 'pagada'
                            WHEN v_nueva_imputada > 0 THEN 'parcial'
                            ELSE 'pendiente'
                          END
     WHERE id = v_fact.factura_comprobante_id;
  END LOOP;

  -- 3. Marcar cancelado — nunca se borra el rastro.
  UPDATE public.cuenta_corriente_movimientos
     SET estado = 'cancelado'
   WHERE id = p_movimiento_id;

  RETURN jsonb_build_object(
    'movimiento_id', p_movimiento_id,
    'cliente_id',    v_mov.cliente_id,
    'monto',         v_mov.monto
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancelar_cobro_cliente(uuid,uuid,uuid,text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancelar_cobro_cliente(uuid,uuid,uuid,text) TO authenticated;

-- ROLLBACK (comentado):
-- DROP FUNCTION IF EXISTS public.cancelar_cobro_cliente(uuid,uuid,uuid,text);
-- (restaurar facturas_saldo_pendiente y registrar_cobro_cliente a su versión previa a mig.367)
-- ALTER TABLE public.movimientos_caja DROP COLUMN IF EXISTS cc_movimiento_id;
-- ALTER TABLE public.cuenta_corriente_movimientos DROP CONSTRAINT IF EXISTS cuenta_corriente_movimientos_estado_check;
-- ALTER TABLE public.cuenta_corriente_movimientos DROP COLUMN IF EXISTS estado;
