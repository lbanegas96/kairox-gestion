-- Migration 390 -- Auditoría de paridad Compras vs Ventas (04/09), Fase 1,
-- hallazgo 🔴 #2: registrar_factura_compra_oc hardcodeaba moneda='ARS' y
-- tipo_cambio_tasa=1 en el INSERT de `compras`, ignorando la moneda real de
-- la Orden de Compra (v_oc.moneda/v_oc.tipo_cambio_tasa) -- una OC pactada en
-- USD generaba una Factura de Compra en ARS con TC=1, perdiendo la moneda y
-- el tipo de cambio pactado con el proveedor.
--
-- El hallazgo 🔴 #1 (IVA duplicado por copiar un precio bruto como si fuera
-- neto) es un bug de FRONTEND puro (OrdenesCompraSection.jsx `abrirModalFactura`),
-- no requiere cambios de RPC -- se corrige aparte, sin migración.
--
-- Único cambio real: 2 literales por las columnas correspondientes de v_oc.
-- Resto del cuerpo idéntico a la versión de mig.332.
--
-- ROLLBACK: restaurar el CREATE OR REPLACE de mig.332 tal cual (con 'ARS', 1
-- hardcodeados).

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

  -- Fix mig.390: moneda/tipo_cambio_tasa vienen de la OC real, no hardcodeados.
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
