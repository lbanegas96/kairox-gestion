-- Migration 216 — Cuenta puente "Tarjetas a Acreditar" + liquidación real de comisión/neto
--
-- HALLAZGO (Fase 2 del análisis de tesorería, sesión 75): cuando se cobra con una forma_pago
-- de tipo tarjeta (dias_acreditacion > 0), KAIROX hoy acredita el BRUTO a "1.1.1 Caja y Bancos"
-- el mismo día de la venta. En la realidad argentina (Comunicación BCRA A 7153), la plata entra
-- 8-10 días hábiles después y por un NETO menor (comisión + IVA). El saldo de Bancos nunca puede
-- cerrar mientras haya ventas con tarjeta, porque el sistema asume liquidez que todavía no existe.
--
-- Mismo patrón contable que ya usamos para Cheques de Terceros (cuenta puente 1.1.6 "en Cartera",
-- con su propio circuito de estados) — acá se aplica el mismo concepto a Tarjetas, pero reutilizando
-- movimientos_caja (que YA es el objeto que trackea "este pago con esta forma_pago") en vez de crear
-- una tabla nueva: se le agregan columnas de estado de liquidación.
--
-- ALCANCE de esta migration: SOLO registrar_cobro_cliente (Cuenta Corriente / cobros manuales).
-- crear_venta (POS) queda SIN TOCAR a propósito — su asiento contable lo arma un service aparte
-- (asientosAutoService.crearAsientoVenta) que hoy no distingue por medio de pago; extenderlo
-- correctamente es un cambio separado, no shoehornearlo acá a medias.

-- ── 1) Cuenta puente 1.1.8 (mismo patrón que 1.1.6/1.1.7 de la migration 209) ──
INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '1.1.8', 'Tarjetas a Acreditar', 'activo', 3, true
FROM public.empresas e
WHERE EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id)
  AND NOT EXISTS (SELECT 1 FROM public.plan_cuentas p WHERE p.empresa_id = e.id AND p.codigo = '1.1.8');

CREATE OR REPLACE FUNCTION public.seed_plan_cuentas(p_empresa_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM plan_cuentas WHERE empresa_id = p_empresa_id LIMIT 1) THEN
    RETURN;
  END IF;
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '1',     'ACTIVO',                    'activo', 1, false),
    (p_empresa_id, '1.1',   'Activo Corriente',          'activo', 2, false),
    (p_empresa_id, '1.1.1', 'Caja y Bancos',             'activo', 3, true),
    (p_empresa_id, '1.1.2', 'Cuentas a Cobrar',          'activo', 3, true),
    (p_empresa_id, '1.1.3', 'Mercaderías / Inventario',  'activo', 3, true),
    (p_empresa_id, '1.1.4', 'IVA Crédito Fiscal',        'activo', 3, true),
    (p_empresa_id, '1.1.5', 'Otros Activos Corrientes',  'activo', 3, true),
    (p_empresa_id, '1.1.6', 'Cheques de Terceros en Cartera',      'activo', 3, true),
    (p_empresa_id, '1.1.7', 'Deudores por Cheques Rechazados',     'activo', 3, true),
    (p_empresa_id, '1.1.8', 'Tarjetas a Acreditar',      'activo', 3, true),
    (p_empresa_id, '1.2',   'Activo No Corriente',       'activo', 2, false),
    (p_empresa_id, '1.2.1', 'Bienes de Uso (neto)',      'activo', 3, true),
    (p_empresa_id, '1.2.2', 'Intangibles',               'activo', 3, true);
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '2',     'PASIVO',                    'pasivo', 1, false),
    (p_empresa_id, '2.1',   'Pasivo Corriente',          'pasivo', 2, false),
    (p_empresa_id, '2.1.1', 'Cuentas a Pagar',           'pasivo', 3, true),
    (p_empresa_id, '2.1.2', 'Sueldos y Cargas Sociales', 'pasivo', 3, true),
    (p_empresa_id, '2.1.3', 'IVA Débito Fiscal',         'pasivo', 3, true),
    (p_empresa_id, '2.1.4', 'Impuestos a Pagar',         'pasivo', 3, true),
    (p_empresa_id, '2.1.5', 'Otros Pasivos Corrientes',  'pasivo', 3, true),
    (p_empresa_id, '2.1.6', 'Documentos a Pagar',        'pasivo', 3, true),
    (p_empresa_id, '2.2',   'Pasivo No Corriente',       'pasivo', 2, false),
    (p_empresa_id, '2.2.1', 'Deudas Financieras LP',     'pasivo', 3, true);
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '3',     'PATRIMONIO NETO',           'patrimonio', 1, false),
    (p_empresa_id, '3.1',   'Capital Social',            'patrimonio', 2, true),
    (p_empresa_id, '3.2',   'Resultados Acumulados',     'patrimonio', 2, true),
    (p_empresa_id, '3.3',   'Resultado del Ejercicio',   'patrimonio', 2, true);
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '4',     'INGRESOS',                  'ingreso', 1, false),
    (p_empresa_id, '4.1',   'Ventas de Productos',       'ingreso', 2, true),
    (p_empresa_id, '4.2',   'Ventas de Servicios',       'ingreso', 2, true),
    (p_empresa_id, '4.3',   'Otros Ingresos',            'ingreso', 2, true),
    (p_empresa_id, '4.4',   'Diferencia de Cambio (Ganancia)', 'ingreso', 2, true);
  INSERT INTO plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos) VALUES
    (p_empresa_id, '5',     'EGRESOS / GASTOS',          'egreso', 1, false),
    (p_empresa_id, '5.1',   'Costo de Mercaderías',      'egreso', 2, true),
    (p_empresa_id, '5.2',   'Gastos de Personal',        'egreso', 2, true),
    (p_empresa_id, '5.3',   'Gastos Comerciales',        'egreso', 2, true),
    (p_empresa_id, '5.4',   'Gastos de Administración',  'egreso', 2, true),
    (p_empresa_id, '5.5',   'Gastos Financieros',        'egreso', 2, true),
    (p_empresa_id, '5.6',   'Impuestos y Tasas',         'egreso', 2, true),
    (p_empresa_id, '5.7',   'Amortizaciones',            'egreso', 2, true),
    (p_empresa_id, '5.8',   'Otros Gastos',              'egreso', 2, true),
    (p_empresa_id, '5.9',   'Diferencia de Cambio (Pérdida)', 'egreso', 2, true);
