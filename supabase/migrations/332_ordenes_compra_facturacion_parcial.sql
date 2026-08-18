-- ════════════════════════════════════════════════════════════════════════════
-- Migration 332 — Facturación parcial de OC + NC de Proveedor reabre (o no)
-- la OC (mismo criterio que Ventas/Pedidos, mig.331, 18/08)
-- ════════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO: hoy una OC solo admite UNA Factura de Proveedor para siempre
-- (índice único `idx_compras_orden_compra_id_unico`, mig.279) — no existe
-- facturación parcial como sí existe del lado de Pedidos desde el Frente 2
-- (15/08). Investigado cómo lo hace SAP B1: trata OC simétrica a Orden de
-- Venta — admite varias facturas parciales, cierra el documento solo cuando
-- se completa, y una NC de proveedor que reduce lo facturado no lo reabre
-- sola (Close/Reopen manual). Se construye completo, estilo SAP, a pedido de
-- Luciano (18/08).
--
-- ── 1. Habilitar múltiples facturas por OC ───────────────────────────────────
DROP INDEX IF EXISTS public.idx_compras_orden_compra_id_unico;

-- ── 2. Nuevo estado 'facturada' — solo cuando TODOS los ítems quedan
--       100% facturados (mismo criterio binario que pedidos.estado) ────────
ALTER TABLE public.ordenes_compra
  DROP CONSTRAINT IF EXISTS ordenes_compra_estado_check;
ALTER TABLE public.ordenes_compra
  ADD CONSTRAINT ordenes_compra_estado_check
  CHECK (estado IN ('borrador','pendiente_aprobacion','enviada','recibida_parcial','recibida','facturada','cancelada'));

-- ── 3. registrar_factura_compra_oc — admite facturación parcial ─────────────
CREATE OR REPLACE FUNCTION public.registrar_factura_compra_oc(
  p_empresa_id       uuid,
  p_user_id          uuid,
  p_orden_compra_id  uuid,
  p_numero_factura   text,
  p_fecha_factura    date,
  p_items            jsonb  -- [{producto_id, cantidad, costo_unitario_neto, alicuota_iva}]
)
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

  -- Tope por ítem: lo que se puede facturar es lo recibido menos lo ya
  -- facturado en facturas anteriores de esta misma OC (financiero sigue al
  -- físico, Regla 8 SAP — mismo criterio que ya usaba el precargado del
  -- frontend, ahora validado también server-side).
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
    v_oc.forma_pago, 'pendiente', v_total, v_subtotal_neto, v_total_iva, 'ARS', 1
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

  -- Cierre por facturación (nunca lo abre, solo lo cierra): solo pasa a
  -- 'facturada' cuando TODOS los ítems quedaron con cantidad_facturada >=
  -- cantidad_pedida. Mismo criterio binario que el fix de Pedidos (18/08).
  SELECT bool_and(cantidad_facturada >= cantidad_pedida) INTO v_totalmente_facturada
    FROM public.ordenes_compra_items WHERE orden_id = p_orden_compra_id;
  IF COALESCE(v_totalmente_facturada, false) THEN
    UPDATE public.ordenes_compra SET estado = 'facturada' WHERE id = p_orden_compra_id;
  END IF;

  -- Open Item: la factura SIEMPRE crea la deuda en Cuenta Corriente. El pago
  -- (inmediato o después) es un evento separado — se salda desde Cuenta
  -- Corriente Proveedores con `registrar_pago_proveedor`, que ya existe y ya
  -- mueve Caja/Bancos y genera su propio asiento.
  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, v_oc.proveedor_id, 'compra', v_total,
    'Factura ' || COALESCE(NULLIF(p_numero_factura, ''), 'S/N') || ' — OC ' || v_oc.numero,
    v_compra_id, 'compra_oc', p_fecha_factura
  ) RETURNING id INTO v_cc_id;

  RETURN jsonb_build_object(
    'compra_id', v_compra_id,
    'total', v_total,
    'neto_gravado', v_subtotal_neto,
    'iva_discriminado', v_total_iva,
    'cc_movimiento_id', v_cc_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_factura_compra_oc(uuid, uuid, uuid, text, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_factura_compra_oc(uuid, uuid, uuid, text, date, jsonb) TO authenticated;

-- ── 4. crear_nota_credito_proveedor — revierte cantidad_facturada de la OC
--       de origen, informa si la OC queda "reabrible" (mismo patrón que
--       mig.331 del lado Ventas) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.crear_nota_credito_proveedor(
  p_empresa_id         uuid,
  p_user_id            uuid,
  p_proveedor_id       uuid,
  p_motivo             text,
  p_items              jsonb,
  p_compra_id          uuid    DEFAULT NULL::uuid,
  p_reembolso_efectivo boolean DEFAULT false,
  p_caja_sesion_id     uuid    DEFAULT NULL::uuid
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

  INSERT INTO public.cuenta_corriente_proveedores (
    empresa_id, user_id, proveedor_id, tipo, monto, descripcion,
    referencia_id, referencia_tipo, fecha
  ) VALUES (
    p_empresa_id, p_user_id, p_proveedor_id, 'nota_credito', v_total, v_descripcion,
    v_ncp_id, 'nc_proveedor', now()
  ) RETURNING id INTO v_cc_id;

  UPDATE public.notas_credito_proveedor SET cc_movimiento_id = v_cc_id WHERE id = v_ncp_id;

  IF p_reembolso_efectivo THEN
    INSERT INTO public.movimientos_caja (
      empresa_id, user_id, caja_sesion_id, tipo, categoria, concepto, monto, metodo_pago, is_automatic, fecha
    ) VALUES (
      p_empresa_id, p_user_id, p_caja_sesion_id, 'ingreso', 'NC Proveedor', v_descripcion, v_total, 'Efectivo', true, now()
    ) RETURNING id INTO v_caja_id;

    UPDATE public.notas_credito_proveedor SET caja_movimiento_id = v_caja_id WHERE id = v_ncp_id;
  END IF;

  -- Revertir cantidad_facturada en la OC de origen (mig.332) — mismo patrón
  -- que mig.331 del lado Ventas: parcial, solo lo que esta NC acredita.
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

      -- No se reabre sola: solo se informa si conviene. El UPDATE de
      -- ordenes_compra.estado lo dispara el frontend si el usuario elige
      -- reabrir. Siempre vuelve a 'recibida' (nunca pudo haber llegado a
      -- 'facturada' sin estar 100% recibida).
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

REVOKE ALL ON FUNCTION public.crear_nota_credito_proveedor(uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_nota_credito_proveedor(uuid, uuid, uuid, text, jsonb, uuid, boolean, uuid) TO authenticated;

-- ROLLBACK (comentado):
--   CREATE UNIQUE INDEX idx_compras_orden_compra_id_unico ON public.compras (orden_compra_id) WHERE orden_compra_id IS NOT NULL;
--   ALTER TABLE public.ordenes_compra DROP CONSTRAINT ordenes_compra_estado_check;
--   ALTER TABLE public.ordenes_compra ADD CONSTRAINT ordenes_compra_estado_check CHECK (estado IN ('borrador','pendiente_aprobacion','enviada','recibida_parcial','recibida','cancelada'));
--   (restaurar registrar_factura_compra_oc de la 279 y crear_nota_credito_proveedor de la 277)
