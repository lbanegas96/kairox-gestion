-- Migration 396 -- Fixes de la Auditoría de Circuitos (13/09/2026).
-- 8 errores críticos + 2 medios directamente acoplados, encontrados en el
-- operativo de pruebas end-to-end de Compras/Ventas/Inventario. Ver
-- CONTEXT.md y la memoria de sesión "pendiente-fix-auditoria-circuitos"
-- para el detalle completo de cada hallazgo y su reproducción.

-- ============================================================================
-- 1) regenerar_asiento_compra -- agrega el mismo escape hatch service_role
--    que ya tienen crear_asiento_automatico/registrar_pago_proveedor, para
--    poder llamarla de forma atómica desde registrar_factura_compra_oc (ahí
--    get_my_empresa_id() no resuelve un usuario real dentro de la misma
--    transacción SECURITY DEFINER) y para poder probarla directo por SQL.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.regenerar_asiento_compra(p_compra_id uuid, p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_compra RECORD;
  v_cerrado boolean;
  v_cta_pago uuid; v_cta_mercaderias uuid; v_cta_iva uuid;
  v_es_credito boolean;
  v_asiento_id uuid;
  v_fecha_dia date;
BEGIN
  SELECT c.empresa_id, c.total, c.neto_gravado, c.iva_discriminado, c.forma_pago,
         COALESCE(c.numero_factura, 'S/N') AS numero_factura, c.fecha::date, c.asiento_id
    INTO v_compra
    FROM public.compras c
   WHERE c.id = p_compra_id;

  IF v_compra.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Compra no encontrada';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF v_compra.empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
      RAISE EXCEPTION 'No autorizado: la compra no pertenece a esta empresa';
    END IF;
    IF NOT has_module_permission('compras') THEN
      RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
    END IF;
  END IF;
  IF v_compra.asiento_id IS NOT NULL THEN
    RAISE EXCEPTION 'Esta compra ya tiene un asiento contable generado';
  END IF;

  -- Autoreparación (mig.303): mismo criterio que regenerar_asiento_venta.
  SELECT id INTO v_asiento_id
    FROM public.asientos_contables
   WHERE origen = 'compra' AND origen_id = p_compra_id
   LIMIT 1;
  IF v_asiento_id IS NOT NULL THEN
    UPDATE public.compras SET asiento_id = v_asiento_id WHERE id = p_compra_id;
    RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id, 'reconectado', true);
  END IF;

  v_fecha_dia := v_compra.fecha;
  SELECT fecha_en_periodo_cerrado(v_compra.empresa_id, v_fecha_dia) INTO v_cerrado;
  IF COALESCE(v_cerrado, false) THEN
    RAISE EXCEPTION 'El período de esta compra (%) está cerrado — reabrilo en Plan de Cuentas antes de regenerar el asiento', v_fecha_dia;
  END IF;

  v_es_credito := v_compra.forma_pago = 'Cuenta Corriente';
  SELECT id INTO v_cta_pago        FROM public.plan_cuentas WHERE empresa_id = v_compra.empresa_id AND codigo = (CASE WHEN v_es_credito THEN '2.1.1' ELSE '1.1.1' END) AND activa LIMIT 1;
  SELECT id INTO v_cta_mercaderias FROM public.plan_cuentas WHERE empresa_id = v_compra.empresa_id AND codigo = '1.1.3' AND activa LIMIT 1;
  SELECT id INTO v_cta_iva         FROM public.plan_cuentas WHERE empresa_id = v_compra.empresa_id AND codigo = '1.1.4' AND activa LIMIT 1;
  IF v_cta_pago IS NULL OR v_cta_mercaderias IS NULL THEN
    RAISE EXCEPTION 'Falta configurar las cuentas contables de Pago o Mercaderías en Plan de Cuentas';
  END IF;

  INSERT INTO public.asientos_contables
    (empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id)
  VALUES (
    v_compra.empresa_id, p_user_id, next_numero_asiento(v_compra.empresa_id), v_fecha_dia,
    'Compra ' || v_compra.numero_factura,
    'confirmado', v_compra.total, v_compra.total, 'compra', p_compra_id
  ) RETURNING id INTO v_asiento_id;

  IF v_cta_iva IS NOT NULL AND COALESCE(v_compra.neto_gravado, 0) + COALESCE(v_compra.iva_discriminado, 0) > 0 THEN
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_compra.empresa_id, v_cta_mercaderias, 'Compra de mercadería (neto)', v_compra.neto_gravado, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_iva,         'IVA Crédito Fiscal', v_compra.iva_discriminado, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_pago,        'Pago por compra', 0, v_compra.total);
  ELSE
    INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber) VALUES
      (v_asiento_id, v_compra.empresa_id, v_cta_mercaderias, 'Compra de mercadería', v_compra.total, 0),
      (v_asiento_id, v_compra.empresa_id, v_cta_pago,        'Pago por compra', 0, v_compra.total);
  END IF;

  UPDATE public.compras SET asiento_id = v_asiento_id WHERE id = p_compra_id;

  RETURN jsonb_build_object('ok', true, 'asiento_id', v_asiento_id);
END;
$function$;

-- ============================================================================
-- 2) registrar_factura_compra_oc -- CRÍTICO #1: nunca generaba asiento
--    contable. Ahora lo genera atómicamente (graceful: si falla por período
--    cerrado o cuenta faltante, la factura y la Cta.Cte. se guardan igual --
--    mismo criterio que registrar_pago_proveedor), reutilizando la lógica ya
--    probada de regenerar_asiento_compra en vez de duplicarla.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.registrar_factura_compra_oc(p_empresa_id uuid, p_user_id uuid, p_orden_compra_id uuid, p_numero_factura text, p_fecha_factura date, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_oc RECORD;
  v_compra_id UUID;
  v_cc_id UUID;
  v_item JSONB;
  v_cantidad NUMERIC;
  v_precio NUMERIC;
  v_alicuota NUMERIC;
  v_neto_item NUMERIC;
  v_subtotal_neto NUMERIC := 0;
  v_total_iva NUMERIC := 0;
  v_total NUMERIC;
  v_producto_id UUID;
  v_oci_id UUID;
  v_oci_recibida NUMERIC;
  v_oci_facturada NUMERIC;
  v_max_facturable NUMERIC;
  v_totalmente_facturada BOOLEAN;
  v_asiento_generado BOOLEAN := false;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT * INTO v_oc FROM public.ordenes_compra
  WHERE id = p_orden_compra_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden de compra no encontrada';
  END IF;

  IF v_oc.estado NOT IN ('recibida', 'recibida_parcial') THEN
    RAISE EXCEPTION 'La OC debe tener al menos una recepción antes de registrar la factura (estado actual: %)', v_oc.estado;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La factura debe tener al menos un ítem';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad    := (v_item->>'cantidad')::NUMERIC;
    v_producto_id := NULLIF(v_item->>'producto_id', '')::UUID;
    IF v_producto_id IS NOT NULL THEN
      SELECT id, cantidad_recibida, cantidad_facturada
        INTO v_oci_id, v_oci_recibida, v_oci_facturada
      FROM public.ordenes_compra_items
      WHERE orden_id = p_orden_compra_id AND producto_id = v_producto_id AND empresa_id = p_empresa_id
      FOR UPDATE;
      IF v_oci_id IS NOT NULL THEN
        v_max_facturable := COALESCE(v_oci_recibida, 0) - COALESCE(v_oci_facturada, 0);
        IF v_cantidad > v_max_facturable THEN
          RAISE EXCEPTION 'Cantidad a facturar (%) supera lo disponible para el producto % (máximo facturable: %)',
            v_cantidad, v_producto_id, v_max_facturable;
        END IF;
      END IF;
    END IF;
  END LOOP;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'costo_unitario_neto')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_neto_item := v_cantidad * v_precio;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_neto_item * v_alicuota / 100);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la factura debe ser mayor a cero'; END IF;

  INSERT INTO public.compras (
    empresa_id, user_id, proveedor_id, numero_factura, fecha, orden_compra_id,
    forma_pago, estado_pago, total, neto_gravado, iva_discriminado, moneda, tipo_cambio_tasa
  ) VALUES (
    p_empresa_id, p_user_id, v_oc.proveedor_id, p_numero_factura, p_fecha_factura, p_orden_compra_id,
    v_oc.forma_pago, 'pendiente', v_total, v_subtotal_neto, v_total_iva, v_oc.moneda, v_oc.tipo_cambio_tasa
  ) RETURNING id INTO v_compra_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'costo_unitario_neto')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_producto_id := NULLIF(v_item->>'producto_id', '')::UUID;
    INSERT INTO public.detalle_compras (
      compra_id, empresa_id, producto_id, cantidad, costo_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_compra_id, p_empresa_id, v_producto_id,
      v_cantidad, v_precio, v_cantidad * v_precio, v_alicuota::TEXT
    );

    IF v_producto_id IS NOT NULL THEN
      UPDATE public.ordenes_compra_items
         SET cantidad_facturada = COALESCE(cantidad_facturada, 0) + v_cantidad
       WHERE orden_id = p_orden_compra_id AND producto_id = v_producto_id AND empresa_id = p_empresa_id;
    END IF;
  END LOOP;

  SELECT bool_and(cantidad_facturada >= cantidad_pedida) INTO v_totalmente_facturada
    FROM public.ordenes_compra_items WHERE orden_id = p_orden_compra_id;
  IF COALESCE(v_totalmente_facturada, false) THEN
    UPDATE public.ordenes_compra SET estado = 'facturada' WHERE id = p_orden_compra_id;
  END IF;

  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_oc.proveedor_id, 'compra', v_total,
    'Factura ' || COALESCE(NULLIF(p_numero_factura, ''), 'S/N') || ' — OC ' || v_oc.numero,
    v_compra_id, 'compra_oc', p_fecha_factura
  ) RETURNING id INTO v_cc_id;

  -- CRÍTICO #1 -- antes esta función nunca generaba asiento. Ahora reutiliza
  -- regenerar_asiento_compra (misma lógica ya probada), envuelta en un bloque
  -- best-effort: si falla (período cerrado, cuenta faltante), la factura y
  -- la Cta.Cte. ya quedaron guardadas -- el usuario puede reintentar con
  -- "Regenerar asiento" desde el detalle, mismo patrón que Compra Rápida.
  BEGIN
    PERFORM public.regenerar_asiento_compra(v_compra_id, p_user_id);
    v_asiento_generado := true;
  EXCEPTION WHEN OTHERS THEN
    v_asiento_generado := false;
  END;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id,
    'total', v_total,
    'neto_gravado', v_subtotal_neto,
    'iva_discriminado', v_total_iva,
    'cc_movimiento_id', v_cc_id,
    'asiento_generado', v_asiento_generado
  );