END;
$function$;

-- ── 2) Columnas de liquidación en movimientos_caja ──
-- estado_liquidacion default 'acreditado': todo movimiento existente (y todo lo que no pase por
-- el bloque nuevo — Efectivo, Transferencia, o cualquier forma_pago con dias_acreditacion=0) se
-- considera ya liquidado, mismo comportamiento de siempre. Solo queda 'pendiente' cuando
-- registrar_cobro_cliente detecta dias_acreditacion > 0 en la forma_pago usada.
ALTER TABLE public.movimientos_caja
  ADD COLUMN estado_liquidacion TEXT NOT NULL DEFAULT 'acreditado'
    CHECK (estado_liquidacion IN ('acreditado', 'pendiente')),
  ADD COLUMN monto_comision NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN monto_neto NUMERIC(12,2),
  ADD COLUMN fecha_acreditacion_estimada DATE,
  ADD COLUMN fecha_acreditacion_real DATE,
  ADD COLUMN asiento_liquidacion_id UUID REFERENCES public.asientos_contables(id) ON DELETE SET NULL;

-- ── 3) registrar_cobro_cliente: resolver dias_acreditacion/comision_porcentaje de la forma_pago
-- y debitar la cuenta puente en vez de Caja y Bancos cuando corresponda ──
DROP FUNCTION IF EXISTS public.registrar_cobro_cliente(
  uuid, uuid, uuid, text, numeric, text, timestamp with time zone, text, uuid, numeric, numeric, jsonb, uuid
);

CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(
  p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_monto numeric,
  p_metodo text, p_fecha timestamp with time zone, p_descripcion text DEFAULT NULL::text,
  p_caja_sesion_id uuid DEFAULT NULL::uuid, p_monto_paralelo numeric DEFAULT NULL::numeric,
  p_tc_paralelo numeric DEFAULT NULL::numeric, p_imputaciones jsonb DEFAULT NULL::jsonb,
  p_forma_pago_id uuid DEFAULT NULL::uuid
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
  -- mig.216: liquidación de tarjeta
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

  -- mig.216: si la forma de pago tarda en acreditarse, el cobro queda pendiente de
  -- liquidación — el bruto va a la cuenta puente, no a Caja y Bancos todavía.
  IF COALESCE(v_dias_acreditacion, 0) > 0 THEN
    v_estado_liq     := 'pendiente';
    v_monto_comision := ROUND(v_monto * COALESCE(v_comision_pct, 0) / 100, 2);
    v_monto_neto     := v_monto - v_monto_comision;
    v_fecha_acred_est := p_fecha::date + v_dias_acreditacion;
  END IF;

  INSERT INTO public.cuenta_corriente_movimientos
    (user_id, empresa_id, cliente_id, tipo, monto, descripcion, fecha, metodo_cobro, monto_paralelo, tc_paralelo, forma_pago_id)
  VALUES
    (p_user_id, p_empresa_id, p_cliente_id, 'HABER', v_monto,
     COALESCE(NULLIF(p_descripcion, ''), 'Pago de deuda'), p_fecha, v_metodo, v_paralelo, p_tc_paralelo, p_forma_pago_id)
  RETURNING id INTO v_cc_id;
  INSERT INTO public.movimientos_caja
    (user_id, empresa_id, caja_sesion_id, fecha, tipo, categoria, concepto, monto, metodo_pago, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id,
     estado_liquidacion, monto_comision, monto_neto, fecha_acreditacion_estimada)
  VALUES
    (p_user_id, p_empresa_id, p_caja_sesion_id, p_fecha, 'ingreso', 'Cobro Cliente',
     'Cobro a ' || COALESCE(NULLIF(p_cliente_nombre, ''), 'cliente') || ' - ' || v_metodo,
     v_monto, v_metodo, true, v_paralelo, p_tc_paralelo, p_forma_pago_id,
     v_estado_liq, v_monto_comision, v_monto_neto, v_fecha_acred_est)
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
      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado FROM public.cuenta_corriente_imputaciones WHERE factura_comprobante_id = v_factura_id;
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
      -- mig.216: si está pendiente de liquidación, el débito va a la cuenta puente
      -- 1.1.8 en vez de 1.1.1 — el resto del asiento (CxC, diferencia de cambio) no cambia.
      IF v_estado_liq = 'pendiente' THEN
        SELECT id INTO v_cta_puente FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.8' AND activa LIMIT 1;
        v_cta_caja := v_cta_puente;
      ELSE
        SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
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

-- ── 4) Puente Caja→Bancos: NO acreditar todavía si el cobro está pendiente de liquidación ──
CREATE OR REPLACE FUNCTION public.trg_fn_puente_caja_bancos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cuenta_bancaria_id uuid;
  v_tipo_instrumento text;
BEGIN
  -- mig.216: un cobro pendiente de liquidación (tarjeta con dias_acreditacion) todavía
  -- no es plata real en el banco — acreditar_movimiento_caja se encarga cuando se liquida.
  IF NEW.estado_liquidacion = 'pendiente' THEN
    RETURN NEW;
  END IF;

  IF NEW.metodo_pago IS DISTINCT FROM 'Efectivo'
     AND NEW.metodo_pago IS DISTINCT FROM 'Cuenta Corriente' THEN

    IF NEW.forma_pago_id IS NOT NULL THEN
      SELECT cuenta_bancaria_id, tipo_instrumento INTO v_cuenta_bancaria_id, v_tipo_instrumento
      FROM public.formas_pago
      WHERE id = NEW.forma_pago_id AND empresa_id = NEW.empresa_id;

      IF v_tipo_instrumento = 'efectivo' THEN
        v_cuenta_bancaria_id := NULL;
      END IF;
    ELSE
      SELECT mpb.cuenta_bancaria_id INTO v_cuenta_bancaria_id
      FROM public.metodo_pago_cuenta_bancaria mpb
      WHERE mpb.empresa_id  = NEW.empresa_id
        AND mpb.metodo_pago = NEW.metodo_pago
        AND mpb.activo      = true;
    END IF;

    IF v_cuenta_bancaria_id IS NOT NULL THEN
      INSERT INTO public.movimientos_bancarios (
        empresa_id, cuenta_bancaria_id, fecha, descripcion,
        monto, tipo, origen, conciliado
      ) VALUES (
        NEW.empresa_id, v_cuenta_bancaria_id, NEW.fecha,
        NEW.concepto, NEW.monto, NEW.tipo, 'caja', false
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ── 5) Permitir 'liquidacion_tarjeta' como origen válido en movimientos_bancarios ──
ALTER TABLE public.movimientos_bancarios DROP CONSTRAINT movimientos_bancarios_origen_check;
ALTER TABLE public.movimientos_bancarios ADD CONSTRAINT movimientos_bancarios_origen_check
  CHECK (origen = ANY (ARRAY['manual', 'csv', 'email', 'webhook', 'mercadopago', 'uala', 'caja', 'cheque', 'liquidacion_tarjeta']::text[]));

