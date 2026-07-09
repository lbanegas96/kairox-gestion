-- migration 170 — Multimoneda: diferencia de cambio realizada (Fase 3 del plan
-- de 4 frentes contables, sesión 54/55, 2026-07-08).
--
-- HALLAZGO: comprobantes.moneda/tipo_cambio_tasa y compras.moneda/tipo_cambio_tasa
-- existen desde migration 013, pero en NINGÚN flujo de la UI (NuevaFacturaModal,
-- NuevaVentaModal, CompraRapidaSection) una factura queda realmente denominada
-- en moneda extranjera: el `total` guardado siempre es el ARS ya calculado desde
-- productos priced en ARS; moneda/tipo_cambio_tasa se usan solo para MOSTRAR un
-- equivalente (igual que tc_paralelo). Nunca hay una obligación en USD que se
-- revalúe. Confirmado con Luciano: se pide construir la feature real (no dejarla
-- documentada como "no aplica").
--
-- DISEÑO (patrón SAP — Open Item clearing, igual que migration 169):
--   - `monto_moneda_original`: el valor nominal FIJO en moneda extranjera de una
--     factura/compra (ej. 100.00 USD), derivado en el frontend como
--     total_ARS / tipo_cambio_tasa. El `total` en ARS sigue siendo lo que se
--     contabiliza como CxC/CxP al emitir — no cambia nada de lo existente.
--   - Al cobrar/pagar e imputar contra una factura con moneda != 'ARS', el
--     frontend ahora puede indicar cuántas unidades de moneda extranjera se están
--     cancelando (`monto_moneda_extranjera` dentro de cada item de
--     `p_imputaciones`). El RPC calcula:
--       * valor_original_ARS = monto_moneda_extranjera * tipo_cambio_tasa (de la
--         factura, fijo desde la emisión) → esto es lo que cancela el saldo
--         pendiente de la factura (columna `monto` de las tablas de imputación,
--         sin cambios de significado respecto a migration 169).
--       * valor_actual_ARS = monto_moneda_extranjera * TC de hoy (get_tasa_cambio)
--       * diferencia = valor_actual_ARS - valor_original_ARS → diferencia de
--         cambio REALIZADA (ganancia si >0 en cobros, pérdida si >0 en pagos).
--   - El asiento automático de cobro/pago gana una tercera pata (Diferencia de
--     Cambio Ganada/Perdida) solo cuando corresponde; si no hay ninguna factura
--     en moneda extranjera imputada, el asiento es IDÉNTICO al de antes de esta
--     migration (100% backward compatible).
--
-- Nada de esto rompe imputaciones existentes en ARS: `monto_moneda_extranjera`
-- es opcional en el JSON y NULL en todos los casos ya usados hasta hoy.

-- ─── Paso 1: columnas nuevas (100% aditivas, nullable) ──────────────────────

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS monto_moneda_original NUMERIC(14,2) NULL;

ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS monto_moneda_original NUMERIC(14,2) NULL;

ALTER TABLE public.cuenta_corriente_imputaciones
  ADD COLUMN IF NOT EXISTS monto_moneda_extranjera NUMERIC(14,2) NULL;

ALTER TABLE public.cuenta_corriente_proveedores_imputaciones
  ADD COLUMN IF NOT EXISTS monto_moneda_extranjera NUMERIC(14,2) NULL;

-- ─── Paso 2: cuentas contables de Diferencia de Cambio ──────────────────────
-- Retroactivo para empresas ya existentes (seed_plan_cuentas solo corre para
-- empresas nuevas — mismo patrón que cualquier alta de cuenta post-seed).

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '4.4', 'Diferencia de Cambio (Ganancia)', 'ingreso', 2, true
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.plan_cuentas pc WHERE pc.empresa_id = e.id AND pc.codigo = '4.4'
);