END;
$function$;

-- ============================================================================
-- 3) cancelar_compra -- 3 fixes en la misma función:
--    a) CRÍTICO #2: restaba stock de más cuando la factura viene de una OC
--       con Recepción propia vigente (la mercadería entró por esa Recepción,
--       que NO se toca al cancelar la factura -- Regla 8 SAP).
--    b) Reapertura de la OC (mismo criterio que crear_nota_credito_proveedor
--       ya calcula vía oc_reabrible, pero acá se aplica directo: al anular
--       una factura COMPLETA, a diferencia de una NC parcial, no hace falta
--       dejarlo como decisión manual).
--    c) Reversa del asiento contable (Storno: asiento nuevo con debe/haber
--       invertidos, nunca se edita el original) -- antes dependía 100% de
--       una llamada aparte desde el frontend (asientosAutoService), y ahora
--       que la Factura por OC SÍ tiene asiento (fix #2 arriba), dejar ese
--       lado sin arreglar hubiera sido un fix a medias.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancelar_compra(
  p_empresa_id uuid,
  p_user_id    uuid,
  p_compra_id  uuid,
  p_motivo     text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_compra             RECORD;
  v_item               RECORD;
  v_prov_nombre        TEXT;
  v_concepto_esperado  TEXT;
  v_cc_reversado       NUMERIC := 0;
  v_total_recibido     NUMERIC;
  v_total_pedido       NUMERIC;
  v_nuevo_estado_oc    TEXT;
  v_asiento_reversa_id UUID;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;

  SELECT * INTO v_compra FROM public.compras
  WHERE id = p_compra_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Factura de compra no encontrada';
  END IF;

  IF v_compra.estado_pago = 'anulada' THEN
    RAISE EXCEPTION 'Esta factura ya está anulada';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cuenta_corriente_proveedores_imputaciones WHERE factura_compra_id = p_compra_id
  ) THEN
    RAISE EXCEPTION 'Esta factura ya tiene pagos imputados desde Cuenta Corriente — no se puede anular directamente. Generá una Nota de Crédito de Proveedor.';
  END IF;

  -- 1. Reversar stock -- SOLO si esta factura NO vino de una OC (Compra
  --    Rápida / Factura directa: acá la factura ES el evento físico, Regla 8).
  --    Si vino de una OC, el stock ya entró por la Recepción -- un documento
  --    aparte que sigue vigente y no se toca acá.
  IF v_compra.orden_compra_id IS NULL THEN
    FOR v_item IN
      SELECT * FROM public.detalle_compras
      WHERE compra_id = p_compra_id AND empresa_id = p_empresa_id AND producto_id IS NOT NULL
    LOOP
      UPDATE public.productos SET stock_actual = COALESCE(stock_actual, 0) - v_item.cantidad
      WHERE id = v_item.producto_id AND empresa_id = p_empresa_id;

      INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
      VALUES (p_empresa_id, p_empresa_id, v_item.producto_id, 'salida', v_item.cantidad,
              'Anulación de Factura ' || COALESCE(NULLIF(v_compra.numero_factura, ''), 'S/N'), now());
    END LOOP;
  END IF;

  -- 2. Revertir cantidad_facturada en la OC de origen, si esta factura vino
  --    de "Registrar Factura desde OC" (mig.332), y reabrir la OC si
  --    corresponde (deja de estar 100% facturada).
  IF v_compra.orden_compra_id IS NOT NULL THEN
    FOR v_item IN
      SELECT producto_id, cantidad FROM public.detalle_compras
      WHERE compra_id = p_compra_id AND empresa_id = p_empresa_id AND producto_id IS NOT NULL
    LOOP
      UPDATE public.ordenes_compra_items
      SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - v_item.cantidad)
      WHERE orden_id = v_compra.orden_compra_id AND producto_id = v_item.producto_id AND empresa_id = p_empresa_id;
    END LOOP;

    SELECT estado INTO v_nuevo_estado_oc FROM public.ordenes_compra WHERE id = v_compra.orden_compra_id;
    IF v_nuevo_estado_oc = 'facturada' THEN
      SELECT COALESCE(SUM(cantidad_pedida), 0), COALESCE(SUM(cantidad_recibida), 0)
        INTO v_total_pedido, v_total_recibido
      FROM public.ordenes_compra_items WHERE orden_id = v_compra.orden_compra_id;

      -- Mismo cálculo que fn_oc_recalcular_estado (trigger de cantidad_recibida) --
      -- se repite acá inline porque esa es una función de trigger (espera
      -- OLD/NEW), no se puede invocar directo fuera de ese contexto.
      IF v_total_recibido <= 0 THEN
        v_nuevo_estado_oc := 'enviada';
      ELSIF v_total_recibido >= v_total_pedido THEN
        v_nuevo_estado_oc := 'recibida';
      ELSE
        v_nuevo_estado_oc := 'recibida_parcial';
      END IF;
      UPDATE public.ordenes_compra SET estado = v_nuevo_estado_oc WHERE id = v_compra.orden_compra_id;
    END IF;
  END IF;

  -- 3. Reversar movimientos_caja (solo si se pagó en Efectivo al crearla).
  IF v_compra.proveedor_id IS NOT NULL THEN
    SELECT nombre INTO v_prov_nombre FROM public.proveedores WHERE id = v_compra.proveedor_id;
  END IF;
  v_concepto_esperado := 'Factura proveedor ' || COALESCE(NULLIF(v_compra.numero_factura, ''), 'S/N')
                         || ' — ' || COALESCE(v_prov_nombre, 'Proveedor');

  IF v_compra.forma_pago = 'Efectivo' THEN
    INSERT INTO public.movimientos_caja (
      empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha
    )
    SELECT mc.empresa_id, auth.uid(), mc.caja_sesion_id, 'ingreso', 'Compra',
           'Anulación ' || mc.concepto, mc.monto, mc.metodo_pago, true, now()
    FROM public.movimientos_caja mc
    WHERE mc.empresa_id = p_empresa_id
      AND mc.tipo = 'egreso'
      AND mc.concepto = v_concepto_esperado
      AND mc.monto = v_compra.total
    LIMIT 1;
  END IF;

  -- 4. Reversar Cuenta Corriente del proveedor.
  IF v_compra.proveedor_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_cc_reversado
    FROM public.cuenta_corriente_proveedores
    WHERE referencia_id = p_compra_id AND tipo = 'compra' AND empresa_id = p_empresa_id;

    IF v_cc_reversado > 0 THEN
      INSERT INTO public.cuenta_corriente_proveedores (
        empresa_id, user_id, proveedor_id, tipo, monto, descripcion, referencia_id, referencia_tipo, fecha
      ) VALUES (
        p_empresa_id, p_user_id, v_compra.proveedor_id, 'nota_credito', v_cc_reversado,
        'Anulación Factura ' || COALESCE(NULLIF(v_compra.numero_factura, ''), 'S/N') || COALESCE(' — ' || NULLIF(p_motivo, ''), ''),
        p_compra_id, 'anulacion_compra', now()
      );
    END IF;
  END IF;

  -- 5. Reversar el asiento contable (Storno) -- best-effort, nunca bloquea
  --    la anulación en sí. El asiento original NUNCA se edita.
  IF v_compra.asiento_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.asientos_contables (
        empresa_id, user_id, numero, fecha, descripcion, estado, total_debe, total_haber, origen, origen_id
      )
      SELECT p_empresa_id, p_user_id, next_numero_asiento(p_empresa_id), CURRENT_DATE,
             'Anulación Factura ' || COALESCE(NULLIF(v_compra.numero_factura, ''), 'S/N'),
             'confirmado', ac.total_debe, ac.total_haber, 'anulacion_compra', p_compra_id
      FROM public.asientos_contables ac WHERE ac.id = v_compra.asiento_id
      RETURNING id INTO v_asiento_reversa_id;

      INSERT INTO public.asientos_items (asiento_id, empresa_id, cuenta_id, descripcion, debe, haber)
      SELECT v_asiento_reversa_id, p_empresa_id, ai.cuenta_id, 'Reversa: ' || ai.descripcion, ai.haber, ai.debe
      FROM public.asientos_items ai WHERE ai.asiento_id = v_compra.asiento_id;
    EXCEPTION WHEN OTHERS THEN
      v_asiento_reversa_id := NULL;
    END;
  END IF;

  -- 6. Estado final.
  UPDATE public.compras SET estado_pago = 'anulada' WHERE id = p_compra_id AND empresa_id = p_empresa_id;

  RETURN jsonb_build_object(
    'compra_id', p_compra_id,
    'numero_factura', v_compra.numero_factura,
    'total', v_compra.total,
    'asiento_reversa_id', v_asiento_reversa_id
  );