-- ── 6) RPC acreditar_movimiento_caja — liquida un cobro pendiente ──
-- Arma el asiento de liquidación (DEBE Bancos neto + DEBE Gastos Financieros comisión / HABER
-- Tarjetas a Acreditar bruto), inserta el movimiento bancario por el neto (recién ahí aparece en
-- Bancos/conciliación) y marca el movimiento_caja como acreditado.
CREATE OR REPLACE FUNCTION public.acreditar_movimiento_caja(p_movimiento_caja_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid; v_forma_pago_id uuid; v_monto numeric; v_monto_comision numeric;
  v_monto_neto numeric; v_estado text; v_fecha date; v_concepto text; v_user_id uuid;
  v_cuenta_bancaria_id uuid; v_cta_puente uuid; v_cta_bancos uuid; v_cta_gastos_fin uuid;
  v_asiento_id uuid; v_cerrado boolean;
BEGIN
  SELECT empresa_id, forma_pago_id, monto, monto_comision, monto_neto, estado_liquidacion, fecha::date, concepto, user_id
    INTO v_empresa_id, v_forma_pago_id, v_monto, v_monto_comision, v_monto_neto, v_estado, v_fecha, v_concepto, v_user_id
  FROM public.movimientos_caja WHERE id = p_movimiento_caja_id FOR UPDATE;

  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Movimiento no encontrado';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: el movimiento no pertenece a tu empresa';
    END IF;
    IF NOT has_module_permission('bancos') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo bancos';
    END IF;
  END IF;
  IF v_estado IS DISTINCT FROM 'pendiente' THEN
    RAISE EXCEPTION 'Este movimiento no está pendiente de liquidación';
  END IF;
  IF v_forma_pago_id IS NULL THEN
    RAISE EXCEPTION 'El movimiento no tiene una forma de pago asociada';
  END IF;

  SELECT cuenta_bancaria_id INTO v_cuenta_bancaria_id
    FROM public.formas_pago WHERE id = v_forma_pago_id AND empresa_id = v_empresa_id;
  IF v_cuenta_bancaria_id IS NULL THEN
    RAISE EXCEPTION 'La forma de pago no tiene una cuenta bancaria configurada — asignala en Configuración > Finanzas antes de acreditar';
  END IF;

  SELECT fecha_en_periodo_cerrado(v_empresa_id, CURRENT_DATE) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'Período cerrado: no se puede acreditar en la fecha de hoy';
  END IF;

  SELECT id INTO v_cta_puente    FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.8' AND activa LIMIT 1;
  SELECT id INTO v_cta_bancos    FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
  SELECT id INTO v_cta_gastos_fin FROM public.plan_cuentas WHERE empresa_id = v_empresa_id AND codigo = '5.5' AND activa LIMIT 1;
  IF v_cta_puente IS NULL OR v_cta_bancos IS NULL OR v_cta_gastos_fin IS NULL THEN
    RAISE EXCEPTION 'Falta alguna cuenta del plan de cuentas (1.1.8 / 1.1.1 / 5.5)';
  END IF;

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_empresa_id, v_user_id, next_numero_asiento(v_empresa_id), CURRENT_DATE,
    'Liquidación de tarjeta — ' || v_concepto, 'confirmado', v_monto, v_monto, 'liquidacion_tarjeta', p_movimiento_caja_id
  ) RETURNING id INTO v_asiento_id;

  INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
    (v_asiento_id, v_empresa_id, v_cta_bancos,     'Acreditación neta en banco', v_monto_neto, 0),
    (v_asiento_id, v_empresa_id, v_cta_gastos_fin, 'Comisión de tarjeta',        v_monto_comision, 0),
    (v_asiento_id, v_empresa_id, v_cta_puente,     'Cancelación de tarjetas a acreditar', 0, v_monto);

  INSERT INTO public.movimientos_bancarios
    (empresa_id, cuenta_bancaria_id, fecha, descripcion, monto, tipo, origen, conciliado, asiento_id)
  VALUES (
    v_empresa_id, v_cuenta_bancaria_id, CURRENT_DATE,
    'Liquidación tarjeta — ' || v_concepto, v_monto_neto, 'ingreso', 'liquidacion_tarjeta', false, v_asiento_id
  );

  UPDATE public.movimientos_caja
     SET estado_liquidacion = 'acreditado', fecha_acreditacion_real = CURRENT_DATE, asiento_liquidacion_id = v_asiento_id
   WHERE id = p_movimiento_caja_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'monto_neto', v_monto_neto, 'monto_comision', v_monto_comision);
END;
$function$;

-- ROLLBACK (comentado): CREATE OR REPLACE registrar_cobro_cliente y trg_fn_puente_caja_bancos con
-- el body previo a esta migration (sin lógica de liquidación), DROP FUNCTION
-- acreditar_movimiento_caja, ALTER TABLE movimientos_caja DROP de las 6 columnas nuevas,
-- DELETE de plan_cuentas donde codigo='1.1.8' y CREATE OR REPLACE seed_plan_cuentas sin esa fila.
