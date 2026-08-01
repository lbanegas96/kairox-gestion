-- migration 296 — Numeración de NC/ND separada por punto de venta
--
-- Cierra el pendiente explícito dejado por mig.295: en esa migración, NC/ND
-- quedaron afuera del scoping por PdV porque generan su número DENTRO de
-- `crear_nota_credito` / `crear_nota_debito_cliente` (SQL), que no recibían el
-- PdV como parámetro. El motor de numeración (`obtener_proximo_numero` 3-arg)
-- ya soportaba 'nota_credito'/'nota_debito_venta' en su CASE de recuento real
-- — sólo el gate `v_es_scoped` los excluía. Este cambio es mínimo a propósito:
-- ampliar ese gate + pasar el PdV desde las dos RPCs.
--
-- Se reemplaza la única versión viva de cada función — 9 args para
-- crear_nota_credito, 8 para crear_nota_debito_cliente — agregando
-- p_punto_venta_id uuid DEFAULT NULL al final. Nota: CREATE OR REPLACE no
-- sirve acá (probado en sandbox) — Postgres identifica una función por su
-- lista de tipos de argumentos, así que agregar un parámetro (aunque tenga
-- DEFAULT) no "reemplaza" nada, crea un OVERLOAD nuevo y deja el viejo vivo
-- en paralelo. Por eso se hace DROP FUNCTION (firma exacta) + CREATE FUNCTION:
-- mismo conteo total de overloads que antes (el huérfano de 8 args de
-- crear_nota_credito, mig.264, sigue intacto y sin tocar). Como el parámetro
-- nuevo tiene DEFAULT NULL, un caller viejo que llame con los mismos args de
-- siempre (sin p_punto_venta_id) sigue resolviendo a esta misma función, con
-- NULL, y numeración legacy — igual que hoy.
--
-- Verificado que ninguna otra función SQL llama a crear_nota_credito ni a
-- crear_nota_debito_cliente internamente (sólo se invocan vía supabase.rpc
-- desde el frontend) — el DROP no puede romper nada del lado de la base.
--
-- GARANTÍA DE SEGURIDAD (misma que mig.295): PdV es_default → sigue usando la
-- fila legacy de siempre. Sólo un PdV no-default provisiona una serie nueva.

