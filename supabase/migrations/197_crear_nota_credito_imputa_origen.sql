-- Migration 197 — crear_nota_credito debe imputar contra la factura de origen
-- (hallazgo sesión 60 cont., 2026-07-11).
--
-- crear_nota_credito inserta un HABER en cuenta_corriente_movimientos (reduce el
-- saldo AGREGADO del cliente) pero nunca inserta en cuenta_corriente_imputaciones
-- contra `comprobante_origen_id`. Resultado: el "saldo pendiente por factura"
-- (usado por registrar_cobro_cliente y por mig.196 para estado_pago) ignora la NC
-- por completo. Confirmado con datos reales: 10 facturas con NC en contra, TODAS
-- muestran saldo_pendiente = total original, como si la NC nunca hubiera pasado.
-- Caso más grave encontrado: factura de $8.000 a cuenta corriente (estado_pago=
-- 'pendiente') con una NC de $9.680 (mayor que la factura) ya emitida — el sistema
-- seguiría pidiendo cobrarle los $8.000 completos a un cliente que en realidad no
-- debe nada.
--
-- Fix: si la NC tiene `p_comprobante_origen_id` Y `p_cliente_id` (única combinación
-- donde existe tracking de Open Item), se imputa contra esa factura, topado al
-- saldo pendiente real (nunca más de lo que la factura debe, nunca negativo):
--   monto_a_imputar = LEAST(total_nc, GREATEST(saldo_pendiente_factura, 0))
-- Si la NC excede el saldo (como el caso real de $9.680 vs $8.000), el excedente
-- NO se imputa a esa factura puntual — ya está reflejado en el saldo agregado del
-- cliente vía el HABER existente, que no se toca. Se reutiliza el mismo
-- movimiento HABER de la NC como `cobro_movimiento_id` (ya se capturaba su id).
-- estado_pago de la factura de origen se sincroniza con el mismo patrón de
-- mig.196 ('pagada'/'parcial'/'pendiente'), respetando el CHECK monto > 0 de
-- cuenta_corriente_imputaciones (no se inserta fila si el monto a imputar da 0,
-- ej. la factura ya estaba 100% cobrada antes de la NC).
--
-- Copia fiel del resto de la función (pg_get_functiondef).

CREATE OR REPLACE FUNCTION public.crear_nota_credito(p_empresa_id uuid, p_user_id uuid, p_cliente_id uuid, p_cliente_nombre text, p_motivo_nc text, p_items jsonb, p_comprobante_origen_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_comp_id UUID; v_numero TEXT; v_item JSONB; v_subtotal_neto NUMERIC := 0; v_total_iva NUMERIC := 0;
  v_total NUMERIC; v_cantidad NUMERIC; v_precio NUMERIC; v_alicuota NUMERIC; v_neto_item NUMERIC;
  v_cc_mov_id UUID; v_total_factura_origen NUMERIC; v_ya_imputado_origen NUMERIC; v_saldo_pendiente_origen NUMERIC; v_monto_a_imputar NUMERIC;
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
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'La NC debe tener al menos un ítem'; END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_cantidad := (v_item->>'cantidad')::NUMERIC; v_precio := (v_item->>'precio_unitario')::NUMERIC;
    v_alicuota := COALESCE((v_item->>'alicuota_iva')::NUMERIC, 21); v_neto_item := v_cantidad * v_precio;
    v_subtotal_neto := v_subtotal_neto + v_neto_item; v_total_iva := v_total_iva + (v_neto_item * v_alicuota / 100);
  END LOOP;
  v_total := v_subtotal_neto + v_total_iva;
  IF v_total <= 0 THEN RAISE EXCEPTION 'El total de la NC debe ser mayor a cero'; END IF;
  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito');
  INSERT INTO public.comprobantes (empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, neto_gravado, iva_discriminado, forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo, comprobante_origen_id, motivo_nc)
  VALUES (p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id, COALESCE(p_cliente_nombre, 'Consumidor Final'), v_total, v_subtotal_neto, v_total_iva, 'Nota de Crédito', 'pagada', 'ARS', 1, 'nota_credito', p_comprobante_origen_id, p_motivo_nc)
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

    -- Imputar contra la factura de origen (hallazgo sesión 60 cont.): sin esto, el
    -- saldo "por factura" ignora la NC para siempre.
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
        -- Tope: nunca más de lo que la factura debe realmente, nunca negativo.
        -- Si la NC excede el saldo, el excedente no se imputa acá — ya redujo el
        -- saldo agregado del cliente vía el HABER de arriba.
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
  RETURN jsonb_build_object('comprobante_id', v_comp_id, 'numero_venta', v_numero, 'total', v_total);
END;
$function$;