END;
$function$;

-- ============================================================================
-- 4) aplicar_compra_producto -- CRÍTICO #3: Compra Rápida / Factura de
--    Proveedor directa no dejaban rastro en movimientos_inventario, aunque
--    stock_actual sí subía -- rompía la reconciliación de Kardex (confirmado:
--    8 unidades de diferencia sobre un producto de prueba real).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.aplicar_compra_producto(p_producto_id uuid, p_cantidad numeric, p_costo_nuevo numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id   UUID;
  v_stock_previo NUMERIC;
  v_costo_previo NUMERIC;
  v_metodo       TEXT;
  v_costo_final  NUMERIC;
BEGIN
  SELECT empresa_id, stock_actual, costo_compra
    INTO v_empresa_id, v_stock_previo, v_costo_previo
  FROM public.productos
  WHERE id = p_producto_id AND empresa_id = get_my_empresa_id();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  SELECT metodo_valoracion_stock INTO v_metodo
  FROM public.empresas WHERE id = v_empresa_id;

  v_costo_final := public.fn_calcular_costo_valoracion(
    COALESCE(v_metodo, 'ultimo_costo'), v_stock_previo, v_costo_previo, p_cantidad, p_costo_nuevo
  );

  UPDATE public.productos
  SET stock_actual = COALESCE(stock_actual, 0) + p_cantidad,
      costo_compra  = v_costo_final
  WHERE id = p_producto_id;

  INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
  VALUES (v_empresa_id, p_producto_id, 'ingreso', p_cantidad, 'Compra directa', auth.uid());

  PERFORM public.fn_recalcular_precio_venta_por_lista_base(p_producto_id, v_costo_final);

  RETURN v_costo_final;
END;
$function$;

-- ============================================================================
-- 5) crear_nota_credito_proveedor -- CRÍTICO #4: con reembolso_efectivo=true
--    acreditaba Caja Y Cuenta Corriente por el mismo hecho económico. El
--    reembolso en efectivo salda la NC en el momento -- nunca debería dejar
--    un saldo a favor permanente en Cta.Cte. (mismo criterio ya aplicado en
--    crear_devolucion/crearAsientoDevolucion para devoluciones con reembolso).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.crear_nota_credito_proveedor(
  p_empresa_id         uuid,
  p_user_id            uuid,
  p_proveedor_id       uuid,
  p_motivo             text,
  p_items              jsonb,
  p_compra_id          uuid    DEFAULT NULL::uuid,
  p_reembolso_efectivo boolean DEFAULT false,
  p_caja_sesion_id     uuid    DEFAULT NULL::uuid,
  p_devolucion_id      uuid    DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ncp_id UUID; v_numero TEXT; v_cc_id UUID; v_caja_id UUID; v_descripcion TEXT;
  v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0; v_total NUMERIC;
  v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
  v_orden_compra_id UUID; v_oc_estado TEXT; v_oc_totalmente_facturada BOOLEAN; v_oc_reabrible BOOLEAN := false;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras';
  END IF;
  IF p_proveedor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.proveedores WHERE id = p_proveedor_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'proveedor_id no pertenece a la empresa';
  END IF;
  IF p_compra_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.compras WHERE id = p_compra_id AND empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'compra_id no pertenece a la empresa';
  END IF;
  IF p_devolucion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.devoluciones
     WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'proveedor'
       AND nota_credito_proveedor_id IS NULL
  ) THEN
    RAISE EXCEPTION 'devolucion_id no pertenece a la empresa, no es de proveedor, o ya tiene una NC generada';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La NC debe tener al menos un ítem';
  END IF;
  IF p_reembolso_efectivo AND p_caja_sesion_id IS NULL THEN
    RAISE EXCEPTION 'Reembolso en efectivo requiere una caja abierta';
  END IF;
  IF p_caja_sesion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.caja_sesiones WHERE id = p_caja_sesion_id AND empresa_id = p_empresa_id AND estado = 'abierta'
  ) THEN
    RAISE EXCEPTION 'La caja indicada no pertenece a la empresa o no está abierta';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la NC debe ser mayor a cero'; END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito_proveedor');
  v_descripcion := 'NC ' || v_numero || ' — ' || p_motivo;

  INSERT INTO public.notas_credito_proveedor (
    empresa_id, user_id, numero_ncp, proveedor_id, compra_id, motivo,
    monto, neto_gravado, iva_discriminado, reembolso_efectivo
  ) VALUES (
    p_empresa_id, p_user_id, v_numero, p_proveedor_id, p_compra_id, p_motivo,
    v_total, v_subtotal_neto, v_total_iva, p_reembolso_efectivo
  ) RETURNING id INTO v_ncp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio   := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.notas_credito_proveedor_items (
      nota_credito_proveedor_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, alicuota_iva
    ) VALUES (
      v_ncp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, NULLIF(v_item->>'descripcion', ''),
      v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21')
    );
  END LOOP;

  -- CRÍTICO #4 -- si se reembolsa en efectivo, la NC se salda en el acto: NO
  -- debe dejar además un saldo a favor permanente en Cuenta Corriente (antes
  -- se hacían las dos cosas, duplicando el beneficio). Sin reembolso
  -- efectivo, sigue siendo la única forma en que la NC se refleja.
  IF NOT p_reembolso_efectivo THEN
    INSERT INTO public.cuenta_corriente_proveedores (
      empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
      referencia_id, referencia_tipo, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_proveedor_id, 'nota_credito', v_total, v_descripcion,
      v_ncp_id, 'nc_proveedor', now()
    ) RETURNING id INTO v_cc_id;

    UPDATE public.notas_credito_proveedor SET cc_movimiento_id = v_cc_id WHERE id = v_ncp_id;
  END IF;

  IF p_reembolso_efectivo THEN
    INSERT INTO public.movimientos_caja (
      empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_caja_sesion_id, 'ingreso', 'NC Proveedor', v_descripcion, v_total, 'Efectivo', true, now()
    ) RETURNING id INTO v_caja_id;

    UPDATE public.notas_credito_proveedor SET caja_movimiento_id = v_caja_id WHERE id = v_ncp_id;
  END IF;

  IF p_devolucion_id IS NOT NULL THEN
    UPDATE public.devoluciones
       SET nota_credito_proveedor_id = v_ncp_id, compensacion = 'nota_credito'
     WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'proveedor';
  END IF;

  IF p_compra_id IS NOT NULL THEN
    SELECT orden_compra_id INTO v_orden_compra_id FROM public.compras WHERE id = p_compra_id;

    IF v_orden_compra_id IS NOT NULL THEN
      FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        IF NULLIF(v_item->>'producto_id', '') IS NOT NULL THEN
          UPDATE public.ordenes_compra_items
             SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - (v_item->>'cantidad')::NUMERIC)
           WHERE orden_id = v_orden_compra_id
             AND producto_id = (v_item->>'producto_id')::UUID
             AND empresa_id = p_empresa_id;
        END IF;
      END LOOP;

      SELECT estado INTO v_oc_estado FROM public.ordenes_compra WHERE id = v_orden_compra_id;
      SELECT bool_and(cantidad_facturada >= cantidad_pedida) INTO v_oc_totalmente_facturada
        FROM public.ordenes_compra_items WHERE orden_id = v_orden_compra_id;
      v_oc_reabrible := (v_oc_estado = 'facturada') AND NOT COALESCE(v_oc_totalmente_facturada, true);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'nota_credito_proveedor_id', v_ncp_id, 'numero_ncp', v_numero, 'total', v_total,
    'orden_compra_id', v_orden_compra_id, 'oc_reabrible', v_oc_reabrible
  );
END;
$function$;