-- ── 1. Ampliar el gate de scoping ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.obtener_proximo_numero(
  p_empresa_id uuid, p_tipo_documento text, p_punto_venta_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_serie       RECORD;
  v_periodo     TEXT;
  v_numero      INTEGER;
  v_max_real    INTEGER;
  v_like_pat    TEXT;
  v_es_scoped   BOOLEAN;
  v_pv_id       uuid;
  v_es_default  BOOLEAN;
  v_pv_numero   INTEGER;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- 'venta'/'factura' (mig.295) + 'nota_credito'/'nota_debito_venta' (mig.296).
  -- Cualquier otro tipo sigue ignorando p_punto_venta_id — sin cambios.
  v_es_scoped := p_tipo_documento IN ('venta', 'factura', 'nota_credito', 'nota_debito_venta')
                 AND p_punto_venta_id IS NOT NULL;

  IF v_es_scoped THEN
    SELECT es_default, numero INTO v_es_default, v_pv_numero
    FROM public.puntos_venta
    WHERE id = p_punto_venta_id AND empresa_id = p_empresa_id;

    v_es_scoped := COALESCE(v_es_default, false) = false;
  END IF;

  v_pv_id := CASE WHEN v_es_scoped THEN p_punto_venta_id ELSE NULL END;

  SELECT * INTO v_serie
  FROM public.series_numeracion
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
    AND punto_venta_id IS NOT DISTINCT FROM v_pv_id
  FOR UPDATE;

  IF NOT FOUND THEN
    IF v_pv_id IS NULL THEN
      PERFORM public.seed_series_numeracion(p_empresa_id);
      SELECT * INTO v_serie
      FROM public.series_numeracion
      WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
        AND punto_venta_id IS NULL
      FOR UPDATE;
    ELSE
      INSERT INTO public.series_numeracion (
        empresa_id, tipo_documento, punto_venta_id, prefijo, formato_fecha, digitos, proximo_numero
      )
      SELECT p_empresa_id, p_tipo_documento, v_pv_id,
             prefijo || v_pv_numero || '-', formato_fecha, digitos, 1
      FROM public.series_numeracion
      WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento AND punto_venta_id IS NULL
      RETURNING * INTO v_serie;
    END IF;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tipo de documento no reconocido: %', p_tipo_documento;
  END IF;

  v_periodo := CASE v_serie.formato_fecha
    WHEN 'YYYYMMDD' THEN to_char(NOW() - INTERVAL '3 hours', 'YYYYMMDD')
    WHEN 'YYYY'     THEN to_char(NOW() - INTERVAL '3 hours', 'YYYY')
    ELSE NULL
  END;

  IF v_periodo IS NOT NULL AND v_periodo IS DISTINCT FROM v_serie.periodo_actual THEN
    v_numero := 1;
  ELSE
    v_numero := v_serie.proximo_numero;
  END IF;

  v_like_pat := v_serie.prefijo || COALESCE(v_periodo || '-', '');

  CASE p_tipo_documento
    WHEN 'venta' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'venta'
        AND c.numero_venta LIKE v_like_pat || '%'
        AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';
    WHEN 'factura' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'venta'
        AND c.numero_venta LIKE v_like_pat || '%'
        AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';
    WHEN 'nota_credito' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'nota_credito'
        AND c.numero_venta LIKE v_like_pat || '%'
        AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';
    WHEN 'nota_debito_venta' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(c.numero_venta, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.comprobantes c
      WHERE c.empresa_id = p_empresa_id AND c.tipo = 'nota_debito'
        AND c.numero_venta LIKE v_like_pat || '%'
        AND regexp_replace(c.numero_venta, '.*-', '') ~ '^[0-9]+$';
    WHEN 'nota_credito_proveedor' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(ncp.numero_ncp, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.notas_credito_proveedor ncp
      WHERE ncp.empresa_id = p_empresa_id
        AND ncp.numero_ncp LIKE v_like_pat || '%'
        AND regexp_replace(ncp.numero_ncp, '.*-', '') ~ '^[0-9]+$';
    WHEN 'entrega' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(e.numero_entrega, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.entregas e
      WHERE e.empresa_id = p_empresa_id
        AND e.numero_entrega LIKE v_like_pat || '%'
        AND regexp_replace(e.numero_entrega, '.*-', '') ~ '^[0-9]+$';
    WHEN 'devolucion' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(d.numero_devolucion, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.devoluciones d
      WHERE d.empresa_id = p_empresa_id
        AND d.numero_devolucion LIKE v_like_pat || '%'
        AND regexp_replace(d.numero_devolucion, '.*-', '') ~ '^[0-9]+$';
    WHEN 'nota_debito' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(nd.numero_nd, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.notas_debito nd
      WHERE nd.empresa_id = p_empresa_id
        AND nd.numero_nd LIKE v_like_pat || '%'
        AND regexp_replace(nd.numero_nd, '.*-', '') ~ '^[0-9]+$';
    WHEN 'recepcion' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(r.numero_recepcion, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.recepciones r
      WHERE r.empresa_id = p_empresa_id
        AND r.numero_recepcion LIKE v_like_pat || '%'
        AND regexp_replace(r.numero_recepcion, '.*-', '') ~ '^[0-9]+$';
    WHEN 'pedido' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(pe.numero, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.pedidos pe
      WHERE pe.empresa_id = p_empresa_id
        AND pe.numero LIKE v_like_pat || '%'
        AND regexp_replace(pe.numero, '.*-', '') ~ '^[0-9]+$';
    WHEN 'cotizacion' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(q.numero, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.cotizaciones q
      WHERE q.empresa_id = p_empresa_id
        AND q.numero LIKE v_like_pat || '%'
        AND regexp_replace(q.numero, '.*-', '') ~ '^[0-9]+$';
    WHEN 'orden_compra' THEN
      SELECT COALESCE(MAX(NULLIF(regexp_replace(oc.numero, '.*-', ''), '')::int), 0)
        INTO v_max_real
      FROM public.ordenes_compra oc
      WHERE oc.empresa_id = p_empresa_id
        AND oc.numero LIKE v_like_pat || '%'
        AND regexp_replace(oc.numero, '.*-', '') ~ '^[0-9]+$';
    ELSE
      v_max_real := NULL;
  END CASE;

  IF v_max_real IS NOT NULL AND v_max_real + 1 > v_numero THEN
    v_numero := v_max_real + 1;
  END IF;

  UPDATE public.series_numeracion
  SET proximo_numero = v_numero + 1,
      periodo_actual = v_periodo
  WHERE empresa_id = p_empresa_id AND tipo_documento = p_tipo_documento
    AND punto_venta_id IS NOT DISTINCT FROM v_pv_id;

  RETURN v_serie.prefijo
    || CASE WHEN v_periodo IS NOT NULL THEN v_periodo || '-' ELSE '' END
    || LPAD(v_numero::TEXT, v_serie.digitos, '0');
END;
$function$;

-- ── 2. crear_nota_credito — DROP la versión viva de 9 args + CREATE con
--       p_punto_venta_id (el huérfano de 8 args, mig.264, no se toca) ───────
DROP FUNCTION IF EXISTS public.crear_nota_credito(
  uuid, uuid, uuid, text, text, jsonb, uuid, uuid, text
);

CREATE FUNCTION public.crear_nota_credito(
  p_empresa_id uuid,
  p_user_id uuid,
  p_cliente_id uuid,
  p_cliente_nombre text,
  p_motivo_nc text,
  p_items jsonb,
  p_comprobante_origen_id uuid DEFAULT NULL::uuid,
  p_devolucion_id uuid DEFAULT NULL::uuid,
  p_referencia_cliente text DEFAULT NULL::text,
  p_punto_venta_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_id UUID; v_numero TEXT; v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0;
  v_total NUMERIC; v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
  v_cc_mov_id UUID; v_total_factura_origen NUMERIC; v_ya_imputado_origen NUMERIC; v_saldo_pendiente_origen NUMERIC; v_monto_a_imputar NUMERIC;
  v_reingresa_stock BOOLEAN; v_costo_revertido NUMERIC := 0;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;
  IF p_comprobante_origen_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_origen_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'comprobante_origen_id no pertenece a la empresa';
  END IF;
  IF p_devolucion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.devoluciones WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'cliente' AND nota_credito_id IS NULL
  ) THEN
    RAISE EXCEPTION 'devolucion_id no pertenece a la empresa, no es de cliente, o ya tiene una NC generada';
  END IF;
  IF p_punto_venta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.puntos_venta WHERE id = p_punto_venta_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'punto_venta_id no pertenece a la empresa';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'La NC debe tener al menos un ítem'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la NC debe ser mayor a cero'; END IF;

  IF p_devolucion_id IS NOT NULL THEN
    SELECT reingresa_stock INTO v_reingresa_stock FROM public.devoluciones WHERE id = p_devolucion_id;
    IF COALESCE(v_reingresa_stock, false) THEN
      SELECT COALESCE(SUM(di.cantidad * ci.costo_unitario), 0) INTO v_costo_revertido
      FROM public.devolucion_items di
      JOIN public.comprobante_items ci ON ci.id = di.comprobante_item_id
      WHERE di.devolucion_id = p_devolucion_id AND ci.costo_unitario IS NOT NULL;
    END IF;
  END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito', p_punto_venta_id);
  INSERT INTO public.comprobantes (empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, neto_gravado, iva_discriminado, forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo, comprobante_origen_id, motivo_nc, referencia_cliente, costo_mercaderia_vendida, punto_venta_id)
  VALUES (p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id, COALESCE(p_cliente_nombre, 'Consumidor Final'), v_total, v_subtotal_neto, v_total_iva, 'Nota de Crédito', 'pagada', 'ARS', 1, 'nota_credito', p_comprobante_origen_id, p_motivo_nc, NULLIF(p_referencia_cliente, ''), ROUND(v_costo_revertido, 2), p_punto_venta_id)
  RETURNING id INTO v_comp_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.comprobante_items (comprobante_id, empresa_id, producto_id, cantidad, precio_unitario, subtotal, alicuota_iva)
    VALUES (v_comp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21'));
  END LOOP;
  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha)
    VALUES (p_empresa_id, p_user_id, p_cliente_id, v_comp_id, 'HABER', v_total, 'NC ' || v_numero || ' — ' || p_motivo_nc, now())
    RETURNING id INTO v_cc_mov_id;

    IF p_comprobante_origen_id IS NOT NULL THEN
      SELECT total INTO v_total_factura_origen
        FROM public.comprobantes
       WHERE id = p_comprobante_origen_id
       FOR UPDATE;

      IF v_total_factura_origen IS NOT NULL THEN
        SELECT COALESCE(SUM(monto), 0) INTO v_ya_imputado_origen
          FROM public.cuenta_corriente_imputaciones
         WHERE factura_comprobante_id = p_comprobante_origen_id;
        v_saldo_pendiente_origen := v_total_factura_origen - v_ya_imputado_origen;
        v_monto_a_imputar := LEAST(v_total, GREATEST(v_saldo_pendiente_origen, 0));

        IF v_monto_a_imputar > 0 THEN
          INSERT INTO public.cuenta_corriente_imputaciones
            (empresa_id, cobro_movimiento_id, factura_comprobante_id, monto)
          VALUES (p_empresa_id, v_cc_mov_id, p_comprobante_origen_id, v_monto_a_imputar);

          UPDATE public.comprobantes
             SET estado_pago = CASE
                                  WHEN (v_ya_imputado_origen + v_monto_a_imputar) >= v_total_factura_origen THEN 'pagada'
                                  WHEN (v_ya_imputado_origen + v_monto_a_imputar) > 0 THEN 'parcial'
                                  ELSE 'pendiente'
                                END
           WHERE id = p_comprobante_origen_id;
        END IF;
      END IF;
    END IF;
  END IF;

  IF p_devolucion_id IS NOT NULL THEN
    UPDATE public.devoluciones
       SET nota_credito_id = v_comp_id, compensacion = 'nota_credito'
     WHERE id = p_devolucion_id AND empresa_id = p_empresa_id AND tipo = 'cliente';
  END IF;

  RETURN jsonb_build_object('comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total, 'costo_mercaderia_vendida', ROUND(v_costo_revertido, 2));
END;
$function$;

-- ── 3. crear_nota_debito_cliente — DROP la única versión existente (8 args)
--       + CREATE con p_punto_venta_id ───────────────────────────────────────
DROP FUNCTION IF EXISTS public.crear_nota_debito_cliente(
  uuid, uuid, uuid, text, text, jsonb, uuid, text
);

CREATE FUNCTION public.crear_nota_debito_cliente(
  p_empresa_id uuid,
  p_user_id uuid,
  p_cliente_id uuid,
  p_cliente_nombre text,
  p_concepto text,
  p_items jsonb,
  p_comprobante_origen_id uuid DEFAULT NULL::uuid,
  p_referencia_cliente text DEFAULT NULL::text,
  p_punto_venta_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_id UUID; v_numero TEXT; v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0;
  v_total NUMERIC; v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_bruto_item NUMERIC;
  v_neto_item NUMERIC; v_factor NUMERIC;
BEGIN
  IF p_empresa_id IS DISTINCT FROM get_my_empresa_id() THEN
    RAISE EXCEPTION 'No autorizado: empresa_id no coincide con el usuario autenticado';
  END IF;
  IF NOT has_module_permission('ventas') THEN
    RAISE EXCEPTION 'No autorizado: sin permiso de módulo ventas';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'cliente_id no pertenece a la empresa';
  END IF;
  IF p_comprobante_origen_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.comprobantes WHERE id = p_comprobante_origen_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'comprobante_origen_id no pertenece a la empresa';
  END IF;
  IF p_punto_venta_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.puntos_venta WHERE id = p_punto_venta_id AND empresa_id = p_empresa_id) THEN
    RAISE EXCEPTION 'punto_venta_id no pertenece a la empresa';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'La ND debe tener al menos un ítem'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21);
    v_bruto_item := v_cantidad * v_precio;
    v_factor := CASE v_alicuota WHEN 21 THEN 1.21 WHEN 10.5 THEN 1.105 ELSE 1 END;
    v_neto_item := v_bruto_item / v_factor;
    v_subtotal_neto := v_subtotal_neto + v_neto_item;
    v_total_iva      := v_total_iva + (v_bruto_item - v_neto_item);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la ND debe ser mayor a cero'; END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_debito_venta', p_punto_venta_id);

  INSERT INTO public.comprobantes (
    empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, neto_gravado,
    iva_discriminado, forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo, comprobante_origen_id,
    motivo_nc, referencia_cliente, punto_venta_id
  )
  VALUES (
    p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id, COALESCE(p_cliente_nombre, 'Consumidor Final'),
    v_total, v_subtotal_neto, v_total_iva, 'Nota de Débito', 'pendiente', 'ARS', 1, 'nota_debito',
    p_comprobante_origen_id, p_concepto, NULLIF(p_referencia_cliente, ''), p_punto_venta_id
  )
  RETURNING id INTO v_comp_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    INSERT INTO public.comprobante_items (comprobante_id, empresa_id, producto_id, descripcion, cantidad, precio_unitario, subtotal, alicuota_iva)
    VALUES (v_comp_id, p_empresa_id, NULLIF(v_item->>'producto_id', '')::UUID, NULLIF(v_item->>'descripcion', ''), v_cantidad, v_precio, v_cantidad * v_precio, COALESCE(v_item->>'alicuota_iva', '21'));
  END LOOP;

  IF p_cliente_id IS NOT NULL THEN
    INSERT INTO public.cuenta_corriente_movimientos (empresa_id, user_id, cliente_id, comprobante_id, tipo, monto, descripcion, fecha)
    VALUES (p_empresa_id, p_user_id, p_cliente_id, v_comp_id, 'DEBE', v_total, 'ND ' || v_numero || ' — ' || p_concepto, now());
  END IF;

  RETURN jsonb_build_object('comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.crear_nota_credito(uuid, uuid, uuid, text, text, jsonb, uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crear_nota_debito_cliente(uuid, uuid, uuid, text, text, jsonb, uuid, text, uuid) TO authenticated;

-- ROLLBACK (comentado):
-- Restaurar los CREATE OR REPLACE de mig.295 (obtener_proximo_numero 3-arg
-- con gate sólo venta/factura) y de las definiciones previas de
-- crear_nota_credito (9 args) / crear_nota_debito_cliente (8 args), sin la
-- columna/parámetro p_punto_venta_id.
