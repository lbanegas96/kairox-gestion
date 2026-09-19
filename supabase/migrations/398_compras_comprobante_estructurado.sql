-- Fase 0 del Plan Libro IVA Digital (19/09) — estructurar el comprobante del
-- proveedor en Compras. Hoy `compras.numero_factura` es texto completamente
-- libre ("77419635", "S/N", null, "VERIF-13-09-C" — verificado contra datos
-- reales de Nalux) y no existe NINGÚN campo con la letra del comprobante
-- (A/B/C/M/E) del proveedor. Sin esto, no hay forma de armar el archivo TXT
-- de Libro IVA Compras que exige ARCA (Fase 2, todavía no construida).
--
-- Nullable a nivel de base a propósito: Luciano confirmó (19/09) que las
-- compras históricas quedan afuera del export, sin backfill retroactivo — la
-- obligatoriedad de estos 3 campos se aplica en el FRONTEND para compras
-- nuevas de acá en adelante, no acá. Un NOT NULL acá rompería las ~40 filas
-- existentes.
--
-- numero_factura se sigue completando igual que siempre (derivado en el
-- frontend a partir de estos 3 campos) — toda la UI/reportes que ya lo leen
-- (ReporteLibroIVACompras, ModalDetalleFacturaCompra, etc.) siguen andando
-- sin cambios.

ALTER TABLE public.compras
  ADD COLUMN tipo_comprobante_letra TEXT
    CHECK (tipo_comprobante_letra IS NULL OR tipo_comprobante_letra IN ('A','B','C','M','E')),
  ADD COLUMN punto_venta_proveedor TEXT,
  ADD COLUMN numero_comprobante_proveedor TEXT;

COMMENT ON COLUMN public.compras.tipo_comprobante_letra IS
  'Letra del comprobante del PROVEEDOR (A/B/C/M/E) — obligatoria en el frontend para altas nuevas desde el 19/09, nula en el historial previo. Necesaria para el export TXT del Libro IVA Digital (voucherTypeAfip).';
COMMENT ON COLUMN public.compras.punto_venta_proveedor IS
  'Punto de venta del comprobante del proveedor, sin ceros a la izquierda forzados acá (se rellenan al exportar). Ver tipo_comprobante_letra.';
COMMENT ON COLUMN public.compras.numero_comprobante_proveedor IS
  'Número (folio) del comprobante del proveedor, sin ceros a la izquierda forzados acá. Ver tipo_comprobante_letra.';

-- registrar_factura_compra_oc — mismo criterio: agrega los 3 parámetros
-- nuevos (DEFAULT NULL para no romper ninguna llamada vieja en caché del
-- lado del cliente durante el rollout) y los persiste en el INSERT.
CREATE OR REPLACE FUNCTION public.registrar_factura_compra_oc(
  p_empresa_id uuid,
  p_user_id uuid,
  p_orden_compra_id uuid,
  p_numero_factura text,
  p_fecha_factura date,
  p_items jsonb,
  p_tipo_comprobante_letra text DEFAULT NULL,
  p_punto_venta_proveedor text DEFAULT NULL,
  p_numero_comprobante_proveedor text DEFAULT NULL
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
    forma_pago, estado_pago, total, neto_gravado, iva_discriminado, moneda, tipo_cambio_tasa,
    tipo_comprobante_letra, punto_venta_proveedor, numero_comprobante_proveedor
  ) VALUES (
    p_empresa_id, p_user_id, v_oc.proveedor_id, p_numero_factura, p_fecha_factura, p_orden_compra_id,
    v_oc.forma_pago, 'pendiente', v_total, v_subtotal_neto, v_total_iva, v_oc.moneda, v_oc.tipo_cambio_tasa,
    p_tipo_comprobante_letra, p_punto_venta_proveedor, p_numero_comprobante_proveedor
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