-- ============================================================================
-- 6) crear_venta -- CRÍTICO #5: con 2+ entregas manuales del mismo pedido, la
--    factura se podía vincular a la entrega equivocada. Faltaba filtrar por
--    "todavía no vinculada a ninguna factura" (no solo desempatar por fecha) --
--    sin este filtro, una entrega YA vinculada a una factura anterior podía
--    perder ese vínculo al crear una factura nueva para OTRA entrega.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.crear_venta(p_empresa_id uuid, p_user_id uuid, p_numero_venta text, p_fecha timestamp with time zone, p_cliente_id uuid, p_cliente_nombre text, p_total numeric, p_forma_pago text, p_estado_pago text, p_moneda text, p_tipo_cambio_tasa numeric, p_monto_paralelo numeric, p_tc_paralelo numeric, p_items jsonb, p_pagos jsonb, p_es_cc boolean, p_caja_sesion_id uuid, p_pedido_id uuid, p_monto_moneda_original numeric DEFAULT NULL::numeric, p_centro_costo_id uuid DEFAULT NULL::uuid, p_client_uuid uuid DEFAULT NULL::uuid, p_puntos_canjeados integer DEFAULT 0, p_tipo_comprobante_afip text DEFAULT NULL::text, p_punto_venta_id uuid DEFAULT NULL::uuid, p_referencia_cliente text DEFAULT NULL::text, p_factura_reserva boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comprobante_id UUID; v_item JSONB; v_pago JSONB; v_stock_actual NUMERIC(12,3);
  v_stock_disponible NUMERIC(12,3);
  v_cantidad NUMERIC(12,3); v_producto_id UUID; v_alicuota TEXT; v_factor NUMERIC;
  v_subtotal NUMERIC; v_neto_total NUMERIC := 0; v_iva_total NUMERIC := 0;
  v_entrega_id UUID; v_numero_entrega TEXT; v_entrega_manual_id UUID := NULL;
  v_dias_credito INTEGER; v_fecha_vencimiento DATE; v_precio_unitario NUMERIC;
  v_precio_original NUMERIC; v_descuento_pct NUMERIC; v_descuento_monto_item NUMERIC;
  v_oferta_id UUID; v_descuento_manual_pct NUMERIC; v_descuento_global_monto NUMERIC := 0;
  v_descuento_global_pct NUMERIC := 0; v_bruto_total NUMERIC := 0; v_total NUMERIC;
  v_pedido_item_id UUID; v_ped_cantidad NUMERIC; v_ped_entregada NUMERIC;
  v_ped_facturada NUMERIC; v_max_facturable NUMERIC; v_mueve_stock BOOLEAN;
  v_usa_cc BOOLEAN;
  v_unidad_venta_id UUID; v_cantidad_venta NUMERIC; v_precio_unidad_venta NUMERIC;
  v_forma_pago_id UUID; v_metodo_pago TEXT;
  v_costo_unitario NUMERIC; v_costo_total NUMERIC := 0;
  v_existente RECORD;
  v_usa_fidelizacion BOOLEAN; v_pesos_por_punto NUMERIC; v_saldo_puntos INTEGER;
  v_puntos_ganados INTEGER := 0;
  v_dias_acreditacion integer; v_comision_pct numeric; v_monto_pago numeric;
  v_estado_liq_pago text; v_monto_comision_pago numeric; v_monto_neto_pago numeric;
  v_fecha_acred_est_pago date; v_monto_pendiente_liq numeric := 0;
  v_monto_cc numeric := 0; v_monto_cc_paralelo numeric; v_tc_cc_paralelo numeric;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  IF p_client_uuid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_empresa_id::text || ':' || p_client_uuid::text, 0));
    SELECT id, numero_venta, neto_gravado, iva_discriminado, costo_mercaderia_vendida
      INTO v_existente
    FROM public.comprobantes
    WHERE empresa_id = p_empresa_id AND client_uuid = p_client_uuid;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'comprobante_id', v_existente.id,
        'numero_venta', v_existente.numero_venta,
        'neto_gravado', v_existente.neto_gravado,
        'iva_discriminado', v_existente.iva_discriminado,
        'costo_mercaderia_vendida', v_existente.costo_mercaderia_vendida,
        'puntos_ganados', 0,
        'duplicate', true
      );
    END IF;
  END IF;

  IF p_centro_costo_id IS NOT NULL THEN
    SELECT usa_centros_costo INTO v_usa_cc FROM public.empresas WHERE id = p_empresa_id;
    IF NOT COALESCE(v_usa_cc, false) THEN
      RAISE EXCEPTION 'Centros de Costo no está activado para esta empresa. Activalo en Configuración > Finanzas.';
    END IF;
  END IF;

  IF p_factura_reserva AND p_pedido_id IS NULL THEN
    RAISE EXCEPTION 'Factura de Reserva requiere un pedido asociado';
  END IF;

  v_total := ROUND(p_total, 2);
  IF p_cliente_id IS NOT NULL THEN
    SELECT dias_credito, saldo_puntos INTO v_dias_credito, v_saldo_puntos
    FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id FOR UPDATE;

    SELECT usa_fidelizacion, puntos_pesos_por_punto
      INTO v_usa_fidelizacion, v_pesos_por_punto
    FROM public.empresas WHERE id = p_empresa_id;
  END IF;

  IF p_puntos_canjeados > 0 THEN
    IF p_cliente_id IS NULL THEN
      RAISE EXCEPTION 'No se pueden canjear puntos sin un cliente asociado a la venta';
    END IF;
    IF NOT COALESCE(v_usa_fidelizacion, false) THEN
      RAISE EXCEPTION 'Fidelización por puntos no está activada para esta empresa';
    END IF;
    IF COALESCE(v_saldo_puntos, 0) < p_puntos_canjeados THEN
      RAISE EXCEPTION 'Saldo de puntos insuficiente (disponible: %, solicitado: %)', COALESCE(v_saldo_puntos, 0), p_puntos_canjeados;
    END IF;
  END IF;

  v_fecha_vencimiento := p_fecha::date + COALESCE(v_dias_credito, 0);

  IF p_pedido_id IS NOT NULL THEN
    -- CRÍTICO #5 -- antes: sin "comprobante_id IS NULL", una entrega YA
    -- vinculada a otra factura podía perder ese vínculo (se lo robaba una
    -- factura nueva de OTRA entrega del mismo pedido, si empataban en fecha).
    -- Con este filtro, solo se consideran entregas todavía sin reclamar; el
    -- desempate por created_at es la segunda capa de seguridad.
    SELECT id INTO v_entrega_manual_id FROM public.entregas
    WHERE empresa_id = p_empresa_id AND pedido_id = p_pedido_id AND origen = 'manual'
      AND estado = 'entregado' AND comprobante_id IS NULL
    ORDER BY fecha DESC, created_at DESC LIMIT 1;
  END IF;

  IF p_factura_reserva AND v_entrega_manual_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este pedido ya tiene una Entrega registrada — no se puede facturar como Reserva';
  END IF;

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, forma_pago,
    estado_pago, moneda, tipo_cambio_tasa, monto_paralelo, tc_paralelo, tipo, pedido_id,
    fecha_vencimiento, monto_moneda_original, centro_costo_id, client_uuid,
    tipo_comprobante_afip, punto_venta_id, referencia_cliente
  ) VALUES (
    p_empresa_id, p_empresa_id, p_numero_venta, p_fecha, p_cliente_id, p_cliente_nombre, v_total, p_forma_pago,
    p_estado_pago, p_moneda, p_tipo_cambio_tasa, p_monto_paralelo, p_tc_paralelo, 'venta', p_pedido_id,
    v_fecha_vencimiento, ROUND(p_monto_moneda_original, 2), p_centro_costo_id, p_client_uuid,
    p_tipo_comprobante_afip, p_punto_venta_id, NULLIF(TRIM(p_referencia_cliente), '')
  )
  RETURNING id INTO v_comprobante_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_producto_id := (v_item->>'producto_id')::UUID;
    v_cantidad    := (v_item->>'cantidad')::NUMERIC(12,3);
    v_subtotal    := ROUND((v_item->>'subtotal')::NUMERIC, 2);
    v_alicuota    := COALESCE(v_item->>'alicuota_iva', '21');
    v_precio_unitario      := ROUND((v_item->>'precio_unitario')::NUMERIC, 2);
    v_precio_original      := ROUND(COALESCE((v_item->>'precio_original')::NUMERIC, (v_item->>'precio_unitario')::NUMERIC), 2);
    v_descuento_pct        := COALESCE((v_item->>'descuento_pct')::NUMERIC, 0);
    v_descuento_monto_item := ROUND(COALESCE((v_item->>'descuento_monto')::NUMERIC, 0), 2);
    v_oferta_id            := NULLIF(v_item->>'oferta_id', '')::UUID;
    v_descuento_manual_pct := COALESCE((v_item->>'descuento_manual_pct')::NUMERIC, 0);
    v_unidad_venta_id     := NULLIF(v_item->>'unidad_venta_id', '')::UUID;
    v_cantidad_venta      := NULLIF(v_item->>'cantidad_venta', '')::NUMERIC;
    v_precio_unidad_venta := NULLIF(v_item->>'precio_unidad_venta', '')::NUMERIC;
    v_mueve_stock    := TRUE;
    v_pedido_item_id := NULL;
    v_costo_unitario := NULL;
    IF p_pedido_id IS NOT NULL THEN
      v_pedido_item_id := NULLIF(v_item->>'pedido_item_id', '')::UUID;
      IF v_pedido_item_id IS NOT NULL THEN
        SELECT cantidad, cantidad_entregada, cantidad_facturada
          INTO v_ped_cantidad, v_ped_entregada, v_ped_facturada
        FROM public.pedido_items
        WHERE id = v_pedido_item_id AND pedido_id = p_pedido_id AND empresa_id = p_empresa_id
        FOR UPDATE;
        IF v_ped_cantidad IS NULL THEN
          RAISE EXCEPTION 'Ítem de pedido no encontrado: %', v_pedido_item_id;
        END IF;
      ELSE
        SELECT id, cantidad, cantidad_entregada, cantidad_facturada
          INTO v_pedido_item_id, v_ped_cantidad, v_ped_entregada, v_ped_facturada
        FROM public.pedido_items
        WHERE pedido_id = p_pedido_id AND producto_id = v_producto_id AND empresa_id = p_empresa_id
        FOR UPDATE;
      END IF;
      IF v_pedido_item_id IS NOT NULL THEN
        IF v_entrega_manual_id IS NOT NULL THEN
          v_max_facturable := COALESCE(v_ped_entregada, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := FALSE;
        ELSE
          v_max_facturable := COALESCE(v_ped_cantidad, 0) - COALESCE(v_ped_facturada, 0);
          v_mueve_stock    := TRUE;
        END IF;
        IF v_cantidad > v_max_facturable THEN
          RAISE EXCEPTION 'Cantidad a facturar (%) supera lo disponible para el producto % del pedido (máximo facturable: %)', v_cantidad, v_producto_id, v_max_facturable;
        END IF;
        UPDATE public.pedido_items SET cantidad_facturada = COALESCE(cantidad_facturada, 0) + v_cantidad WHERE id = v_pedido_item_id;
      END IF;
    END IF;
    IF p_factura_reserva THEN
      v_mueve_stock := FALSE;
    END IF;

    SELECT stock_actual, costo_compra INTO v_stock_actual, v_costo_unitario
    FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
    IF v_stock_actual IS NULL THEN
      RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id;
    END IF;

    IF v_mueve_stock THEN
      SELECT stock_disponible INTO v_stock_disponible
      FROM public.productos_stock_disponible
      WHERE producto_id = v_producto_id AND empresa_id = p_empresa_id;

      IF COALESCE(v_stock_disponible, v_stock_actual) < v_cantidad THEN
        RAISE EXCEPTION 'Stock insuficiente para producto % (disponible: %, requerido: %)', v_producto_id, COALESCE(v_stock_disponible, v_stock_actual), v_cantidad;
      END IF;

      UPDATE public.productos SET stock_actual = stock_actual - v_cantidad WHERE id = v_producto_id;
    END IF;

    v_costo_total := v_costo_total + (COALESCE(v_costo_unitario, 0) * v_cantidad);

    v_factor := CASE v_alicuota WHEN '21' THEN 1.21 WHEN '10.5' THEN 1.105 ELSE 1 END;
    v_neto_total := v_neto_total + (v_subtotal / v_factor);
    v_iva_total  := v_iva_total  + (v_subtotal - (v_subtotal / v_factor));
    INSERT INTO public.comprobante_items (
      comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva,
      precio_original, descuento_pct, descuento_monto, oferta_id, descuento_manual_pct,
      unidad_venta_id, cantidad_venta, precio_unidad_venta, costo_unitario
    ) VALUES (
      v_comprobante_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unitario, v_subtotal, v_alicuota,
      v_precio_original, v_descuento_pct, v_descuento_monto_item, v_oferta_id, v_descuento_manual_pct,
      v_unidad_venta_id, v_cantidad_venta, v_precio_unidad_venta, v_costo_unitario
    );
    v_descuento_global_monto := v_descuento_global_monto + (v_descuento_monto_item * v_cantidad);
    v_bruto_total := v_bruto_total + (v_precio_original * v_cantidad);
    IF v_mueve_stock THEN
      INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
      VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'salida', v_cantidad, 'Venta #' || p_numero_venta, p_fecha);
    END IF;
  END LOOP;
  v_descuento_global_pct := CASE WHEN v_bruto_total > 0 THEN ROUND(v_descuento_global_monto / v_bruto_total * 100, 2) ELSE 0 END;
  UPDATE public.comprobantes SET neto_gravado = ROUND(v_neto_total, 2), iva_discriminado = ROUND(v_iva_total, 2),
    descuento_global_monto = ROUND(v_descuento_global_monto, 2), descuento_global_pct = v_descuento_global_pct,
    costo_mercaderia_vendida = ROUND(v_costo_total, 2)
  WHERE id = v_comprobante_id;
  IF v_entrega_manual_id IS NOT NULL THEN
    UPDATE public.entregas SET comprobante_id = v_comprobante_id WHERE id = v_entrega_manual_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      UPDATE public.comprobante_items SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id AND producto_id = (v_item->>'producto_id')::UUID;
    END LOOP;
  ELSIF p_factura_reserva THEN
    NULL;
  ELSE
    v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
    INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, comprobante_id, cliente_id, origen, estado, fecha, pedido_id)
    VALUES (p_empresa_id, auth.uid(), v_numero_entrega, v_comprobante_id, p_cliente_id, 'implicita', 'entregado', CURRENT_DATE, p_pedido_id)
    RETURNING id INTO v_entrega_id;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
      INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad)
      VALUES (v_entrega_id, p_empresa_id, (v_item->>'producto_id')::UUID, (v_item->>'cantidad')::NUMERIC(12,3));
      UPDATE public.comprobante_items SET cantidad_entregada = (v_item->>'cantidad')::NUMERIC
      WHERE comprobante_id = v_comprobante_id AND producto_id = (v_item->>'producto_id')::UUID;
    END LOOP;
  END IF;
  IF p_pedido_id IS NOT NULL THEN
    UPDATE public.pedidos SET comprobante_id = v_comprobante_id WHERE id = p_pedido_id AND comprobante_id IS NULL;
  END IF;
  FOR v_pago IN SELECT * FROM jsonb_array_elements(p_pagos)
  LOOP
    IF (v_pago->>'metodo') IS DISTINCT FROM 'Cuenta Corriente' THEN
      v_forma_pago_id := NULLIF(v_pago->>'forma_pago_id', '')::uuid;
      v_metodo_pago := v_pago->>'metodo';
      v_dias_acreditacion := 0;
      v_comision_pct := 0;
      IF v_forma_pago_id IS NOT NULL THEN
        SELECT nombre, dias_acreditacion, comision_porcentaje
          INTO v_metodo_pago, v_dias_acreditacion, v_comision_pct
        FROM public.formas_pago
         WHERE id = v_forma_pago_id AND empresa_id = p_empresa_id;
        IF v_metodo_pago IS NULL THEN
          RAISE EXCEPTION 'La forma de pago no existe o no pertenece a la empresa';
        END IF;
      END IF;

      v_monto_pago := ROUND((v_pago->>'monto')::NUMERIC, 2);

      IF COALESCE(v_dias_acreditacion, 0) > 0 THEN
        v_estado_liq_pago      := 'pendiente';
        v_monto_comision_pago  := ROUND(v_monto_pago * COALESCE(v_comision_pct, 0) / 100, 2);
        v_monto_neto_pago      := v_monto_pago - v_monto_comision_pago;
        v_fecha_acred_est_pago := p_fecha::date + v_dias_acreditacion;
        v_monto_pendiente_liq  := v_monto_pendiente_liq + v_monto_pago;
      ELSE
        v_estado_liq_pago      := 'acreditado';
        v_monto_comision_pago  := 0;
        v_monto_neto_pago      := NULL;
        v_fecha_acred_est_pago := NULL;
      END IF;

      INSERT INTO public.movimientos_caja (
        empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, fecha, is_automatic, monto_paralelo, tc_paralelo, forma_pago_id, comprobante_id,
        estado_liquidacion, monto_comision, monto_neto, fecha_acreditacion_estimada
      ) VALUES (
        p_empresa_id, auth.uid(), p_caja_sesion_id, 'ingreso', 'Venta', 'Venta #' || p_numero_venta,
        v_monto_pago, v_metodo_pago, p_fecha, true,
        NULLIF(v_pago->>'monto_paralelo', '')::NUMERIC, NULLIF(v_pago->>'tc_paralelo', '')::NUMERIC, v_forma_pago_id, v_comprobante_id,
        v_estado_liq_pago, v_monto_comision_pago, v_monto_neto_pago, v_fecha_acred_est_pago
      );
    END IF;
  END LOOP;

  SELECT (p->>'monto')::numeric, NULLIF(p->>'monto_paralelo', '')::numeric, NULLIF(p->>'tc_paralelo', '')::numeric
    INTO v_monto_cc, v_monto_cc_paralelo, v_tc_cc_paralelo
  FROM jsonb_array_elements(p_pagos) p
  WHERE p->>'metodo' = 'Cuenta Corriente'
  LIMIT 1;
  v_monto_cc := ROUND(COALESCE(v_monto_cc, 0), 2);
  IF p_es_cc AND v_monto_cc = 0 THEN
    v_monto_cc := v_total;
    v_monto_cc_paralelo := p_monto_paralelo;
    v_tc_cc_paralelo := p_tc_paralelo;
  END IF;

  IF v_monto_cc > 0 AND p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, tipo, monto, descripcion, fecha, comprobante_id, monto_paralelo, tc_paralelo
    ) VALUES (
      p_empresa_id, auth.uid(), p_cliente_id, 'DEBE', v_monto_cc, 'Venta #' || p_numero_venta, p_fecha,
      v_comprobante_id, v_monto_cc_paralelo, v_tc_cc_paralelo
    );
  END IF;

  IF p_puntos_canjeados > 0 THEN
    UPDATE public.clientes SET saldo_puntos = saldo_puntos - p_puntos_canjeados
    WHERE id = p_cliente_id AND empresa_id = p_empresa_id
    RETURNING saldo_puntos INTO v_saldo_puntos;
    INSERT INTO public.movimientos_puntos (empresa_id, cliente_id, comprobante_id, tipo, puntos, saldo_posterior, user_id)
    VALUES (p_empresa_id, p_cliente_id, v_comprobante_id, 'canjeado', p_puntos_canjeados, v_saldo_puntos, auth.uid());
  END IF;

  IF p_cliente_id IS NOT NULL AND COALESCE(v_usa_fidelizacion, false) AND COALESCE(v_pesos_por_punto, 0) > 0 THEN
    v_puntos_ganados := FLOOR(v_total / v_pesos_por_punto)::integer;
    IF v_puntos_ganados > 0 THEN
      UPDATE public.clientes SET saldo_puntos = saldo_puntos + v_puntos_ganados
      WHERE id = p_cliente_id AND empresa_id = p_empresa_id
      RETURNING saldo_puntos INTO v_saldo_puntos;
      INSERT INTO public.movimientos_puntos (empresa_id, cliente_id, comprobante_id, tipo, puntos, saldo_posterior, user_id)
      VALUES (p_empresa_id, p_cliente_id, v_comprobante_id, 'ganado', v_puntos_ganados, v_saldo_puntos, auth.uid());
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'comprobante_id', v_comprobante_id,
    'numero_venta', p_numero_venta,
    'neto_gravado', ROUND(v_neto_total, 2),
    'iva_discriminado', ROUND(v_iva_total, 2),
    'costo_mercaderia_vendida', ROUND(v_costo_total, 2),
    'puntos_ganados', v_puntos_ganados,
    'monto_pendiente_liquidacion', v_monto_pendiente_liq,
    'duplicate', false
  );