INSERT INTO public.plan_cuentas (empresa_id, codigo, nombre, tipo, nivel, permite_movimientos)
SELECT e.id, '5.9', 'Diferencia de Cambio (Pérdida)', 'egreso', 2, true
FROM public.empresas e
WHERE NOT EXISTS (
  SELECT 1 FROM public.plan_cuentas pc WHERE pc.empresa_id = e.id AND pc.codigo = '5.9'
);

CREATE OR REPLACE FUNCTION public.seed_plan_cuentas(p_empresa_id UUID)
RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

-- ─── Paso 3: crear_venta — nuevo parámetro opcional p_monto_moneda_original ─
-- Único cambio real: guardar el valor nominal en moneda extranjera al emitir
-- (si la venta es en moneda != ARS). Nada más de la función cambia.
DROP FUNCTION IF EXISTS public.crear_venta(uuid,uuid,text,timestamptz,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,jsonb,boolean,uuid,uuid);

CREATE OR REPLACE FUNCTION public.crear_venta(
  p_empresa_id         UUID,
  p_user_id            UUID,
  p_numero_venta       TEXT,
  p_fecha              TIMESTAMPTZ,
  p_cliente_id         UUID,
  p_cliente_nombre     TEXT,
  p_total              NUMERIC,
  p_forma_pago         TEXT,
  p_estado_pago        TEXT,
  p_moneda             TEXT,
  p_tipo_cambio_tasa   NUMERIC,
  p_monto_paralelo     NUMERIC,
  p_tc_paralelo        NUMERIC,
  p_items              JSONB,
  p_pagos              JSONB,
  p_es_cc              BOOLEAN,
  p_caja_sesion_id     UUID,
  p_pedido_id          UUID,
  p_monto_moneda_original NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comprobante_id         UUID;
  v_item                   JSONB;
  v_pago                   JSONB;
  v_stock_actual           INTEGER;
  v_cantidad               INTEGER;
  v_producto_id            UUID;
  v_alicuota               TEXT;
  v_factor                 NUMERIC;
  v_subtotal               NUMERIC;
  v_neto_total             NUMERIC := 0;
  v_iva_total              NUMERIC := 0;
  v_entrega_id             UUID;
  v_numero_entrega         TEXT;
  v_entrega_manual_id      UUID := NULL;
  v_dias_credito           INTEGER;
  v_fecha_vencimiento      DATE;
  v_precio_unitario        NUMERIC;
  v_precio_original        NUMERIC;
  v_descuento_pct          NUMERIC;
  v_descuento_monto_item   NUMERIC;
  v_oferta_id              UUID;
  v_descuento_manual_pct   NUMERIC;
  v_descuento_global_monto NUMERIC := 0;
  v_descuento_global_pct   NUMERIC := 0;
  v_bruto_total            NUMERIC := 0;
  v_total                  NUMERIC;
  v_pedido_item_id         UUID;
  v_ped_cantidad           NUMERIC;
  v_ped_entregada          NUMERIC;
  v_ped_facturada          NUMERIC;
  v_max_facturable         NUMERIC;
  v_mueve_stock            BOOLEAN;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;

  v_total := ROUND(p_total, 2);

  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito INTO v_dias_credito
    FROM public.clientes
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id;
  END IF;
  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);

  IF p_pedido_id IS NOT NULL THEN
    SELECT id INTO v_entrega_manual_id
    FROM public.entregas
    WHERE empresa_id = p_empresa_id
      AND pedido_id  = p_pedido_id
      AND origen     = 'manual'
      AND estado     = 'entregado'
    ORDER BY fecha DESC
    LIMIT 1;
  END IF;

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha,
    cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa,
    monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento, monto_moneda_original
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha,
    p_cliente_id, p_cliente_nombre, v_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa,
    p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento, ROUND(p_monto_moneda_original, 2)
  )
  RETURNING id INTO v_comprobante_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::INTEGER;
    v_subtotal    := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');

    v_precio_unitario      := ROUND((v_item->>'precio_unitario')::NUMERIC, 2);
    v_precio_original      := ROUND(COALESCE((v_item->>'precio_original')::NUMERIC,
                                              (v_item->>'precio_unitario')::NUMERIC), 2);
    v_descuento_pct        := COALESCE((v_item->>'descuento_pct')::NUMERIC, 0);
    v_descuento_monto_item := ROUND(COALESCE((v_item->>'descuento_monto')::NUMERIC, 0), 2);
    v_oferta_id            := NULLIF(v_item->>'oferta_id', '')::UUID;
    v_descuento_manual_pct := COALESCE((v_item->>'descuento_manual_pct')::NUMERIC, 0);

    v_mueve_stock    := TRUE;
    v_pedido_item_id := NULL;
    IF p_pedido_id IS NOT NULL THEN
      SELECT id, cantidad, cantidad_entregada, cantidad_facturada
        INTO v_pedido_item_id, v_ped_cantidad, v_ped_entregada, v_ped_facturada
      FROM public.pedido_items
      WHERE pedido_id = p_pedido_id AND producto_id = v_producto_id AND empresa_id = p_empresa_id
      FOR UPDATE;

      IF v_pedido_item_id IS NOT NULL THEN
        IF v_entrega_manual_id IS NOT NULL THEN
          v_max_facturable := COALESCE(v_ped_entregada, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := FALSE;
        ELSE
          v_max_facturable := COALESCE(v_ped_cantidad, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := TRUE;
        END IF;

        IF v_cantidad > v_max_facturable THEN
          RAISE EXCEPTION 'Cantidad a facturar (%) supera lo disponible para el producto % del pedido (máximo facturable: %)',
            v_cantidad, v_producto_id, v_max_facturable;
        END IF;

        UPDATE public.pedido_items
        SET cantidad_facturada = COALESCE(cantidad_facturada, 0) + v_cantidad
        WHERE id = v_pedido_item_id;
      END IF;
    END IF;

    IF v_mueve_stock THEN
      SELECT stock_actual INTO v_stock_actual
      FROM public.productos
      WHERE id = v_producto_id AND empresa_id = p_empresa_id
      FOR UPDATE;

      IF v_stock_actual IS NULL THEN
        RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
      END IF;
      IF v_stock_actual < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)',
          v_producto_id, v_stock_actual, v_cantidad;
      END IF;

      UPDATE public.productos
      SET stock_actual = stock_actual - v_cantidad
      WHERE id = v_producto_id;
    END IF;

    v_factor := CASE v_alicuota
      WHEN '21'   THEN 1.21
      WHEN '10.5' THEN 1.105
      ELSE 1
    END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));

    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id,
      cantidad, precio_unitario, subtotal, alicuota_iva,
      precio_original, descuento_pct, descuento_monto,
      oferta_id, descuento_manual_pct
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id,
      v_cantidad, v_precio_unitario,
      v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item,
      v_oferta_id, v_descuento_manual_pct
    );

    v_descuento_global_monto := v_descuento_global_monto
                                + (v_descuento_monto_item * v_cantidad);
    v_bruto_total := v_bruto_total + (v_precio_original * v_cantidad);

    IF v_mueve_stock THEN
      INSERT INTO public.movimientos_inventario (
        empresa_id, tenant_id, producto_id,
        tipo, cantidad, motivo, fecha
      ) VALUES (
        p_empresa_id, p_empresa_id, v_producto_id,
        'salida', v_cantidad,
        'Venta #' || p_numero_venta,
        p_fecha
      );
    END IF;
  END LOOP;

  v_descuento_global_pct := CASE
    WHEN v_bruto_total > 0
    THEN ROUND(v_descuento_global_monto / v_bruto_total * 100, 2)
    ELSE 0
  END;

  UPDATE public.comprobantes
  SET neto_gravado     = ROUND(v_neto_total, 2),
      iva_discriminado = ROUND(v_iva_total, 2),
      descuento_global_monto = ROUND(v_descuento_global_monto, 2),
      descuento_global_pct = v_descuento_global_pct
  WHERE id = v_comprobante_id;

  IF v_entrega_manual_id IS NOT NULL THEN
    UPDATE public.entregas
    SET comprobante_id = v_comprobante_id
    WHERE id = v_entrega_manual_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      UPDATE public.comprobante_items
      SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id
        AND producto_id   = (v_item->>'producto_id')::UUID;
    END LOOP;
  ELSE
    v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
    INSERT INTO public.entregas (
      empresa_id, user_id, numero_entrega, comprobante_id, cliente_id,
      origen, estado, fecha, pedido_id
    ) VALUES (
      p_empresa_id, p_user_id, v_numero_entrega, v_comprobante_id, p_cliente_id,
      'implicita', 'entregado', CURRENT_DATE, p_pedido_id
    ) RETURNING id INTO v_entrega_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
      VALUES (
        v_entrega_id, p_empresa_id,
        (v_item->>'producto_id')::UUID,
        (v_item->>'cantidad')::INTEGER
      );
      UPDATE public.comprobante_items
      SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id
        AND producto_id   = (v_item->>'producto_id')::UUID;
    END LOOP;
  END IF;

  IF p_pedido_id IS NOT NULL THEN
    UPDATE public.pedidos
    SET comprobante_id = v_comprobante_id
    WHERE id = p_pedido_id AND comprobante_id IS NULL;
  END IF;

  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    IF (v_pago->>'metodo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id,
        tipo, categoria, concepto,
        monto, metodo_pago, fecha, is_automatic,
        monto_paralelo, tc_paralelo
      ) VALUES (
        p_empresa_id, p_user_id, p_caja_sesion_id,
        'ingreso', 'Venta',
        'Venta #' || p_numero_venta,
        ROUND((v_pago->>'monto')::NUMERIC, 2),
        v_pago->>'metodo',
        p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC,
        NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC
      );
    END IF;
  END LOOP;

  IF p_es_cc AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id,
      tipo, monto, descripcion, fecha,
      comprobante_id,
      monto_paralelo, tc_paralelo
    ) VALUES (
      p_empresa_id, p_user_id, p_cliente_id,
      'DEBE', v_total,
      'Venta #' || p_numero_venta,
      p_fecha,
      v_comprobante_id,
      p_monto_paralelo, p_tc_paralelo
    );
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta',   p_numero_venta
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.crear_venta(uuid,uuid,text,timestamptz,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,jsonb,boolean,uuid,uuid,numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.crear_venta(uuid,uuid,text,timestamptz,uuid,text,numeric,text,text,text,numeric,numeric,numeric,jsonb,jsonb,boolean,uuid,uuid,numeric) TO authenticated;

-- ─── Paso 4: registrar_cobro_cliente — diferencia de cambio en el clearing ──
-- Misma firma que migration 169 (CREATE OR REPLACE alcanza, no hay parámetro
-- nuevo — la data de FX viaja dentro de cada item de p_imputaciones).
CREATE OR REPLACE FUNCTION public.registrar_cobro_cliente(
  p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text,
  p_monto numeric, p_metodo text, p_fecha timestamp with time zone,
  p_descripcion text DEFAULT NULL::text, p_caja_sesion_id uuid DEFAULT NULL::uuid,
  p_monto_paralelo numeric DEFAULT NULL::numeric, p_tc_paralelo numeric DEFAULT NULL::numeric,
  p_imputaciones jsonb DEFAULT NULL::jsonb
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
  v_item       jsonb;
  v_factura_id uuid;
  v_monto_imp  numeric;
  v_total_factura     numeric;
  v_ya_imputado        numeric;
  v_saldo_pendiente    numeric;
  v_suma_imputada numeric := 0;
  -- Diferencia de cambio (Open Item clearing en moneda extranjera)
  v_factura_moneda     text;
  v_factura_tc_origen  numeric;
  v_monto_moneda_ext   numeric;
  v_tc_actual          numeric;
  v_monto_imp_actual   numeric;
  v_dif_cambio         numeric;
  v_dif_cambio_total   numeric := 0;
  v_cta_dif_gan        uuid;
  v_cta_dif_perd       uuid;
  v_monto_cxc_cancelado numeric;
  v_total_asiento        numeric;
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

  -- ── Imputación a factura(s) específica(s) — Open Item clearing (opcional) ──
  IF p_imputaciones IS NOT NULL AND jsonb_array_length(p_imputaciones) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
    LOOP
      v_factura_id := (v_item->>'comprobante_id')::uuid;

      -- Lock de la factura para evitar que 2 cobros concurrentes la sobre-imputen.
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
        -- Clearing en moneda extranjera: el TC de la factura cancela su propio
        -- saldo; el TC de hoy determina cuánto efectivo entró realmente. La
        -- diferencia es la diferencia de cambio realizada de este clearing.
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

      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
      FROM public.cuenta_corriente_imputaciones
      WHERE factura_comprobante_id = v_factura_id;

      v_saldo_pendiente := v_total_factura - v_ya_imputado;

      IF v_monto_imp > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto imputado (%) supera el saldo pendiente de la factura (%)', v_monto_imp, v_saldo_pendiente;
      END IF;

      INSERT INTO public.cuenta_corriente_imputaciones
        (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto, monto_moneda_extranjera)
      VALUES (p_empresa_id, v_cc_id, v_factura_id, v_monto_imp, v_monto_moneda_ext);

      v_suma_imputada := v_suma_imputada + v_monto_imp_actual;
    END LOOP;

    IF v_suma_imputada > v_monto THEN
      RAISE EXCEPTION 'La suma imputada a facturas (%) no puede superar el monto del cobro (%)', v_suma_imputada, v_monto;
    END IF;
  END IF;

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

      IF v_dif_cambio_total <> 0 THEN
        SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
        SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
        IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
          v_dif_cambio_total := 0; -- sin cuentas de diferencia de cambio: no se contabiliza (asiento no se rompe)
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
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Cobro recibido', v_monto, 0),
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
  END;

  RETURN jsonb_build_object('ok', true, 'cc_id', v_cc_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado, 'diferencia_cambio', v_dif_cambio_total);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric,jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_cobro_cliente(uuid,uuid,uuid,text,numeric,text,timestamptz,text,uuid,numeric,numeric,jsonb) TO authenticated;

-- ─── Paso 5: registrar_pago_proveedor — diferencia de cambio en el clearing ─
-- Simétrico al Paso 4, con el signo invertido (CxP: TC sube → pérdida, no ganancia).
CREATE OR REPLACE FUNCTION public.registrar_pago_proveedor(
  p_empresa_id uuid, p_user_id uuid, p_proveedor_id uuid, p_proveedor_nombre text,
  p_monto numeric, p_metodo text, p_descripcion text DEFAULT NULL::text,
  p_caja_sesion_id uuid DEFAULT NULL::uuid,
  p_imputaciones jsonb DEFAULT NULL::jsonb
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
  v_item       jsonb;
  v_factura_id uuid;
  v_monto_imp  numeric;
  v_total_factura   numeric;
  v_ya_imputado     numeric;
  v_saldo_pendiente numeric;
  v_suma_imputada   numeric := 0;
  -- Diferencia de cambio (Open Item clearing en moneda extranjera)
  v_compra_moneda      text;
  v_compra_tc_origen   numeric;
  v_monto_moneda_ext   numeric;
  v_tc_actual          numeric;
  v_monto_imp_actual   numeric;
  v_dif_cambio         numeric;
  v_dif_cambio_total   numeric := 0;
  v_cta_dif_gan        uuid;
  v_cta_dif_perd       uuid;
  v_monto_cxp_cancelado numeric;
  v_total_asiento         numeric;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
    END IF;
    IF NOT has_module_permission('compras') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
    END IF;
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

  -- ── Imputación a compra(s) específica(s) — Open Item clearing (opcional) ───
  IF p_imputaciones IS NOT NULL AND jsonb_array_length(p_imputaciones) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_imputaciones)
    LOOP
      v_factura_id := (v_item->>'compra_id')::uuid;

      SELECT total, moneda, tipo_cambio_tasa
      INTO v_total_factura, v_compra_moneda, v_compra_tc_origen
      FROM public.compras
      WHERE id = v_factura_id AND empresa_id = p_empresa_id AND proveedor_id = p_proveedor_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'La compra % no existe o no pertenece a este proveedor', v_factura_id;
      END IF;

      v_monto_moneda_ext := NULLIF(v_item->>'monto_moneda_extranjera', '')::numeric;

      IF v_compra_moneda IS DISTINCT FROM 'ARS' AND v_monto_moneda_ext IS NOT NULL AND v_monto_moneda_ext > 0 THEN
        v_tc_actual        := COALESCE(public.get_tasa_cambio(p_empresa_id, v_compra_moneda, now()::date), v_compra_tc_origen);
        v_monto_imp        := ROUND(v_monto_moneda_ext * v_compra_tc_origen, 2);
        v_monto_imp_actual := ROUND(v_monto_moneda_ext * v_tc_actual, 2);
        v_dif_cambio       := v_monto_imp_actual - v_monto_imp;
        v_dif_cambio_total := v_dif_cambio_total + v_dif_cambio;
      ELSE
        v_monto_imp        := ROUND((v_item->>'monto')::numeric, 2);
        v_monto_imp_actual := v_monto_imp;
        v_monto_moneda_ext := NULL;
      END IF;

      IF v_monto_imp IS NULL OR v_monto_imp <= 0 THEN
        RAISE EXCEPTION 'El monto imputado a la compra % debe ser mayor a cero', v_factura_id;
      END IF;

      SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado
      FROM public.cuenta_corriente_proveedores_imputaciones
      WHERE factura_compra_id = v_factura_id;

      v_saldo_pendiente := v_total_factura - v_ya_imputado;

      IF v_monto_imp > v_saldo_pendiente THEN
        RAISE EXCEPTION 'El monto imputado (%) supera el saldo pendiente de la compra (%)', v_monto_imp, v_saldo_pendiente;
      END IF;

      INSERT INTO public.cuenta_corriente_proveedores_imputaciones
        (empresa_id, pago_movimiento_id, factura_compra_id, monto, monto_moneda_extranjera)
      VALUES (p_empresa_id, v_ccp_id, v_factura_id, v_monto_imp, v_monto_moneda_ext);

      v_suma_imputada := v_suma_imputada + v_monto_imp_actual;
    END LOOP;

    IF v_suma_imputada > v_monto THEN
      RAISE EXCEPTION 'La suma imputada a compras (%) no puede superar el monto del pago (%)', v_suma_imputada, v_monto;
    END IF;
  END IF;

  BEGIN
    BEGIN
      SELECT fecha_en_periodo_cerrado(p_empresa_id, v_fecha_dia) INTO v_cerrado;
    EXCEPTION WHEN undefined_function THEN v_cerrado := false;
    END;

    IF NOT COALESCE(v_cerrado, false) THEN
      SELECT id INTO v_cta_caja FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '1.1.1' AND activa LIMIT 1;
      SELECT id INTO v_cta_cxp  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '2.1.1' AND activa LIMIT 1;

      IF v_dif_cambio_total <> 0 THEN
        SELECT id INTO v_cta_dif_gan  FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '4.4' AND activa LIMIT 1;
        SELECT id INTO v_cta_dif_perd FROM public.plan_cuentas WHERE empresa_id = p_empresa_id AND codigo = '5.9' AND activa LIMIT 1;
        IF v_cta_dif_gan IS NULL OR v_cta_dif_perd IS NULL THEN
          v_dif_cambio_total := 0;
        END IF;
      END IF;

      v_monto_cxp_cancelado := v_monto - v_dif_cambio_total;
      v_total_asiento       := v_monto + GREATEST(-v_dif_cambio_total, 0);

      IF v_cta_caja IS NOT NULL AND v_cta_cxp IS NOT NULL THEN
        INSERT INTO public.asientos_contables
          (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
        VALUES (
          p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), v_fecha_dia,
          'Pago a ' || COALESCE(NULLIF(p_proveedor_nombre, ''), 'proveedor'),
          'confirmado', v_total_asiento, v_total_asiento, 'pago_proveedor', v_ccp_id
        ) RETURNING id INTO v_asiento_id;

        INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
          (v_asiento_id, p_empresa_id, v_cta_cxp,  'Cancelación parcial/total de deuda', v_monto_cxp_cancelado, 0),
          (v_asiento_id, p_empresa_id, v_cta_caja, 'Pago realizado', 0, v_monto);

        IF v_dif_cambio_total > 0 THEN
          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, p_empresa_id, v_cta_dif_perd, 'Diferencia de cambio perdida (clearing)', v_dif_cambio_total, 0);
        ELSIF v_dif_cambio_total < 0 THEN
          INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
            (v_asiento_id, p_empresa_id, v_cta_dif_gan, 'Diferencia de cambio ganada (clearing)', 0, -v_dif_cambio_total);
        END IF;

        v_asiento_generado := true;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  RETURN jsonb_build_object('ok', true, 'ccp_id', v_ccp_id, 'caja_id', v_caja_id, 'asiento_generado', v_asiento_generado, 'diferencia_cambio', v_dif_cambio_total);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid,uuid,uuid,text,numeric,text,text,uuid,jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.registrar_pago_proveedor(uuid,uuid,uuid,text,numeric,text,text,uuid,jsonb) TO authenticated;

-- ─── Paso 6: exponer moneda/tipo_cambio_tasa en las vistas de saldo pendiente
-- (solo APPEND al final — Postgres no permite insertar columnas en el medio de
-- una vista con CREATE OR REPLACE, lección ya aplicada en migration 169).

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
  SELECT factura_comprobante_id, SUM(monto) AS total_imputado
  FROM public.cuenta_corriente_imputaciones
  GROUP BY factura_comprobante_id
) i ON i.factura_comprobante_id = c.id
WHERE c.tipo = 'venta' AND c.cliente_id IS NOT NULL;

