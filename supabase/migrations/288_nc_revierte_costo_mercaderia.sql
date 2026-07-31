-- migration 288 — la Nota de Crédito revierte el Costo de Mercadería Vendida
--
-- HALLAZGO (auditoría de Inventario/COGS, continuación de mig.287): cuando un
-- cliente devuelve mercadería, `crear_devolucion` restaura el stock físico
-- correctamente (`productos.stock_actual`), pero la Nota de Crédito que
-- eventualmente compensa esa devolución (`crearAsientoNotaCliente`) solo
-- revierte Ventas + IVA Débito contra CxC — nunca toca `5.1 Costo de
-- Mercaderías` ni `1.1.3 Inventario`. Con mig.287 contabilizando el costo en
-- cada venta, esto se vuelve una asimetría real: el stock vuelve, la venta se
-- revierte, pero el costo original queda cargado para siempre sin su
-- contrapartida de ingreso.
--
-- Fix: `crear_nota_credito` calcula el costo a revertir uniendo
-- `devolucion_items.comprobante_item_id` con `comprobante_items.costo_unitario`
-- (mig.287) — SOLO cuando la NC viene de una Devolución con `reingresa_stock =
-- true` (una NC financiera sin devolución de mercadería no debe tocar
-- Inventario). Se guarda en `comprobantes.costo_mercaderia_vendida` (mismo
-- campo que usan las Ventas, reutilizado con el signo semántico correcto según
-- el tipo de documento) y se devuelve en el jsonb para que
-- `crearAsientoNotaCliente` (JS) agregue las 2 líneas correspondientes:
--   Debe 1.1.3 Mercaderías/Inventario (vuelve a entrar) / Haber 5.1 Costo de Mercaderías (se revierte el gasto)

CREATE OR REPLACE FUNCTION public.crear_nota_credito(
  p_empresa_id            uuid,
  p_user_id               uuid,
  p_cliente_id            uuid,
  p_cliente_nombre        text,
  p_motivo_nc             text,
  p_items                 jsonb,
  p_comprobante_origen_id uuid DEFAULT NULL::uuid,
  p_devolucion_id         uuid DEFAULT NULL::uuid,
  p_referencia_cliente    text DEFAULT NULL::text
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

  -- Costo de mercadería a revertir: solo si viene de una devolución que
  -- efectivamente reingresó stock físico.
  IF p_devolucion_id IS NOT NULL THEN
    SELECT reingresa_stock INTO v_reingresa_stock FROM public.devoluciones WHERE id = p_devolucion_id;
    IF COALESCE(v_reingresa_stock, false) THEN
      SELECT COALESCE(SUM(di.cantidad * ci.costo_unitario), 0) INTO v_costo_revertido
      FROM public.devolucion_items di
      JOIN public.comprobante_items ci ON ci.id = di.comprobante_item_id
      WHERE di.devolucion_id = p_devolucion_id AND ci.costo_unitario IS NOT NULL;
    END IF;
  END IF;

  v_numero := public.obtener_proximo_numero(p_empresa_id, 'nota_credito');
  INSERT INTO public.comprobantes (empresa_id, tenant_id, numero_venta, fecha, cliente_id, cliente_nombre, total, neto_gravado, iva_discriminado, forma_pago, estado_pago, moneda, tipo_cambio_tasa, tipo, comprobante_origen_id, motivo_nc, referencia_cliente, costo_mercaderia_vendida)
  VALUES (p_empresa_id, p_empresa_id, v_numero, now(), p_cliente_id, COALESCE(p_cliente_nombre, 'Consumidor Final'), v_total, v_subtotal_neto, v_total_iva, 'Nota de Crédito', 'pagada', 'ARS', 1, 'nota_credito', p_comprobante_origen_id, p_motivo_nc, NULLIF(p_referencia_cliente, ''), ROUND(v_costo_revertido, 2))
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

-- ROLLBACK (comentado): restaurar el body de migration 266 (sin
-- costo_mercaderia_vendida en el INSERT/RETURN).