END;
$function$;

-- ============================================================================
-- 7) crear_entrega -- CRÍTICO #6: truncaba cantidades fraccionarias a entero
--    (::INTEGER en dos lugares + la variable local v_stock_actual tipada
--    INTEGER) -- afecta ventas por peso/volumen que pasan por Pedido→Entrega.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.crear_entrega(p_empresa_id uuid, p_user_id uuid, p_pedido_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_entrega_id UUID; v_numero_entrega TEXT; v_cliente_id UUID; v_item JSONB; v_stock_actual NUMERIC(12,3);
  v_producto_id UUID; v_cantidad NUMERIC; v_pedido_item_id UUID; v_cant_pedida NUMERIC; v_cant_entregada NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  SELECT cliente_id INTO v_cliente_id FROM public.pedidos WHERE id = p_pedido_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pedido no encontrado o no pertenece a la empresa: %', p_pedido_id; END IF;
  v_numero_entrega := public.obtener_proximo_numero(p_empresa_id, 'entrega');
  INSERT INTO public.entregas (empresa_id, user_id, numero_entrega, pedido_id, cliente_id, origen, estado, fecha)
  VALUES (p_empresa_id, p_user_id, v_numero_entrega, p_pedido_id, v_cliente_id, 'manual', 'entregado', CURRENT_DATE) RETURNING id INTO v_entrega_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID; v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_pedido_item_id := NULLIF(v_item->>'pedido_item_id', '')::UUID;
    IF v_pedido_item_id IS NOT NULL THEN
      SELECT cantidad, cantidad_entregada INTO v_cant_pedida, v_cant_entregada FROM public.pedido_items WHERE id = v_pedido_item_id AND empresa_id = p_empresa_id FOR UPDATE;
      IF v_cant_pedida IS NULL THEN RAISE EXCEPTION 'Ítem de pedido no encontrado: %', v_pedido_item_id; END IF;
      IF COALESCE(v_cant_entregada, 0) + v_cantidad > v_cant_pedida THEN
        RAISE EXCEPTION 'Sobre-entrega: el ítem tiene % pedido(s) y ya se entregaron %. No se puede entregar % más.', v_cant_pedida, COALESCE(v_cant_entregada, 0), v_cantidad;
      END IF;
    END IF;
    SELECT stock_actual INTO v_stock_actual FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
    IF v_stock_actual IS NULL THEN RAISE EXCEPTION 'Producto no encontrado: %', v_producto_id; END IF;
    IF v_stock_actual < v_cantidad THEN RAISE EXCEPTION 'Stock insuficiente para producto %. Disponible: %, Solicitado: %', v_producto_id, v_stock_actual, v_cantidad; END IF;
    UPDATE public.productos SET stock_actual = stock_actual - v_cantidad WHERE id = v_producto_id AND empresa_id = p_empresa_id;
    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'salida', v_cantidad, 'Entrega ' || v_numero_entrega, NOW());
    INSERT INTO public.entrega_items (entrega_id, empresa_id, producto_id, cantidad, pedido_item_id)
    VALUES (v_entrega_id, p_empresa_id, v_producto_id, v_cantidad, v_pedido_item_id);
    IF v_pedido_item_id IS NOT NULL THEN
      UPDATE public.pedido_items SET cantidad_entregada = cantidad_entregada + v_cantidad WHERE id = v_pedido_item_id AND empresa_id = p_empresa_id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('entrega_id', v_entrega_id, 'numero_entrega', v_numero_entrega);