CREATE OR REPLACE VIEW public.compras_saldo_pendiente
WITH (security_invoker = true) AS
SELECT
  co.id           AS compra_id,
  co.empresa_id,
  co.proveedor_id,
  co.total,
  COALESCE(i.total_imputado, 0)                     AS total_imputado,
  co.total - COALESCE(i.total_imputado, 0)          AS saldo_pendiente,
  co.moneda,
  co.tipo_cambio_tasa,
  co.monto_moneda_original
FROM public.compras co
LEFT JOIN (
  SELECT factura_compra_id, SUM(monto) AS total_imputado
  FROM public.cuenta_corriente_proveedores_imputaciones
  GROUP BY factura_compra_id
) i ON i.factura_compra_id = co.id;

-- ROLLBACK (comentado):
-- DROP VIEW facturas_saldo_pendiente / compras_saldo_pendiente y recrear como en mig. 169
-- restaurar registrar_cobro_cliente/registrar_pago_proveedor/crear_venta a su versión de mig. 169/anterior
-- DELETE FROM plan_cuentas WHERE codigo IN ('4.4','5.9')
-- ALTER TABLE comprobantes/compras DROP COLUMN monto_moneda_original
-- ALTER TABLE cuenta_corriente_imputaciones/cuenta_corriente_proveedores_imputaciones DROP COLUMN monto_moneda_extranjera