END;
$function$;

-- ============================================================================
-- 8) crear_recepcion / crear_devolucion -- mismo patrón de truncamiento que
--    crear_entrega (::INTEGER), encontrado al revisar el resto de las
--    funciones que insertan en movimientos_inventario. No se había
--    reproducido en vivo (las pruebas usaron cantidades enteras), pero es el
--    mismo bug de raíz -- se corrige acá de una mientras se está arreglando
--    esta clase de error en el resto del sistema.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.crear_recepcion(p_empresa_id uuid, p_user_id uuid, p_orden_compra_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_recepcion_id UUID; v_numero_recepcion TEXT; v_proveedor_id UUID; v_item JSONB; v_producto_id UUID;
  v_cantidad NUMERIC; v_oc_item_id UUID; v_cantidad_pedida NUMERIC; v_cantidad_recibida_actual NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'Acceso denegado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('compras') THEN RAISE EXCEPTION 'No autorizado: sin permiso de módulo compras'; END IF;
  SELECT proveedor_id INTO v_proveedor_id FROM public.ordenes_compra WHERE id = p_orden_compra_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden de compra no encontrada o no pertenece a la empresa: %', p_orden_compra_id; END IF;
  v_numero_recepcion := public.obtener_proximo_numero(p_empresa_id, 'recepcion');
  INSERT INTO public.recepciones (empresa_id, user_id, numero_recepcion, orden_compra_id, proveedor_id, origen, estado, fecha)
  VALUES (p_empresa_id, p_user_id, v_numero_recepcion, p_orden_compra_id, v_proveedor_id, 'manual', 'recibido', CURRENT_DATE) RETURNING id INTO v_recepcion_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID; v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_oc_item_id := NULLIF(v_item->>'orden_compra_item_id', '')::UUID;
    IF v_oc_item_id IS NOT NULL THEN
      SELECT cantidad_pedida, cantidad_recibida INTO v_cantidad_pedida, v_cantidad_recibida_actual FROM public.ordenes_compra_items WHERE id = v_oc_item_id FOR UPDATE;
      IF v_cantidad_recibida_actual + v_cantidad > v_cantidad_pedida THEN
        RAISE EXCEPTION 'La cantidad a recibir (%) superaria lo pedido para el item % (pedido: %, ya recibido: %)', v_cantidad, v_oc_item_id, v_cantidad_pedida, v_cantidad_recibida_actual;
      END IF;
    END IF;
    IF v_oc_item_id IS NULL THEN
      UPDATE public.productos SET stock_actual = stock_actual + v_cantidad WHERE id = v_producto_id AND empresa_id = p_empresa_id;
    END IF;
    INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
    VALUES (p_empresa_id, p_empresa_id, v_producto_id, 'ingreso', v_cantidad, 'Recepción ' || v_numero_recepcion, NOW());
    INSERT INTO public.recepcion_items (recepcion_id, empresa_id, producto_id, cantidad, orden_compra_item_id)
    VALUES (v_recepcion_id, p_empresa_id, v_producto_id, v_cantidad, v_oc_item_id);
    IF v_oc_item_id IS NOT NULL THEN
      UPDATE public.ordenes_compra_items SET cantidad_recibida = cantidad_recibida + v_cantidad WHERE id = v_oc_item_id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('recepcion_id', v_recepcion_id, 'numero_recepcion', v_numero_recepcion);
END;
$function$;

CREATE OR REPLACE FUNCTION public.crear_devolucion(p_empresa_id uuid, p_user_id uuid, p_tipo text, p_items jsonb, p_entrega_id uuid DEFAULT NULL::uuid, p_recepcion_id uuid DEFAULT NULL::uuid, p_comprobante_id uuid DEFAULT NULL::uuid, p_compra_id uuid DEFAULT NULL::uuid, p_cliente_id uuid DEFAULT NULL::uuid, p_proveedor_id uuid DEFAULT NULL::uuid, p_reingresa_stock boolean DEFAULT false, p_reembolso_efectivo boolean DEFAULT false, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_devolucion_id UUID; v_numero_dev TEXT; v_item JSONB; v_producto_id UUID; v_cantidad NUMERIC;
  v_precio_unit NUMERIC; v_subtotal NUMERIC; v_total_dev NUMERIC := 0; v_alicuota TEXT;
  v_caja_sesion_id UUID; v_stock_actual_dev NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN RAISE EXCEPTION 'No autorizado'; END IF;
  IF NOT (has_module_permission('ventas') OR has_module_permission('compras')) THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas o compras';
  END IF;
  v_numero_dev := public.obtener_proximo_numero(p_empresa_id, 'devolucion');
  INSERT INTO public.devoluciones (empresa_id, user_id, numero_devolucion, tipo, entrega_id, recepcion_id, comprobante_id, compra_id, cliente_id, proveedor_id, reingresa_stock, compensacion, reembolso_efectivo, motivo)
  VALUES (p_empresa_id, p_user_id, v_numero_dev, p_tipo, p_entrega_id, p_recepcion_id, p_comprobante_id, p_compra_id, p_cliente_id, p_proveedor_id, p_reingresa_stock, 'pendiente', p_reembolso_efectivo, p_motivo)
  RETURNING id INTO v_devolucion_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_producto_id := (v_item->>'producto_id')::UUID; v_cantidad := (v_item->>'cantidad')::NUMERIC;
    v_precio_unit := (v_item->>'precio_unitario')::NUMERIC; v_subtotal := v_cantidad * v_precio_unit; v_total_dev := v_total_dev + v_subtotal;
    v_alicuota := COALESCE(v_item->>'alicuota_iva', '21');
    INSERT INTO public.devolucion_items (devolucion_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva, comprobante_item_id, detalle_compra_item_id)
    VALUES (v_devolucion_id, p_empresa_id, v_producto_id, v_cantidad, v_precio_unit, v_subtotal, v_alicuota, NULLIF(v_item->>'comprobante_item_id', '')::UUID, NULLIF(v_item->>'detalle_compra_item_id', '')::UUID);
    IF (v_item->>'comprobante_item_id') IS NOT NULL AND (v_item->>'comprobante_item_id') <> '' THEN
      UPDATE public.comprobante_items SET cantidad_devuelta = cantidad_devuelta + v_cantidad WHERE id = (v_item->>'comprobante_item_id')::UUID;
    END IF;
    IF (v_item->>'detalle_compra_item_id') IS NOT NULL AND (v_item->>'detalle_compra_item_id') <> '' THEN
      UPDATE public.detalle_compras SET cantidad_devuelta = cantidad_devuelta + v_cantidad WHERE id = (v_item->>'detalle_compra_item_id')::UUID;
    END IF;
    IF p_reingresa_stock THEN
      IF p_tipo = 'cliente' THEN
        UPDATE public.productos SET stock_actual = stock_actual + v_cantidad WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
        VALUES (p_empresa_id, v_producto_id, 'ingreso', v_cantidad, 'Devolucion cliente ' || v_numero_dev, p_user_id);
      ELSE
        SELECT stock_actual INTO v_stock_actual_dev FROM public.productos WHERE id = v_producto_id AND empresa_id = p_empresa_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', v_producto_id; END IF;
        IF COALESCE(v_stock_actual_dev, 0) - v_cantidad < 0 THEN RAISE EXCEPTION 'Stock insuficiente para devolver al proveedor el producto: %', v_producto_id; END IF;
        UPDATE public.productos SET stock_actual = stock_actual - v_cantidad WHERE id = v_producto_id AND empresa_id = p_empresa_id;
        INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
        VALUES (p_empresa_id, v_producto_id, 'salida', v_cantidad, 'Devolucion a proveedor ' || v_numero_dev, p_user_id);
      END IF;
    END IF;
  END LOOP;

  IF p_reembolso_efectivo THEN
    SELECT id INTO v_caja_sesion_id FROM public.caja_sesiones WHERE empresa_id = p_empresa_id AND estado = 'abierta' ORDER BY apertura_fecha DESC LIMIT 1;
    IF v_caja_sesion_id IS NULL THEN RAISE EXCEPTION 'Caja cerrada: abri la caja para procesar reembolsos en efectivo'; END IF;
    INSERT INTO public.movimientos_caja (empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic)
    VALUES (p_empresa_id, p_user_id, v_caja_sesion_id, CASE WHEN p_tipo = 'cliente' THEN 'egreso' ELSE 'ingreso' END, 'Devoluciones', 'Reembolso devolucion ' || v_numero_dev, v_total_dev, 'Efectivo', TRUE);
  END IF;

  RETURN jsonb_build_object('devolucion_id', v_devolucion_id, 'numero_devolucion', v_numero_dev, 'total', v_total_dev);
END;
$function$;

-- ============================================================================
-- 9) ajustar_stock_manual -- CRÍTICO #7 (mitad 1) + M3: el ajuste guardaba
--    el valor ABSOLUTO resultante en movimientos_inventario en vez del
--    delta aplicado (rompe Kardex; ya afecta un producto real de Nalux).
--    Se reclasifica a 'entrada'/'salida' según el signo del delta -- mismo
--    criterio que ya usan esos dos tipos (magnitud + tipo implica signo),
--    sin requerir ningún cambio de frontend (TabHistorialMovimientos.jsx ya
--    muestra '+'/'-' según tipo). Si el ajuste no cambia nada (delta=0), no
--    inserta ningún movimiento fantasma. También agrega el guard de período
--    contable cerrado que ya tenían Recuento/Revalorización y a este le
--    faltaba.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.ajustar_stock_manual(p_producto_id uuid, p_tipo text, p_cantidad integer, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id uuid;
  v_stock_actual integer;
  v_nuevo_stock integer;
  v_costo_unitario numeric;
  v_delta integer;
BEGIN
  v_empresa_id := get_my_empresa_id();

  IF p_tipo NOT IN ('entrada', 'salida', 'ajuste') THEN
    RAISE EXCEPTION 'Tipo de movimiento inválido: %', p_tipo;
  END IF;

  IF p_cantidad < 0 THEN
    RAISE EXCEPTION 'Cantidad inválida: %', p_cantidad;
  END IF;

  IF fecha_en_periodo_cerrado(v_empresa_id, CURRENT_DATE) THEN
    RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado.', CURRENT_DATE;
  END IF;

  SELECT stock_actual, costo_compra INTO v_stock_actual, v_costo_unitario
  FROM public.productos
  WHERE id = p_producto_id AND empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado o sin permiso: %', p_producto_id;
  END IF;

  IF p_tipo = 'entrada' THEN
    v_nuevo_stock := v_stock_actual + p_cantidad;
  ELSIF p_tipo = 'salida' THEN
    v_nuevo_stock := v_stock_actual - p_cantidad;
  ELSE
    v_nuevo_stock := p_cantidad; -- ajuste: valor absoluto (inventario físico)
  END IF;

  IF v_nuevo_stock < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para el producto: %', p_producto_id;
  END IF;

  UPDATE public.productos
  SET stock_actual = v_nuevo_stock
  WHERE id = p_producto_id;

  v_delta := v_nuevo_stock - v_stock_actual;
  IF v_delta > 0 THEN
    INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
    VALUES (v_empresa_id, p_producto_id, 'entrada', v_delta, p_motivo, auth.uid());
  ELSIF v_delta < 0 THEN
    INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
    VALUES (v_empresa_id, p_producto_id, 'salida', ABS(v_delta), p_motivo, auth.uid());
  END IF;
  -- v_delta = 0 (ajuste al mismo valor que ya tenía): no se movió nada, no
  -- se inserta ningún movimiento.

  RETURN jsonb_build_object(
    'delta', v_delta,
    'costo_unitario', COALESCE(v_costo_unitario, 0)
  );
END;
$function$;

-- ============================================================================
-- 10) confirmar_recuento_inventario -- CRÍTICO #7 (mitad 2): mismo bug que
--     ajustar_stock_manual, mismo fix (guardar el delta, reclasificar a
--     entrada/salida). El resto de la función (un solo asiento consolidado,
--     guard de período cerrado) ya estaba bien.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.confirmar_recuento_inventario(p_recuento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_empresa_id UUID := get_my_empresa_id();
  v_recuento RECORD;
  v_item RECORD;
  v_diferencia INTEGER;
  v_total_faltante NUMERIC := 0;
  v_total_sobrante NUMERIC := 0;
BEGIN
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  SELECT * INTO v_recuento FROM public.recuentos_inventario
  WHERE id = p_recuento_id AND empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recuento no encontrado';
  END IF;
  IF v_recuento.estado <> 'borrador' THEN
    RAISE EXCEPTION 'El recuento ya está %', v_recuento.estado;
  END IF;
  IF fecha_en_periodo_cerrado(v_empresa_id, v_recuento.fecha::date) THEN
    RAISE EXCEPTION 'Período cerrado: la fecha % pertenece a un período contable cerrado.', v_recuento.fecha::date;
  END IF;

  FOR v_item IN
    SELECT * FROM public.recuento_inventario_items
    WHERE recuento_id = p_recuento_id
      AND cantidad_contada IS NOT NULL
      AND cantidad_contada <> stock_sistema
    FOR UPDATE
  LOOP
    v_diferencia := v_item.cantidad_contada - v_item.stock_sistema;

    UPDATE public.productos
    SET stock_actual = v_item.cantidad_contada
    WHERE id = v_item.producto_id AND empresa_id = v_empresa_id;

    IF v_diferencia > 0 THEN
      INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
      VALUES (v_empresa_id, v_item.producto_id, 'entrada', v_diferencia,
              'Recuento ' || v_recuento.numero, auth.uid());
      v_total_sobrante := v_total_sobrante + (v_diferencia * v_item.costo_unitario);
    ELSE
      INSERT INTO public.movimientos_inventario (empresa_id, producto_id, tipo, cantidad, motivo, user_id)
      VALUES (v_empresa_id, v_item.producto_id, 'salida', ABS(v_diferencia),
              'Recuento ' || v_recuento.numero, auth.uid());
      v_total_faltante := v_total_faltante + (ABS(v_diferencia) * v_item.costo_unitario);
    END IF;
  END LOOP;

  UPDATE public.recuentos_inventario
  SET estado = 'confirmado', confirmado_at = NOW()
  WHERE id = p_recuento_id;

  RETURN jsonb_build_object(
    'total_faltante', ROUND(v_total_faltante, 2),
    'total_sobrante', ROUND(v_total_sobrante, 2)
  );
END;
$function$;

-- ============================================================================
-- 11) movimientos_puntos -- agrega 'reversion' como tipo válido, para poder
--     distinguir (auditoría) una reversa automática por cancelación de un
--     'ajuste_manual' hecho a mano por un usuario.
-- ============================================================================
ALTER TABLE public.movimientos_puntos DROP CONSTRAINT IF EXISTS movimientos_puntos_tipo_check;
ALTER TABLE public.movimientos_puntos ADD CONSTRAINT movimientos_puntos_tipo_check
  CHECK (tipo = ANY (ARRAY['ganado'::text, 'canjeado'::text, 'ajuste_manual'::text, 'reversion'::text]));

-- ============================================================================
-- 12) cancelar_factura (Ventas) -- CRÍTICO #8: no revertía los puntos de
--     fidelización ganados/canjeados por la venta que se anula -- el saldo
--     de puntos del cliente quedaba desalineado para siempre.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancelar_factura(p_empresa_id uuid, p_user_id uuid, p_comprobante_id uuid, p_motivo text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp     RECORD;
  v_entrega  RECORD;
  v_item     RECORD;
  v_puntos   RECORD;
  v_saldo_puntos_post INTEGER;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;

  SELECT * INTO v_comp FROM public.comprobantes
  WHERE id = p_comprobante_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comprobante no encontrado';
  END IF;

  IF v_comp.tipo <> 'venta' THEN
    RAISE EXCEPTION 'Solo se pueden cancelar Facturas de Venta (tipo actual: %)', v_comp.tipo;
  END IF;

  IF v_comp.estado_pago = 'cancelada' THEN
    RAISE EXCEPTION 'Esta factura ya está cancelada';
  END IF;

  IF COALESCE(v_comp.cae_estado, 'no_aplica') IN ('emitido', 'pendiente', 'pendiente_caea') THEN
    RAISE EXCEPTION 'Esta factura tiene CAE emitido (o en trámite ante AFIP) — no se puede cancelar directamente. Generá una Nota de Crédito para anularla.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cuenta_corriente_imputaciones WHERE factura_comprobante_id = p_comprobante_id
  ) THEN
    RAISE EXCEPTION 'Esta factura ya tiene cobros imputados desde Cuenta Corriente — no se puede cancelar directamente. Generá una Nota de Crédito.';
  END IF;

  -- 1. Reversar stock SOLO de la entrega 'implicita' ligada a esta factura.
  FOR v_entrega IN
    SELECT * FROM public.entregas
    WHERE comprobante_id = p_comprobante_id AND empresa_id = p_empresa_id AND estado <> 'anulado'
  LOOP
    IF v_entrega.origen = 'implicita' THEN
      FOR v_item IN
        SELECT * FROM public.entrega_items WHERE entrega_id = v_entrega.id
      LOOP
        UPDATE public.productos SET stock_actual = stock_actual + v_item.cantidad
        WHERE id = v_item.producto_id AND empresa_id = p_empresa_id;

        INSERT INTO public.movimientos_inventario (empresa_id, tenant_id, producto_id, tipo, cantidad, motivo, fecha)
        VALUES (p_empresa_id, p_empresa_id, v_item.producto_id, 'entrada', v_item.cantidad,
                'Cancelación de Factura ' || v_comp.numero_venta, now());
      END LOOP;

      UPDATE public.entregas SET estado = 'anulado' WHERE id = v_entrega.id;
    ELSE
      UPDATE public.entregas SET comprobante_id = NULL WHERE id = v_entrega.id;
    END IF;
  END LOOP;

  -- 2. Revertir cantidad_facturada en pedido_items si esta factura vino de un pedido
  IF v_comp.pedido_id IS NOT NULL THEN
    FOR v_item IN
      SELECT ci.producto_id, ci.cantidad
      FROM public.comprobante_items ci
      WHERE ci.comprobante_id = p_comprobante_id AND ci.producto_id IS NOT NULL
    LOOP
      UPDATE public.pedido_items
      SET cantidad_facturada = GREATEST(0, COALESCE(cantidad_facturada, 0) - v_item.cantidad)
      WHERE pedido_id = v_comp.pedido_id AND producto_id = v_item.producto_id AND empresa_id = p_empresa_id;
    END LOOP;
  END IF;

  -- 3. Reversar movimientos_caja.
  INSERT INTO public.movimientos_caja (
    empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha, comprobante_id
  )
  SELECT empresa_id, auth.uid(), caja_sesion_id, 'egreso', 'Venta',
         'Cancelación Factura ' || v_comp.numero_venta, monto, metodo_pago, true, now(), p_comprobante_id
  FROM public.movimientos_caja mc
  WHERE mc.empresa_id = p_empresa_id
    AND mc.tipo = 'ingreso'
    AND (
      mc.comprobante_id = p_comprobante_id
      OR (mc.comprobante_id IS NULL AND mc.concepto IN ('Venta #' || v_comp.numero_venta, 'Factura ' || v_comp.numero_venta))
    );

  -- 4. Reversar cuenta corriente.
  IF v_comp.cliente_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.cuenta_corriente_movimientos
    WHERE comprobante_id = p_comprobante_id AND tipo = 'DEBE'
  ) THEN
    INSERT INTO public.cuenta_corriente_movimientos (
      empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha
    ) VALUES (
      p_empresa_id, auth.uid(), v_comp.cliente_id, p_comprobante_id, 'HABER',
      public.monto_cc_original_comprobante(p_comprobante_id),
      'Cancelación Factura ' || v_comp.numero_venta || COALESCE(' — ' || NULLIF(p_motivo, ''), ''), now()
    );
  END IF;

  -- 5. CRÍTICO #8 -- reversar puntos de fidelización ganados/canjeados por
  --    esta venta, si el cliente los tiene. Nunca deja el saldo de puntos
  --    desalineado por una venta que ya no existe.
  IF v_comp.cliente_id IS NOT NULL THEN
    FOR v_puntos IN
      SELECT * FROM public.movimientos_puntos
      WHERE comprobante_id = p_comprobante_id AND tipo IN ('ganado', 'canjeado')
    LOOP
      IF v_puntos.tipo = 'ganado' THEN
        UPDATE public.clientes SET saldo_puntos = GREATEST(0, saldo_puntos - v_puntos.puntos)
        WHERE id = v_comp.cliente_id AND empresa_id = p_empresa_id
        RETURNING saldo_puntos INTO v_saldo_puntos_post;
      ELSE
        UPDATE public.clientes SET saldo_puntos = saldo_puntos + v_puntos.puntos
        WHERE id = v_comp.cliente_id AND empresa_id = p_empresa_id
        RETURNING saldo_puntos INTO v_saldo_puntos_post;
      END IF;

      INSERT INTO public.movimientos_puntos (empresa_id, cliente_id, comprobante_id, tipo, puntos, saldo_posterior, user_id)
      VALUES (p_empresa_id, v_comp.cliente_id, p_comprobante_id, 'reversion', v_puntos.puntos, v_saldo_puntos_post, auth.uid());
    END LOOP;
  END IF;

  -- 6. Estado final.
  UPDATE public.comprobantes SET estado_pago = 'cancelada', cae_estado = 'no_aplica' WHERE id = p_comprobante_id;

  RETURN jsonb_build_object(
    'comprobante_id', p_comprobante_id,
    'numero_venta',   v_comp.numero_venta,
    'total',          v_comp.total
  );
END;
$function$;
